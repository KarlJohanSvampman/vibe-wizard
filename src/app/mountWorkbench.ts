import { VisibilityState, type World } from '@iwsdk/core';
import type { MusicalEvent, NoteOffEvent, NoteOnEvent } from '../audio/events.js';
import { AudioRuntime } from '../audio/AudioRuntime.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { createAudioAssetStore } from '../audio/AudioAssetStore.js';
import { getInstrumentLabel, isInstrumentType } from '../audio/InstrumentTypes.js';
import type { InstrumentType } from '../audio/InstrumentTypes.js';
import { HttpAudioGenerationProvider } from '../ai/AudioGenerationProvider.js';
import { HttpAudioTransformationProvider } from '../ai/AudioTransformationProvider.js';
import { Rack } from '../rack/Rack.js';
import { ParameterBus } from '../rack/ParameterBus.js';
import { TrackAudioBus } from '../rack/TrackAudioBus.js';
import { ThereminController } from '../controllers/theremin/ThereminController.js';
import { ThereminSpatialAdapter } from '../controllers/theremin/ThereminSpatialAdapter.js';
import { EventRecorder, type RecordingClip } from '../sequencer/Recorder.js';
import { ArrangementTransport } from '../sequencer/ArrangementTransport.js';
import { createSequencerTransport, type TransportState } from '../sequencer/SequencerTransport.js';
import { ProjectHistory } from '../project/ProjectHistory.js';
import {
  addInstrumentTrack,
  addRecordingToProject,
  addProjectClipNote,
  createEmptyProject,
  deleteProjectTrack,
  deleteProjectClipNote,
  duplicateProjectClip,
  getArrangementDurationBeats,
  getClipDurationBeats,
  getProjectClipNotes,
  moveProjectClip,
  projectClipToRecordingClip,
  resizeProjectClip,
  setActiveProjectTrack,
  updateProjectClipNote,
  type ProjectClipNote,
  updateProjectTrack,
  updateProjectTiming,
  DEFAULT_SAMPLER_SETTINGS,
  type SamplerSettings,
  updateProjectLoopRegion,
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
  const sampleAssets = createAudioAssetStore();
  const parameterBus = new ParameterBus();
  const theremin = rack.add(new ThereminController('theremin-main', parameterBus));
  const recorder = new EventRecorder();
  const arrangementTransport = new ArrangementTransport(audioRuntime, parameterBus);
  const trackResources = new Map<string, {
    instrument: AudioEngine;
    bus: TrackAudioBus;
    transport: ReturnType<typeof createSequencerTransport>;
    unsubscribeTransport: () => void;
  }>();
  const noteOwners = new Map<string, AudioEngine>();
  let project: ProjectSnapshot = createEmptyProject();
  const projectHistory = new ProjectHistory();
  let selectedClipId: string | undefined;
  let selectedClip: ProjectClip | undefined;
  let selectedPianoNote: Pick<ProjectClipNote, 'sourceId' | 'noteId'> | undefined;
  let pianoDrag: {
    readonly pointerId: number;
    readonly pointerStartX: number;
    readonly pointerStartY: number;
    readonly mode: 'move' | 'resize';
    readonly original: ProjectClipNote;
    preview: ProjectClipNote;
  } | undefined;
  let repository: ProjectRepository = createProjectRepository();
  let persistenceReady = false;
  let audioReady = false;
  let isDesktopPlaying = false;
  let recordingTrackId: string | undefined;
  let spatialNoteId: string | undefined;
  let spatialNoteCounter = 0;
  let saveQueue: Promise<void> = Promise.resolve();
  let generationAbortController: AbortController | undefined;
  let isCreatingNewProject = false;
  let savedProjects: ProjectSnapshot[] = [];
  const desktopNoteId = 'theremin-desktop-note';

  const activeTrack = (): ProjectTrack | undefined =>
    project.tracks.find(track => track.id === project.activeTrackId) ?? project.tracks[0];

  const resourceFor = (trackId: string) => trackResources.get(trackId);

  const disposeProjectTrackResources = async (): Promise<void> => {
    for (const [trackId, resources] of [...trackResources.entries()]) {
      resources.transport.dispose();
      resources.unsubscribeTransport();
      parameterBus.unregisterTarget(resources.instrument.id);
      parameterBus.unregisterTarget(resources.bus.id);
      await rack.remove(resources.instrument.id);
      await rack.remove(resources.bus.id);
      trackResources.delete(trackId);
    }
    noteOwners.clear();
  };

  const ensureTrackRuntime = (track: ProjectTrack, autoStartAudio = true) => {
    const existing = trackResources.get(track.id);
    if (existing) return existing;

    const instrument = rack.add(new AudioEngine(track.instrumentModuleId, audioRuntime, track.instrumentType));
    if (track.instrumentType === 'sampler') {
      instrument.setSamplerSettings(track.samplerSettings ?? DEFAULT_SAMPLER_SETTINGS);
    }
    const bus = rack.add(new TrackAudioBus('track-bus-' + track.id, audioRuntime));
    parameterBus.registerTarget(instrument);
    parameterBus.registerTarget(bus);
    if (track.instrumentType !== 'drums') {
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
    }
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

    const transport = createSequencerTransport(instrument, parameterBus, instrument.id);
    const unsubscribeTransport = transport.subscribe((state) =>
      handleTransportState(track.id, state),
    );
    const resources = { instrument, bus, transport, unsubscribeTransport };
    trackResources.set(track.id, resources);
    if (audioReady && autoStartAudio) void ensureTrackAudioReady(track.id);
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
    if (track.instrumentType === 'sampler' && track.sampleAssetId && !resources.instrument.hasSample) {
      try {
        const asset = await sampleAssets.load(track.sampleAssetId);
        if (asset) await resources.instrument.loadSample(asset.data);
      } catch (error) {
        console.warn('Could not restore sampler sample for track ' + track.id, error);
      }
    }
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
    '    <label class="saved-project-field" for="saved-projects"><span>OPEN A SAVED PROJECT</span>',
    '      <select id="saved-projects" disabled><option value="">Loading projects…</option></select></label>',
    '    <button class="transport-button" id="project-open" type="button" disabled>Open project</button>',
    '    <button class="transport-button" id="project-new" type="button" disabled>＋ New project</button>',
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
    '    <p class="spatial-hint">The theremin is a controller, not an instrument. Add and select an instrument track, then arm it to record. In VR, move your right index fingertip into the floating field to control pitch and volume.</p>',
    '  </div>',
    '  <div class="controller-panel sequencer-panel">',
    '    <div class="section-heading"><div><p class="eyebrow">ARRANGEMENT · TRACKS</p><h2 id="active-track-name">Theremin Synth</h2></div>',
    '      <span class="module-chip" id="clip-summary">NO CLIP</span></div>',
    '    <div class="arrangement-toolbar">',
    '      <span class="arrangement-label">MULTI-TRACK ARRANGEMENT</span>',
    '      <button class="transport-button" id="arrangement-play" type="button" disabled>▶ Play arrangement</button>',
    '      <button class="transport-button" id="arrangement-stop" type="button" disabled>■ Stop arrangement</button>',
    '      <span class="arrangement-hint">Drag clips between tracks. Positions snap to the musical grid.</span>',
    '    </div>',
    '    <div class="timing-toolbar">',
    '      <label for="tempo-bpm"><span>TEMPO · BPM</span><input id="tempo-bpm" type="number" min="20" max="300" step="1" value="120" /></label>',
    '      <label for="time-signature"><span>TIME SIGNATURE</span><select id="time-signature"><option value="4/4">4/4</option><option value="3/4">3/4</option><option value="2/4">2/4</option><option value="5/4">5/4</option><option value="6/8">6/8</option><option value="7/8">7/8</option><option value="9/8">9/8</option><option value="12/8">12/8</option></select></label>',
    '      <label for="grid-snap"><span>SNAP TO</span><select id="grid-snap"><option value="1">Quarter note</option><option value="0.5">Eighth note</option><option value="0.25" selected>Sixteenth note</option><option value="0.125">Thirty-second</option><option value="0">Off</option></select></label>',
    '    </div>',
    '    <div class="loop-toolbar">',
    '      <label class="loop-toggle" for="loop-enabled"><input id="loop-enabled" type="checkbox" /> <span>Loop arrangement</span></label>',
    '      <label for="loop-start-bar"><span>LOOP IN · BAR</span><input id="loop-start-bar" type="number" min="1" step="1" value="1" /></label>',
    '      <label for="loop-end-bar"><span>LOOP OUT · BAR</span><input id="loop-end-bar" type="number" min="2" step="1" value="5" /></label>',
    '      <span class="arrangement-hint">Enabled loops repeat between the selected bar boundaries.</span>',
    '    </div>',
    '    <div class="arrangement-wrap"><canvas id="arrangement-timeline" width="1000" height="220" aria-label="Multi-track arrangement. Drag clips to reposition or move them to another instrument track."></canvas></div>',
    '    <div class="track-list" id="track-list" role="list" aria-label="Project tracks"></div>',
    '    <div class="track-toolbar">',
    '      <label class="legacy-track-select" for="track-select"><span>SELECTED TRACK</span><select id="track-select"></select></label>',
    '      <label for="new-instrument-type"><span>NEW TRACK INSTRUMENT</span><select id="new-instrument-type"><option value="synth">Analog Synth</option><option value="piano">Piano</option><option value="drums">Drum Kit</option><option value="sampler">Sampler</option></select></label>',
    '      <button class="transport-button" id="add-track" type="button">＋ Add track</button>',
    '      <button class="transport-button danger-button" id="delete-track" type="button" disabled>Delete track</button>',
    '      <button class="transport-button" id="arm-track" type="button" disabled>Arm for recording</button>',
    '      <button class="transport-button" id="mute-track" type="button" disabled>Mute</button>',
    '      <button class="transport-button" id="solo-track" type="button" disabled>Solo</button>',
    '    </div>',
    '    <div class="instrument-asset-row" id="sample-import-row" hidden>',
    '      <label for="sample-file"><span>SAMPLER AUDIO FILE</span><input id="sample-file" type="file" accept="audio/*" /></label>',
    '      <span id="sample-status">Choose a Sampler track to import audio.</span>',
    '    </div>',
    '    <section class="sampler-editor" id="sampler-editor" hidden>',
    '      <div class="section-heading"><div><p class="eyebrow">SAMPLE EDITOR</p><h3>Sampler settings</h3></div><span id="sample-duration">No sample loaded</span></div>',
    '      <div class="sampler-actions"><button class="transport-button" id="sample-audition" type="button" disabled>▶ Audition</button><button class="transport-button" id="sample-audition-stop" type="button" disabled>■ Stop</button>',
    '        <label for="sampler-playback-mode"><span>PLAYBACK</span><select id="sampler-playback-mode"><option value="gate">Gate · hold to play</option><option value="one-shot">One-shot · play through</option></select></label></div>',
    '      <label class="control-row" for="sampler-start"><span><strong>Sample start</strong><small id="sampler-start-time">0.00 s</small></span><input id="sampler-start" type="range" min="0" max="0.999" step="0.001" value="0" /></label>',
    '      <label class="control-row" for="sampler-end"><span><strong>Sample end</strong><small id="sampler-end-time">100%</small></span><input id="sampler-end" type="range" min="0.001" max="1" step="0.001" value="1" /></label>',
    '      <label class="loop-toggle" for="sampler-loop"><input id="sampler-loop" type="checkbox" /> <span>Enable sample loop</span></label>',
    '      <label class="control-row" for="sampler-loop-start"><span><strong>Loop start</strong><small id="sampler-loop-start-time">0.00 s</small></span><input id="sampler-loop-start" type="range" min="0" max="0.999" step="0.001" value="0" /></label>',
    '      <label class="control-row" for="sampler-loop-end"><span><strong>Loop end</strong><small id="sampler-loop-end-time">100%</small></span><input id="sampler-loop-end" type="range" min="0.001" max="1" step="0.001" value="1" /></label>',
    '      <label for="sampler-root-note"><span>ROOT NOTE · MIDI</span><input id="sampler-root-note" type="number" min="0" max="127" step="1" value="60" /></label>',
    '      <p class="sampler-hint">The root note plays the sample at its original pitch. Notes above and below transpose it chromatically.</p>',
    '      <section class="sampler-transform-panel">',
    '        <div class="section-heading"><div><p class="eyebrow">AI SOUND TRANSFORMATION</p><h3>Create a variation</h3></div><span class="module-chip">AUDIO REFERENCE</span></div>',
    '        <label for="sampler-transform-prompt"><span>HOW SHOULD IT CHANGE?</span><textarea id="sampler-transform-prompt" rows="2" maxlength="4000" placeholder="Turn this into a dark ambient texture with deeper low end, evolving granular layers, and a slow cinematic atmosphere."></textarea></label>',
    '        <div class="sampler-transform-controls">',
    '          <label for="sampler-transform-duration"><span>OUTPUT · SECONDS</span><input id="sampler-transform-duration" type="number" min="3" max="30" step="1" value="8" /></label>',
    '          <label for="sampler-transform-strength"><span>SOURCE INFLUENCE</span><select id="sampler-transform-strength"><option value="high">High · stay close</option><option value="medium">Medium · balanced</option><option value="low">Low · explore</option><option value="xhigh">Very high · strongest match</option></select></label>',
    '        </div>',
    '        <button class="transport-button" id="sampler-transform" type="button" disabled>✧ Transform selected sample</button>',
    '        <p class="ai-generation-status" id="sampler-transform-status" role="status">Enable audio and select a Sampler track with a loaded sample. Requires Eleven Music API access. Upload and generation may both consume credits. Source audio is uploaded to ElevenLabs; only use audio you have rights to use.</p>',
    '      </section>',
    '    </section>',
    '    <section class="ai-sample-studio">',
    '      <div class="section-heading"><div><p class="eyebrow">AI SOUND GENERATION</p><h3>Generate a playable sample</h3></div><span class="module-chip">ASYNC · LOCAL ASSETS</span></div>',
    '      <label for="ai-service-url"><span>AI SERVICE URL</span><input id="ai-service-url" type="text" placeholder="/api (same-origin gateway)" autocomplete="url" /></label>',
    '      <label for="ai-sample-prompt"><span>SOUND PROMPT</span><textarea id="ai-sample-prompt" rows="3" maxlength="4000" placeholder="A warm, evolving analog bass with a soft attack, subtle tape saturation, and a clean low end."></textarea></label>',
    '      <div class="ai-generation-actions">',
    '        <label for="ai-sample-duration"><span>DURATION · SECONDS</span><input id="ai-sample-duration" type="number" min="1" max="30" step="1" value="3" /></label>',
    '        <button class="transport-button" id="ai-generate-sample" type="button">✦ Generate sampler</button>',
    '        <button class="transport-button" id="ai-cancel-generation" type="button" disabled>Stop waiting</button>',
    '      </div>',
    '      <p class="ai-generation-status" id="ai-generation-status" role="status">ElevenLabs currently lists 40 credits per second when a duration is specified. Check your account pricing before generating. The API key stays on the local server, never in this browser.</p>',
    '    </section>',
    '    <section class="asset-browser-panel">',
    '      <div class="section-heading"><div><p class="eyebrow">LOCAL SOUND LIBRARY</p><h3>Audio assets</h3></div><button class="transport-button" id="asset-refresh" type="button">↻ Refresh</button></div>',
    '      <div class="asset-browser-toolbar"><input id="asset-search" type="search" placeholder="Search sounds…" aria-label="Search audio assets" /><select id="asset-filter" aria-label="Filter audio assets"><option value="all">All sounds</option><option value="ai-generated">AI generated</option><option value="ai-transformed">AI transformed</option><option value="user-import">Imported</option></select></div>',
    '      <div id="asset-browser-list" class="asset-browser-list" role="list" aria-live="polite"><p class="asset-empty">Loading local audio assets…</p></div>',
    '      <p class="asset-browser-hint">Audio assets are stored in this browser on this device, separately from projects. They remain available across projects in this browser.</p>',
    '    </section>',
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
    '      <button class="transport-button" id="clip-duplicate" type="button" disabled>Duplicate clip</button>',
    '      <button class="transport-button" id="clip-stop" type="button" disabled>■ Stop playback</button>',
    '    </div>',
    '    <div class="timeline-wrap"><canvas id="clip-timeline" width="1000" height="210" aria-label="Recorded notes and theremin automation timeline"></canvas></div>',
    '    <p class="timeline-legend"><span class="legend-x">X · Pitch movement</span><span class="legend-y">Y · Volume movement</span><span class="legend-note">Notes · Held duration</span></p>',
    '    <div class="piano-roll-heading">',
    '      <div><p class="eyebrow">NOTE EDITOR</p><h3 id="piano-note-label">PIANO ROLL · SELECT A CLIP</h3></div>',
    '      <div class="piano-roll-actions">',
    '        <button class="transport-button" id="piano-undo" type="button" disabled>↶ Undo</button>',
    '        <button class="transport-button" id="piano-redo" type="button" disabled>↷ Redo</button>',
    '        <button class="transport-button" id="piano-delete" type="button" disabled>Delete note</button>',
    '      </div>',
    '    </div>',
    '    <div class="piano-roll-toolbar">',
    '      <label for="piano-velocity"><span>SELECTED NOTE VELOCITY</span><input id="piano-velocity" type="range" min="0.01" max="1" step="0.01" value="0.8" disabled /></label>',
    '      <span class="piano-roll-hint">Click an empty cell to add a note. Drag a note to move it; drag its right edge to resize. Delete removes the selected note.</span>',
    '    </div>',
    '    <div class="piano-roll-wrap" id="piano-roll-wrap"><canvas id="piano-roll" width="1000" height="420" tabindex="0" aria-label="Piano roll editor. Click to add notes and drag notes to edit pitch, timing, and duration."></canvas></div>',
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
  const savedProjectsSelect = get<HTMLSelectElement>('#saved-projects');
  const openProjectButton = get<HTMLButtonElement>('#project-open');
  const newProjectButton = get<HTMLButtonElement>('#project-new');
  const projectSaveButton = get<HTMLButtonElement>('#project-save');
  const projectStatus = get<HTMLElement>('#project-status');
  const trackName = get<HTMLElement>('#active-track-name');
  const trackSelect = get<HTMLSelectElement>('#track-select');
  const trackList = get<HTMLElement>('#track-list');
  const deleteTrackButton = get<HTMLButtonElement>('#delete-track');
  const newInstrumentTypeSelect = get<HTMLSelectElement>('#new-instrument-type');
  const sampleImportRow = get<HTMLElement>('#sample-import-row');
  const sampleFileInput = get<HTMLInputElement>('#sample-file');
  const sampleStatus = get<HTMLElement>('#sample-status');
  const samplerEditor = get<HTMLElement>('#sampler-editor');
  const sampleDurationLabel = get<HTMLElement>('#sample-duration');
  const sampleAuditionButton = get<HTMLButtonElement>('#sample-audition');
  const sampleAuditionStopButton = get<HTMLButtonElement>('#sample-audition-stop');
  const samplerPlaybackMode = get<HTMLSelectElement>('#sampler-playback-mode');
  const samplerStartInput = get<HTMLInputElement>('#sampler-start');
  const samplerEndInput = get<HTMLInputElement>('#sampler-end');
  const samplerLoopInput = get<HTMLInputElement>('#sampler-loop');
  const samplerLoopStartInput = get<HTMLInputElement>('#sampler-loop-start');
  const samplerLoopEndInput = get<HTMLInputElement>('#sampler-loop-end');
  const samplerRootNoteInput = get<HTMLInputElement>('#sampler-root-note');
  const samplerStartTime = get<HTMLElement>('#sampler-start-time');
  const samplerEndTime = get<HTMLElement>('#sampler-end-time');
  const samplerLoopStartTime = get<HTMLElement>('#sampler-loop-start-time');
  const samplerLoopEndTime = get<HTMLElement>('#sampler-loop-end-time');
  const aiServiceUrlInput = get<HTMLInputElement>('#ai-service-url');
  const aiSamplePromptInput = get<HTMLTextAreaElement>('#ai-sample-prompt');
  const aiSampleDurationInput = get<HTMLInputElement>('#ai-sample-duration');
  const aiGenerateButton = get<HTMLButtonElement>('#ai-generate-sample');
  const aiCancelButton = get<HTMLButtonElement>('#ai-cancel-generation');
  const aiGenerationStatus = get<HTMLElement>('#ai-generation-status');
  const assetRefreshButton = get<HTMLButtonElement>('#asset-refresh');
  const assetSearchInput = get<HTMLInputElement>('#asset-search');
  const assetFilterSelect = get<HTMLSelectElement>('#asset-filter');
  const assetBrowserList = get<HTMLElement>('#asset-browser-list');
  const samplerTransformPrompt = get<HTMLTextAreaElement>('#sampler-transform-prompt');
  const samplerTransformDuration = get<HTMLInputElement>('#sampler-transform-duration');
  const samplerTransformStrength = get<HTMLSelectElement>('#sampler-transform-strength');
  const samplerTransformButton = get<HTMLButtonElement>('#sampler-transform');
  const samplerTransformStatus = get<HTMLElement>('#sampler-transform-status');
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
  const clipDuplicateButton = get<HTMLButtonElement>('#clip-duplicate');
  const clipSummary = get<HTMLElement>('#clip-summary');
  const pianoRollWrap = get<HTMLElement>('#piano-roll-wrap');
  const pianoRoll = get<HTMLCanvasElement>('#piano-roll');
  const pianoNoteLabel = get<HTMLElement>('#piano-note-label');
  const pianoVelocityInput = get<HTMLInputElement>('#piano-velocity');
  const pianoUndoButton = get<HTMLButtonElement>('#piano-undo');
  const pianoRedoButton = get<HTMLButtonElement>('#piano-redo');
  const pianoDeleteButton = get<HTMLButtonElement>('#piano-delete');
  const arrangementPlayButton = get<HTMLButtonElement>('#arrangement-play');
  const arrangementStopButton = get<HTMLButtonElement>('#arrangement-stop');
  const tempoInput = get<HTMLInputElement>('#tempo-bpm');
  const timeSignatureSelect = get<HTMLSelectElement>('#time-signature');
  const gridSnapSelect = get<HTMLSelectElement>('#grid-snap');
  const loopEnabledInput = get<HTMLInputElement>('#loop-enabled');
  const loopStartBarInput = get<HTMLInputElement>('#loop-start-bar');
  const loopEndBarInput = get<HTMLInputElement>('#loop-end-bar');
  const arrangementTimeline = get<HTMLCanvasElement>('#arrangement-timeline');
  const captureStatus = get<HTMLElement>('#capture-status');
  const timeline = get<HTMLCanvasElement>('#clip-timeline');

  if (
    !enableButton || !enterVrButton || !playButton || !xInput || !yInput ||
    !status || !statusDot || !xValue || !yValue || !pitchValue ||
    !projectNameInput || !savedProjectsSelect || !openProjectButton || !newProjectButton ||
    !projectSaveButton || !projectStatus || !trackName ||
    !trackSelect || !trackList || !deleteTrackButton || !newInstrumentTypeSelect || !sampleImportRow || !sampleFileInput ||
    !sampleStatus || !samplerEditor || !sampleDurationLabel || !sampleAuditionButton || !sampleAuditionStopButton ||
    !samplerPlaybackMode || !samplerStartInput || !samplerEndInput || !samplerLoopInput ||
    !samplerLoopStartInput || !samplerLoopEndInput || !samplerRootNoteInput ||
    !samplerStartTime || !samplerEndTime || !samplerLoopStartTime || !samplerLoopEndTime || !aiServiceUrlInput || !aiSamplePromptInput || !aiSampleDurationInput ||
    !aiGenerateButton || !aiCancelButton || !aiGenerationStatus ||
    !assetRefreshButton || !assetSearchInput || !assetFilterSelect || !assetBrowserList ||
    !samplerTransformPrompt || !samplerTransformDuration || !samplerTransformStrength ||
    !samplerTransformButton || !samplerTransformStatus ||
    !addTrackButton || !armTrackButton || !muteTrackButton ||
    !soloTrackButton || !trackVolumeInput || !trackPanInput ||
    !clipSelect || !recordStartButton || !recordStopButton || !clipPlayButton ||
    !clipStopButton || !clipDuplicateButton || !clipSummary || !arrangementPlayButton ||
    !pianoRollWrap || !pianoRoll || !pianoNoteLabel || !pianoVelocityInput ||
    !pianoUndoButton || !pianoRedoButton || !pianoDeleteButton ||
    !arrangementStopButton || !tempoInput || !timeSignatureSelect || !gridSnapSelect ||
    !loopEnabledInput || !loopStartBarInput || !loopEndBarInput ||
    !arrangementTimeline || !captureStatus || !timeline
  ) {
    arrangementTransport.dispose();
    spatialAdapter.dispose();
    unsubscribeController();
    throw new Error('The workbench UI is missing a required control.');
  }

  const aiEndpointStorageKey = 'vibe-wizard.ai-service-url';
  try {
    aiServiceUrlInput.value = globalThis.localStorage?.getItem(aiEndpointStorageKey) ?? '/api';
  } catch {
    aiServiceUrlInput.value = '';
  }
  aiServiceUrlInput.addEventListener('change', () => {
    try { globalThis.localStorage?.setItem(aiEndpointStorageKey, aiServiceUrlInput.value.trim()); }
    catch { /* Endpoint can still be entered for this session. */ }
  });

  type ArrangementHitRegion = {
    readonly clipId: string;
    readonly trackId: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  type ArrangementPreview = {
    readonly clipId: string;
    readonly trackId: string;
    readonly startBeats: number;
    readonly lengthBeats: number;
  };
  type ArrangementDragMode = 'move' | 'resize';

  let arrangementHitRegions: ArrangementHitRegion[] = [];
  let arrangementDrag: {
    readonly clipId: string;
    readonly pointerId: number;
    readonly pointerStartX: number;
    readonly mode: ArrangementDragMode;
    readonly originalProject: ProjectSnapshot;
    readonly originalStartBeats: number;
    readonly originalLengthBeats: number;
    readonly originalTrackId: string;
    readonly originalActiveTrackId: string;
    previewTrackId: string;
    previewStartBeats: number;
    previewLengthBeats: number;
  } | undefined;

  const getArrangementMetrics = () => {
    const tracks = [...project.tracks].sort((a, b) => a.order - b.order);
    const width = Math.max(320, arrangementTimeline.clientWidth || 900);
    const left = 142;
    const right = 14;
    const top = 34;
    const rowHeight = 46;
    const durationBeats = Math.max(
      getArrangementDurationBeats(project),
      project.loopRegion.endBeat,
    );
    return {
      tracks,
      width,
      height: top + tracks.length * rowHeight + 12,
      left,
      right,
      top,
      rowHeight,
      durationBeats,
      pixelsPerBeat: (width - left - right) / durationBeats,
    };
  };

  const drawArrangement = (preview?: ArrangementPreview): void => {
    const context = arrangementTimeline.getContext('2d');
    if (!context) return;

    const metrics = getArrangementMetrics();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    arrangementTimeline.style.height = metrics.height + 'px';
    arrangementTimeline.width = Math.round(metrics.width * dpr);
    arrangementTimeline.height = Math.round(metrics.height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, metrics.width, metrics.height);
    context.fillStyle = '#100f18';
    context.fillRect(0, 0, metrics.width, metrics.height);
    context.font = '10px Inter, system-ui, sans-serif';

    const plotRight = metrics.width - metrics.right;
    const beatsPerBar = project.timeSignature.numerator * 4 / project.timeSignature.denominator;
    const barWidth = beatsPerBar * metrics.pixelsPerBeat;
    const barsPerLabel = barWidth < 44 ? Math.ceil(44 / barWidth) : 1;
    const beatStep = metrics.durationBeats > 128 ? 4 : metrics.durationBeats > 64 ? 2 : 1;
    context.fillStyle = '#8b8499';
    context.strokeStyle = 'rgba(180, 164, 209, 0.12)';
    for (let beat = 0; beat <= metrics.durationBeats; beat += beatStep) {
      const x = metrics.left + beat * metrics.pixelsPerBeat;
      const isBar = Math.abs(beat / beatsPerBar - Math.round(beat / beatsPerBar)) < 0.0001;
      if (isBar) continue;
      context.beginPath();
      context.moveTo(x, 22);
      context.lineTo(x, metrics.height - 8);
      context.stroke();
    }
    context.strokeStyle = 'rgba(190, 169, 225, 0.34)';
    context.fillStyle = '#b7a8d2';
    for (let bar = 0; bar * beatsPerBar <= metrics.durationBeats + 0.0001; bar += barsPerLabel) {
      const x = metrics.left + bar * beatsPerBar * metrics.pixelsPerBeat;
      context.beginPath();
      context.moveTo(x, 22);
      context.lineTo(x, metrics.height - 8);
      context.stroke();
      context.fillText('Bar ' + (bar + 1), x + 3, 15);
    }

    arrangementHitRegions = [];
    metrics.tracks.forEach((track, index) => {
      const y = metrics.top + index * metrics.rowHeight;
      context.fillStyle = track.id === project.activeTrackId
        ? 'rgba(132, 97, 188, 0.16)'
        : 'rgba(255, 255, 255, 0.025)';
      context.fillRect(0, y, metrics.width, metrics.rowHeight - 2);
      context.fillStyle = track.id === project.activeTrackId ? '#e5d6ff' : '#a39aae';
      context.fillText(track.name.slice(0, 19), 10, y + 19);
      context.fillStyle = '#716b80';
      context.fillText(track.muted ? 'MUTED' : track.solo ? 'SOLO' : track.armed ? 'ARMED' : 'READY', 10, y + 33);

      context.strokeStyle = 'rgba(180, 164, 209, 0.12)';
      context.beginPath();
      context.moveTo(metrics.left, y + metrics.rowHeight - 2);
      context.lineTo(plotRight, y + metrics.rowHeight - 2);
      context.stroke();
    });

    const previewClip = preview
      ? project.clips.find(clip => clip.id === preview.clipId)
      : undefined;
    for (const clip of project.clips) {
      const isPreview = Boolean(preview && previewClip?.id === clip.id);
      const trackId = isPreview ? preview!.trackId : clip.trackId;
      const startBeats = isPreview ? preview!.startBeats : clip.startBeats;
      const lengthBeats = isPreview ? preview!.lengthBeats : getClipDurationBeats(clip);
      const trackIndex = metrics.tracks.findIndex(track => track.id === trackId);
      if (trackIndex < 0) continue;

      const x = metrics.left + startBeats * metrics.pixelsPerBeat;
      const y = metrics.top + trackIndex * metrics.rowHeight + 8;
      const width = Math.max(24, lengthBeats * metrics.pixelsPerBeat);
      const height = 27;
      const selected = clip.id === selectedClipId;
      context.fillStyle = isPreview
        ? 'rgba(183, 151, 238, 0.85)'
        : selected
          ? 'rgba(155, 115, 220, 0.92)'
          : 'rgba(75, 135, 143, 0.78)';
      context.fillRect(x, y, width, height);
      context.strokeStyle = selected ? '#e9d8ff' : 'rgba(220, 210, 240, 0.28)';
      context.strokeRect(x + 0.5, y + 0.5, Math.max(1, width - 1), height - 1);
      context.fillStyle = '#fff';
      if (width > 42) context.fillText(clip.name.slice(0, Math.max(4, Math.floor(width / 7))), x + 6, y + 17);
      context.fillStyle = selected ? '#f4eaff' : 'rgba(220, 210, 240, 0.55)';
      context.fillRect(x + Math.max(0, width - 5), y + 3, 3, height - 6);

      if (!isPreview) {
        arrangementHitRegions.push({
          clipId: clip.id,
          trackId: clip.trackId,
          x,
          y,
          width,
          height,
        });
      }
    }

    if (project.clips.length === 0) {
      context.fillStyle = '#777184';
      context.fillText('Record a performance to create a clip, then drag it onto this timeline.', metrics.left + 10, metrics.top + 24);
    }

    const loop = project.loopRegion;
    if (loop.enabled) {
      context.fillStyle = 'rgba(99, 220, 165, 0.85)';
      const loopX1 = metrics.left + loop.startBeat * metrics.pixelsPerBeat;
      const loopX2 = metrics.left + loop.endBeat * metrics.pixelsPerBeat;
      context.fillRect(loopX1, 20, Math.max(1, loopX2 - loopX1), 2);
      context.fillRect(loopX1, 20, 2, metrics.height - 28);
      context.fillRect(loopX2, 20, 2, metrics.height - 28);
    }

    const playheadBeat = arrangementTransport.currentBeat;
    if (playheadBeat !== undefined) {
      const playheadX = metrics.left + playheadBeat * metrics.pixelsPerBeat;
      context.strokeStyle = '#ffcf6e';
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(playheadX, 20);
      context.lineTo(playheadX, metrics.height - 8);
      context.stroke();
    }
  };

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

  type PianoRollPreview = {
    readonly sourceId: string;
    readonly noteId: string;
    readonly pitch: number;
    readonly startBeat: number;
    readonly durationBeats: number;
  };
  type PianoRollHitRegion = {
    readonly sourceId: string;
    readonly noteId: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  let pianoRollHitRegions: PianoRollHitRegion[] = [];
  let pianoRollMetrics = {
    left: 48,
    top: 28,
    rowHeight: 8,
    pixelsPerBeat: 56,
    pitchLow: 36,
    pitchHigh: 83,
    durationBeats: 4,
  };

  const midiNoteName = (pitch: number): string => {
    const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
    return names[pitch % 12]! + (Math.floor(pitch / 12) - 1);
  };

  const drawPianoRoll = (preview?: PianoRollPreview): void => {
    const context = pianoRoll.getContext('2d');
    if (!context) return;

    const clip = selectedClip;
    const notes = clip ? getProjectClipNotes(clip) : [];
    const displayedPitches = notes.map(note => note.pitch);
    if (preview) displayedPitches.push(preview.pitch);
    const lowest = displayedPitches.length > 0 ? Math.min(...displayedPitches) : 60;
    const highest = displayedPitches.length > 0 ? Math.max(...displayedPitches) : 72;
    const rowCount = Math.min(128, Math.max(48, Math.ceil((highest - lowest + 13) / 12) * 12));
    const pitchLow = Math.max(0, Math.min(128 - rowCount, Math.floor((lowest - 6) / 12) * 12));
    const pitchHigh = Math.min(127, pitchLow + rowCount - 1);
    const left = 48;
    const top = 28;
    const rowHeight = 8;
    const right = 16;
    const durationBeats = Math.max(4, clip?.lengthBeats ?? 4);
    const pixelsPerBeat = 56;
    const viewportWidth = Math.max(320, pianoRollWrap.clientWidth || 900);
    const width = Math.max(viewportWidth, left + durationBeats * pixelsPerBeat + right);
    const height = top + rowCount * rowHeight + 10;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    pianoRoll.style.width = width + 'px';
    pianoRoll.style.height = height + 'px';
    pianoRoll.width = Math.round(width * dpr);
    pianoRoll.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#100f18';
    context.fillRect(0, 0, width, height);

    pianoRollMetrics = { left, top, rowHeight, pixelsPerBeat, pitchLow, pitchHigh, durationBeats };
    pianoRollHitRegions = [];

    context.font = '9px Inter, system-ui, sans-serif';
    context.fillStyle = '#b9aecb';
    context.fillText('BAR', 8, 17);
    const beatsPerBar = project.timeSignature.numerator * 4 / project.timeSignature.denominator;
    const snap = Number(gridSnapSelect.value);
    const gridStep = snap > 0 ? Math.min(snap, 1) : 0.5;
    context.textAlign = 'left';
    context.strokeStyle = 'rgba(190, 171, 226, .13)';
    context.fillStyle = '#92899f';
    for (let beat = 0; beat <= durationBeats + 0.0001; beat += gridStep) {
      const x = left + beat * pixelsPerBeat;
      const isBar = Math.abs(beat / beatsPerBar - Math.round(beat / beatsPerBar)) < 0.0001;
      context.strokeStyle = isBar
        ? 'rgba(190, 171, 226, .42)'
        : Math.abs(beat - Math.round(beat)) < 0.0001
          ? 'rgba(190, 171, 226, .22)'
          : 'rgba(190, 171, 226, .09)';
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, height - 8);
      context.stroke();
      if (isBar) context.fillText(String(Math.round(beat / beatsPerBar) + 1), x + 3, 17);
    }

    const blackPitchClasses = new Set([1, 3, 6, 8, 10]);
    for (let pitch = pitchLow; pitch <= pitchHigh; pitch++) {
      const y = top + (pitchHigh - pitch) * rowHeight;
      const isBlack = blackPitchClasses.has(pitch % 12);
      context.fillStyle = isBlack ? '#181622' : '#211e2b';
      context.fillRect(0, y, left - 1, rowHeight);
      context.fillStyle = isBlack ? '#181521' : '#14121c';
      context.fillRect(left, y, width - left, rowHeight);
      context.strokeStyle = 'rgba(190, 171, 226, .07)';
      context.beginPath();
      context.moveTo(left, y + rowHeight);
      context.lineTo(width, y + rowHeight);
      context.stroke();
      if (pitch % 12 === 0) {
        context.fillStyle = '#c4b8d8';
        context.fillText(midiNoteName(pitch), 5, y + rowHeight - 1);
      }
    }

    if (!clip) {
      context.fillStyle = '#777184';
      context.font = '11px Inter, system-ui, sans-serif';
      context.fillText('Select a saved clip or record a performance to edit its notes.', left + 12, top + 25);
      return;
    }

    const selectedKey = selectedPianoNote
      ? selectedPianoNote.sourceId + ':' + selectedPianoNote.noteId
      : undefined;
    for (const note of notes) {
      const isPreview = preview?.sourceId === note.sourceId && preview.noteId === note.noteId;
      const pitch = isPreview ? preview!.pitch : note.pitch;
      const startBeat = isPreview ? preview!.startBeat : note.startBeat;
      const duration = isPreview ? preview!.durationBeats : note.durationBeats;
      if (pitch < pitchLow || pitch > pitchHigh) continue;
      const visibleDuration = Math.min(
        duration,
        Math.max(0, clip.lengthBeats - startBeat),
      );
      if (visibleDuration <= 0) continue;
      const x = left + startBeat * pixelsPerBeat + 1;
      const y = top + (pitchHigh - pitch) * rowHeight + 1;
      const w = Math.max(12, visibleDuration * pixelsPerBeat - 2);
      const h = rowHeight - 2;
      const selected = note.sourceId + ':' + note.noteId === selectedKey;
      const alpha = 0.4 + note.velocity * 0.5;
      context.fillStyle = isPreview
        ? 'rgba(207, 181, 255, .95)'
        : selected
          ? 'rgba(218, 184, 255, .98)'
          : 'rgba(92, 177, 194, ' + alpha.toFixed(2) + ')';
      context.fillRect(x, y, w, h);
      context.strokeStyle = selected ? '#f0dcff' : 'rgba(220, 245, 250, .42)';
      context.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), h - 1);
      context.fillStyle = selected ? '#251a36' : '#102128';
      if (w > 28) context.fillText(midiNoteName(pitch), x + 4, y + h - 2);
      context.fillStyle = selected ? '#fff1ff' : 'rgba(255,255,255,.7)';
      context.fillRect(x + Math.max(0, w - 5), y + 1, 3, h - 2);
      if (!isPreview) {
        pianoRollHitRegions.push({
          sourceId: note.sourceId,
          noteId: note.noteId,
          x,
          y,
          width: w,
          height: h,
        });
      }
    }

    if (clip.lengthBeats <= 0) {
      context.fillStyle = '#777184';
      context.fillText('Extend this clip in the arrangement before adding notes.', left + 10, top + 18);
    }
  };

  const anyTransportPlaying = (): boolean =>
    arrangementTransport.currentState === 'playing' ||
    [...trackResources.values()].some(resources => resources.transport.currentState === 'playing');

  const updateClipUi = (): void => {
    const auditionClip = selectedClip
      ? projectClipToRecordingClip(selectedClip, project.tempoBpm)
      : undefined;
    const hasClip = Boolean(auditionClip && auditionClip.events.length > 0);
    clipPlayButton.disabled = !hasClip || !audioReady || recorder.isRecording || anyTransportPlaying();
    clipDuplicateButton.disabled = !selectedClip || recorder.isRecording || anyTransportPlaying();
    clipStopButton.disabled = !anyTransportPlaying();
    arrangementPlayButton.disabled = !audioReady || recorder.isRecording ||
      project.clips.length === 0 || anyTransportPlaying();
    arrangementStopButton.disabled = arrangementTransport.currentState !== 'playing';
    const timingControlsDisabled = recorder.isRecording || anyTransportPlaying();
    tempoInput.disabled = timingControlsDisabled;
    timeSignatureSelect.disabled = timingControlsDisabled;
    loopEnabledInput.disabled = timingControlsDisabled;
    loopStartBarInput.disabled = timingControlsDisabled;
    loopEndBarInput.disabled = timingControlsDisabled;
    clipSummary.textContent = selectedClip
      ? selectedClip.name.toUpperCase() + ' · ' + getClipDurationBeats(selectedClip).toFixed(1) + ' BEATS'
      : 'NO CLIP';
    const currentClip = selectedClip;
    const selectedNote = currentClip && selectedPianoNote
      ? getProjectClipNotes(currentClip).find(note =>
        note.sourceId === selectedPianoNote!.sourceId &&
        note.noteId === selectedPianoNote!.noteId &&
        note.startBeat < currentClip.lengthBeats,
      )
      : undefined;
    if (!selectedNote) selectedPianoNote = undefined;
    pianoNoteLabel.textContent = selectedNote
      ? midiNoteName(selectedNote.pitch) + ' · BEAT ' + (selectedNote.startBeat + 1).toFixed(2) +
        ' · ' + selectedNote.durationBeats.toFixed(2) + ' BEATS'
      : selectedClip ? 'PIANO ROLL · CLICK TO ADD A NOTE' : 'PIANO ROLL · SELECT A CLIP';
    pianoVelocityInput.disabled = !selectedNote || recorder.isRecording || anyTransportPlaying();
    if (selectedNote) pianoVelocityInput.value = String(selectedNote.velocity);
    pianoDeleteButton.disabled = !selectedNote || recorder.isRecording || anyTransportPlaying();
    pianoUndoButton.disabled = !projectHistory.canUndo || recorder.isRecording || anyTransportPlaying();
    pianoRedoButton.disabled = !projectHistory.canRedo || recorder.isRecording || anyTransportPlaying();
    drawTimeline(auditionClip);
    drawPianoRoll();
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
        option.textContent = clip.name + ' · ' + getClipDurationBeats(clip).toFixed(1) + ' beats';
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
    newProjectButton.disabled = !persistenceReady || recorder.isRecording ||
      anyTransportPlaying() || generationAbortController !== undefined || isCreatingNewProject;
    updateProjectBrowserControls();
    tempoInput.value = String(project.tempoBpm);
    const signature = project.timeSignature.numerator + '/' + project.timeSignature.denominator;
    if (![...timeSignatureSelect.options].some(option => option.value === signature)) {
      const option = document.createElement('option');
      option.value = signature;
      option.textContent = signature;
      timeSignatureSelect.append(option);
    }
    timeSignatureSelect.value = signature;
    const beatsPerBar = project.timeSignature.numerator * 4 / project.timeSignature.denominator;
    loopEnabledInput.checked = project.loopRegion.enabled;
    loopStartBarInput.value = String(Math.floor(project.loopRegion.startBeat / beatsPerBar) + 1);
    loopEndBarInput.value = String(Math.max(
      Number(loopStartBarInput.value) + 1,
      Math.ceil(project.loopRegion.endBeat / beatsPerBar) + 1,
    ));
    const timingControlsDisabled = recorder.isRecording || anyTransportPlaying();
    tempoInput.disabled = timingControlsDisabled;
    timeSignatureSelect.disabled = timingControlsDisabled;
    loopEnabledInput.disabled = timingControlsDisabled;
    loopStartBarInput.disabled = timingControlsDisabled;
    loopEndBarInput.disabled = timingControlsDisabled;
    const selectedTrack = activeTrack();
    trackName.textContent = selectedTrack
      ? selectedTrack.name + ' · ' + getInstrumentLabel(selectedTrack.instrumentType)
      : 'No instrument track selected';

    trackSelect.replaceChildren();
    for (const track of [...project.tracks].sort((a, b) => a.order - b.order)) {
      const option = document.createElement('option');
      option.value = track.id;
      option.textContent = track.name + ' · ' + getInstrumentLabel(track.instrumentType);
      trackSelect.append(option);
    }
    trackSelect.value = selectedTrack?.id ?? '';
    trackList.replaceChildren();
    for (const track of [...project.tracks].sort((a, b) => a.order - b.order)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'track-row' + (track.id === project.activeTrackId ? ' is-selected' : '');
      row.setAttribute('role', 'listitem');
      row.setAttribute('aria-pressed', String(track.id === project.activeTrackId));
      const main = document.createElement('span'); main.className = 'track-row-main';
      const name = document.createElement('strong'); name.textContent = track.name;
      const type = document.createElement('small'); type.textContent = getInstrumentLabel(track.instrumentType);
      main.append(name, type);
      const state = document.createElement('span'); state.className = 'track-row-state';
      state.textContent = track.armed ? '● REC ARMED' : track.muted ? 'MUTED' : track.solo ? 'SOLO' : 'READY';
      row.append(main, state);
      row.disabled = recorder.isRecording;
      row.addEventListener('click', () => {
        if (recorder.isRecording || track.id === project.activeTrackId) return;
        resourceFor(project.activeTrackId)?.instrument.stopAudition();
        project = setActiveProjectTrack(project, track.id);
        selectedClipId = undefined; selectedClip = undefined; selectedPianoNote = undefined;
        updateProjectUi(); void persistProject();
      });
      trackList.append(row);
    }
    const hasTrack = Boolean(selectedTrack);
    recordStartButton.disabled = !persistenceReady || !selectedTrack?.armed || recorder.isRecording;
    deleteTrackButton.disabled = !hasTrack || recorder.isRecording || anyTransportPlaying();
    trackSelect.disabled = recorder.isRecording || !hasTrack;
    armTrackButton.textContent = selectedTrack?.armed ? '● Record armed' : 'Arm for recording';
    muteTrackButton.textContent = selectedTrack?.muted ? 'Unmute' : 'Mute';
    soloTrackButton.textContent = selectedTrack?.solo ? 'Unsolo' : 'Solo';
    trackVolumeInput.value = String(selectedTrack?.volume ?? 0.8);
    trackPanInput.value = String(selectedTrack?.pan ?? 0);
    armTrackButton.disabled = !hasTrack || recorder.isRecording;
    muteTrackButton.disabled = !hasTrack || recorder.isRecording;
    soloTrackButton.disabled = !hasTrack || recorder.isRecording;
    trackVolumeInput.disabled = !hasTrack || recorder.isRecording;
    trackPanInput.disabled = !hasTrack || recorder.isRecording;
    trackSelect.disabled = recorder.isRecording || !hasTrack;
    newInstrumentTypeSelect.disabled = recorder.isRecording;
    sampleImportRow.hidden = selectedTrack?.instrumentType !== 'sampler';
    samplerEditor.hidden = selectedTrack?.instrumentType !== 'sampler';
    const samplerSettings = selectedTrack?.samplerSettings ?? DEFAULT_SAMPLER_SETTINGS;
    const samplerResources = selectedTrack ? resourceFor(selectedTrack.id) : undefined;
    const samplerLoaded = samplerResources?.instrument.hasSample === true;
    samplerResources?.instrument.setSamplerSettings(samplerSettings);
    const sampleDuration = samplerResources?.instrument.sampleDuration ?? 0;
    sampleDurationLabel.textContent = sampleDuration > 0 ? sampleDuration.toFixed(2) + ' s' : 'No sample loaded';
    sampleAuditionButton.disabled = !audioReady || !samplerLoaded || recorder.isRecording || anyTransportPlaying();
    sampleAuditionStopButton.disabled = !samplerLoaded;
    samplerPlaybackMode.value = samplerSettings.playbackMode;
    samplerStartInput.value = String(samplerSettings.startPosition);
    samplerEndInput.value = String(samplerSettings.endPosition);
    samplerLoopInput.checked = samplerSettings.loopEnabled;
    samplerLoopStartInput.value = String(samplerSettings.loopStart);
    samplerLoopEndInput.value = String(samplerSettings.loopEnd);
    samplerRootNoteInput.value = String(samplerSettings.rootNote);
    samplerLoopStartInput.disabled = !samplerSettings.loopEnabled || !samplerLoaded;
    samplerLoopEndInput.disabled = !samplerSettings.loopEnabled || !samplerLoaded;
    samplerStartInput.disabled = !samplerLoaded;
    samplerEndInput.disabled = !samplerLoaded;
    samplerLoopInput.disabled = !samplerLoaded;
    samplerPlaybackMode.disabled = !samplerLoaded;
    samplerRootNoteInput.disabled = !samplerLoaded;
    samplerTransformButton.disabled = !selectedTrack?.sampleAssetId || !audioReady ||
      recorder.isRecording || anyTransportPlaying() || generationAbortController !== undefined;
    samplerTransformPrompt.disabled = samplerTransformButton.disabled;
    samplerTransformDuration.disabled = samplerTransformButton.disabled;
    samplerTransformStrength.disabled = samplerTransformButton.disabled;
    const seconds = (position: number) => (position * sampleDuration).toFixed(2) + ' s';
    samplerStartTime.textContent = seconds(samplerSettings.startPosition);
    samplerEndTime.textContent = seconds(samplerSettings.endPosition);
    samplerLoopStartTime.textContent = seconds(samplerSettings.loopStart);
    samplerLoopEndTime.textContent = seconds(samplerSettings.loopEnd);
    sampleFileInput.disabled = recorder.isRecording;
    sampleStatus.textContent = selectedTrack?.instrumentType !== 'sampler'
      ? 'Choose a Sampler track to import audio.'
      : selectedTrack?.sampleFileName
        ? (resourceFor(selectedTrack.id)?.instrument.hasSample
          ? 'Loaded: ' + selectedTrack.sampleFileName
          : 'Stored: ' + selectedTrack.sampleFileName + ' · click Enable audio to load')
        : 'Choose an audio file. It will be stored locally with the project reference.';
    aiGenerateButton.disabled = recorder.isRecording || anyTransportPlaying() || generationAbortController !== undefined;
    aiCancelButton.disabled = generationAbortController === undefined;
    aiServiceUrlInput.disabled = recorder.isRecording || generationAbortController !== undefined;
    aiSamplePromptInput.disabled = recorder.isRecording || generationAbortController !== undefined;
    aiSampleDurationInput.disabled = recorder.isRecording || generationAbortController !== undefined;
    addTrackButton.disabled = recorder.isRecording;
    armTrackButton.disabled = recorder.isRecording;
    muteTrackButton.disabled = recorder.isRecording;
    soloTrackButton.disabled = recorder.isRecording;
    trackVolumeInput.disabled = recorder.isRecording;
    trackPanInput.disabled = recorder.isRecording;
    refreshClipList();
    drawArrangement();
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

  const updateProjectBrowserControls = (): void => {
    const blocked = !persistenceReady || recorder.isRecording ||
      anyTransportPlaying() || generationAbortController !== undefined || isCreatingNewProject;
    savedProjectsSelect.disabled = blocked || savedProjects.length === 0;
    openProjectButton.disabled = blocked || !savedProjectsSelect.value ||
      savedProjectsSelect.value === project.id;
  };

  const refreshSavedProjects = async (): Promise<void> => {
    try {
      savedProjects = await repository.list();
      savedProjectsSelect.replaceChildren();
      if (savedProjects.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No saved projects yet';
        savedProjectsSelect.append(option);
      } else {
        for (const saved of savedProjects) {
          const option = document.createElement('option');
          option.value = saved.id;
          const date = new Date(saved.updatedAt);
          const savedAt = Number.isNaN(date.getTime()) ? saved.updatedAt : date.toLocaleString();
          option.textContent = saved.name + ' · ' + saved.tracks.length + ' tracks · ' +
            saved.clips.length + ' clips · ' + savedAt;
          savedProjectsSelect.append(option);
        }
        savedProjectsSelect.value = savedProjects.some(item => item.id === project.id)
          ? project.id
          : savedProjects[0]!.id;
      }
      updateProjectBrowserControls();
    } catch (error) {
      savedProjects = [];
      savedProjectsSelect.replaceChildren();
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Could not read saved projects';
      savedProjectsSelect.append(option);
      updateProjectBrowserControls();
      projectStatus.textContent = error instanceof Error
        ? 'Project list unavailable: ' + error.message
        : 'Project list unavailable.';
    }
  };

  savedProjectsSelect.addEventListener('change', updateProjectBrowserControls);

  let activeAssetPreview: HTMLAudioElement | undefined;
  let activeAssetPreviewUrl: string | undefined;

  const refreshAssetBrowser = async (): Promise<void> => {
    assetBrowserList.replaceChildren();
    try {
      const assets = await sampleAssets.list();
      const query = assetSearchInput.value.trim().toLowerCase();
      const filter = assetFilterSelect.value;
      const visible = assets.filter(asset => {
        const origin = asset.origin?.kind ?? 'user-import';
        return (filter === 'all' || origin === filter) &&
          (!query || asset.name.toLowerCase().includes(query) || (asset.origin?.prompt ?? '').toLowerCase().includes(query));
      }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (visible.length === 0) {
        const empty = document.createElement('p'); empty.className = 'asset-empty';
        empty.textContent = assets.length ? 'No sounds match this search.' : 'No sounds saved yet. Generate or import audio to build your library.';
        assetBrowserList.append(empty); return;
      }
      const referencedIds = new Set<string>();
      for (const saved of savedProjects) for (const track of saved.tracks) if (track.sampleAssetId) referencedIds.add(track.sampleAssetId);
      for (const asset of visible) {
        const card = document.createElement('article'); card.className = 'asset-card'; card.setAttribute('role', 'listitem');
        const heading = document.createElement('div'); heading.className = 'asset-card-heading';
        const title = document.createElement('strong'); title.textContent = asset.name;
        const origin = document.createElement('span'); origin.textContent = asset.origin?.kind === 'ai-generated' ? 'AI GENERATED' : asset.origin?.kind === 'ai-transformed' ? 'AI TRANSFORMED' : 'IMPORTED';
        heading.append(title, origin);
        const meta = document.createElement('p'); meta.className = 'asset-meta';
        meta.textContent = (asset.data.byteLength / 1024 / 1024).toFixed(2) + ' MB · ' + new Date(asset.updatedAt).toLocaleString();
        const diagnostics = document.createElement('p'); diagnostics.className = 'asset-diagnostics'; diagnostics.textContent = 'Analysing signal…';
        const actions = document.createElement('div'); actions.className = 'asset-card-actions';
        const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'transport-button'; preview.textContent = '▶ Preview';
        preview.addEventListener('click', () => {
          if (activeAssetPreview) activeAssetPreview.pause();
          if (activeAssetPreviewUrl) URL.revokeObjectURL(activeAssetPreviewUrl);
          activeAssetPreviewUrl = URL.createObjectURL(new Blob([asset.data], { type: asset.mimeType || 'audio/mpeg' }));
          activeAssetPreview = new Audio(activeAssetPreviewUrl);
          void activeAssetPreview.play().catch(() => { diagnostics.textContent = 'Preview playback is unavailable.'; });
        });
        const load = document.createElement('button'); load.type = 'button'; load.className = 'transport-button'; load.textContent = 'Load into selected sampler';
        const selected = activeTrack(); const canLoad = selected?.instrumentType === 'sampler' && !recorder.isRecording && !anyTransportPlaying();
        load.disabled = !canLoad; load.title = canLoad ? 'Replace the selected sampler source with this sound' : 'Select a Sampler track first';
        load.addEventListener('click', () => {
          void (async () => {
            const track = activeTrack(); if (!track || track.instrumentType !== 'sampler' || recorder.isRecording || anyTransportPlaying()) return;
            ensureTrackRuntime(track); if (audioReady) await ensureTrackAudioReady(track.id);
            const resources = resourceFor(track.id); if (!resources) throw new Error('Selected sampler is not ready.');
            const loaded = await sampleAssets.load(asset.id); if (!loaded) throw new Error('This sound is no longer available.');
            if (audioReady) await resources.instrument.loadSample(loaded.data);
            project = updateProjectTrack(project, track.id, { sampleAssetId: loaded.id, sampleFileName: loaded.name });
            await persistProject(); updateProjectUi(); await refreshAssetBrowser();
            sampleStatus.textContent = audioReady ? 'Loaded from library: ' + loaded.name : 'Assigned from library: ' + loaded.name + ' · enable audio to decode';
          })().catch((error: unknown) => { sampleStatus.textContent = error instanceof Error ? error.message : 'Could not load this sound.'; });
        });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'transport-button danger-button'; remove.textContent = 'Delete';
        remove.disabled = referencedIds.has(asset.id); remove.title = remove.disabled ? 'Used by a saved project; remove its sampler reference first.' : 'Delete from this browser';
        remove.addEventListener('click', () => {
          if (referencedIds.has(asset.id) || !window.confirm('Delete "' + asset.name + '" from the local sound library?')) return;
          void sampleAssets.delete(asset.id).then(refreshAssetBrowser);
        });
        actions.append(preview, load, remove); card.append(heading, meta, diagnostics, actions); assetBrowserList.append(card);
        void (async () => {
          try {
            const decoded = await audioRuntime.prepareContext().decodeAudioData(asset.data.slice(0));
            let peak = 0; let sumSquares = 0; let count = 0;
            for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
              const samples = decoded.getChannelData(channel);
              for (let i = 0; i < samples.length; i += 1) { const value = samples[i] ?? 0; peak = Math.max(peak, Math.abs(value)); sumSquares += value * value; count += 1; }
            }
            const rms = count ? Math.sqrt(sumSquares / count) : 0;
            const db = (value: number) => value > 0 ? (20 * Math.log10(value)).toFixed(1) + ' dBFS' : '−∞ dBFS';
            const warning = peak < 0.001 ? ' · ⚠ Nearly silent' : peak < 0.03 ? ' · ⚠ Very quiet source' : peak > 0.999 ? ' · ⚠ Near full scale / possible clipping' : ' · Signal level looks normal';
            diagnostics.textContent = decoded.duration.toFixed(2) + ' s · Peak ' + db(peak) + ' · RMS ' + db(rms) + warning;
            diagnostics.classList.toggle('has-warning', peak < 0.03 || peak > 0.999);
          } catch { diagnostics.textContent = 'Could not decode this file for level analysis.'; }
        })();
      }
    } catch (error) {
      const message = document.createElement('p'); message.className = 'asset-empty';
      message.textContent = error instanceof Error ? 'Sound library unavailable: ' + error.message : 'Sound library unavailable.'; assetBrowserList.append(message);
    }
  };

  assetRefreshButton.addEventListener('click', () => void refreshAssetBrowser());
  assetSearchInput.addEventListener('input', () => void refreshAssetBrowser());
  assetFilterSelect.addEventListener('change', () => void refreshAssetBrowser());


  const persistProject = (): Promise<void> => {
    const name = projectNameInput.value.trim();
    const nextName = name || 'Untitled Session';
    if (nextName !== project.name) {
      projectHistory.clear();
      pianoUndoButton.disabled = true;
      pianoRedoButton.disabled = true;
    }
    project = {
      ...project,
      name: nextName,
      updatedAt: new Date().toISOString(),
    };
    const snapshot = project;
    const operation = saveQueue.then(() => repository.save(snapshot));
    saveQueue = operation.catch(() => undefined);
    return operation.then(() => refreshSavedProjects());
  };

  const commitPianoEdit = (
    nextProject: ProjectSnapshot,
    selected?: Pick<ProjectClipNote, 'sourceId' | 'noteId'>,
  ): void => {
    if (nextProject === project) return;
    projectHistory.commit(project, nextProject);
    project = nextProject;
    selectedPianoNote = selected;
    updateProjectUi();
    void persistProject().catch((error: unknown) => {
      projectStatus.textContent = error instanceof Error
        ? error.message
        : 'Could not save the piano-roll edit.';
    });
  };

  const undoProjectEdit = (): void => {
    if (recorder.isRecording || anyTransportPlaying()) return;
    const previous = projectHistory.undo(project);
    if (!previous) return;
    project = previous;
    updateProjectUi();
    void persistProject().catch((error: unknown) => {
      projectStatus.textContent = error instanceof Error ? error.message : 'Could not save undo.';
    });
  };

  const redoProjectEdit = (): void => {
    if (recorder.isRecording || anyTransportPlaying()) return;
    const next = projectHistory.redo(project);
    if (!next) return;
    project = next;
    updateProjectUi();
    void persistProject().catch((error: unknown) => {
      projectStatus.textContent = error instanceof Error ? error.message : 'Could not save redo.';
    });
  };

  const deleteSelectedPianoNote = (): void => {
    if (!selectedClip || !selectedPianoNote || recorder.isRecording || anyTransportPlaying()) return;
    try {
      const next = deleteProjectClipNote(
        project,
        selectedClip.id,
        selectedPianoNote.sourceId,
        selectedPianoNote.noteId,
      );
      commitPianoEdit(next);
    } catch (error) {
      captureStatus.textContent = error instanceof Error ? error.message : 'Could not delete note.';
    }
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
      // Refresh sampler asset status after deferred audio decoding completes.
      updateProjectUi();
    } catch (error) {
      updateStatus(error instanceof Error ? error.message : 'Could not start audio');
      throw error;
    }
  };

  const startDesktopTone = async (): Promise<void> => {
    if (!audioReady) {
      try { await enableAudio(); } catch { return; }
    }
    if (!activeTrack()) { updateStatus('Add and select an instrument track before playing the theremin.'); return; }
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
      arrangementTransport.stop();
      for (const resources of trackResources.values()) resources.transport.stop();
    }
    selectedClipId = undefined;
    selectedClip = undefined;
    selectedPianoNote = undefined;
    const track = activeTrack();
    if (!track) { captureStatus.textContent = 'Add an instrument track before recording.'; return; }
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
    const beforeEdit = project;
    const destinationTrackId = recordingTrackId ?? project.activeTrackId;
    recordStartButton.disabled = !persistenceReady;
    recordStopButton.disabled = true;
    recordingTrackId = undefined;
    if (!recording) {
      updateProjectUi();
      updateClipUi();
      return;
    }

    project = {
      ...project,
      name: projectNameInput.value.trim() || project.name,
    };
    project = addRecordingToProject(project, destinationTrackId, recording);
    projectHistory.commit(beforeEdit, project);
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
      projectHistory.clear();
      if (!saved) await repository.save(project);
    } catch (error) {
      repository = new MemoryProjectRepository();
      project = createEmptyProject();
      projectStatus.textContent = 'Session only · local storage unavailable';
      captureStatus.textContent = error instanceof Error
        ? 'Could not open saved projects: ' + error.message
        : 'Could not open saved projects. This session will be temporary.';
    }

    persistenceReady = true;
    recordStartButton.disabled = !activeTrack()?.armed;
    projectSaveButton.disabled = false;
    if (repository.durability === 'persistent') {
      projectStatus.textContent = 'Local project storage ready';
    } else if (!projectStatus.textContent.startsWith('Session only')) {
      projectStatus.textContent = 'Session only · browser storage unavailable';
    }
    for (const track of project.tracks) ensureTrackRuntime(track);
    await refreshSavedProjects();
    await refreshAssetBrowser();
    enableButton.disabled = false;
    enterVrButton.disabled = false;
    playButton.disabled = !activeTrack();
    updateProjectUi();
  };

  arrangementTimeline.addEventListener('pointerdown', (event) => {
    if (recorder.isRecording || anyTransportPlaying()) return;
    const rect = arrangementTimeline.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = [...arrangementHitRegions].reverse().find(region =>
      x >= region.x && x <= region.x + region.width &&
      y >= region.y && y <= region.y + region.height,
    );
    if (!hit) return;

    const clip = project.clips.find(item => item.id === hit.clipId);
    if (!clip) return;
    const originalProject = project;
    const originalActiveTrackId = project.activeTrackId;
    resourceFor(originalActiveTrackId)?.instrument.stopAudition();
    project = setActiveProjectTrack(project, hit.trackId);
    selectedClipId = clip.id;
    selectedClip = clip;
    const isResizeHandle = hit.x + hit.width - x <= 12;
    arrangementDrag = {
      clipId: clip.id,
      pointerId: event.pointerId,
      pointerStartX: event.clientX,
      mode: isResizeHandle ? 'resize' : 'move',
      originalProject,
      originalStartBeats: clip.startBeats,
      originalLengthBeats: getClipDurationBeats(clip),
      originalTrackId: clip.trackId,
      originalActiveTrackId,
      previewTrackId: clip.trackId,
      previewStartBeats: clip.startBeats,
      previewLengthBeats: getClipDurationBeats(clip),
    };
    arrangementTimeline.setPointerCapture(event.pointerId);
    updateProjectUi();
    event.preventDefault();
  });

  arrangementTimeline.addEventListener('pointermove', (event) => {
    if (!arrangementDrag || arrangementDrag.pointerId !== event.pointerId) return;
    const metrics = getArrangementMetrics();
    const rect = arrangementTimeline.getBoundingClientRect();
    const deltaBeats = (event.clientX - arrangementDrag.pointerStartX) / metrics.pixelsPerBeat;
    const snapBeats = Number(gridSnapSelect.value);
    if (arrangementDrag.mode === 'resize') {
      const rawLength = Math.max(0.125, arrangementDrag.originalLengthBeats + deltaBeats);
      const snappedLength = snapBeats > 0
        ? Math.round(rawLength / snapBeats) * snapBeats
        : rawLength;
      arrangementDrag.previewLengthBeats = Math.max(0.125, snappedLength);
    } else {
      const localY = event.clientY - rect.top;
      const rowIndex = Math.floor((localY - metrics.top) / metrics.rowHeight);
      const boundedRow = Math.max(0, Math.min(metrics.tracks.length - 1, rowIndex));
      const targetTrack = metrics.tracks[boundedRow];
      const rawStart = Math.max(0, arrangementDrag.originalStartBeats + deltaBeats);
      const snappedStart = snapBeats > 0
        ? Math.round(rawStart / snapBeats) * snapBeats
        : rawStart;
      arrangementDrag.previewStartBeats = Math.max(0, snappedStart);
      if (targetTrack) arrangementDrag.previewTrackId = targetTrack.id;
    }
    drawArrangement({
      clipId: arrangementDrag.clipId,
      trackId: arrangementDrag.previewTrackId,
      startBeats: arrangementDrag.previewStartBeats,
      lengthBeats: arrangementDrag.previewLengthBeats,
    });
    event.preventDefault();
  });

  const finishArrangementDrag = (event: PointerEvent): void => {
    if (!arrangementDrag || arrangementDrag.pointerId !== event.pointerId) return;
    const drag = arrangementDrag;
    arrangementDrag = undefined;
    const clipMoved = drag.mode === 'move' && (
      drag.previewStartBeats !== drag.originalStartBeats ||
      drag.previewTrackId !== drag.originalTrackId
    );
    const clipResized = drag.mode === 'resize' &&
      drag.previewLengthBeats !== drag.originalLengthBeats;
    const activeTrackChanged = drag.originalActiveTrackId !== drag.previewTrackId;
    if (clipResized) {
      project = resizeProjectClip(project, drag.clipId, drag.previewLengthBeats);
    }
    if (clipMoved) {
      project = moveProjectClip(
        project,
        drag.clipId,
        drag.previewTrackId,
        drag.previewStartBeats,
      );
      project = setActiveProjectTrack(project, drag.previewTrackId);
    }
    if (clipMoved || clipResized || activeTrackChanged) {
      projectHistory.commit(drag.originalProject, project);
    }
    selectedClipId = drag.clipId;
    selectedClip = project.clips.find(clip => clip.id === selectedClipId);
    updateProjectUi();
    if (clipMoved || clipResized || activeTrackChanged) {
      void persistProject().catch((error: unknown) => {
        projectStatus.textContent = error instanceof Error
          ? error.message
          : 'Could not save the clip edit.';
      });
    }
    event.preventDefault();
  };

  arrangementTimeline.addEventListener('pointerup', finishArrangementDrag);
  arrangementTimeline.addEventListener('pointercancel', (event) => {
    if (!arrangementDrag || arrangementDrag.pointerId !== event.pointerId) return;
    const originalActiveTrackId = arrangementDrag.originalActiveTrackId;
    arrangementDrag = undefined;
    project = setActiveProjectTrack(project, originalActiveTrackId);
    selectedClip = project.clips.find(clip => clip.id === selectedClipId);
    updateProjectUi();
  });

  const commitTimingChange = (patch: { tempoBpm?: number; timeSignature?: { numerator: number; denominator: number } }): void => {
    try {
      const beforeEdit = project;
      project = updateProjectTiming(project, patch);
      projectHistory.commit(beforeEdit, project);
      updateProjectUi();
      void persistProject().catch((error: unknown) => {
        projectStatus.textContent = error instanceof Error ? error.message : 'Could not save project timing.';
      });
    } catch (error) {
      updateProjectUi();
      captureStatus.textContent = error instanceof Error ? error.message : 'Invalid musical timing.';
    }
  };

  tempoInput.addEventListener('change', () => {
    const tempo = Number(tempoInput.value);
    if (!Number.isFinite(tempo) || tempo < 20 || tempo > 300) {
      tempoInput.value = String(project.tempoBpm);
      return;
    }
    commitTimingChange({ tempoBpm: tempo });
  });

  timeSignatureSelect.addEventListener('change', () => {
    const [numeratorText, denominatorText] = timeSignatureSelect.value.split('/');
    const numerator = Number(numeratorText);
    const denominator = Number(denominatorText);
    if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
      timeSignatureSelect.value = project.timeSignature.numerator + '/' + project.timeSignature.denominator;
      return;
    }
    commitTimingChange({ timeSignature: { numerator, denominator } });
  });

  const commitLoopRegion = (): void => {
    const startBar = Number(loopStartBarInput.value);
    const endBar = Number(loopEndBarInput.value);
    if (!Number.isInteger(startBar) || !Number.isInteger(endBar) ||
        startBar < 1 || endBar <= startBar) {
      captureStatus.textContent = 'Loop out must be a later bar than loop in.';
      updateProjectUi();
      return;
    }
    const beforeEdit = project;
    const beatsPerBar = project.timeSignature.numerator * 4 / project.timeSignature.denominator;
    project = updateProjectLoopRegion(project, {
      enabled: loopEnabledInput.checked,
      startBeat: (startBar - 1) * beatsPerBar,
      endBeat: (endBar - 1) * beatsPerBar,
    });
    projectHistory.commit(beforeEdit, project);
    updateProjectUi();
    void persistProject().catch((error: unknown) => {
      projectStatus.textContent = error instanceof Error ? error.message : 'Could not save loop region.';
    });
  };
  loopEnabledInput.addEventListener('change', commitLoopRegion);
  loopStartBarInput.addEventListener('change', commitLoopRegion);
  loopEndBarInput.addEventListener('change', commitLoopRegion);

  deleteTrackButton.addEventListener('click', () => {
    const selected = activeTrack();
    if (!selected || recorder.isRecording || anyTransportPlaying()) return;
    if (!window.confirm('Delete track "' + selected.name + '" and all clips on it? This cannot be undone.')) return;
    void (async () => {
      const resources = resourceFor(selected.id);
      if (resources) {
        resources.transport.dispose(); resources.unsubscribeTransport();
        parameterBus.unregisterTarget(resources.instrument.id); parameterBus.unregisterTarget(resources.bus.id);
        await rack.remove(resources.instrument.id); await rack.remove(resources.bus.id);
        trackResources.delete(selected.id);
      }
      project = deleteProjectTrack(project, selected.id);
      projectHistory.clear(); selectedClipId = undefined; selectedClip = undefined; selectedPianoNote = undefined;
      updateProjectUi(); await persistProject();
      captureStatus.textContent = 'Deleted ' + selected.name + ' and its clips.';
    })().catch((error: unknown) => { projectStatus.textContent = error instanceof Error ? error.message : 'Could not delete track.'; });
  });

  trackSelect.addEventListener('change', () => {
    if (recorder.isRecording) return;
    const beforeEdit = project;
    resourceFor(project.activeTrackId)?.instrument.stopAudition();
    project = setActiveProjectTrack(project, trackSelect.value);
    projectHistory.commit(beforeEdit, project);
    selectedClipId = undefined;
    selectedClip = undefined;
    selectedPianoNote = undefined;
    updateProjectUi();
    void persistProject().catch((error: unknown) => {
      projectStatus.textContent = error instanceof Error ? error.message : 'Could not save active track';
    });
  });

  addTrackButton.addEventListener('click', () => {
    if (recorder.isRecording) return;
    const count = project.tracks.length + 1;
    const instrumentType = newInstrumentTypeSelect.value;
    if (!isInstrumentType(instrumentType)) return;
    const moduleId = instrumentType + '-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36));
    const trackName = getInstrumentLabel(instrumentType) + ' ' + String(count).padStart(2, '0');
    const beforeEdit = project;
    project = addInstrumentTrack(project, trackName, moduleId, new Date(), instrumentType);
    projectHistory.commit(beforeEdit, project);
    const track = activeTrack();
    if (!track) return;
    ensureTrackRuntime(track);
    selectedClipId = undefined;
    selectedClip = undefined;
    updateProjectUi();
    void persistProject().catch((error: unknown) => {
      projectStatus.textContent = error instanceof Error ? error.message : 'Could not save new track';
    });
  });

  sampleFileInput.addEventListener('change', () => {
    const file = sampleFileInput.files?.[0];
    const track = activeTrack();
    if (!file) return;
    if (!track) { sampleStatus.textContent = 'Add a Sampler track before importing audio.'; sampleFileInput.value = ''; return; }
    if (recorder.isRecording || anyTransportPlaying()) {
      sampleStatus.textContent = 'Stop recording and playback before replacing a sample.';
      sampleFileInput.value = '';
      return;
    }
    if (track.instrumentType !== 'sampler') {
      sampleStatus.textContent = 'Select a Sampler track before importing audio.';
      sampleFileInput.value = '';
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      sampleStatus.textContent = 'Sample files must be 25 MB or smaller.';
      sampleFileInput.value = '';
      return;
    }

    sampleStatus.textContent = 'Importing ' + file.name + '…';
    void (async () => {
      const data = await file.arrayBuffer();
      const assetId = 'sample-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36));
      await sampleAssets.save({
        id: assetId,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        data,
        updatedAt: new Date().toISOString(),
      });
      await refreshAssetBrowser();
      const beforeEdit = project;
      project = updateProjectTrack(project, track.id, {
        sampleAssetId: assetId,
        sampleFileName: file.name,
        samplerSettings: { ...DEFAULT_SAMPLER_SETTINGS },
      });
      projectHistory.commit(beforeEdit, project);
      const resources = resourceFor(track.id);
      resources?.instrument.clearSample();
      if (audioReady && resources) await resources.instrument.loadSample(data);
      sampleStatus.textContent = audioReady
        ? 'Loaded: ' + file.name
        : 'Stored: ' + file.name + ' · enable audio to decode';
      updateProjectUi();
      await persistProject();
    })().catch((error: unknown) => {
      sampleStatus.textContent = error instanceof Error
        ? 'Sample import failed: ' + error.message
        : 'Sample import failed.';
    });
    sampleFileInput.value = '';
  });

  const saveSamplerSettings = (patch: Partial<SamplerSettings>): void => {
    const track = activeTrack();
    if (!track || track.instrumentType !== 'sampler') return;
    const current = track.samplerSettings ?? DEFAULT_SAMPLER_SETTINGS;
    const next: SamplerSettings = {
      ...current,
      ...patch,
    };
    const startPosition = Math.max(0, Math.min(0.998, next.startPosition));
    const endPosition = Math.max(startPosition + 0.001, Math.min(1, next.endPosition));
    const loopStart = Math.max(startPosition, Math.min(endPosition - 0.001, next.loopStart));
    const loopEnd = Math.max(loopStart + 0.001, Math.min(endPosition, next.loopEnd));
    const normalized: SamplerSettings = {
      ...next, startPosition, endPosition, loopStart, loopEnd,
      rootNote: Math.max(0, Math.min(127, Math.round(next.rootNote))),
    };
    const beforeEdit = project;
    project = updateProjectTrack(project, track.id, { samplerSettings: normalized });
    projectHistory.commit(beforeEdit, project);
    resourceFor(track.id)?.instrument.setSamplerSettings(normalized);
    updateProjectUi();
    void persistProject().catch((error: unknown) => {
      sampleStatus.textContent = error instanceof Error ? error.message : 'Could not save sampler settings.';
    });
  };

  sampleAuditionButton.addEventListener('click', () => {
    const selected = activeTrack();
    const resources = selected ? resourceFor(selected.id) : undefined;
    if (!audioReady || !resources?.instrument.hasSample) {
      sampleStatus.textContent = 'Enable audio and load a sample before auditioning.';
      return;
    }
    resources.instrument.auditionSample();
    sampleAuditionStopButton.disabled = false;
  });
  sampleAuditionStopButton.addEventListener('click', () => { const selected = activeTrack(); if (selected) resourceFor(selected.id)?.instrument.stopAudition(); });
  samplerPlaybackMode.addEventListener('change', () =>
    saveSamplerSettings({ playbackMode: samplerPlaybackMode.value as SamplerSettings['playbackMode'] }));
  samplerStartInput.addEventListener('input', () =>
    saveSamplerSettings({ startPosition: Number(samplerStartInput.value) }));
  samplerEndInput.addEventListener('input', () =>
    saveSamplerSettings({ endPosition: Number(samplerEndInput.value) }));
  samplerLoopInput.addEventListener('change', () =>
    saveSamplerSettings({ loopEnabled: samplerLoopInput.checked }));
  samplerLoopStartInput.addEventListener('input', () =>
    saveSamplerSettings({ loopStart: Number(samplerLoopStartInput.value) }));
  samplerLoopEndInput.addEventListener('input', () =>
    saveSamplerSettings({ loopEnd: Number(samplerLoopEndInput.value) }));
  samplerRootNoteInput.addEventListener('change', () =>
    saveSamplerSettings({ rootNote: Number(samplerRootNoteInput.value) }));

  aiCancelButton.addEventListener('click', () => {
    generationAbortController?.abort();
    aiGenerationStatus.textContent = 'Stopping browser polling. The provider may continue its current generation.';
  });

  aiGenerateButton.addEventListener('click', () => {
    if (recorder.isRecording || anyTransportPlaying() || generationAbortController) return;
    const endpoint = aiServiceUrlInput.value.trim();
    const prompt = aiSamplePromptInput.value.trim();
    const durationSeconds = Number(aiSampleDurationInput.value);
    if (!endpoint) {
      aiGenerationStatus.textContent = 'Enter the base URL of an audio-generation service first.';
      aiServiceUrlInput.focus();
      return;
    }
    if (!prompt || prompt.length > 4000) {
      aiGenerationStatus.textContent = 'Enter a sound prompt between 1 and 4000 characters.';
      aiSamplePromptInput.focus();
      return;
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 30) {
      aiGenerationStatus.textContent = 'Choose a duration between 1 and 30 seconds for the current provider.';
      aiSampleDurationInput.focus();
      return;
    }

    const controller = new AbortController();
    generationAbortController = controller;
    updateProjectUi();
    aiGenerationStatus.textContent = 'Submitting your prompt to the AI service…';
    void (async () => {
      const provider = new HttpAudioGenerationProvider(endpoint);
      const generated = await provider.generateSample(
        { prompt, durationSeconds },
        progress => {
          const percent = progress.progress === undefined ? '' : ' · ' + Math.round(progress.progress) + '%';
          aiGenerationStatus.textContent = (progress.message || 'AI generation ' + progress.status) + percent;
        },
        controller.signal,
      );

      const assetId = 'ai-sample-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36));
      const createdAt = new Date().toISOString();
      await sampleAssets.save({
        id: assetId,
        name: generated.fileName,
        mimeType: generated.mimeType,
        data: generated.data,
        updatedAt: createdAt,
        origin: {
          kind: 'ai-generated',
          providerId: generated.providerId,
          jobId: generated.jobId,
          prompt,
          createdAt,
        },
      });

      await refreshAssetBrowser();
      const beforeEdit = project;
      const trackNumber = project.tracks.length + 1;
      const moduleId = 'sampler-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36));
      project = addInstrumentTrack(
        project,
        'AI Sample ' + String(trackNumber).padStart(2, '0'),
        moduleId,
        new Date(),
        'sampler',
      );
      const generatedTrack = activeTrack();
      if (!generatedTrack) throw new Error('Generated sampler track could not be created.');
      project = updateProjectTrack(project, generatedTrack.id, {
        sampleAssetId: assetId,
        sampleFileName: generated.fileName,
        samplerSettings: { ...DEFAULT_SAMPLER_SETTINGS },
      });
      projectHistory.commit(beforeEdit, project);
      ensureTrackRuntime(generatedTrack, false);
      if (audioReady) await ensureTrackAudioReady(generatedTrack.id);
      await persistProject();
      updateProjectUi();
      await refreshAssetBrowser();
      const sampleLoaded = resourceFor(generatedTrack.id)?.instrument.hasSample === true;
      aiGenerationStatus.textContent = sampleLoaded
        ? 'Created ' + generated.fileName + ' on ' + generatedTrack.name + '. The sample is loaded and ready to play.'
        : 'Created ' + generated.fileName + ' on ' + generatedTrack.name + '. It is stored locally; click Enable audio to load it into the Sampler.';
    })().catch((error: unknown) => {
      aiGenerationStatus.textContent = controller.signal.aborted
        ? 'Stopped waiting. No track was added; the provider job may still finish remotely.'
        : error instanceof Error ? 'AI generation failed: ' + error.message : 'AI generation failed.';
    }).finally(() => {
      if (generationAbortController === controller) generationAbortController = undefined;
      updateProjectUi();
    });
  });


  samplerTransformButton.addEventListener('click', () => {
    const sourceTrack = activeTrack();
    if (
      !sourceTrack || sourceTrack.instrumentType !== 'sampler' || !sourceTrack.sampleAssetId ||
      !audioReady || recorder.isRecording || anyTransportPlaying() || generationAbortController
    ) return;

    const endpoint = aiServiceUrlInput.value.trim();
    const prompt = samplerTransformPrompt.value.trim();
    const durationSeconds = Number(samplerTransformDuration.value);
    const conditionStrength = samplerTransformStrength.value as 'low' | 'medium' | 'high' | 'xhigh';
    if (!endpoint) {
      samplerTransformStatus.textContent = 'Enter the AI service URL in the AI Sound Generation panel first.';
      aiServiceUrlInput.focus();
      return;
    }
    if (!prompt || prompt.length > 4000) {
      samplerTransformStatus.textContent = 'Describe the transformation in 1–4000 characters.';
      samplerTransformPrompt.focus();
      return;
    }
    if (!Number.isInteger(durationSeconds) || durationSeconds < 3 || durationSeconds > 30) {
      samplerTransformStatus.textContent = 'Choose an output duration between 3 and 30 seconds.';
      samplerTransformDuration.focus();
      return;
    }

    const controller = new AbortController();
    generationAbortController = controller;
    updateProjectUi();
    samplerTransformStatus.textContent = 'Preparing the selected sample as an audio reference…';
    void (async () => {
      const asset = await sampleAssets.load(sourceTrack.sampleAssetId!);
      if (!asset) throw new Error('The selected sample could not be found in local audio storage.');
      const context = audioRuntime.requireContext();
      const decoded = await context.decodeAudioData(asset.data.slice(0));
      const settings = sourceTrack.samplerSettings ?? DEFAULT_SAMPLER_SETTINGS;
      const regionStartSeconds = Math.max(0, Math.min(decoded.duration, settings.startPosition * decoded.duration));
      const regionEndSeconds = Math.max(regionStartSeconds, Math.min(decoded.duration, settings.endPosition * decoded.duration));
      const referenceEndSeconds = Math.min(regionEndSeconds, regionStartSeconds + 30);
      const referenceStartMs = Math.round(regionStartSeconds * 1000);
      const referenceEndMs = Math.round(referenceEndSeconds * 1000);
      if (referenceEndMs - referenceStartMs < 50) {
        throw new Error('The selected sample region must be at least 50 ms long.');
      }
      if (referenceEndMs > 600000) {
        throw new Error('The selected reference region must start within the first 10 minutes of the source file.');
      }

      const sourceFile = new File([asset.data], asset.name, { type: asset.mimeType || 'audio/mpeg' });
      const provider = new HttpAudioTransformationProvider(endpoint);
      samplerTransformStatus.textContent = 'Uploading the selected sample to Eleven Music…';
      const transformed = await provider.transformSample({
        prompt,
        durationSeconds,
        referenceStartMs,
        referenceEndMs,
        conditionStrength,
      }, sourceFile, progress => {
        const percent = progress.progress === undefined ? '' : ' · ' + Math.round(progress.progress) + '%';
        samplerTransformStatus.textContent = (progress.message || 'Transforming sample ' + progress.status) + percent;
      }, controller.signal);

      const assetId = 'ai-transform-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36));
      const createdAt = new Date().toISOString();
      await sampleAssets.save({
        id: assetId,
        name: transformed.fileName,
        mimeType: transformed.mimeType,
        data: transformed.data,
        updatedAt: createdAt,
        origin: {
          kind: 'ai-transformed',
          providerId: transformed.providerId,
          jobId: transformed.jobId,
          prompt,
          sourceAssetId: asset.id,
          createdAt,
        },
      });

      const beforeEdit = project;
      const trackNumber = project.tracks.length + 1;
      const moduleId = 'sampler-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36));
      project = addInstrumentTrack(
        project,
        'AI Variation ' + String(trackNumber).padStart(2, '0'),
        moduleId,
        new Date(),
        'sampler',
      );
      const generatedTrack = activeTrack();
      if (!generatedTrack) throw new Error('Variation sampler track could not be created.');
      project = updateProjectTrack(project, generatedTrack.id, {
        sampleAssetId: assetId,
        sampleFileName: transformed.fileName,
        samplerSettings: { ...DEFAULT_SAMPLER_SETTINGS },
      });
      projectHistory.commit(beforeEdit, project);
      ensureTrackRuntime(generatedTrack, false);
      if (audioReady) await ensureTrackAudioReady(generatedTrack.id);
      await persistProject();
      updateProjectUi();
      await refreshAssetBrowser();
      samplerTransformStatus.textContent = 'Created ' + transformed.fileName + ' on ' + generatedTrack.name +
        '. Your original sample remains unchanged; the variation is saved as a new Sampler track.';
    })().catch((error: unknown) => {
      samplerTransformStatus.textContent = controller.signal.aborted
        ? 'Stopped waiting. The provider job may still finish remotely.'
        : error instanceof Error ? 'Transformation failed: ' + error.message : 'Transformation failed.';
    }).finally(() => {
      if (generationAbortController === controller) generationAbortController = undefined;
      updateProjectUi();
    });
  });

  armTrackButton.addEventListener('click', () => {
    if (recorder.isRecording) return;
    const beforeEdit = project;
    const trackId = project.activeTrackId;
    const selected = activeTrack();
    if (!selected) return;
    const shouldArm = !selected.armed;
    for (const track of project.tracks) {
      project = updateProjectTrack(project, track.id, { armed: track.id === trackId && shouldArm });
    }
    projectHistory.commit(beforeEdit, project);
    updateProjectUi();
    void persistProject();
  });

  muteTrackButton.addEventListener('click', () => {
    if (recorder.isRecording) return;
    const beforeEdit = project;
    const selected = activeTrack(); if (!selected) return;
    project = updateProjectTrack(project, selected.id, { muted: !selected.muted });
    projectHistory.commit(beforeEdit, project);
    updateProjectUi();
    void persistProject();
  });

  soloTrackButton.addEventListener('click', () => {
    if (recorder.isRecording) return;
    const beforeEdit = project;
    const selected = activeTrack(); if (!selected) return;
    project = updateProjectTrack(project, selected.id, { solo: !selected.solo });
    projectHistory.commit(beforeEdit, project);
    updateProjectUi();
    void persistProject();
  });

  trackVolumeInput.addEventListener('input', () => {
    projectHistory.clear();
    pianoUndoButton.disabled = true;
    pianoRedoButton.disabled = true;
    project = updateProjectTrack(project, project.activeTrackId, { volume: Number(trackVolumeInput.value) });
    applyTrackMix();
  });
  trackVolumeInput.addEventListener('change', () => { void persistProject(); });

  trackPanInput.addEventListener('input', () => {
    projectHistory.clear();
    pianoUndoButton.disabled = true;
    pianoRedoButton.disabled = true;
    project = updateProjectTrack(project, project.activeTrackId, { pan: Number(trackPanInput.value) });
    applyTrackMix();
  });
  trackPanInput.addEventListener('change', () => { void persistProject(); });

  recordStartButton.addEventListener('click', startRecording);
  recordStopButton.addEventListener('click', stopRecording);

  clipSelect.addEventListener('change', () => {
    selectedClipId = clipSelect.value || undefined;
    selectedClip = project.clips.find(clip => clip.id === selectedClipId);
    selectedPianoNote = undefined;
    updateClipUi();
  });

  pianoRoll.addEventListener('pointerdown', (event) => {
    if (!selectedClip || recorder.isRecording || anyTransportPlaying()) return;
    const rect = pianoRoll.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const metrics = pianoRollMetrics;
    const hit = [...pianoRollHitRegions].reverse().find(region =>
      x >= region.x && x <= region.x + region.width &&
      y >= region.y && y <= region.y + region.height,
    );

    if (hit) {
      const note = getProjectClipNotes(selectedClip).find(item =>
        item.sourceId === hit.sourceId && item.noteId === hit.noteId,
      );
      if (!note) return;
      selectedPianoNote = { sourceId: note.sourceId, noteId: note.noteId };
      pianoDrag = {
        pointerId: event.pointerId,
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
        mode: hit.x + hit.width - x <= 6 ? 'resize' : 'move',
        original: note,
        preview: note,
      };
      pianoRoll.setPointerCapture(event.pointerId);
      updateClipUi();
      event.preventDefault();
      return;
    }

    if (x < metrics.left || y < metrics.top) return;
    const pitch = metrics.pitchHigh - Math.floor((y - metrics.top) / metrics.rowHeight);
    if (pitch < metrics.pitchLow || pitch > metrics.pitchHigh) return;
    const snap = Number(gridSnapSelect.value);
    const rawBeat = Math.max(0, (x - metrics.left) / metrics.pixelsPerBeat);
    if (rawBeat > selectedClip.lengthBeats + 0.0001) return;
    const snappedBeat = snap > 0 ? Math.round(rawBeat / snap) * snap : rawBeat;
    const startBeat = Math.max(
      0,
      Math.min(selectedClip.lengthBeats - 0.0625, snappedBeat),
    );
    const safeDuration = Math.min(1, selectedClip.lengthBeats - startBeat);
    if (safeDuration <= 0) return;

    const noteId = 'piano-' + (
      globalThis.crypto?.randomUUID?.() ??
      Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    );
    try {
      const next = addProjectClipNote(project, selectedClip.id, {
        sourceId: 'piano-roll',
        noteId,
        pitch,
        velocity: 0.8,
        startBeat,
        durationBeats: safeDuration,
      });
      pianoRoll.focus();
      commitPianoEdit(next, { sourceId: 'piano-roll', noteId });
    } catch (error) {
      captureStatus.textContent = error instanceof Error ? error.message : 'Could not add note.';
    }
    event.preventDefault();
  });

  pianoRoll.addEventListener('pointermove', (event) => {
    if (!pianoDrag || pianoDrag.pointerId !== event.pointerId || !selectedClip) return;
    const metrics = pianoRollMetrics;
    const deltaBeats = (event.clientX - pianoDrag.pointerStartX) / metrics.pixelsPerBeat;
    const snap = Number(gridSnapSelect.value);
    let preview: ProjectClipNote;

    if (pianoDrag.mode === 'resize') {
      const maxDuration = selectedClip.lengthBeats - pianoDrag.original.startBeat;
      const minimumDuration = Math.min(0.0625, maxDuration);
      const rawDuration = Math.max(minimumDuration, pianoDrag.original.durationBeats + deltaBeats);
      const snappedDuration = snap > 0 ? Math.round(rawDuration / snap) * snap : rawDuration;
      preview = {
        ...pianoDrag.original,
        durationBeats: Math.max(minimumDuration, Math.min(maxDuration, snappedDuration)),
      };
    } else {
      const rawStart = pianoDrag.original.startBeat + deltaBeats;
      const snappedStart = snap > 0 ? Math.round(rawStart / snap) * snap : rawStart;
      const startBeat = Math.max(
        0,
        Math.min(selectedClip.lengthBeats - pianoDrag.original.durationBeats, snappedStart),
      );
      const deltaPitch = Math.round((pianoDrag.pointerStartY - event.clientY) / metrics.rowHeight);
      preview = {
        ...pianoDrag.original,
        startBeat,
        pitch: Math.max(0, Math.min(127, pianoDrag.original.pitch + deltaPitch)),
      };
    }

    pianoDrag.preview = preview;
    drawPianoRoll({
      sourceId: preview.sourceId,
      noteId: preview.noteId,
      pitch: preview.pitch,
      startBeat: preview.startBeat,
      durationBeats: preview.durationBeats,
    });
    event.preventDefault();
  });

  const finishPianoDrag = (event: PointerEvent): void => {
    if (!pianoDrag || pianoDrag.pointerId !== event.pointerId || !selectedClip) return;
    const drag = pianoDrag;
    pianoDrag = undefined;
    const changed = drag.preview.pitch !== drag.original.pitch ||
      drag.preview.startBeat !== drag.original.startBeat ||
      drag.preview.durationBeats !== drag.original.durationBeats;
    if (changed) {
      try {
        const next = updateProjectClipNote(
          project,
          selectedClip.id,
          drag.original.sourceId,
          drag.original.noteId,
          {
            pitch: drag.preview.pitch,
            startBeat: drag.preview.startBeat,
            durationBeats: drag.preview.durationBeats,
          },
        );
        commitPianoEdit(next, {
          sourceId: drag.original.sourceId,
          noteId: drag.original.noteId,
        });
      } catch (error) {
        captureStatus.textContent = error instanceof Error ? error.message : 'Could not edit note.';
        drawPianoRoll();
      }
    } else {
      drawPianoRoll();
    }
    event.preventDefault();
  };
  pianoRoll.addEventListener('pointerup', finishPianoDrag);
  pianoRoll.addEventListener('pointercancel', (event) => {
    if (!pianoDrag || pianoDrag.pointerId !== event.pointerId) return;
    pianoDrag = undefined;
    drawPianoRoll();
  });

  pianoVelocityInput.addEventListener('change', () => {
    if (!selectedClip || !selectedPianoNote || recorder.isRecording || anyTransportPlaying()) return;
    try {
      const next = updateProjectClipNote(
        project,
        selectedClip.id,
        selectedPianoNote.sourceId,
        selectedPianoNote.noteId,
        { velocity: Number(pianoVelocityInput.value) },
      );
      commitPianoEdit(next, selectedPianoNote);
    } catch (error) {
      captureStatus.textContent = error instanceof Error ? error.message : 'Could not change velocity.';
    }
  });
  pianoDeleteButton.addEventListener('click', deleteSelectedPianoNote);
  pianoUndoButton.addEventListener('click', undoProjectEdit);
  pianoRedoButton.addEventListener('click', redoProjectEdit);
  pianoRoll.addEventListener('keydown', (event) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelectedPianoNote();
    }
  });
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const isEditable = target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (isEditable || !(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoProjectEdit();
      else undoProjectEdit();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redoProjectEdit();
    }
  });
  gridSnapSelect.addEventListener('change', () => drawPianoRoll());

  clipPlayButton.addEventListener('click', () => {
    if (!selectedClip || !audioReady) return;
    try {
      arrangementTransport.stop();
      for (const resources of trackResources.values()) resources.transport.stop();
      const resources = resourceFor(selectedClip.trackId);
      if (!resources) throw new Error('The clip track has no instrument runtime.');
      resources.transport.play(projectClipToRecordingClip(selectedClip, project.tempoBpm));
    } catch (error) {
      captureStatus.textContent = error instanceof Error ? error.message : 'Could not play clip';
    }
  });
  clipDuplicateButton.addEventListener('click', () => {
    if (!selectedClip || recorder.isRecording || anyTransportPlaying()) return;
    try {
      const beforeEdit = project;
      project = duplicateProjectClip(project, selectedClip.id);
      projectHistory.commit(beforeEdit, project);
      selectedClipId = project.clips[project.clips.length - 1]?.id;
      selectedClip = project.clips.find(clip => clip.id === selectedClipId);
      updateProjectUi();
      void persistProject().catch((error: unknown) => {
        projectStatus.textContent = error instanceof Error ? error.message : 'Could not save duplicate clip.';
      });
    } catch (error) {
      captureStatus.textContent = error instanceof Error ? error.message : 'Could not duplicate clip.';
    }
  });

  clipStopButton.addEventListener('click', () => {
    arrangementTransport.stop();
    for (const resources of trackResources.values()) resources.transport.stop();
  });

  const startArrangementPlayback = async (): Promise<void> => {
    if (!audioReady) throw new Error('Enable audio before playing the arrangement.');
    arrangementTransport.stop();
    for (const resources of trackResources.values()) resources.transport.stop();
    await Promise.all(project.tracks.map(async track => {
      ensureTrackRuntime(track);
      await ensureTrackAudioReady(track.id);
    }));
    const sinks = new Map(
      project.tracks.map(track => [track.id, resourceFor(track.id)!.instrument] as const),
    );
    arrangementTransport.play(project, sinks);
    updateClipUi();
  };

  arrangementPlayButton.addEventListener('click', () => {
    void startArrangementPlayback().catch((error: unknown) => {
      captureStatus.textContent = error instanceof Error
        ? error.message
        : 'Could not play the arrangement.';
    });
  });
  arrangementStopButton.addEventListener('click', () => arrangementTransport.stop());

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

  const startNewProject = async (): Promise<void> => {
    if (
      !persistenceReady || recorder.isRecording || anyTransportPlaying() ||
      generationAbortController !== undefined || isCreatingNewProject
    ) return;

    const accepted = window.confirm(
      'Start a new project?\n\n' +
      '"' + project.name + '" will be saved on this device. ' +
      'A fresh, empty project will open. Your previous project will be kept.',
    );
    if (!accepted) return;

    isCreatingNewProject = true;
    newProjectButton.disabled = true;
    projectSaveButton.disabled = true;
    try {
      // Flush any queued edits and preserve the current session before switching.
      await persistProject();
      const previousProjectName = project.name;

      stopDesktopTone();
      if (spatialNoteId) {
        stopNote(theremin.id, spatialNoteId);
        spatialNoteId = undefined;
      }
      arrangementTransport.stop();

      // Release the previous project's instruments, buses, schedulers and mappings.
      await disposeProjectTrackResources();

      const previousUpdatedAt = Date.parse(project.updatedAt);
      const nextTimestamp = new Date(Number.isFinite(previousUpdatedAt)
        ? Math.max(Date.now(), previousUpdatedAt + 1)
        : Date.now());
      const existingProjectIds = new Set(savedProjects.map(saved => saved.id));
      let freshProject = createEmptyProject(nextTimestamp);
      // New-project creation is insert-only. Guard against even an unexpected ID collision.
      while (existingProjectIds.has(freshProject.id)) {
        const uniqueId = globalThis.crypto?.randomUUID?.() ??
          'project-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        freshProject = { ...freshProject, id: uniqueId };
      }
      project = freshProject;
      projectHistory.clear();
      selectedClipId = undefined;
      selectedClip = undefined;
      selectedPianoNote = undefined;
      pianoDrag = undefined;
      recordingTrackId = undefined;

      projectNameInput.value = project.name;
      // Empty projects do not instantiate an instrument until the user adds a track.
      updateProjectUi();
      const newSnapshot = project;
      const createOperation = saveQueue.then(() => repository.saveAsNew(newSnapshot));
      saveQueue = createOperation.catch(() => undefined);
      await createOperation;
      await refreshSavedProjects();

      projectStatus.textContent = repository.durability === 'persistent'
        ? 'New project saved · previous project kept on this device'
        : 'New session created · browser storage unavailable';
      captureStatus.textContent = 'Started a fresh project. "' + previousProjectName +
        '" was saved separately on this device.';
    } catch (error) {
      projectStatus.textContent = error instanceof Error
        ? 'Could not finish creating the new project: ' + error.message
        : 'Could not finish creating the new project.';
    } finally {
      isCreatingNewProject = false;
      newProjectButton.disabled = !persistenceReady || recorder.isRecording ||
        anyTransportPlaying() || generationAbortController !== undefined;
      projectSaveButton.disabled = false;
      updateProjectUi();
    }
  };

  newProjectButton.addEventListener('click', () => {
    void startNewProject();
  });

  const openSelectedProject = async (): Promise<void> => {
    if (
      !persistenceReady || recorder.isRecording || anyTransportPlaying() ||
      generationAbortController !== undefined || isCreatingNewProject
    ) return;

    const target = savedProjects.find(item => item.id === savedProjectsSelect.value);
    if (!target || target.id === project.id) return;

    const accepted = window.confirm(
      'Open "' + target.name + '"?\n\n' +
      'Your current project will be saved first. You can reopen it later.',
    );
    if (!accepted) return;

    isCreatingNewProject = true;
    updateProjectBrowserControls();
    newProjectButton.disabled = true;
    projectSaveButton.disabled = true;
    try {
      // Save the current project before changing the active snapshot.
      await persistProject();

      stopDesktopTone();
      if (spatialNoteId) {
        stopNote(theremin.id, spatialNoteId);
        spatialNoteId = undefined;
      }
      arrangementTransport.stop();
      await disposeProjectTrackResources();

      project = target;
      projectHistory.clear();
      selectedClipId = undefined;
      selectedClip = undefined;
      selectedPianoNote = undefined;
      pianoDrag = undefined;
      recordingTrackId = undefined;

      for (const track of project.tracks) ensureTrackRuntime(track, false);
      if (audioReady) {
        await Promise.all(project.tracks.map(track => ensureTrackAudioReady(track.id)));
      }
      updateProjectUi();
      await refreshSavedProjects();

      projectStatus.textContent = repository.durability === 'persistent'
        ? 'Opened "' + project.name + '" · saved on this device'
        : 'Opened "' + project.name + '" · session only';
      captureStatus.textContent = 'Project "' + project.name + '" is ready.';
    } catch (error) {
      projectStatus.textContent = error instanceof Error
        ? 'Could not open project: ' + error.message
        : 'Could not open the selected project.';
    } finally {
      isCreatingNewProject = false;
      updateProjectUi();
    }
  };

  openProjectButton.addEventListener('click', () => {
    void openSelectedProject();
  });

  function handleTransportState(trackId: string, state: TransportState): void {
    updateClipUi();
    if (state === 'playing') {
      captureStatus!.textContent = 'Playing clip on ' +
        (project.tracks.find(track => track.id === trackId)?.name ?? 'track') + '…';
      updateStatus('Sequencer playing');
    } else if (state === 'completed' && !anyTransportPlaying()) {
      captureStatus!.textContent = 'Playback complete.';
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
  const resizeHandler = (): void => {
    drawTimeline(selectedClip);
    drawArrangement();
    drawPianoRoll();
  };
  window.addEventListener('resize', resizeHandler);

  root.addEventListener('vibe-wizard-dispose', () => {
    stopDesktopTone();
    if (recorder.isRecording) stopRecording();
    arrangementTransport.dispose();
    if (arrangementAnimationFrame !== undefined) {
      cancelAnimationFrame(arrangementAnimationFrame);
      arrangementAnimationFrame = undefined;
    }
    for (const resources of trackResources.values()) {
      resources.transport.dispose();
      resources.unsubscribeTransport();
    }
    unsubscribeArrangementTransport();
    unsubscribeController();
    spatialAdapter.dispose();
    window.removeEventListener('resize', resizeHandler);
    if (activeAssetPreview) { activeAssetPreview.pause(); activeAssetPreview = undefined; }
    if (activeAssetPreviewUrl) { URL.revokeObjectURL(activeAssetPreviewUrl); activeAssetPreviewUrl = undefined; }
    void rack.dispose().then(() => audioRuntime.dispose());
  }, { once: true });

  let arrangementAnimationFrame: number | undefined;
  const animateArrangementPlayhead = (): void => {
    if (arrangementTransport.currentState !== 'playing') {
      arrangementAnimationFrame = undefined;
      drawArrangement();
      return;
    }
    drawArrangement();
    arrangementAnimationFrame = requestAnimationFrame(animateArrangementPlayhead);
  };

  const unsubscribeArrangementTransport = arrangementTransport.subscribe((state) => {
    updateClipUi();
    if (state === 'playing') {
      captureStatus.textContent = 'Playing the multi-track arrangement…';
      updateStatus('Arrangement playing');
      if (arrangementAnimationFrame === undefined) {
        arrangementAnimationFrame = requestAnimationFrame(animateArrangementPlayhead);
      }
    } else {
      if (arrangementAnimationFrame !== undefined) {
        cancelAnimationFrame(arrangementAnimationFrame);
        arrangementAnimationFrame = undefined;
      }
      drawArrangement();
      if (state === 'completed' && ![...trackResources.values()].some(
        resources => resources.transport.currentState === 'playing',
      )) {
        captureStatus.textContent = 'Arrangement playback complete.';
        updateStatus(audioReady ? 'Audio engine running' : 'Audio is stopped');
      } else if (state === 'stopped') {
        captureStatus.textContent = 'Arrangement stopped.';
        updateStatus(audioReady ? 'Audio engine running' : 'Audio is stopped');
      }
    }
  });

  updateController();
  drawTimeline(undefined);
  drawArrangement();
  drawPianoRoll();
  void initializeProject();
}
