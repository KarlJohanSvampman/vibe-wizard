import { clamp, midiToFrequency } from './events.js';
import type { NoteOffEvent, NoteOnEvent } from './events.js';
import type { RackModule } from '../rack/types.js';

interface SynthVoice {
  readonly oscillator: OscillatorNode;
  readonly envelope: GainNode;
  pitch: number;
}

/**
 * Small Web Audio synthesizer used by the first vertical slice.
 * AudioContext creation is deferred until start() is called from a user gesture.
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

    if (this.context.state !== 'running') {
      await this.context.resume();
    }
  }

  get isRunning(): boolean {
    return this.context?.state === 'running';
  }

  noteOn(event: NoteOnEvent): void {
    const context = this.requireContext();
    this.noteOff({
      kind: 'note-off',
      sourceId: event.sourceId,
      noteId: event.noteId,
      timestamp: event.timestamp,
    });

    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const now = context.currentTime;
    const pitch = clamp(event.pitch, 0, 127);
    const velocity = clamp(event.velocity, 0, 1);

    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(midiToFrequency(pitch), now);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, velocity), now + 0.015);
    oscillator.connect(envelope);
    envelope.connect(this.masterGain!);
    oscillator.start(now);

    const voice: SynthVoice = { oscillator, envelope, pitch };
    this.voices.set(event.noteId, voice);
    oscillator.onended = () => {
      envelope.disconnect();
      oscillator.disconnect();
      if (this.voices.get(event.noteId) === voice) {
        this.voices.delete(event.noteId);
      }
    };
  }

  noteOff(event: NoteOffEvent, releaseSeconds = 0.14): void {
    const voice = this.voices.get(event.noteId);
    const context = this.context;
    if (!voice || !context) return;

    const now = context.currentTime;
    const release = Math.max(0.015, releaseSeconds);
    voice.envelope.gain.cancelScheduledValues(now);
    voice.envelope.gain.setValueAtTime(Math.max(0.0001, voice.envelope.gain.value), now);
    voice.envelope.gain.linearRampToValueAtTime(0.0001, now + release);
    voice.oscillator.stop(now + release + 0.02);
  }

  allNotesOff(): void {
    const timestamp = this.context?.currentTime ?? 0;
    for (const noteId of this.voices.keys()) {
      this.noteOff({
        kind: 'note-off',
        sourceId: 'panic',
        noteId,
        timestamp,
      }, 0.03);
    }
  }

  setParameter(parameterId: string, value: number, _timestamp: number): void {
    if (!Number.isFinite(value)) return;

    if (parameterId === 'volume') {
      this.masterVolume = clamp(value, 0, 1);
      const context = this.context;
      const gain = this.masterGain;
      if (context && gain) {
        gain.gain.setTargetAtTime(this.masterVolume, context.currentTime, 0.012);
      }
      return;
    }

    if (parameterId === 'pitch') {
      const pitch = clamp(value, 0, 127);
      const context = this.context;
      if (!context) return;
      const now = context.currentTime;
      for (const voice of this.voices.values()) {
        voice.pitch = pitch;
        voice.oscillator.frequency.setTargetAtTime(midiToFrequency(pitch), now, 0.018);
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.allNotesOff();
    const context = this.context;
    this.voices.clear();
    this.context = undefined;
    this.masterGain = undefined;
    if (context && context.state !== 'closed') {
      await context.close();
    }
  }

  private requireContext(): AudioContext {
    if (!this.context || !this.masterGain || this.context.state === 'closed') {
      throw new Error('Audio is not ready. Call start() from a user gesture first.');
    }
    return this.context;
  }
}
