import type {
  ControlSignal,
  NoteOffEvent,
  NoteOnEvent,
} from '../audio/events.js';
import type { ParameterBus } from '../rack/ParameterBus.js';
import type { ProjectSnapshot } from '../project/ProjectModel.js';
import type { ProjectClip } from '../project/ProjectModel.js';
import type { TransportState } from './SequencerTransport.js';

export interface ArrangementAudioClock {
  readonly isRunning: boolean;
  readonly currentTime: number;
  performanceTimeForAudioTime(audioTime: number): number;
}

export interface ArrangementTrackSink {
  noteOn(event: NoteOnEvent): void;
  noteOff(event: NoteOffEvent, releaseSeconds?: number): void;
}

export type ArrangementListener = (state: TransportState) => void;

interface ScheduledArrangementEvent {
  readonly audioOffsetSeconds: number;
  readonly clipId: string;
  readonly trackId: string;
  readonly instrumentModuleId: string;
  readonly event: ProjectClip['events'][number]['event'];
  readonly order: number;
}

interface ActiveArrangementNote {
  readonly sink: ArrangementTrackSink;
  readonly playbackNoteId: string;
  readonly sourceId: string;
}

/**
 * One project-wide transport. Every clip is translated to the same AudioContext
 * start time, so clips on different instrument tracks remain sample-clock aligned.
 */
export class ArrangementTransport {
  private readonly listeners = new Set<ArrangementListener>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private events: ScheduledArrangementEvent[] = [];
  private scheduleIndex = 0;
  private startAudioTime = 0;
  private endOffsetSeconds = 0;
  private state: TransportState = 'stopped';
  private readonly activeNotes = new Map<string, ActiveArrangementNote>();
  /** All note-ons submitted to Web Audio, including notes with a future note-off already queued. */
  private readonly scheduledVoices = new Map<string, ActiveArrangementNote>();
  private sequence = 0;

  constructor(
    private readonly audio: ArrangementAudioClock,
    private readonly parameterBus: ParameterBus,
    private readonly lookAheadSeconds = 0.12,
    private readonly intervalMilliseconds = 25,
  ) {
    if (lookAheadSeconds <= 0 || intervalMilliseconds <= 0) {
      throw new Error('Arrangement scheduler timing values must be positive.');
    }
  }

