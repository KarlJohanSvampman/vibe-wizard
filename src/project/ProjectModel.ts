import type { MusicalEvent } from '../audio/events.js';
import type { RecordedEvent, RecordingClip } from '../sequencer/Recorder.js';
import { isInstrumentType } from '../audio/InstrumentTypes.js';
import type { InstrumentType } from '../audio/InstrumentTypes.js';
import { validateControllerInstance, validateControllerPreset, validateStudioPlacement } from '../controllers/ControllerModel.js';
import type { ControllerInstance, ControllerPreset, StudioObjectPlacement } from '../controllers/ControllerModel.js';

export const PROJECT_SCHEMA_VERSION = 9 as const;

export interface SamplerSettings {
  readonly startPosition: number;
  readonly endPosition: number;
  readonly loopEnabled: boolean;
  readonly loopStart: number;
  readonly loopEnd: number;
  readonly rootNote: number;
  readonly playbackMode: 'one-shot' | 'gate';
}

export const DEFAULT_SAMPLER_SETTINGS: SamplerSettings = {
  startPosition: 0, endPosition: 1, loopEnabled: false,
  loopStart: 0, loopEnd: 1, rootNote: 60, playbackMode: 'gate',
};

export interface ProjectTimeSignature {
  readonly numerator: number;
  readonly denominator: number;
}

export interface ProjectTrackEffect {
  readonly id: string;
  readonly type: 'delay' | 'reverb';
  readonly enabled: boolean;
  readonly parameters: Readonly<Record<string, number>>;
}

export interface ProjectTrack {
  readonly id: string;
  readonly name: string;
  readonly kind: 'instrument';
  readonly instrumentModuleId: string;
  readonly instrumentType: InstrumentType;
  /** Stable binary sample reference; the audio bytes live in the separate asset store. */
  readonly sampleAssetId?: string;
  readonly sampleFileName?: string;
  readonly samplerSettings?: SamplerSettings;
  readonly order: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly armed: boolean;
  /** Linear track fader value, independent of instrument/controller volume. */
  readonly volume: number;
  /** Stereo position in the range -1 (left) to +1 (right). */
  readonly pan: number;
  /** Ordered, project-persisted track insert effects. */
  readonly effects: readonly ProjectTrackEffect[];
  /** Linear pre-fader send levels to the shared project delay and reverb returns. */
  readonly sends: Readonly<{ delay: number; reverb: number }>;
}

export interface ProjectClipNote {
  readonly sourceId: string;
  readonly noteId: string;
  readonly pitch: number;
  readonly velocity: number;
  readonly startBeat: number;
  readonly durationBeats: number;
}

export interface ProjectClipNotePatch {
  readonly pitch?: number;
  readonly velocity?: number;
  readonly startBeat?: number;
  readonly durationBeats?: number;
}

export interface ProjectClip extends RecordingClip {
  readonly name: string;
  readonly trackId: string;
  /** Musical position from project start, measured in quarter-note beats. */
  readonly startBeats: number;
  /** Musical clip length. Resizing this never deletes captured event data. */
  readonly lengthBeats: number;
  /** Tempo at which the performance was captured; used to scale clip-relative timing. */
  readonly recordedAtTempoBpm: number;
  readonly createdAt: string;
}

export interface ProjectLoopRegion {
  readonly enabled: boolean;
  readonly startBeat: number;
  readonly endBeat: number;
}

export interface SharedReturnSettings {
  readonly delay: Readonly<{ time: number; feedback: number }>;
  readonly reverb: Readonly<{ decay: number }>;
}

export const DEFAULT_SHARED_RETURN_SETTINGS: SharedReturnSettings = {
  delay: { time: 0.35, feedback: 0.25 },
  reverb: { decay: 2.2 },
};

export interface ProjectSnapshot {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tempoBpm: number;
  readonly timeSignature: ProjectTimeSignature;
  readonly loopRegion: ProjectLoopRegion;
  /** Project-wide effect parameters for the shared send/return channels. */
  readonly sharedReturns: SharedReturnSettings;
  readonly activeTrackId: string;
  readonly tracks: readonly ProjectTrack[];
  readonly clips: readonly ProjectClip[];
  /** Reusable controller designs included with this project snapshot. */
  readonly controllerPresets: readonly ControllerPreset[];
  /** Project-local instances; each can be placed and routed independently. */
  readonly controllerInstances: readonly ControllerInstance[];
  /** Persisted VR studio object transforms, independent of the arrangement timeline. */
  readonly studioLayout: readonly StudioObjectPlacement[];
}

export type ProjectTrackPatch = Partial<
  Pick<ProjectTrack, 'name' | 'muted' | 'solo' | 'armed' | 'volume' | 'pan' | 'sampleAssetId' | 'sampleFileName' | 'samplerSettings' | 'effects' | 'sends'>
>;

