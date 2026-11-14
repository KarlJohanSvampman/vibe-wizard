import { clamp, midiToFrequency } from './events.js';
import type { NoteOffEvent, NoteOnEvent } from './events.js';
import type { RackModule } from '../rack/types.js';
import { AudioRuntime } from './AudioRuntime.js';

interface SynthVoice {
  readonly oscillator: OscillatorNode;
  readonly envelope: GainNode;
  readonly sourceId: string;
  readonly velocity: number;
  readonly startTime: number;
  releaseTime?: number;
}

/**
 * Prototype Web Audio instrument. Multiple engines can share one AudioRuntime
 * while retaining independent voices and output connections.
 */
export class AudioEngine implements RackModule {
  readonly kind = 'instrument' as const;

  private readonly runtime: AudioRuntime;
  private readonly ownsRuntime: boolean;
  private masterGain: GainNode | undefined;
  private outputNode: AudioNode | undefined;
  private readonly voices = new Map<string, SynthVoice>();
  private masterVolume = 0.35;
  private disposed = false;

  constructor(readonly id: string, runtime?: AudioRuntime) {
    this.runtime = runtime ?? new AudioRuntime();
    this.ownsRuntime = runtime === undefined;
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Cannot start a disposed audio engine.');
    const context = this.runtime.prepareContext();

    if (!this.masterGain) {
      this.masterGain = context.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.outputNode ??= context.destination;
      this.masterGain.connect(this.outputNode);
    }

    await this.runtime.start();
  }

  get isRunning(): boolean {
    return this.runtime.isRunning;
  }

  get currentTime(): number {
    return this.runtime.currentTime;
  }

  performanceTimeForAudioTime(audioTime: number): number {
    return this.runtime.performanceTimeForAudioTime(audioTime);
  }

  /** Route this instrument's output into its owning track bus. */
  connectOutput(destination: AudioNode): void {
    this.outputNode = destination;
    if (!this.masterGain) return;
    this.masterGain.disconnect();
    this.masterGain.connect(destination);
  }

  noteOn(event: NoteOnEvent): void {
    const context = this.runtime.requireContext();
    if (!this.masterGain) throw new Error('Start the instrument before sending note events.');
    const startTime = this.runtime.toAudioTime(event.timestamp);

    this.noteOff({
      kind: 'note-off',
      sourceId: event.sourceId,
      noteId: event.noteId,
      timestamp: event.timestamp,
    });

    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const pitch = clamp(event.pitch, 0, 127);
    const velocity = clamp(event.velocity, 0, 1);

    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(midiToFrequency(pitch), startTime);
    envelope.gain.setValueAtTime(0.0001, startTime);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, velocity), startTime + 0.015);
    oscillator.connect(envelope);
    envelope.connect(this.masterGain);
    oscillator.start(startTime);

    const voice: SynthVoice = {
      oscillator,
      envelope,
      sourceId: event.sourceId,
      velocity,
      startTime,
    };
    this.voices.set(event.noteId, voice);

    oscillator.onended = () => {
      envelope.disconnect();
      oscillator.disconnect();
      if (this.voices.get(event.noteId) === voice) this.voices.delete(event.noteId);
    };
  }

  noteOff(event: NoteOffEvent, releaseSeconds = 0.14): void {
    const voice = this.voices.get(event.noteId);
    const context = this.runtime.context;
    if (!voice || !context || context.state === 'closed') return;

    const requestedTime = this.runtime.toAudioTime(event.timestamp);
    const releaseTime = Math.max(requestedTime, voice.startTime);
    if (voice.releaseTime !== undefined && releaseTime >= voice.releaseTime) return;

    if (requestedTime < voice.startTime) {
      voice.envelope.gain.cancelScheduledValues(voice.startTime);
      voice.oscillator.stop(Math.max(context.currentTime, requestedTime));
      voice.releaseTime = requestedTime;
      return;
    }

    const release = Math.max(0.015, releaseSeconds);
    voice.envelope.gain.cancelScheduledValues(releaseTime);
    voice.envelope.gain.setValueAtTime(voice.velocity, releaseTime);
    voice.envelope.gain.linearRampToValueAtTime(0.0001, releaseTime + release);
    voice.oscillator.stop(releaseTime + release + 0.02);
    voice.releaseTime = releaseTime;
  }

  allNotesOff(): void {
    const timestamp = performance.now() / 1000;
    for (const [noteId, voice] of this.voices) {
      this.noteOff({
        kind: 'note-off',
        sourceId: voice.sourceId,
        noteId,
        timestamp,
      }, 0.03);
    }
  }

  setParameter(parameterId: string, value: number, timestamp: number): void {
    if (!Number.isFinite(value)) return;

    if (parameterId === 'volume') {
      this.masterVolume = clamp(value, 0, 1);
      if (this.masterGain) {
        this.masterGain.gain.setTargetAtTime(
          this.masterVolume,
          this.runtime.toAudioTime(timestamp),
          0.012,
        );
      }
      return;
    }

    if (!this.masterGain) return;
    if (parameterId === 'pitch') {
      const frequency = midiToFrequency(clamp(value, 0, 127));
      const at = this.runtime.toAudioTime(timestamp);
      for (const voice of this.voices.values()) {
        voice.oscillator.frequency.setTargetAtTime(
          frequency,
          Math.max(at, voice.startTime),
          0.018,
        );
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.allNotesOff();
    this.disposed = true;
    this.voices.clear();
    this.masterGain?.disconnect();
    this.masterGain = undefined;
    this.outputNode = undefined;
    if (this.ownsRuntime) await this.runtime.dispose();
  }
}
