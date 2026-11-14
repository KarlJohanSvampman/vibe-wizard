import type {
  ControlSignal,
  NoteOffEvent,
  NoteOnEvent,
} from '../audio/events.js';
import type { AudioEngine } from '../audio/AudioEngine.js';
import type { ParameterBus } from '../rack/ParameterBus.js';
import type { RecordingClip } from './Recorder.js';

export type TransportState = 'stopped' | 'playing' | 'completed';

export interface ScheduledAudioSink {
  readonly isRunning: boolean;
  readonly currentTime: number;
  performanceTimeForAudioTime(audioTime: number): number;
  noteOn(event: NoteOnEvent): void;
  noteOff(event: NoteOffEvent, releaseSeconds?: number): void;
}

export type TransportListener = (state: TransportState) => void;

/** Look-ahead scheduler that plays clips against the AudioContext clock. */
export class SequencerTransport {
  private readonly listeners = new Set<TransportListener>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private clip: RecordingClip | undefined;
  private scheduleIndex = 0;
  private startAudioTime = 0;
  private state: TransportState = 'stopped';
  private readonly playbackNoteIds = new Map<string, string>();
  private readonly scheduledVoiceIds = new Set<string>();
  private playbackSequence = 0;

  constructor(
    private readonly audio: ScheduledAudioSink,
    private readonly parameterBus: ParameterBus,
    private readonly lookAheadSeconds = 0.12,
    private readonly intervalMilliseconds = 25,
    private readonly controlTargetModuleId?: string,
  ) {}

  subscribe(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get currentState(): TransportState {
    return this.state;
  }

  play(clip: RecordingClip): void {
    this.stop();

    if (!this.audio.isRunning) {
      throw new Error('Enable the audio engine before playing a recorded clip.');
    }
    if (clip.events.length === 0) {
      throw new Error('This clip contains no recorded events.');
    }

    this.clip = clip;
    this.scheduleIndex = 0;
    this.startAudioTime = this.audio.currentTime + this.lookAheadSeconds;
    this.playbackNoteIds.clear();
    this.scheduledVoiceIds.clear();
    this.setState('playing');
    this.scheduleWindow();
    this.timer = setInterval(() => this.scheduleWindow(), this.intervalMilliseconds);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    if (this.state === 'playing') {
      const timestamp = performance.now() / 1000;
      for (const noteId of this.scheduledVoiceIds) {
        this.audio.noteOff({
          kind: 'note-off',
          sourceId: 'sequencer',
          noteId,
          timestamp,
        }, 0.025);
      }
    }

    this.playbackNoteIds.clear();
    this.scheduledVoiceIds.clear();
    this.clip = undefined;
    this.scheduleIndex = 0;
    this.setState('stopped');
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private scheduleWindow(): void {
    const clip = this.clip;
    if (!clip || this.state !== 'playing') return;

    const horizon = this.audio.currentTime + this.lookAheadSeconds;
    while (this.scheduleIndex < clip.events.length) {
      const recorded = clip.events[this.scheduleIndex];
      const eventAudioTime = this.startAudioTime + recorded.offsetSeconds;
      if (eventAudioTime > horizon + 0.002) break;

      const eventTimestamp = this.audio.performanceTimeForAudioTime(eventAudioTime);
      this.dispatch(recorded.event, eventTimestamp, clip.id);
      this.scheduleIndex += 1;
    }

    const clipEndTime = this.startAudioTime + clip.durationSeconds;
    if (
      this.scheduleIndex >= clip.events.length &&
      this.audio.currentTime >= clipEndTime + 0.03
    ) {
      this.finish();
    }
  }

  private dispatch(
    event: RecordingClip['events'][number]['event'],
    timestamp: number,
    clipId: string,
  ): void {
    if (event.kind === 'note-on') {
      this.playbackSequence += 1;
      const playbackId = 'playback-' + clipId + '-' + this.playbackSequence;
      const sourceKey = event.sourceId + ':' + event.noteId;
      this.playbackNoteIds.set(sourceKey, playbackId);
      this.scheduledVoiceIds.add(playbackId);
      this.audio.noteOn({
        ...event,
        sourceId: 'sequencer',
        noteId: playbackId,
        timestamp,
      });
      return;
    }

    if (event.kind === 'note-off') {
      const sourceKey = event.sourceId + ':' + event.noteId;
      const playbackId = this.playbackNoteIds.get(sourceKey);
      if (!playbackId) return;
      this.audio.noteOff({
        ...event,
        sourceId: 'sequencer',
        noteId: playbackId,
        timestamp,
      });
      this.playbackNoteIds.delete(sourceKey);
      return;
    }

    if (event.kind === 'control') {
      const control: ControlSignal = { ...event, timestamp };
      this.parameterBus.process(control, this.controlTargetModuleId);
    }
    // Gate events will be connected to gate-capable modules in the next pass.
  }

  private finish(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.playbackNoteIds.clear();
    this.scheduledVoiceIds.clear();
    this.clip = undefined;
    this.setState('completed');
  }

  private setState(state: TransportState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

export function createSequencerTransport(
  audio: AudioEngine,
  parameterBus: ParameterBus,
  controlTargetModuleId?: string,
): SequencerTransport {
  return new SequencerTransport(audio, parameterBus, 0.12, 25, controlTargetModuleId);
}
