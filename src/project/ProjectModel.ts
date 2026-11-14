import type { MusicalEvent } from '../audio/events.js';
import type { RecordedEvent, RecordingClip } from '../sequencer/Recorder.js';

export const PROJECT_SCHEMA_VERSION = 1 as const;

export interface ProjectTimeSignature {
  readonly numerator: number;
  readonly denominator: number;
}

export interface ProjectTrack {
  readonly id: string;
  readonly name: string;
  readonly kind: 'instrument';
  readonly instrumentModuleId: string;
  readonly order: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly armed: boolean;
}

export interface ProjectClip extends RecordingClip {
  readonly name: string;
  readonly trackId: string;
  /** Position on the arrangement timeline. The prototype uses seconds. */
  readonly startSeconds: number;
  readonly createdAt: string;
}

export interface ProjectSnapshot {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tempoBpm: number;
  readonly timeSignature: ProjectTimeSignature;
  readonly activeTrackId: string;
  readonly tracks: readonly ProjectTrack[];
  readonly clips: readonly ProjectClip[];
}

function makeId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ??
    prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function createDefaultProject(
  instrumentModuleId: string,
  now = new Date(),
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
    activeTrackId: trackId,
    tracks: [{
      id: trackId,
      name: 'Theremin Synth',
      kind: 'instrument',
      instrumentModuleId,
      order: 0,
      muted: false,
      solo: false,
      armed: true,
    }],
    clips: [],
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
    startSeconds: 0,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

/** Validate persisted data before it is allowed into live project state. */
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
  const tracks: ProjectTrack[] = value.tracks.map((item) => {
    if (
      !isRecord(item) || typeof item.id !== 'string' ||
      typeof item.name !== 'string' || item.kind !== 'instrument' ||
      typeof item.instrumentModuleId !== 'string' ||
      !finiteNumber(item.order) ||
      typeof item.muted !== 'boolean' || typeof item.solo !== 'boolean' ||
      typeof item.armed !== 'boolean'
    ) {
      throw new Error('Project contains an invalid track.');
    }
    if (trackIds.has(item.id)) throw new Error('Project contains duplicate track IDs.');
    trackIds.add(item.id);
    return item as unknown as ProjectTrack;
  });

  if (tracks.length === 0 || !trackIds.has(value.activeTrackId)) {
    throw new Error('Project must contain at least one track and a valid active track.');
  }

  const clipIds = new Set<string>();
  const clips: ProjectClip[] = value.clips.map((item) => {
    if (
      !isRecord(item) || typeof item.id !== 'string' ||
      typeof item.name !== 'string' || typeof item.trackId !== 'string' ||
      !trackIds.has(item.trackId) ||
      typeof item.createdAt !== 'string' ||
      !finiteNumber(item.durationSeconds) || item.durationSeconds < 0 ||
      !finiteNumber(item.startSeconds) || item.startSeconds < 0 ||
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
        recorded.offsetSeconds > item.durationSeconds + 0.001 ||
        !validateMusicalEvent(recorded.event)
      ) {
        throw new Error('Project contains an invalid recorded event.');
      }
      return recorded as unknown as RecordedEvent;
    });

    return { ...item, events } as unknown as ProjectClip;
  });

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
    activeTrackId: value.activeTrackId,
    tracks,
    clips,
  };
}