export interface ProjectTimingPatch {
  readonly tempoBpm?: number;
  readonly timeSignature?: ProjectTimeSignature;
}

export type ProjectLoopRegionPatch = ProjectLoopRegion;

function makeId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ??
    prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function createEmptyProject(now = new Date()): ProjectSnapshot {
  const timestamp = now.toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: makeId('project'),
    name: 'Untitled Session',
    createdAt: timestamp,
    updatedAt: timestamp,
    tempoBpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    loopRegion: { enabled: false, startBeat: 0, endBeat: 16 },
    sharedReturns: { delay: { ...DEFAULT_SHARED_RETURN_SETTINGS.delay }, reverb: { ...DEFAULT_SHARED_RETURN_SETTINGS.reverb } },
    activeTrackId: '',
    tracks: [],
    clips: [],
    controllerPresets: [],
    controllerInstances: [],
    studioLayout: [],
  };
}

export function createDefaultProject(
  instrumentModuleId: string,
  now = new Date(),
  instrumentType: InstrumentType = 'synth',
): ProjectSnapshot {
  const timestamp = now.toISOString();
  const projectId = makeId('project');
  const trackId = makeId('track');
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: projectId,
    name: 'Untitled Session',
    createdAt: timestamp,
    updatedAt: timestamp,
    tempoBpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    loopRegion: { enabled: false, startBeat: 0, endBeat: 16 },
    sharedReturns: { delay: { ...DEFAULT_SHARED_RETURN_SETTINGS.delay }, reverb: { ...DEFAULT_SHARED_RETURN_SETTINGS.reverb } },
    activeTrackId: trackId,
    tracks: [{
      id: trackId,
      name: 'Theremin Synth',
      kind: 'instrument',
      instrumentModuleId,
      instrumentType,
      ...(instrumentType === 'sampler' ? { samplerSettings: { ...DEFAULT_SAMPLER_SETTINGS } } : {}),
      order: 0,
      muted: false,
      solo: false,
      armed: true,
      volume: 0.8,
      pan: 0,
      effects: [],
      sends: { delay: 0, reverb: 0 },
    }],
    clips: [],
    controllerPresets: [],
    controllerInstances: [],
    studioLayout: [],
  };
}

export function addInstrumentTrack(
  snapshot: ProjectSnapshot,
  name: string,
  instrumentModuleId: string,
  now = new Date(),
  instrumentType: InstrumentType = 'synth',
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  if (project.tracks.some(track => track.instrumentModuleId === instrumentModuleId)) {
    throw new Error('Instrument module is already assigned to a project track.');
  }
  const id = makeId('track');
  const track: ProjectTrack = {
    id,
    name: name.trim() || 'Instrument Track ' + (project.tracks.length + 1),
    kind: 'instrument',
    instrumentModuleId,
    instrumentType,
    ...(instrumentType === 'sampler' ? { samplerSettings: { ...DEFAULT_SAMPLER_SETTINGS } } : {}),
    order: project.tracks.reduce((highest, item) => Math.max(highest, item.order), -1) + 1,
    muted: false,
    solo: false,
    armed: false,
    volume: 0.8,
    pan: 0,
    effects: [],
    sends: { delay: 0, reverb: 0 },
  };

  return {
    ...project,
    updatedAt: now.toISOString(),
    activeTrackId: id,
    tracks: project.tracks.concat(track),
  };
}

/** Delete a track and its clips. Select the next remaining track, or no track. */
export function deleteProjectTrack(
  snapshot: ProjectSnapshot,
  trackId: string,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  if (!project.tracks.some(track => track.id === trackId)) {
    throw new Error('Cannot delete unknown track: ' + trackId);
  }
  const tracks = project.tracks
    .filter(track => track.id !== trackId)
    .map((track, index) => ({ ...track, order: index }));
  const activeTrackId = project.activeTrackId === trackId
    ? (tracks[0]?.id ?? '')
    : project.activeTrackId;
  return validateProjectSnapshot({
    ...project,
    updatedAt: now.toISOString(),
    activeTrackId,
    tracks,
    clips: project.clips.filter(clip => clip.trackId !== trackId),
  });
}

export function updateProjectTrack(
  snapshot: ProjectSnapshot,
  trackId: string,
  patch: ProjectTrackPatch,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  if (!project.tracks.some(track => track.id === trackId)) {
    throw new Error('Cannot update unknown track: ' + trackId);
  }
  const tracks = project.tracks.map((track) =>
    track.id === trackId ? { ...track, ...patch } : track,
  );
  return validateProjectSnapshot({
    ...project,
    updatedAt: now.toISOString(),
    tracks,
  });
}

export function setActiveProjectTrack(
  snapshot: ProjectSnapshot,
  trackId: string,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  if (!project.tracks.some(track => track.id === trackId)) {
    throw new Error('Cannot select unknown track: ' + trackId);
  }
  return { ...project, activeTrackId: trackId, updatedAt: now.toISOString() };
}

