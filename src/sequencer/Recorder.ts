import type { MusicalEvent } from '../audio/events.js';

export interface RecordedEvent {
  readonly offsetSeconds: number;
  readonly event: MusicalEvent;
}

export interface RecordingClip {
  readonly id: string;
  readonly durationSeconds: number;
  readonly events: readonly RecordedEvent[];
}

/** Captures typed live events on a monotonic seconds clock. */
export class EventRecorder {
  private startedAt: number | undefined;
  private readonly recorded: RecordedEvent[] = [];

  start(timestampSeconds: number): void {
    if (!Number.isFinite(timestampSeconds)) {
      throw new Error('Recording start time must be finite.');
    }
    this.recorded.length = 0;
    this.startedAt = timestampSeconds;
  }

  record(event: MusicalEvent): boolean {
    if (this.startedAt === undefined || event.timestamp < this.startedAt) {
      return false;
    }
    this.recorded.push({
      offsetSeconds: event.timestamp - this.startedAt,
      event: { ...event },
    });
    return true;
  }

  stop(timestampSeconds: number, id = crypto.randomUUID()): RecordingClip | undefined {
    if (this.startedAt === undefined) return undefined;
    const durationSeconds = Math.max(0, timestampSeconds - this.startedAt);
    const clip: RecordingClip = {
      id,
      durationSeconds,
      events: [...this.recorded].sort((a, b) => a.offsetSeconds - b.offsetSeconds),
    };
    this.startedAt = undefined;
    this.recorded.length = 0;
    return clip;
  }

  get isRecording(): boolean {
    return this.startedAt !== undefined;
  }
}