  subscribe(listener: ArrangementListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get currentState(): TransportState {
    return this.state;
  }

  play(
    project: ProjectSnapshot,
    trackSinks: ReadonlyMap<string, ArrangementTrackSink>,
  ): void {
    this.stop();

    if (!this.audio.isRunning) {
      throw new Error('Enable the audio engine before playing the arrangement.');
    }

    const tracks = new Map(project.tracks.map(track => [track.id, track] as const));
    const clips = project.clips.filter(clip => clip.events.length > 0);
    if (clips.length === 0) {
      throw new Error('The arrangement contains no musical events.');
    }

    const scheduled: ScheduledArrangementEvent[] = [];
    let order = 0;
    let endOffset = 0;

    for (const clip of clips) {
      const track = tracks.get(clip.trackId);
      if (!track) throw new Error('Clip "' + clip.id + '" references an unknown track.');
      if (!trackSinks.has(track.id)) {
        throw new Error('Track "' + track.name + '" has no ready instrument output.');
      }
      const secondsPerBeat = 60 / project.tempoBpm;
      const clipStartSeconds = clip.startBeats * secondsPerBeat;
      const clipTimeScale = clip.recordedAtTempoBpm / project.tempoBpm;
      endOffset = Math.max(
        endOffset,
        clipStartSeconds + clip.durationSeconds * clipTimeScale,
      );

      for (const recorded of clip.events) {
        scheduled.push({
          audioOffsetSeconds:
            clip.startBeats * (60 / project.tempoBpm) +
            recorded.offsetSeconds * clip.recordedAtTempoBpm / project.tempoBpm,
          clipId: clip.id,
          trackId: track.id,
          instrumentModuleId: track.instrumentModuleId,
          event: recorded.event,
          order: order++,
        });
      }
    }

    scheduled.sort((a, b) =>
      a.audioOffsetSeconds - b.audioOffsetSeconds || a.order - b.order,
    );

    this.events = scheduled;
    this.scheduleIndex = 0;
    this.endOffsetSeconds = endOffset;
    this.startAudioTime = this.audio.currentTime + this.lookAheadSeconds;
    this.activeNotes.clear();
    this.setState('playing');
    this.scheduleWindow(trackSinks);

    if (this.state === 'playing') {
      this.timer = setInterval(
        () => this.scheduleWindow(trackSinks),
        this.intervalMilliseconds,
      );
    }
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    if (this.state === 'playing') this.releaseScheduledVoices();
    this.activeNotes.clear();
    this.scheduledVoices.clear();
    this.events = [];
    this.scheduleIndex = 0;
    this.endOffsetSeconds = 0;
    this.setState('stopped');
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private scheduleWindow(trackSinks: ReadonlyMap<string, ArrangementTrackSink>): void {
    if (this.state !== 'playing') return;

    const horizon = this.audio.currentTime + this.lookAheadSeconds;
    while (this.scheduleIndex < this.events.length) {
      const scheduled = this.events[this.scheduleIndex]!;
      const eventAudioTime = this.startAudioTime + scheduled.audioOffsetSeconds;
      if (eventAudioTime > horizon + 0.002) break;

      const timestamp = this.audio.performanceTimeForAudioTime(eventAudioTime);
      const sink = trackSinks.get(scheduled.trackId);
      if (sink) this.dispatch(scheduled, sink, timestamp);
      this.scheduleIndex += 1;
    }

    const arrangementEnd = this.startAudioTime + this.endOffsetSeconds;
    if (
      this.scheduleIndex >= this.events.length &&
      this.audio.currentTime >= arrangementEnd + 0.03
    ) {
      this.releaseActiveNotes();
      this.finish();
    }
  }

  private dispatch(
    scheduled: ScheduledArrangementEvent,
    sink: ArrangementTrackSink,
    timestamp: number,
  ): void {
    const event = scheduled.event;
    const sourcePrefix = 'arrangement:' + scheduled.trackId;

    if (event.kind === 'note-on') {
      this.sequence += 1;
      const playbackNoteId = 'arr-' + scheduled.clipId + '-' + this.sequence;
      const noteKey = scheduled.clipId + ':' + event.sourceId + ':' + event.noteId;
      const previous = this.activeNotes.get(noteKey);

      if (previous) {
        previous.sink.noteOff({
          kind: 'note-off',
          sourceId: previous.sourceId,
          noteId: previous.playbackNoteId,
          timestamp,
        }, 0.015);
      }

      const active: ActiveArrangementNote = {
        sink,
        playbackNoteId,
        sourceId: sourcePrefix,
      };
      this.activeNotes.set(noteKey, active);
      this.scheduledVoices.set(playbackNoteId, active);
      sink.noteOn({
        ...event,
        sourceId: sourcePrefix,
        noteId: playbackNoteId,
        timestamp,
      });
      return;
    }

    if (event.kind === 'note-off') {
      const noteKey = scheduled.clipId + ':' + event.sourceId + ':' + event.noteId;
      const active = this.activeNotes.get(noteKey);
      if (!active) return;

      active.sink.noteOff({
        ...event,
        sourceId: active.sourceId,
        noteId: active.playbackNoteId,
        timestamp,
      });
      this.activeNotes.delete(noteKey);
      return;
    }

    if (event.kind === 'control') {
      const control: ControlSignal = { ...event, timestamp };
      this.parameterBus.process(control, scheduled.instrumentModuleId);
    }
    // Gate events will be connected to gate-capable modules in a later pass.
  }

  private releaseActiveNotes(): void {
    const timestamp = this.audio.performanceTimeForAudioTime(this.audio.currentTime);
    for (const active of this.activeNotes.values()) {
      active.sink.noteOff({
        kind: 'note-off',
        sourceId: active.sourceId,
        noteId: active.playbackNoteId,
        timestamp,
      }, 0.025);
    }
  }

  /** Cancel all note-ons already submitted, even when their future note-off was queued. */
  private releaseScheduledVoices(): void {
    const timestamp = this.audio.performanceTimeForAudioTime(this.audio.currentTime);
    for (const active of this.scheduledVoices.values()) {
      active.sink.noteOff({
        kind: 'note-off',
        sourceId: active.sourceId,
        noteId: active.playbackNoteId,
        timestamp,
      }, 0.025);
    }
  }


  private finish(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.activeNotes.clear();
    this.scheduledVoices.clear();
    this.setState('completed');
  }

  private setState(state: TransportState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