export function updateProjectSharedReturns(
  snapshot: ProjectSnapshot,
  sharedReturns: SharedReturnSettings,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  return validateProjectSnapshot({ ...project, sharedReturns: { delay: { ...sharedReturns.delay }, reverb: { ...sharedReturns.reverb } }, updatedAt: now.toISOString() });
}

export function updateProjectTiming(
  snapshot: ProjectSnapshot,
  patch: ProjectTimingPatch,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  const tempoBpm = patch.tempoBpm ?? project.tempoBpm;
  const timeSignature = patch.timeSignature ?? project.timeSignature;
  return validateProjectSnapshot({
    ...project,
    tempoBpm,
    timeSignature: { ...timeSignature },
    updatedAt: now.toISOString(),
  });
}

/** Move a clip on the musical timeline, optionally to another instrument lane. */
export function moveProjectClip(
  snapshot: ProjectSnapshot,
  clipId: string,
  targetTrackId: string,
  startBeats: number,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  if (!project.tracks.some(track => track.id === targetTrackId)) {
    throw new Error('Cannot move a clip to unknown track: ' + targetTrackId);
  }
  if (!finiteNumber(startBeats) || startBeats < 0) {
    throw new Error('Clip arrangement position must be a finite non-negative beat value.');
  }
  if (!project.clips.some(clip => clip.id === clipId)) {
    throw new Error('Cannot move unknown clip: ' + clipId);
  }

  return validateProjectSnapshot({
    ...project,
    updatedAt: now.toISOString(),
    clips: project.clips.map(clip =>
      clip.id === clipId ? { ...clip, trackId: targetTrackId, startBeats } : clip,
    ),
  });
}

export function getClipDurationBeats(clip: ProjectClip): number {
  return clip.lengthBeats;
}

/** Pair recorded note-on/off events and expose their musical beat positions. */
export function getProjectClipNotes(clip: ProjectClip): ProjectClipNote[] {
  const starts = new Map<string, RecordedEvent>();
  const notes: ProjectClipNote[] = [];
  for (const recorded of [...clip.events].sort((a, b) => a.offsetSeconds - b.offsetSeconds)) {
    const event = recorded.event;
    if (event.kind === 'note-on') {
      starts.set(event.sourceId + ':' + event.noteId, recorded);
    } else if (event.kind === 'note-off') {
      const key = event.sourceId + ':' + event.noteId;
      const start = starts.get(key);
      if (!start || start.event.kind !== 'note-on') continue;
      starts.delete(key);
      notes.push({
        sourceId: event.sourceId,
        noteId: event.noteId,
        pitch: start.event.pitch,
        velocity: start.event.velocity,
        startBeat: start.offsetSeconds * clip.recordedAtTempoBpm / 60,
        durationBeats: Math.max(
          0.0001,
          (recorded.offsetSeconds - start.offsetSeconds) * clip.recordedAtTempoBpm / 60,
        ),
      });
    }
  }
  return notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
}

function findClipNote(
  clip: ProjectClip,
  sourceId: string,
  noteId: string,
): ProjectClipNote {
  const note = getProjectClipNotes(clip).find(item =>
    item.sourceId === sourceId && item.noteId === noteId,
  );
  if (!note) throw new Error('Cannot find note in clip: ' + sourceId + ':' + noteId);
  return note;
}

function validateClipNoteValues(
  clip: ProjectClip,
  patch: ProjectClipNotePatch,
  current?: ProjectClipNote,
): ProjectClipNote {
  const note: ProjectClipNote = {
    sourceId: current?.sourceId ?? 'piano-roll',
    noteId: current?.noteId ?? '',
    pitch: patch.pitch ?? current?.pitch ?? 60,
    velocity: patch.velocity ?? current?.velocity ?? 0.8,
    startBeat: patch.startBeat ?? current?.startBeat ?? 0,
    durationBeats: patch.durationBeats ?? current?.durationBeats ?? 1,
  };
  if (
    !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 ||
    !finiteNumber(note.velocity) || note.velocity < 0 || note.velocity > 1 ||
    !finiteNumber(note.startBeat) || note.startBeat < 0 ||
    !finiteNumber(note.durationBeats) || note.durationBeats <= 0 ||
    note.startBeat + note.durationBeats > clip.lengthBeats + 0.0001
  ) {
    throw new Error('Piano-roll note values are outside the clip or MIDI range.');
  }
  return note;
}

