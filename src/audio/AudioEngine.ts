import { clamp, midiToFrequency } from './events.js';
import type { NoteOffEvent, NoteOnEvent } from './events.js';
import type { RackModule } from '../rack/types.js';

interface SynthVoice {
  readonly oscillator: OscillatorNode;
  readonly envelope: GainNode;
  readonly sourceId: string;
  readonly velocity: number;
  readonly startTime: number;
  releaseTime?: number;
}

/**
 * Prototype Web Audio instrument. Public event timestamps use performance.now()
 * seconds and are translated into AudioContext time for look-ahead scheduling.
 */
export class AudioEngine implements RackModule {
  readonly kind = 'instrument' as const;

  private context: AudioContext | undefined;
  private masterGain: GainNode | undefined;
  private readonly voices = new Map<string, SynthVoice>();
  private masterVolume = 0.35;
  private disposed = false;

  constructor(readonly id: string) {}

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Cannot start a disposed audio engine.');

    if (!this.context) {
      this.context = new AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.context.destination);
    }

    if (this.context.state !== 'running') await this.context.resume();
  }

  get isRunning(): boolean {
    return this.context?.state === 'running';
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  performanceTimeForAudioTime(audioTime: number): number {
    const context = this.requireContext();
    return performance.now() / 1000 + (audioTime - context.currentTime);
  }

  noteOn(event: NoteOnEvent): void {
    const context = this.requireContext();
    const startTime = this.toAudioTime(event.timestamp);

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
    envelope.connect(this.masterGain!);
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
    const context = this.context;
    if (!voice || !context) return;

    const requestedTime = this.toAudioTime(event.timestamp);
    const releaseTime = Math.max(requestedTime, voice.startTime);

    if (voice.releaseTime !== undefined && releaseTime >= voice.releaseTime) return;

    if (requestedTime < voice.startTime) {
      // Cancel a voice that has been queued by look-ahead but has not begun.
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
      // Keep the most recent controller value even before AudioContext starts.
      this.masterVolume = clamp(value, 0, 1);
      if (this.context && this.masterGain) {
        const at = this.toAudioTime(timestamp);
        this.masterGain.gain.setTargetAtTime(this.masterVolume, at, 0.012);
      }
      return;
    }

    if (!this.context) return;
    const at = this.toAudioTime(timestamp);

    if (parameterId === 'pitch') {
      const frequency = midiToFrequency(clamp(value, 0, 127));
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
    const context = this.context;
    this.voices.clear();
    this.context = undefined;
    this.masterGain = undefined;
    if (context && context.state !== 'closed') await context.close();
  }

  private toAudioTime(performanceTimestamp: number): number {
    const context = this.requireContext();
    const offset = context.currentTime - performance.now() / 1000;
    return Math.max(context.currentTime, performanceTimestamp + offset);
  }

  private requireContext(): AudioContext {
    if (!this.context || !this.masterGain || this.context.state === 'closed') {
      throw new Error('Audio is not ready. Call start() from a user gesture first.');
    }
    return this.context;
  }
}
