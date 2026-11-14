import type {
  MusicalEvent,
  NoteOffEvent,
  NoteOnEvent,
} from '../audio/events.js';

export interface RecordedEvent {
  readonly offsetSeconds: number;
  readonly event: MusicalEvent;
}

export interface RecordingClip {
  readonly id: string;
  readonly durationSeconds: number;
  readonly events: readonly RecordedEvent[];
}

function noteKey(event: NoteOnEvent | NoteOffEvent): string {
  return event.sourceId + ':' + event.noteId;
}

function createClipId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    'clip-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

/** Captures typed live events on a monotonic seconds clock. */
export class EventRecorder {
  private startedAt: number | undefined;
  private readonly recorded: RecordedEvent[] = [];
  private readonly activeNotes = new Map<string, NoteOnEvent>();

  start(timestampSeconds: number): void {
    if (!Number.isFinite(timestampSeconds)) {
      throw new Error('Recording start time must be finite.');
    }
    this.recorded.length = 0;
    this.activeNotes.clear();
    this.startedAt = timestampSeconds;
  }

  record(event: MusicalEvent): boolean {
    if (
      this.startedAt === undefined ||
      !Number.isFinite(event.timestamp) ||
      event.timestamp < this.startedAt
    ) {
      return false;
    }

    this.recorded.push({
      offsetSeconds: event.timestamp - this.startedAt,
      event: { ...event },
    });

    if (event.kind === 'note-on') {
      this.activeNotes.set(noteKey(event), event);
    } else if (event.kind === 'note-off') {
      this.activeNotes.delete(noteKey(event));
    }
    return true;
  }

  stop(timestampSeconds: number, id = createClipId()): RecordingClip | undefined {
    if (this.startedAt === undefined) return undefined;
    if (!Number.isFinite(timestampSeconds)) {
      throw new Error('Recording stop time must be finite.');
    }

    const durationSeconds = Math.max(0, timestampSeconds - this.startedAt);

    // Close notes still held when Stop is pressed, preventing hanging voices.
    for (const noteOn of this.activeNotes.values()) {
      const noteOff: NoteOffEvent = {
        kind: 'note-off',
        sourceId: noteOn.sourceId,
        noteId: noteOn.noteId,
        timestamp: timestampSeconds,
      };
      this.recorded.push({ offsetSeconds: durationSeconds, event: noteOff });
    }

    const clip: RecordingClip = {
      id,
      durationSeconds,
      events: [...this.recorded].sort((a, b) => a.offsetSeconds - b.offsetSeconds),
    };

    this.startedAt = undefined;
    this.recorded.length = 0;
    this.activeNotes.clear();
    return clip;
  }

  clear(): void {
    this.startedAt = undefined;
    this.recorded.length = 0;
    this.activeNotes.clear();
  }

  get isRecording(): boolean {
    return this.startedAt !== undefined;
  }
}