export function updateProjectClipNote(
  snapshot: ProjectSnapshot,
  clipId: string,
  sourceId: string,
  noteId: string,
  patch: ProjectClipNotePatch,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  const clip = project.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Cannot edit unknown clip: ' + clipId);
  const current = findClipNote(clip, sourceId, noteId);
  const next = validateClipNoteValues(clip, patch, current);
  const startSeconds = next.startBeat * 60 / clip.recordedAtTempoBpm;
  const endSeconds = (next.startBeat + next.durationBeats) * 60 / clip.recordedAtTempoBpm;
  let foundOn = false;
  let foundOff = false;
  const events = clip.events.map(recorded => {
    const event = recorded.event;
    if (event.kind === 'note-on' && event.sourceId === sourceId && event.noteId === noteId) {
      foundOn = true;
      return {
        offsetSeconds: startSeconds,
        event: {
          ...event,
          pitch: next.pitch,
          velocity: next.velocity,
          timestamp: event.timestamp + startSeconds - recorded.offsetSeconds,
        },
      };
    }
    if (event.kind === 'note-off' && event.sourceId === sourceId && event.noteId === noteId) {
      foundOff = true;
      return {
        offsetSeconds: endSeconds,
        event: {
          ...event,
          timestamp: event.timestamp + endSeconds - recorded.offsetSeconds,
        },
      };
    }
    return recorded;
  });
  if (!foundOn || !foundOff) throw new Error('Piano-roll note is missing a matching note-on or note-off.');
  events.sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  return validateProjectSnapshot({
    ...project,
    updatedAt: now.toISOString(),
    clips: project.clips.map(item => item.id === clipId
      ? { ...item, durationSeconds: Math.max(item.durationSeconds, endSeconds), events }
      : item),
  });
}

export function addProjectClipNote(
  snapshot: ProjectSnapshot,
  clipId: string,
  note: Omit<ProjectClipNote, 'sourceId'> & { readonly sourceId?: string },
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  const clip = project.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Cannot add a note to unknown clip: ' + clipId);
  const normalized = validateClipNoteValues(clip, {
    pitch: note.pitch,
    velocity: note.velocity,
    startBeat: note.startBeat,
    durationBeats: note.durationBeats,
  });
  const sourceId = note.sourceId ?? 'piano-roll';
  if (!sourceId || !note.noteId ||
      clip.events.some(item =>
        item.event.kind === 'note-on' &&
        item.event.sourceId === sourceId &&
        item.event.noteId === note.noteId,
      )) {
    throw new Error('A piano-roll note requires a unique source and note ID.');
  }
  const startSeconds = normalized.startBeat * 60 / clip.recordedAtTempoBpm;
  const endSeconds = (normalized.startBeat + normalized.durationBeats) * 60 / clip.recordedAtTempoBpm;
  const events: RecordedEvent[] = [
    ...clip.events,
    {
      offsetSeconds: startSeconds,
      event: {
        kind: 'note-on',
        sourceId,
        noteId: note.noteId,
        pitch: normalized.pitch,
        velocity: normalized.velocity,
        timestamp: startSeconds,
      },
    },
    {
      offsetSeconds: endSeconds,
      event: {
        kind: 'note-off',
        sourceId,
        noteId: note.noteId,
        timestamp: endSeconds,
      },
    },
  ];
  events.sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  return validateProjectSnapshot({
    ...project,
    updatedAt: now.toISOString(),
    clips: project.clips.map(item => item.id === clipId
      ? { ...item, durationSeconds: Math.max(item.durationSeconds, endSeconds), events }
      : item),
  });
}

export function deleteProjectClipNote(
  snapshot: ProjectSnapshot,
  clipId: string,
  sourceId: string,
  noteId: string,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  const clip = project.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Cannot edit unknown clip: ' + clipId);
  findClipNote(clip, sourceId, noteId);
  const events = clip.events.filter(recorded => !(
    (recorded.event.kind === 'note-on' || recorded.event.kind === 'note-off') &&
    recorded.event.sourceId === sourceId &&
    recorded.event.noteId === noteId
  ));
  return validateProjectSnapshot({
    ...project,
    updatedAt: now.toISOString(),
    clips: project.clips.map(item => item.id === clipId ? { ...item, events } : item),
  });
}

export function resizeProjectClip(
  snapshot: ProjectSnapshot,
  clipId: string,
  lengthBeats: number,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  if (!finiteNumber(lengthBeats) || lengthBeats <= 0) {
    throw new Error('Clip length must be a finite positive beat value.');
  }
  if (!project.clips.some(clip => clip.id === clipId)) {
    throw new Error('Cannot resize unknown clip: ' + clipId);
  }
  return validateProjectSnapshot({
    ...project,
    updatedAt: now.toISOString(),
    clips: project.clips.map(clip =>
      clip.id === clipId ? { ...clip, lengthBeats } : clip,
    ),
  });
}

/** Remove a clip from the project without affecting its source track. */
export function deleteProjectClip(
  snapshot: ProjectSnapshot,
  clipId: string,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  if (!project.clips.some(clip => clip.id === clipId)) {
    throw new Error('Cannot delete unknown clip: ' + clipId);
  }
  return validateProjectSnapshot({
    ...project,
    updatedAt: now.toISOString(),
    clips: project.clips.filter(clip => clip.id !== clipId),
  });
}

