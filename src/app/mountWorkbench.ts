import { VisibilityState, type World } from '@iwsdk/core';
import type { MusicalEvent, NoteOffEvent, NoteOnEvent } from '../audio/events.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Rack } from '../rack/Rack.js';
import { ParameterBus } from '../rack/ParameterBus.js';
import { ThereminController } from '../controllers/theremin/ThereminController.js';
import { ThereminSpatialAdapter } from '../controllers/theremin/ThereminSpatialAdapter.js';
import { EventRecorder, type RecordingClip } from '../sequencer/Recorder.js';
import { createSequencerTransport, type TransportState } from '../sequencer/SequencerTransport.js';
import {
  addRecordingToProject,
  createDefaultProject,
  type ProjectClip,
  type ProjectSnapshot,
} from '../project/ProjectModel.js';
import {
  createProjectRepository,
  MemoryProjectRepository,
  type ProjectRepository,
} from '../project/ProjectRepository.js';

export function mountWorkbench(root: HTMLElement, world: World): void {
  const rack = new Rack();
  const synth = rack.add(new AudioEngine('synth-main'));
  const parameterBus = new ParameterBus();
  parameterBus.registerTarget(synth);

  const theremin = rack.add(new ThereminController('theremin-main', parameterBus));
  parameterBus.addMapping({
    id: 'theremin-x-to-synth-pitch',
    sourceModuleId: theremin.id,
    sourcePortId: 'x',
    targetModuleId: synth.id,
    targetParameterId: 'pitch',
    inputRange: [0, 1],
    outputRange: [48, 84],
    curve: 'linear',
    invert: false,
    deadZone: 0,
    smoothingMs: 10,
  });
  parameterBus.addMapping({
    id: 'theremin-y-to-synth-volume',
    sourceModuleId: theremin.id,
    sourcePortId: 'y',
    targetModuleId: synth.id,
    targetParameterId: 'volume',
    inputRange: [0, 1],
    outputRange: [0.025, 0.65],
    curve: 'linear',
    invert: false,
    deadZone: 0,
    smoothingMs: 14,
  });

  const recorder = new EventRecorder();
  const transport = createSequencerTransport(synth, parameterBus);
  let project: ProjectSnapshot = createDefaultProject(synth.id);
  let selectedClipId: string | undefined;
  let selectedClip: ProjectClip | undefined;
  let repository: ProjectRepository = createProjectRepository();
  let persistenceReady = false;
  let saveQueue: Promise<void> = Promise.resolve();
  let spatialNoteId: string | undefined;
  let spatialNoteCounter = 0;

  const recordEvent = (event: MusicalEvent): void => {
    recorder.record(event);
  };

  const startNote = (
    sourceId: string,
    noteId: string,
    pitch: number,
    velocity: number,
    timestamp = performance.now() / 1000,
  ): void => {
    const event: NoteOnEvent = {
      kind: 'note-on',
      sourceId,
      noteId,
      pitch,
      velocity,
      timestamp,
    };
    synth.noteOn(event);
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
    synth.noteOff(event);
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
    '    <span class="prototype-tag">PROTOTYPE 04</span>',
    '  </header>',
    '  <div class="signal-row">',
    '    <span class="signal-dot" id="audio-status-dot"></span>',
    '    <span id="audio-status" role="status">Audio is stopped</span>',
    '    <button class="action-button" id="enable-audio" type="button">Enable audio</button>',
    '    <button class="action-button enter-vr-button" id="enter-vr" type="button">Enter VR</button>',
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
    '    <button class="play-button" id="play-theremin" type="button"><span class="play-symbol">▶</span>',
    '      <span><strong>Play theremin</strong><small>Press and hold to sustain a tone on desktop</small></span></button>',
    '    <p class="spatial-hint">In VR, enter the session and move your right index fingertip into the floating field. Horizontal movement changes pitch; vertical movement changes volume.</p>',
    '  </div>',
    '  <div class="controller-panel sequencer-panel">',
    '    <div class="section-heading"><div><p class="eyebrow">ARRANGEMENT · TRACK 01</p><h2 id="active-track-name">Theremin Synth</h2></div>',
    '      <span class="module-chip" id="clip-summary">NO CLIP</span></div>',
    '    <div class="clip-library-row">',
    '      <label for="saved-clips"><span>SAVED PERFORMANCES</span>',
    '        <select id="saved-clips" disabled><option value="">No saved clips</option></select></label>',
    '      <span class="track-badge">INSTRUMENT TRACK · SYNTH-MAIN</span>',
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
    !clipSelect || !recordStartButton || !recordStopButton || !clipPlayButton ||
    !clipStopButton || !clipSummary || !captureStatus || !timeline
  ) {
    spatialAdapter.dispose();
    unsubscribeController();
    transport.dispose();
    throw new Error('The workbench UI is missing a required control.');
  }

  let audioReady = false;
  let isDesktopPlaying = false;
  const desktopNoteId = 'theremin-desktop-note';

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

  const updateClipUi = (): void => {
    const hasClip = Boolean(selectedClip && selectedClip.events.length > 0);
    clipPlayButton.disabled = !hasClip || !audioReady || transport.currentState === 'playing';
    clipStopButton.disabled = transport.currentState !== 'playing';
    clipSummary.textContent = selectedClip
      ? selectedClip.name.toUpperCase() + ' · ' + selectedClip.durationSeconds.toFixed(1) + 'S'
      : 'NO CLIP';
    drawTimeline(selectedClip);
  };

  const refreshClipList = (): void => {
    clipSelect.replaceChildren();
    if (project.clips.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No saved clips';
      clipSelect.append(option);
      clipSelect.disabled = true;
      selectedClipId = undefined;
      selectedClip = undefined;
    } else {
      for (const clip of project.clips) {
        const option = document.createElement('option');
        option.value = clip.id;
        option.textContent = clip.name + ' · ' + clip.durationSeconds.toFixed(1) + 's';
        clipSelect.append(option);
      }
      if (!project.clips.some(clip => clip.id === selectedClipId)) {
        selectedClipId = project.clips[project.clips.length - 1]?.id;
      }
      clipSelect.value = selectedClipId ?? '';
      clipSelect.disabled = false;
      selectedClip = project.clips.find(clip => clip.id === selectedClipId);
    }
    updateClipUi();
  };

  const updateProjectUi = (): void => {
    projectNameInput.value = project.name;
    const activeTrack = project.tracks.find(track => track.id === project.activeTrackId);
    trackName.textContent = activeTrack?.name ?? 'No active track';
    refreshClipList();
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
      await synth.start();
      audioReady = true;
      updateStatus('Audio engine running');
      statusDot.classList.add('is-live');
      enableButton.textContent = 'Audio enabled';
      enableButton.disabled = true;
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
    if (transport.currentState === 'playing') transport.stop();
    selectedClipId = undefined;
    selectedClip = undefined;
    recorder.start(performance.now() / 1000);
    recordStartButton.disabled = true;
    recordStopButton.disabled = false;
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
    project = addRecordingToProject(project, project.activeTrackId, recording);
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
      project = createDefaultProject(synth.id);
      projectStatus.textContent = 'Session only · local storage unavailable';
      captureStatus.textContent = error instanceof Error
        ? 'Could not open saved projects: ' + error.message
        : 'Could not open saved projects. This session will be temporary.';
    }

    persistenceReady = true;
    recordStartButton.disabled = false;
    projectSaveButton.disabled = false;
    if (repository.durability === 'persistent') {
      projectStatus.textContent = 'Local project storage ready';
    } else if (!projectStatus.textContent.startsWith('Session only')) {
      projectStatus.textContent = 'Session only · browser storage unavailable';
    }
    updateProjectUi();
  };

  recordStartButton.addEventListener('click', startRecording);
  recordStopButton.addEventListener('click', stopRecording);

  clipSelect.addEventListener('change', () => {
    selectedClipId = clipSelect.value || undefined;
    selectedClip = project.clips.find(clip => clip.id === selectedClipId);
    updateClipUi();
  });

  clipPlayButton.addEventListener('click', () => {
    if (!selectedClip) return;
    try { transport.play(selectedClip); }
    catch (error) {
      captureStatus.textContent = error instanceof Error ? error.message : 'Could not play clip';
    }
  });
  clipStopButton.addEventListener('click', () => transport.stop());

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

  const updateTransportUi = (state: TransportState): void => {
    updateClipUi();
    if (state === 'playing') {
      captureStatus.textContent = 'Playing recorded performance…';
      updateStatus('Sequencer playing');
    } else if (state === 'completed') {
      captureStatus.textContent = 'Playback complete.';
      updateStatus(audioReady ? 'Audio engine running' : 'Audio is stopped');
    } else if (!recorder.isRecording) {
      updateStatus(audioReady ? 'Audio engine running' : 'Audio is stopped');
    }
  };
  const unsubscribeTransport = transport.subscribe(updateTransportUi);

  enableButton.addEventListener('click', () => void enableAudio().catch(() => undefined));
  enterVrButton.addEventListener('click', () => {
    stopDesktopTone();
    const audioStart = synth.start();
    const xrStart = world.launchXR();
    void Promise.all([audioStart, xrStart]).then(() => {
      audioReady = true;
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
    enterVrButton.disabled = immersive;
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
    transport.dispose();
    unsubscribeController();
    unsubscribeTransport();
    spatialAdapter.dispose();
    window.removeEventListener('resize', resizeHandler);
    void rack.dispose();
  }, { once: true });

  updateController();
  drawTimeline(undefined);
  void initializeProject();
}
