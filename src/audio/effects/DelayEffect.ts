import { clamp } from '../events.js';
import type { AudioRuntime } from '../AudioRuntime.js';
import type { AudioPortDefinition, AudioPortModule } from '../../rack/audioPorts.js';

/** Tempo-ready stereo delay with bounded feedback and independent wet/dry paths. */
export class DelayEffect implements AudioPortModule {
  readonly kind = 'effect' as const;
  readonly ports: readonly AudioPortDefinition[] = [
    { id: 'audio-in', direction: 'input', mediaType: 'audio' },
    { id: 'audio-out', direction: 'output', mediaType: 'audio', maxConnections: 16 },
  ];

  private input: GainNode | undefined;
  private output: GainNode | undefined;
  private delay: DelayNode | undefined;
  private feedback: GainNode | undefined;
  private wet: GainNode | undefined;
  private dry: GainNode | undefined;
  private mix = 0.3;
  private time = 0.35;
  private feedbackAmount = 0.25;
  private disposed = false;

  constructor(readonly id: string, private readonly runtime: AudioRuntime) {}

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Cannot start a disposed delay effect.');
    if (this.input) return;
    const context = this.runtime.prepareContext();
    this.input = context.createGain();
    this.output = context.createGain();
    this.delay = context.createDelay(2);
    this.feedback = context.createGain();
    this.wet = context.createGain();
    this.dry = context.createGain();
    this.delay.delayTime.value = this.time;
    this.feedback.gain.value = this.feedbackAmount;
    this.applyMix();

    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.input.connect(this.delay);
    this.delay.connect(this.wet);
    this.wet.connect(this.output);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
  }

  getAudioPortNode(portId: string): AudioNode {
    if (portId === 'audio-in' && this.input) return this.input;
    if (portId === 'audio-out' && this.output) return this.output;
    throw new Error(`Start delay effect "${this.id}" before accessing port "${portId}".`);
  }

  setParameter(parameterId: string, value: number, timestamp: number): void {
    if (!Number.isFinite(value)) return;
    const at = this.runtime.toAudioTime(timestamp);
    if (parameterId === 'mix') {
      this.mix = clamp(value, 0, 1);
      this.wet?.gain.setTargetAtTime(this.mix, at, 0.015);
      this.dry?.gain.setTargetAtTime(1 - this.mix, at, 0.015);
    } else if (parameterId === 'time') {
      this.time = clamp(value, 0.01, 2);
      this.delay?.delayTime.setTargetAtTime(this.time, at, 0.02);
    } else if (parameterId === 'feedback') {
      this.feedbackAmount = clamp(value, 0, 0.85);
      this.feedback?.gain.setTargetAtTime(this.feedbackAmount, at, 0.02);
    }
  }

  private applyMix(): void {
    if (this.wet) this.wet.gain.value = this.mix;
    if (this.dry) this.dry.gain.value = 1 - this.mix;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const node of [this.input, this.output, this.delay, this.feedback, this.wet, this.dry]) node?.disconnect();
    this.input = undefined; this.output = undefined; this.delay = undefined;
    this.feedback = undefined; this.wet = undefined; this.dry = undefined;
  }
}