/** Duplicate a clip immediately after its source while preserving recorded events. */
export function duplicateProjectClip(
  snapshot: ProjectSnapshot,
  clipId: string,
  newClipId = makeId('clip'),
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  const source = project.clips.find(clip => clip.id === clipId);
  if (!source) throw new Error('Cannot duplicate unknown clip: ' + clipId);
  if (!newClipId || project.clips.some(clip => clip.id === newClipId)) {
    throw new Error('The duplicate clip ID must be unique.');
  }
  const duplicate: ProjectClip = {
    ...source,
    id: newClipId,
    name: source.name + ' copy',
    startBeats: source.startBeats + source.lengthBeats,
    createdAt: now.toISOString(),
    events: source.events.map(recorded => ({
      offsetSeconds: recorded.offsetSeconds,
      event: { ...recorded.event },
    })),
  };
  return validateProjectSnapshot({
    ...project,
    updatedAt: now.toISOString(),
    clips: [...project.clips, duplicate],
  });
}

export function updateProjectLoopRegion(
  snapshot: ProjectSnapshot,
  loopRegion: ProjectLoopRegionPatch,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  return validateProjectSnapshot({
    ...project,
    loopRegion: { ...loopRegion },
    updatedAt: now.toISOString(),
  });
}

export function getArrangementDurationBeats(
  project: ProjectSnapshot,
  minimumBeats = 16,
): number {
  return Math.max(
    minimumBeats,
    ...project.clips.map(clip => clip.startBeats + getClipDurationBeats(clip)),
  );
}

/** Convert a project clip to the seconds-based format used by the audition transport. */
export function projectClipToRecordingClip(
  clip: ProjectClip,
  projectTempoBpm: number,
): RecordingClip {
  if (!finiteNumber(projectTempoBpm) || projectTempoBpm < 20 || projectTempoBpm > 300) {
    throw new Error('Project tempo must be between 20 and 300 BPM.');
  }
  const scale = clip.recordedAtTempoBpm / projectTempoBpm;
  return {
    id: clip.id,
    durationSeconds: clip.lengthBeats * 60 / projectTempoBpm,
    events: clip.events
      .filter(recorded =>
        recorded.offsetSeconds * clip.recordedAtTempoBpm / 60 <= clip.lengthBeats + 0.0001,
      )
      .map(recorded => ({
        offsetSeconds: recorded.offsetSeconds * scale,
        event: { ...recorded.event },
      })),
  };
}

export function addRecordingToProject(
  snapshot: ProjectSnapshot,
  trackId: string,
  recording: RecordingClip,
  now = new Date(),
): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  if (!project.tracks.some(track => track.id === trackId)) {
    throw new Error('Cannot add a clip to unknown track: ' + trackId);
  }

  const existingIndex = project.clips.findIndex(clip => clip.id === recording.id);
  const clipNumber = project.clips.length + (existingIndex < 0 ? 1 : 0);
  const clip: ProjectClip = {
    ...recording,
    name: existingIndex >= 0
      ? project.clips[existingIndex]!.name
      : 'Performance ' + String(clipNumber).padStart(2, '0'),
    trackId,
    startBeats: 0,
    lengthBeats: recording.durationSeconds * project.tempoBpm / 60,
    recordedAtTempoBpm: project.tempoBpm,
    createdAt: existingIndex >= 0
      ? project.clips[existingIndex]!.createdAt
      : now.toISOString(),
    events: recording.events.map((item): RecordedEvent => ({
      offsetSeconds: item.offsetSeconds,
      event: { ...item.event },
    })),
  };

  const clips = [...project.clips];
  if (existingIndex >= 0) clips[existingIndex] = clip;
  else clips.push(clip);

  return {
    ...project,
    updatedAt: now.toISOString(),
    clips,
  };
}

export function saveControllerPreset(snapshot: ProjectSnapshot, preset: ControllerPreset, now = new Date()): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  const normalized = validateControllerPreset({ ...preset, updatedAt: now.toISOString(), version: preset.version + 1 });
  const presets = project.controllerPresets.some(item => item.id === normalized.id)
    ? project.controllerPresets.map(item => item.id === normalized.id ? normalized : item)
    : [...project.controllerPresets, normalized];
  return validateProjectSnapshot({ ...project, updatedAt: now.toISOString(), controllerPresets: presets });
}

export function addControllerInstance(snapshot: ProjectSnapshot, instance: ControllerInstance, now = new Date()): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  if (project.controllerInstances.some(item => item.id === instance.id)) throw new Error('Controller instance already exists.');
  return validateProjectSnapshot({ ...project, updatedAt: now.toISOString(), controllerInstances: [...project.controllerInstances, instance] });
}

