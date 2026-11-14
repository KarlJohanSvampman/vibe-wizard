import { VisibilityState, type World } from '@iwsdk/core';
import type { MusicalEvent, NoteOffEvent, NoteOnEvent } from '../audio/events.js';
import { AudioRuntime } from '../audio/AudioRuntime.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Rack } from '../rack/Rack.js';
import { ParameterBus } from '../rack/ParameterBus.js';
import { TrackAudioBus } from '../rack/TrackAudioBus.js';
import { ThereminController } from '../controllers/theremin/ThereminController.js';
import { ThereminSpatialAdapter } from '../controllers/theremin/ThereminSpatialAdapter.js';
import { EventRecorder, type RecordingClip } from '../sequencer/Recorder.js';
import { createSequencerTransport, type TransportState } from '../sequencer/SequencerTransport.js';
import {
  addInstrumentTrack,
  addRecordingToProject,
  createDefaultProject,
  setActiveProjectTrack,
  updateProjectTrack,
  type ProjectClip,
  type ProjectSnapshot,
  type ProjectTrack,
} from '../project/ProjectModel.js';
import {
  createProjectRepository,
  MemoryProjectRepository,
  type ProjectRepository,
} from '../project/ProjectRepository.js';

export function mountWorkbench(root: HTMLElement, world: World): void {
  const rack = new Rack();
  const audioRuntime = new AudioRuntime();
  const parameterBus = new ParameterBus();
  const theremin = rack.add(new ThereminController('theremin-main', parameterBus));
  const recorder = new EventRecorder();
  const trackResources = new Map<string, {
    instrument: AudioEngine;
    bus: TrackAudioBus;
    transport: ReturnType<typeof createSequencerTransport>;
    unsubscribeTransport: () => void;
  }>();
  const noteOwners = new Map<string, AudioEngine>();
  let project: ProjectSnapshot = createDefaultProject('synth-main');
  let selectedClipId: string | undefined;
  let selectedClip: ProjectClip | undefined;
  let repository: ProjectRepository = createProjectRepository();
  let persistenceReady = false;
  let audioReady = false;
  let isDesktopPlaying = false;
  let recordingTrackId: string | undefined;
  let spatialNoteId: string | undefined;
  let spatialNoteCounter = 0;
  let saveQueue: Promise<void> = Promise.resolve();
  const desktopNoteId = 'theremin-desktop-note';

  const activeTrack = (): ProjectTrack =>
    project.tracks.find(track => track.id === project.activeTrackId) ?? project.tracks[0]!;

  const resourceFor = (trackId: string) => trackResources.get(trackId);

  const ensureTrackRuntime = (track: ProjectTrack) => {
    const existing = trackResources.get(track.id);
    if (existing) return existing;

    const instrument = rack.add(new AudioEngine(track.instrumentModuleId, audioRuntime));
    const bus = rack.add(new TrackAudioBus('track-bus-' + track.id, audioRuntime));
    parameterBus.registerTarget(instrument);
    parameterBus.registerTarget(bus);
    parameterBus.addMapping({
      id: 'theremin-x-to-' + instrument.id,
      sourceModuleId: theremin.id,
      sourcePortId: 'x',
      targetModuleId: instrument.id,
      targetParameterId: 'pitch',
      inputRange: [0, 1],
      outputRange: [48, 84],
      curve: 'linear',
      invert: false,
      deadZone: 0,
      smoothingMs: 10,
    });
    parameterBus.addMapping({
      id: 'theremin-y-to-' + instrument.id,
      sourceModuleId: theremin.id,
      sourcePortId: 'y',
      targetModuleId: instrument.id,
      targetParameterId: 'volume',
      inputRange: [0, 1],
      outputRange: [0.025, 0.65],
      curve: 'linear',
      invert: false,
      deadZone: 0,
      smoothingMs: 14,
    });

    const transport = createSequencerTransport(instrument, parameterBus);
    const unsubscribeTransport = transport.subscribe((state) =>
      handleTransportState(track.id, state),
    );
    const resources = { instrument, bus, transport, unsubscribeTransport };
    trackResources.set(track.id, resources);
    if (audioReady) void ensureTrackAudioReady(track.id);
    return resources;
  };

  const ensureTrackAudioReady = async (trackId: string): Promise<void> => {
    const track = project.tracks.find(item => item.id === trackId);
    const resources = track ? resourceFor(trackId) : undefined;
    if (!track || !resources) return;
    const instrumentStart = resources.instrument.start();
    const busStart = resources.bus.start();
    // Both start methods create their graph nodes synchronously before awaiting
    // context resume, so XR input cannot race an unprepared track graph.
    resources.instrument.connectOutput(resources.bus.inputNode);
    await Promise.all([instrumentStart, busStart]);
    applyTrackMix();
  };

  const applyTrackMix = (): void => {
    if (!audioReady) return;
    const anySolo = project.tracks.some(track => track.solo);
    const timestamp = performance.now() / 1000;
    for (const track of project.tracks) {
      const resources = resourceFor(track.id);
      if (!resources) continue;
      const isAudible = !track.muted && (!anySolo || track.solo);
      resources.bus.setParameter('volume', isAudible ? track.volume : 0, timestamp);
      resources.bus.setParameter('pan', track.pan, timestamp);
    }
  };

  const recordEvent = (event: MusicalEvent): void => {
    recorder.record(event);
  };

  const noteKey = (sourceId: string, noteId: string): string => sourceId + ':' + noteId;

  const startNote = (
    sourceId: string,
    noteId: string,
    pitch: number,
    velocity: number,
    timestamp = performance.now() / 1000,
  ): void => {
    const resources = resourceFor(project.activeTrackId);
    if (!resources) return;
    const event: NoteOnEvent = {
      kind: 'note-on',
      sourceId,
      noteId,
      pitch,
      velocity,
      timestamp,
    };
    noteOwners.set(noteKey(sourceId, noteId), resources.instrument);
    resources.instrument.noteOn(event);
    recordEvent(event);
  };

  const stopNote = (
    sourceId: string,
    noteId: string,
    timestamp = performance.now() / 1000,
  ): void => {
    const event: NoteOffEvent = {
      kind: 'note-off',
      sourceId,
      noteId,
      timestamp,
    };
    const key = noteKey(sourceId, noteId);
    const owner = noteOwners.get(key) ?? resourceFor(project.activeTrackId)?.instrument;
    owner?.noteOff(event);
    noteOwners.delete(key);
    recordEvent(event);
  };

  const spatialAdapter = new ThereminSpatialAdapter(world, theremin, {
    handedness: 'right',
    onActiveChange: (active, point, time) => {
      if (active && point) {
        spatialNoteCounter += 1;
        spatialNoteId = 'spatial-note-' + spatialNoteCounter;
        startNote(theremin.id, spatialNoteId, 48 + point.x * 36, 0.85, time);
      } else if (spatialNoteId) {
        stopNote(theremin.id, spatialNoteId, time);
        spatialNoteId = undefined;
      }
    },
  });

  const unsubscribeController = theremin.subscribe(recordEvent);

  root.innerHTML = [
    '<section class="workbench-card">',
    '  <header class="workbench-header">',
    '    <div><p class="eyebrow">IMMERSIVE MUSIC WORKSTATION</p><h1>Vibe-Wizard</h1>',
    '    <p class="subtitle">Create instruments. Shape sounds. Make music.</p></div>',
    '    <span class="prototype-tag">PROTOTYPE 05</span>',
    '  </header>',
    '  <div class="signal-row">',
    '    <span class="signal-dot" id="audio-status-dot"></span>',
    '    <span id="audio-status" role="status">Audio is stopped</span>',
    '    <button class="action-button" id="enable-audio" type="button" disabled>Enable audio</button>',
    '    <button class="action-button enter-vr-button" id="enter-vr" type="button" disabled>Enter VR</button>',
    '  </div>',
    '  <div class="project-toolbar">',
    '    <label class="project-name-field" for="project-name"><span>PROJECT</span>',
    '      <input id="project-name" type="text" maxlength="80" value="Untitled Session" /></label>',
    '    <button class="transport-button" id="project-save" type="button" disabled>Save project</button>',
    '    <span class="project-status" id="project-status" role="status">Loading local project…</span>',
    '  </div>',
    '  <div class="controller-panel">',
    '    <div class="section-heading"><div><p class="eyebrow">LIVE CONTROLLER</p><h2>Virtual theremin</h2></div>',
    '    <span class="module-chip">THEREMIN · 2 AXIS</span></div>',
    '    <label class="control-row" for="theremin-x"><span><strong>X · Pitch</strong><small>Low notes ← → High notes</small></span>',
    '      <input id="theremin-x" type="range" min="0" max="1" value="0.5" step="0.001" /></label>',
    '    <label class="control-row" for="theremin-y"><span><strong>Y · Volume</strong><small>Quiet at bottom · Loud at top</small></span>',
    '      <input id="theremin-y" type="range" min="0" max="1" value="0.55" step="0.001" /></label>',
    '    <div class="controller-readout"><span>X <strong id="x-value">0.500</strong></span>',
    '      <span>Y <strong id="y-value">0.550</strong></span><span>Pitch <strong id="pitch-value">66.0</strong></span></div>',
    '    <button class="play-button" id="play-theremin" type="button" disabled><span class="play-symbol">▶</span>',
    '      <span><strong>Play theremin</strong><small>Press and hold to sustain a tone on desktop</small></span></button>',
    '    <p class="spatial-hint">In VR, enter the session and move your right index fingertip into the floating field. Horizontal movement changes pitch; vertical movement changes volume.</p>',
    '  </div>',
    '  <div class="controller-panel sequencer-panel">',
    '    <div class="section-heading"><div><p class="eyebrow">ARRANGEMENT · TRACKS</p><h2 id="active-track-name">Theremin Synth</h2></div>',
    '      <span class="module-chip" id="clip-summary">NO CLIP</span></div>',
    '    <div class="track-toolbar">',
    '      <label for="track-select"><span>ACTIVE TRACK</span><select id="track-select"></select></label>',
    '      <button class="transport-button" id="add-track" type="button">+ Add instrument</button>',
    '      <button class="transport-button" id="arm-track" type="button">● Armed</button>',
    '      <button class="transport-button" id="mute-track" type="button">Mute</button>',
    '      <button class="transport-button" id="solo-track" type="button">Solo</button>',
    '    </div>',
    '    <div class="track-mixer-controls">',
    '      <label for="track-volume"><span>TRACK LEVEL</span><input id="track-volume" type="range" min="0" max="1" step="0.01" value="0.8" /></label>',
    '      <label for="track-pan"><span>STEREO PAN</span><input id="track-pan" type="range" min="-1" max="1" step="0.01" value="0" /></label>',
    '    </div>',
    '    <div class="clip-library-row">',
    '      <label for="saved-clips"><span>CLIPS ON THIS TRACK</span>',
    '        <select id="saved-clips" disabled><option value="">No saved clips</option></select></label>',
    '    </div>',
    '    <div class="transport-controls">',
    '      <button class="transport-button record-control" id="record-start" type="button" disabled>● Record</button>',
    '      <button class="transport-button" id="record-stop" type="button" disabled>Stop recording</button>',
    '      <button class="transport-button" id="clip-play" type="button" disabled>▶ Play clip</button>',
    '      <button class="transport-button" id="clip-stop" type="button" disabled>■ Stop playback</button>',
    '    </div>',
    '    <div class="timeline-wrap"><canvas id="clip-timeline" width="1000" height="210" aria-label="Recorded notes and theremin automation timeline"></canvas></div>',
    '    <p class="timeline-legend"><span class="legend-x">X · Pitch movement</span><span class="legend-y">Y · Volume movement</span><span class="legend-note">Notes · Held duration</span></p>',
    '    <p class="capture-hint" id="capture-status">Perform with the sliders, desktop button, or VR hand tracking. Recordings are saved to this device.</p>',
    '  </div>',
    '  <footer class="workbench-footer"><span>GLOBAL RACK</span><span>TRACK → CLIPS → TRANSPORT</span><span>LOCAL AUDIO</span></footer>',
    '</section>',
  ].join('');

  const get = <T extends HTMLElement>(selector: string): T | null =>
    root.querySelector<T>(selector);
  const enableButton = get<HTMLButtonElement>('#enable-audio');
  const enterVrButton = get<HTMLButtonElement>('#enter-vr');
  const playButton = get<HTMLButtonElement>('#play-theremin');
  const xInput = get<HTMLInputElement>('#theremin-x');
  const yInput = get<HTMLInputElement>('#theremin-y');
  const status = get<HTMLElement>('#audio-status');
  const statusDot = get<HTMLElement>('#audio-status-dot');
  const xValue = get<HTMLElement>('#x-value');
  const yValue = get<HTMLElement>('#y-value');
  const pitchValue = get<HTMLElement>('#pitch-value');
  const projectNameInput = get<HTMLInputElement>('#project-name');
  const projectSaveButton = get<HTMLButtonElement>('#project-save');
  const projectStatus = get<HTMLElement>('#project-status');
  const trackName = get<HTMLElement>('#active-track-name');
  const trackSelect = get<HTMLSelectElement>('#track-select');
  const addTrackButton = get<HTMLButtonElement>('#add-track');
  const armTrackButton = get<HTMLButtonElement>('#arm-track');
  const muteTrackButton = get<HTMLButtonElement>('#mute-track');
  const soloTrackButton = get<HTMLButtonElement>('#solo-track');
  const trackVolumeInput = get<HTMLInputElement>('#track-volume');
  const trackPanInput = get<HTMLInputElement>('#track-pan');
  const clipSelect = get<HTMLSelectElement>('#saved-clips');
  const recordStartButton = get<HTMLButtonElement>('#record-start');
  const recordStopButton = get<HTMLButtonElement>('#record-stop');
  const clipPlayButton = get<HTMLButtonElement>('#clip-play');
  const clipStopButton = get<HTMLButtonElement>('#clip-stop');
  const clipSummary = get<HTMLElement>('#clip-summary');
  const captureStatus = get<HTMLElement>('#capture-status');
  const timeline = get<HTMLCanvasElement>('#clip-timeline');

  if (
    !enableButton || !enterVrButton || !playButton || !xInput || !yInput ||
    !status || !statusDot || !xValue || !yValue || !pitchValue ||
    !projectNameInput || !projectSaveButton || !projectStatus || !trackName ||
    !trackSelect || !addTrackButton || !armTrackButton || !muteTrackButton ||
    !soloTrackButton || !trackVolumeInput || !trackPanInput ||
    !clipSelect || !recordStartButton || !recordStopButton || !clipPlayButton ||
    !clipStopButton || !clipSummary || !captureStatus || !timeline
  ) {
    spatialAdapter.dispose();
    unsubscribeController();
    throw new Error('The workbench UI is missing a required control.');
  }

  const drawTimeline = (clip: RecordingClip | undefined): void => {
    const context = timeline.getContext('2d');
    if (!context) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(320, timeline.clientWidth || 900);
    const height = 210;
    timeline.width = Math.round(width * dpr);
    timeline.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#100f18';
    context.fillRect(0, 0, width, height);

    const left = 46;
    const right = 14;
    const plotWidth = width - left - right;
    const duration = Math.max(clip?.durationSeconds ?? 0, 1);
    const toX = (seconds: number): number => left + (seconds / duration) * plotWidth;

    context.font = '10px Inter, system-ui, sans-serif';
    context.fillStyle = '#8b8499';
    context.strokeStyle = 'rgba(180, 164, 209, 0.15)';
    context.lineWidth = 1;

    for (let tick = 0; tick <= Math.ceil(duration); tick += 1) {
      const x = toX(tick);
      context.beginPath();
      context.moveTo(x, 12);
      context.lineTo(x, 194);
      context.stroke();
      context.fillText(tick + 's', x + 3, 205);
    }

    const lanes = [
      { top: 18, bottom: 67, label: 'X' },
      { top: 82, bottom: 131, label: 'Y' },
      { top: 146, bottom: 194, label: 'NOTES' },
    ];
    for (const lane of lanes) {
      context.fillStyle = '#938ba2';
      context.fillText(lane.label, 8, lane.top + 12);
      context.strokeStyle = 'rgba(180, 164, 209, 0.18)';
      context.beginPath();
      context.moveTo(left, lane.bottom);
      context.lineTo(width - right, lane.bottom);
      context.stroke();
    }

    if (!clip) {
      context.fillStyle = '#777184';
      context.fillText('Select a saved clip or record a new performance.', left + 10, 111);
      return;
    }

    const controls = clip.events.flatMap(item =>
      item.event.kind === 'control'
        ? [{ time: item.offsetSeconds, port: item.event.portId, value: item.event.value }]
        : [],
    );

    const drawAutomation = (port: string, top: number, bottom: number, color: string): void => {
      const values = controls.filter(item => item.port === port);
      if (values.length === 0) return;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.beginPath();
      values.forEach((item, index) => {
        const x = toX(item.time);
        const y = bottom - item.value * (bottom - top);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    };

    drawAutomation('x', 20, 65, '#b58aff');
    drawAutomation('y', 84, 129, '#53c9c4');

    const noteStarts = new Map<string, { time: number; pitch: number }>();
    for (const item of clip.events) {
      if (item.event.kind === 'note-on') {
        noteStarts.set(item.event.sourceId + ':' + item.event.noteId, {
          time: item.offsetSeconds,
          pitch: item.event.pitch,
        });
      } else if (item.event.kind === 'note-off') {
        const key = item.event.sourceId + ':' + item.event.noteId;
        const start = noteStarts.get(key);
        if (!start) continue;
        noteStarts.delete(key);
        const x = toX(start.time);
        const endX = toX(item.offsetSeconds);
        const y = 188 - ((start.pitch - 48) / 36) * 34;
        context.fillStyle = '#e6b86a';
        context.fillRect(x, y - 3, Math.max(3, endX - x), 6);
      }
    }

    for (const start of noteStarts.values()) {
      const x = toX(start.time);
      const y = 188 - ((start.pitch - 48) / 36) * 34;
      context.fillStyle = '#e6b86a';
      context.fillRect(x, y - 3, Math.max(3, toX(clip.durationSeconds) - x), 6);
    }
  };

  const anyTransportPlaying = (): boolean =>
    [...trackResources.values()].some(resources => resources.transport.currentState === 'playing');

  const updateClipUi = (): void => {
    const hasClip = Boolean(selectedClip && selectedClip.events.length > 0);
    clipPlayButton.disabled = !hasClip || !audioReady || anyTransportPlaying();
    clipStopButton.disabled = !anyTransportPlaying();
    clipSummary.textContent = selectedClip
      ? selectedClip.name.toUpperCase() + ' · ' + selectedClip.durationSeconds.toFixed(1) + 'S'
      : 'NO CLIP';
    drawTimeline(selectedClip);
  };

  const refreshClipList = (): void => {
    const trackClips = project.clips.filter(clip => clip.trackId === project.activeTrackId);
    clipSelect.replaceChildren();
    if (trackClips.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No saved clips';
      clipSelect.append(option);
      clipSelect.disabled = true;
      selectedClipId = undefined;
      selectedClip = undefined;
    } else {
      for (const clip of trackClips) {
        const option = document.createElement('option');
        option.value = clip.id;
        option.textContent = clip.name + ' · ' + clip.durationSeconds.toFixed(1) + 's';
        clipSelect.append(option);
      }
      if (!trackClips.some(clip => clip.id === selectedClipId)) {
        selectedClipId = trackClips[trackClips.length - 1]?.id;
      }
      clipSelect.value = selectedClipId ?? '';
      clipSelect.disabled = false;
      selectedClip = project.clips.find(clip => clip.id === selectedClipId);
    }
    updateClipUi();
  };

  const updateProjectUi = (): void => {
    projectNameInput.value = project.name;
    const selectedTrack = activeTrack();
    trackName.textContent = selectedTrack?.name ?? 'No active track';

    trackSelect.replaceChildren();
    for (const track of [...project.tracks].sort((a, b) => a.order - b.order)) {
      const option = document.createElement('option');
      option.value = track.id;
      option.textContent = track.name;
      trackSelect.append(option);
    }
    trackSelect.value = selectedTrack.id;
    recordStartButton.disabled = !persistenceReady || !selectedTrack.armed || recorder.isRecording;
    armTrackButton.textContent = selectedTrack.armed ? '● Armed' : 'Arm track';
    muteTrackButton.textContent = selectedTrack.muted ? 'Unmute' : 'Mute';
    soloTrackButton.textContent = selectedTrack.solo ? 'Unsolo' : 'Solo';
    trackVolumeInput.value = String(selectedTrack.volume);
    trackPanInput.value = String(selectedTrack.pan);
    trackSelect.disabled = recorder.isRecording;
    addTrackButton.disabled = recorder.isRecording;
    armTrackButton.disabled = recorder.isRecording;
    muteTrackButton.disabled = recorder.isRecording;
    soloTrackButton.disabled = recorder.isRecording;
    trackVolumeInput.disabled = recorder.isRecording;
    trackPanInput.disabled = recorder.isRecording;
    refreshClipList();
    applyTrackMix();
  };

  const updateController = (): void => {
    const x = Number(xInput.value);
    const y = Number(yInput.value);
    theremin.move(x, y);
    xValue.textContent = x.toFixed(3);
    yValue.textContent = y.toFixed(3);
    pitchValue.textContent = (48 + x * 36).toFixed(1);
  };

  const updateStatus = (message: string): void => { status.textContent = message; };

  const persistProject = (): Promise<void> => {
    const name = projectNameInput.value.trim();
    project = {
      ...project,
      name: name || 'Untitled Session',
      updatedAt: new Date().toISOString(),
    };
    const snapshot = project;
    const operation = saveQueue.then(() => repository.save(snapshot));
    saveQueue = operation.catch(() => undefined);
    return operation;
  };

  const enableAudio = async (): Promise<void> => {
    try {
      const runtimeStart = audioRuntime.start();
      const trackStarts = project.tracks.map(async track => {
        ensureTrackRuntime(track);
        await ensureTrackAudioReady(track.id);
      });
      await Promise.all([runtimeStart, ...trackStarts]);
      audioReady = true;
      updateStatus('Audio engine running');
      statusDot.classList.add('is-live');
      enableButton.textContent = 'Audio enabled';
      enableButton.disabled = true;
      applyTrackMix();
      updateClipUi();
    } catch (error) {
      updateStatus(error instanceof Error ? error.message : 'Could not start audio');
      throw error;
    }
  };

  const startDesktopTone = async (): Promise<void> => {
    if (!audioReady) {
      try { await enableAudio(); } catch { return; }
    }
    if (!audioReady || isDesktopPlaying) return;
    await ensureTrackAudioReady(project.activeTrackId);
    startNote(theremin.id, desktopNoteId, 48 + Number(xInput.value) * 36, 0.55);
    isDesktopPlaying = true;
    playButton.classList.add('is-playing');
    updateController();
  };

  const stopDesktopTone = (): void => {
    if (!isDesktopPlaying) return;
    stopNote(theremin.id, desktopNoteId);
    isDesktopPlaying = false;
    playButton.classList.remove('is-playing');
  };

  const startRecording = (): void => {
    if (!persistenceReady || recorder.isRecording) return;
    if (anyTransportPlaying()) {
      for (const resources of trackResources.values()) resources.transport.stop();
    }
    selectedClipId = undefined;
    selectedClip = undefined;
    const track = activeTrack();
    if (!track.armed) {
      captureStatus.textContent = 'Arm this track before recording.';
      return;
    }
    recordingTrackId = track.id;
    recorder.start(performance.now() / 1000);
    recordStartButton.disabled = true;
    recordStopButton.disabled = false;
    trackSelect.disabled = true;
    addTrackButton.disabled = true;
    armTrackButton.disabled = true;
    muteTrackButton.disabled = true;
    soloTrackButton.disabled = true;
    trackVolumeInput.disabled = true;
    trackPanInput.disabled = true;
    captureStatus.textContent = 'Recording notes and X/Y controller movement…';
    updateClipUi();
  };

  const stopRecording = (): void => {
    if (!recorder.isRecording) return;
    const recording = recorder.stop(performance.now() / 1000);
    recordStartButton.disabled = !persistenceReady;
    recordStopButton.disabled = true;
    if (!recording) return;

    project = {
      ...project,
      name: projectNameInput.value.trim() || project.name,
    };
    project = addRecordingToProject(project, recordingTrackId ?? project.activeTrackId, recording);
    recordingTrackId = undefined;
    selectedClipId = recording.id;
    captureStatus.textContent = 'Captured ' + recording.events.length + ' events over ' +
      recording.durationSeconds.toFixed(2) + ' seconds. Saving to this device…';
    updateProjectUi();
    void persistProject().then(() => {
      projectStatus.textContent = repository.durability === 'persistent'
        ? 'Saved on this device'
        : 'Session only · browser storage unavailable';
      captureStatus.textContent = 'Recording saved to project "' + project.name + '".';
    }).catch((error: unknown) => {
      projectStatus.textContent = 'Save failed';
      captureStatus.textContent = error instanceof Error
        ? 'Recording is in memory, but could not be saved: ' + error.message
        : 'Recording is in memory, but could not be saved.';
    });
  };

  const initializeProject = async (): Promise<void> => {
    try {
      const saved = await repository.loadLatest();
      if (saved) project = saved;
      else await repository.save(project);
    } catch (error) {
      repository = new MemoryProjectRepository();
      project = createDefaultProject('synth-main');
      projectStatus.textContent = 'Session only · local storage unavailable';
      captureStatus.textContent = error instanceof Error
        ? 'Could not open saved projects: ' + error.message
        : 'Could not open saved projects. This session will be temporary.';
    }

    persistenceReady = true;
    recordStartButton.disabled = !activeTrack().armed;
    projectSaveButton.disabled = false;
    if (repository.durability === 'persistent') {
      projectStatus.textContent = 'Local project storage ready';
    } else if (!projectStatus.textContent.startsWith('Session only')) {
      projectStatus.textContent = 'Session only · browser storage unavailable';
    }
    for (const track of project.tracks) ensureTrackRuntime(track);
    enableButton.disabled = false;
    enterVrButton.disabled = false;
    playButton.disabled = false;
    updateProjectUi();
  };

  trackSelect.addEventListener('change', () => {
    if (recorder.isRecording) return;
    project = setActiveProjectTrack(project, trackSelect.value);
    selectedClipId = undefined;
    selectedClip = undefined;
    updateProjectUi();
    void persistProject().catch((error: unknown) => {
      projectStatus.textContent = error instanceof Error ? error.message : 'Could not save active track';
    });
  });

  addTrackButton.addEventListener('click', () => {
    if (recorder.isRecording) return;
    const count = project.tracks.length + 1;
    const moduleId = 'synth-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36));
    project = addInstrumentTrack(project, 'Instrument Track ' + String(count).padStart(2, '0'), moduleId);
    const track = activeTrack();
    ensureTrackRuntime(track);
    selectedClipId = undefined;
    selectedClip = undefined;
    updateProjectUi();
    void persistProject().catch((error: unknown) => {
      projectStatus.textContent = error instanceof Error ? error.message : 'Could not save new track';
    });
  });

  armTrackButton.addEventListener('click', () => {
    if (recorder.isRecording) return;
    const trackId = project.activeTrackId;
    const shouldArm = !activeTrack().armed;
    for (const track of project.tracks) {
      project = updateProjectTrack(project, track.id, { armed: track.id === trackId && shouldArm });
    }
    updateProjectUi();
    void persistProject();
  });

  muteTrackButton.addEventListener('click', () => {
    if (recorder.isRecording) return;
    project = updateProjectTrack(project, project.activeTrackId, { muted: !activeTrack().muted });
    updateProjectUi();
    void persistProject();
  });

  soloTrackButton.addEventListener('click', () => {
    if (recorder.isRecording) return;
    project = updateProjectTrack(project, project.activeTrackId, { solo: !activeTrack().solo });
    updateProjectUi();
    void persistProject();
  });

  trackVolumeInput.addEventListener('input', () => {
    project = updateProjectTrack(project, project.activeTrackId, { volume: Number(trackVolumeInput.value) });
    applyTrackMix();
  });
  trackVolumeInput.addEventListener('change', () => { void persistProject(); });

  trackPanInput.addEventListener('input', () => {
    project = updateProjectTrack(project, project.activeTrackId, { pan: Number(trackPanInput.value) });
    applyTrackMix();
  });
  trackPanInput.addEventListener('change', () => { void persistProject(); });

  recordStartButton.addEventListener('click', startRecording);
  recordStopButton.addEventListener('click', stopRecording);

  clipSelect.addEventListener('change', () => {
    selectedClipId = clipSelect.value || undefined;
    selectedClip = project.clips.find(clip => clip.id === selectedClipId);
    updateClipUi();
  });

  clipPlayButton.addEventListener('click', () => {
    if (!selectedClip || !audioReady) return;
    try {
      for (const resources of trackResources.values()) resources.transport.stop();
      const resources = resourceFor(selectedClip.trackId);
      if (!resources) throw new Error('The clip track has no instrument runtime.');
      resources.transport.play(selectedClip);
    } catch (error) {
      captureStatus.textContent = error instanceof Error ? error.message : 'Could not play clip';
    }
  });
  clipStopButton.addEventListener('click', () => {
    for (const resources of trackResources.values()) resources.transport.stop();
  });

  projectSaveButton.addEventListener('click', () => {
    projectSaveButton.disabled = true;
    void persistProject().then(() => {
      projectStatus.textContent = repository.durability === 'persistent'
        ? 'Project saved on this device'
        : 'Session only · browser storage unavailable';
    }).catch((error: unknown) => {
      projectStatus.textContent = error instanceof Error ? error.message : 'Could not save project';
    }).finally(() => {
      projectSaveButton.disabled = false;
    });
  });

  function handleTransportState(trackId: string, state: TransportState): void {
    updateClipUi();
    if (state === 'playing') {
      captureStatus.textContent = 'Playing clip on ' +
        (project.tracks.find(track => track.id === trackId)?.name ?? 'track') + '…';
      updateStatus('Sequencer playing');
    } else if (state === 'completed' && !anyTransportPlaying()) {
      captureStatus.textContent = 'Playback complete.';
      updateStatus(audioReady ? 'Audio engine running' : 'Audio is stopped');
    } else if (state === 'stopped' && !anyTransportPlaying() && !recorder.isRecording) {
      updateStatus(audioReady ? 'Audio engine running' : 'Audio is stopped');
    }
  }

  enableButton.addEventListener('click', () => void enableAudio().catch(() => undefined));
  enterVrButton.addEventListener('click', () => {
    stopDesktopTone();
    const audioStart = enableAudio();
    const xrStart = world.launchXR();
    void Promise.all([audioStart, xrStart]).then(() => {
      statusDot.classList.add('is-live');
      enableButton.textContent = 'Audio enabled';
      enableButton.disabled = true;
      enterVrButton.textContent = 'VR active';
      enterVrButton.disabled = true;
      updateClipUi();
      updateStatus('VR ready · move your right index fingertip into the field');
    }).catch((error: unknown) => {
      updateStatus(error instanceof Error ? error.message : 'Could not enter VR');
      enterVrButton.disabled = false;
    });
  });

  world.visibilityState.subscribe((state) => {
    const immersive = state !== VisibilityState.NonImmersive;
    enterVrButton.disabled = !persistenceReady || immersive;
    enterVrButton.textContent = immersive ? 'VR active' : 'Enter VR';
    if (!immersive && audioReady) updateStatus('Audio engine running');
  });

  xInput.addEventListener('input', updateController);
  yInput.addEventListener('input', updateController);
  playButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    playButton.setPointerCapture(event.pointerId);
    void startDesktopTone();
  });
  playButton.addEventListener('pointerup', stopDesktopTone);
  playButton.addEventListener('pointercancel', stopDesktopTone);
  playButton.addEventListener('lostpointercapture', stopDesktopTone);
  window.addEventListener('blur', stopDesktopTone);
  const resizeHandler = (): void => drawTimeline(selectedClip);
  window.addEventListener('resize', resizeHandler);

  root.addEventListener('vibe-wizard-dispose', () => {
    stopDesktopTone();
    if (recorder.isRecording) stopRecording();
    for (const resources of trackResources.values()) {
      resources.transport.dispose();
      resources.unsubscribeTransport();
    }
    unsubscribeController();
    spatialAdapter.dispose();
    window.removeEventListener('resize', resizeHandler);
    void rack.dispose().then(() => audioRuntime.dispose());
  }, { once: true });

  updateController();
  drawTimeline(undefined);
  void initializeProject();
}
