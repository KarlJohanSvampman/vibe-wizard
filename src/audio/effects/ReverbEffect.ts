import { clamp } from '../events.js';
import type { AudioRuntime } from '../AudioRuntime.js';
import type { AudioPortDefinition, AudioPortModule } from '../../rack/audioPorts.js';

/** Algorithmic stereo convolution reverb with an offline-generated impulse response. */
export class ReverbEffect implements AudioPortModule {
  readonly kind = 'effect' as const;
  readonly ports: readonly AudioPortDefinition[] = [
    { id: 'audio-in', direction: 'input', mediaType: 'audio' },
    { id: 'audio-out', direction: 'output', mediaType: 'audio', maxConnections: 16 },
  ];

  private input: GainNode | undefined;
  private output: GainNode | undefined;
  private convolver: ConvolverNode | undefined;
  private wet: GainNode | undefined;
  private dry: GainNode | undefined;
  private mix = 0.25;
  private decaySeconds = 2.2;
  private disposed = false;

  constructor(readonly id: string, private readonly runtime: AudioRuntime) {}

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Cannot start a disposed reverb effect.');
    if (this.input) return;
    const context = this.runtime.prepareContext();
    this.input = context.createGain();
    this.output = context.createGain();
    this.convolver = context.createConvolver();
    this.wet = context.createGain();
    this.dry = context.createGain();
    this.convolver.buffer = this.createImpulse(context);
    this.applyMix();

    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.input.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.wet.connect(this.output);
  }

  getAudioPortNode(portId: string): AudioNode {
    if (portId === 'audio-in' && this.input) return this.input;
    if (portId === 'audio-out' && this.output) return this.output;
    throw new Error(`Start reverb effect "${this.id}" before accessing port "${portId}".`);
  }

  setParameter(parameterId: string, value: number, timestamp: number): void {
    if (!Number.isFinite(value)) return;
    const at = this.runtime.toAudioTime(timestamp);
    if (parameterId === 'mix') {
      this.mix = clamp(value, 0, 1);
      this.wet?.gain.setTargetAtTime(this.mix, at, 0.015);
      this.dry?.gain.setTargetAtTime(1 - this.mix, at, 0.015);
    } else if (parameterId === 'decay') {
      this.decaySeconds = clamp(value, 0.1, 8);
      if (this.convolver) this.convolver.buffer = this.createImpulse(this.runtime.prepareContext());
    }
  }

  private createImpulse(context: BaseAudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(context.sampleRate * this.decaySeconds));
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const samples = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const remaining = 1 - i / length;
        samples[i] = (Math.random() * 2 - 1) * remaining ** 2.5;
      }
    }
    return impulse;
  }

  private applyMix(): void {
    if (this.wet) this.wet.gain.value = this.mix;
    if (this.dry) this.dry.gain.value = 1 - this.mix;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const node of [this.input, this.output, this.convolver, this.wet, this.dry]) node?.disconnect();
    this.input = undefined; this.output = undefined; this.convolver = undefined;
    this.wet = undefined; this.dry = undefined;
  }
}