export function updateControllerInstance(snapshot: ProjectSnapshot, instanceId: string, patch: Partial<Pick<ControllerInstance, 'name' | 'targetTrackId' | 'placement' | 'enabled'>>, now = new Date()): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  if (!project.controllerInstances.some(item => item.id === instanceId)) throw new Error('Unknown controller instance.');
  return validateProjectSnapshot({
    ...project, updatedAt: now.toISOString(),
    controllerInstances: project.controllerInstances.map(item => item.id === instanceId ? { ...item, ...patch } : item),
  });
}

export function updateStudioLayout(snapshot: ProjectSnapshot, placements: readonly StudioObjectPlacement[], now = new Date()): ProjectSnapshot {
  const project = validateProjectSnapshot(snapshot);
  return validateProjectSnapshot({ ...project, updatedAt: now.toISOString(), studioLayout: [...placements] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Upgrade older stored projects while preserving clip IDs and audible timing. */
export function migrateProjectRecord(value: unknown): unknown {
  if (!isRecord(value)) throw new Error('Project data must be an object.');
  if (value.schemaVersion === PROJECT_SCHEMA_VERSION) return value;
  if (
    (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4 && value.schemaVersion !== 5 && value.schemaVersion !== 6 && value.schemaVersion !== 7 && value.schemaVersion !== 8) ||
    !Array.isArray(value.tracks)
  ) {
    throw new Error('Unsupported project schema version: ' + String(value.schemaVersion) + '.');
  }

  const tempoBpm = finiteNumber(value.tempoBpm) && value.tempoBpm >= 20 && value.tempoBpm <= 300
    ? value.tempoBpm
    : 120;
  const tracks = value.tracks.map((track) => {
    if (!isRecord(track)) return track;
    return {
      ...track,
      volume: finiteNumber(track.volume) ? track.volume : 0.8,
      pan: finiteNumber(track.pan) ? track.pan : 0,
      effects: Array.isArray(track.effects) ? track.effects : [],
      sends: isRecord(track.sends) ? track.sends : { delay: 0, reverb: 0 },
      ...(track.instrumentType === 'sampler' && !isRecord(track.samplerSettings)
        ? { samplerSettings: { ...DEFAULT_SAMPLER_SETTINGS } } : {}),
    };
  });
  const clips = Array.isArray(value.clips) ? value.clips.map((item) => {
    if (!isRecord(item)) return item;
    const { startSeconds, ...clip } = item;
    return {
      ...clip,
      startBeats: finiteNumber(item.startBeats)
        ? item.startBeats
        : finiteNumber(startSeconds) ? startSeconds * tempoBpm / 60 : 0,
      recordedAtTempoBpm: finiteNumber(item.recordedAtTempoBpm)
        ? item.recordedAtTempoBpm
        : tempoBpm,
      lengthBeats: finiteNumber(item.lengthBeats)
        ? item.lengthBeats
        : finiteNumber(item.durationSeconds)
          ? item.durationSeconds * (finiteNumber(item.recordedAtTempoBpm)
            ? item.recordedAtTempoBpm
            : tempoBpm) / 60
          : 0,
    };
  }) : value.clips;

  return {
    ...value,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    tempoBpm,
    sharedReturns: isRecord(value.sharedReturns) ? value.sharedReturns : { delay: { ...DEFAULT_SHARED_RETURN_SETTINGS.delay }, reverb: { ...DEFAULT_SHARED_RETURN_SETTINGS.reverb } },
    tracks,
    clips,
    controllerPresets: Array.isArray(value.controllerPresets) ? value.controllerPresets : [],
    controllerInstances: Array.isArray(value.controllerInstances) ? value.controllerInstances : [],
    studioLayout: Array.isArray(value.studioLayout) ? value.studioLayout : [],
    loopRegion: isRecord(value.loopRegion)
      ? value.loopRegion
      : { enabled: false, startBeat: 0, endBeat: 16 },
  };
}

function validateMusicalEvent(value: unknown): value is MusicalEvent {
  if (!isRecord(value) || typeof value.kind !== 'string' ||
      typeof value.sourceId !== 'string' || !finiteNumber(value.timestamp)) {
    return false;
  }

  switch (value.kind) {
    case 'note-on':
      return typeof value.noteId === 'string' &&
        finiteNumber(value.pitch) && finiteNumber(value.velocity);
    case 'note-off':
      return typeof value.noteId === 'string';
    case 'control':
      return typeof value.portId === 'string' &&
        finiteNumber(value.value) && finiteNumber(value.min) && finiteNumber(value.max);
    case 'gate':
      return typeof value.portId === 'string' && typeof value.pressed === 'boolean';
    default:
      return false;
  }
}

export function validateProjectSnapshot(value: unknown): ProjectSnapshot {
  if (!isRecord(value)) throw new Error('Project data must be an object.');
  if (value.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error('Unsupported project schema version: ' + String(value.schemaVersion) + '.');
  }
  if (
    typeof value.id !== 'string' || typeof value.name !== 'string' ||
    typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' ||
    !finiteNumber(value.tempoBpm) || value.tempoBpm < 20 || value.tempoBpm > 300 ||
    !isRecord(value.timeSignature) ||
    !isRecord(value.loopRegion) ||
    !isRecord(value.sharedReturns) || !isRecord(value.sharedReturns.delay) ||
    !finiteNumber(value.sharedReturns.delay.time) || value.sharedReturns.delay.time < 0.01 || value.sharedReturns.delay.time > 2 ||
    !finiteNumber(value.sharedReturns.delay.feedback) || value.sharedReturns.delay.feedback < 0 || value.sharedReturns.delay.feedback > 0.85 ||
    !isRecord(value.sharedReturns.reverb) || !finiteNumber(value.sharedReturns.reverb.decay) || value.sharedReturns.reverb.decay < 0.1 || value.sharedReturns.reverb.decay > 8 ||
    typeof value.loopRegion.enabled !== 'boolean' ||
    !finiteNumber(value.loopRegion.startBeat) || value.loopRegion.startBeat < 0 ||
    !finiteNumber(value.loopRegion.endBeat) || value.loopRegion.endBeat <= value.loopRegion.startBeat ||
    !finiteNumber(value.timeSignature.numerator) ||
    !finiteNumber(value.timeSignature.denominator) ||
    value.timeSignature.numerator < 1 || value.timeSignature.numerator > 32 ||
    value.timeSignature.denominator < 1 || value.timeSignature.denominator > 32 ||
    typeof value.activeTrackId !== 'string' ||
    !Array.isArray(value.tracks) || !Array.isArray(value.clips)
  ) {
    throw new Error('Project metadata is incomplete or invalid.');
  }

  const trackIds = new Set<string>();
  const moduleIds = new Set<string>();
  const tracks: ProjectTrack[] = value.tracks.map((item) => {
    if (
      !isRecord(item) || typeof item.id !== 'string' ||
      typeof item.name !== 'string' || item.kind !== 'instrument' ||
      typeof item.instrumentModuleId !== 'string' ||
      (item.instrumentType !== undefined && !isInstrumentType(item.instrumentType)) ||
      (item.sampleAssetId !== undefined && typeof item.sampleAssetId !== 'string') ||
      (item.sampleFileName !== undefined && typeof item.sampleFileName !== 'string') ||
      (item.samplerSettings !== undefined && (!isRecord(item.samplerSettings) ||
        !finiteNumber(item.samplerSettings.startPosition) || item.samplerSettings.startPosition < 0 || item.samplerSettings.startPosition >= 1 ||
        !finiteNumber(item.samplerSettings.endPosition) || item.samplerSettings.endPosition > 1 || item.samplerSettings.endPosition <= item.samplerSettings.startPosition ||
        typeof item.samplerSettings.loopEnabled !== 'boolean' ||
        !finiteNumber(item.samplerSettings.loopStart) || item.samplerSettings.loopStart < item.samplerSettings.startPosition || item.samplerSettings.loopStart >= 1 ||
        !finiteNumber(item.samplerSettings.loopEnd) || item.samplerSettings.loopEnd > item.samplerSettings.endPosition || item.samplerSettings.loopEnd <= item.samplerSettings.loopStart ||
        !finiteNumber(item.samplerSettings.rootNote) || !Number.isInteger(item.samplerSettings.rootNote) || item.samplerSettings.rootNote < 0 || item.samplerSettings.rootNote > 127 ||
        (item.samplerSettings.playbackMode !== 'one-shot' && item.samplerSettings.playbackMode !== 'gate'))) ||
      !finiteNumber(item.order) ||
      typeof item.muted !== 'boolean' || typeof item.solo !== 'boolean' ||
      typeof item.armed !== 'boolean' ||
      !finiteNumber(item.volume) || item.volume < 0 || item.volume > 1 ||
      !finiteNumber(item.pan) || item.pan < -1 || item.pan > 1 ||
      (item.sends !== undefined && (!isRecord(item.sends) || !finiteNumber(item.sends.delay) || item.sends.delay < 0 || item.sends.delay > 1 || !finiteNumber(item.sends.reverb) || item.sends.reverb < 0 || item.sends.reverb > 1)) ||
      (item.effects !== undefined && (!Array.isArray(item.effects) || item.effects.some(effect =>
        !isRecord(effect) || typeof effect.id !== 'string' || !effect.id ||
        (effect.type !== 'delay' && effect.type !== 'reverb') ||
        typeof effect.enabled !== 'boolean' || !isRecord(effect.parameters) ||
        Object.values(effect.parameters).some(parameter => !finiteNumber(parameter))
      )))
    ) {
      throw new Error('Project contains an invalid track.');
    }
    if (trackIds.has(item.id)) throw new Error('Project contains duplicate track IDs.');
    if (moduleIds.has(item.instrumentModuleId)) {
      throw new Error('A single instrument module cannot be assigned to more than one track.');
    }
    trackIds.add(item.id);
    moduleIds.add(item.instrumentModuleId);
    const instrumentType = item.instrumentType ?? 'synth';
    const effects = (Array.isArray(item.effects) ? item.effects : []) as unknown as ProjectTrackEffect[];
    const effectIds = new Set<string>();
    for (const effect of effects) {
      if (effectIds.has(effect.id)) throw new Error('Project contains duplicate track effect IDs.');
      effectIds.add(effect.id);
    }
    return { ...item, instrumentType, effects, sends: (item.sends ?? { delay: 0, reverb: 0 }) as ProjectTrack['sends'],
      ...(instrumentType === 'sampler' ? { samplerSettings: item.samplerSettings ?? { ...DEFAULT_SAMPLER_SETTINGS } } : {}),
    } as unknown as ProjectTrack;
  });

  if ((tracks.length === 0 && value.activeTrackId !== '') ||
      (tracks.length > 0 && !trackIds.has(value.activeTrackId))) {
    throw new Error('Project must have either no active track or a valid active track.');
  }

  const clipIds = new Set<string>();
  const clips: ProjectClip[] = value.clips.map((item) => {
    if (!isRecord(item)) {
      throw new Error('Project contains an invalid clip or an orphaned track reference.');
    }
    const durationSeconds = item.durationSeconds;
    if (
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' || typeof item.trackId !== 'string' ||
      !trackIds.has(item.trackId) ||
      typeof item.createdAt !== 'string' ||
      !finiteNumber(durationSeconds) || durationSeconds < 0 ||
      !finiteNumber(item.startBeats) || item.startBeats < 0 ||
      !finiteNumber(item.lengthBeats) || item.lengthBeats < 0 ||
      !finiteNumber(item.recordedAtTempoBpm) ||
      item.recordedAtTempoBpm < 20 || item.recordedAtTempoBpm > 300 ||
      !Array.isArray(item.events)
    ) {
      throw new Error('Project contains an invalid clip or an orphaned track reference.');
    }
    if (clipIds.has(item.id)) throw new Error('Project contains duplicate clip IDs.');
    clipIds.add(item.id);

    const events: RecordedEvent[] = item.events.map((recorded) => {
      if (
        !isRecord(recorded) || !finiteNumber(recorded.offsetSeconds) ||
        recorded.offsetSeconds < 0 ||
        recorded.offsetSeconds > durationSeconds + 0.001 ||
        !validateMusicalEvent(recorded.event)
      ) {
        throw new Error('Project contains an invalid recorded event.');
      }
      return recorded as unknown as RecordedEvent;
    });

    return { ...item, events } as unknown as ProjectClip;
  });

  const controllerPresets = (Array.isArray(value.controllerPresets) ? value.controllerPresets : []).map(validateControllerPreset);
  const presetIds = new Set<string>();
  for (const preset of controllerPresets) {
    if (presetIds.has(preset.id)) throw new Error('Project contains duplicate controller preset IDs.');
    presetIds.add(preset.id);
  }
  const controllerInstances = (Array.isArray(value.controllerInstances) ? value.controllerInstances : []).map(item => validateControllerInstance(item, presetIds));
  const instanceIds = new Set<string>();
  for (const instance of controllerInstances) {
    if (instanceIds.has(instance.id)) throw new Error('Project contains duplicate controller instance IDs.');
    instanceIds.add(instance.id);
    if (instance.targetTrackId && !trackIds.has(instance.targetTrackId)) {
      throw new Error('Controller instance references an unknown project track.');
    }
  }
  const studioLayout = (Array.isArray(value.studioLayout) ? value.studioLayout : []).map(validateStudioPlacement);
  const placementIds = new Set<string>();
  for (const placement of studioLayout) {
    if (placementIds.has(placement.id)) throw new Error('Project contains duplicate studio placement IDs.');
    placementIds.add(placement.id);
    if (placement.objectType === 'instrument-track' && !trackIds.has(placement.objectRefId)) {
      throw new Error('Studio placement references an unknown instrument track.');
    }
    if (placement.objectType === 'controller-instance' && !instanceIds.has(placement.objectRefId)) {
      throw new Error('Studio placement references an unknown controller instance.');
    }
  }

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    tempoBpm: value.tempoBpm,
    timeSignature: {
      numerator: value.timeSignature.numerator,
      denominator: value.timeSignature.denominator,
    },
    loopRegion: {
      enabled: value.loopRegion.enabled,
      startBeat: value.loopRegion.startBeat,
      endBeat: value.loopRegion.endBeat,
    },
    sharedReturns: {
      delay: { time: value.sharedReturns.delay.time, feedback: value.sharedReturns.delay.feedback },
      reverb: { decay: value.sharedReturns.reverb.decay },
    },
    activeTrackId: value.activeTrackId,
    tracks,
    clips,
    controllerPresets,
    controllerInstances,
    studioLayout,
  };
}
