import { clamp } from './events.js';
import type { AudioRuntime } from './AudioRuntime.js';
import type { RackModule } from '../rack/types.js';

/**
 * Project output stage: bounded master gain, broadband safety limiter, and
 * post-limiter peak analysis. Tracks connect to inputNode, never destination.
 */
export class MasterAudioBus implements RackModule {
  readonly kind = 'utility' as const;

  private inputGain: GainNode | undefined;
  private limiter: DynamicsCompressorNode | undefined;
  private analyser: AnalyserNode | undefined;
  private volume = 0.8;
  private disposed = false;
  private readonly meterBuffer = new Float32Array(256);

  constructor(readonly id: string, private readonly runtime: AudioRuntime) {}

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Cannot start a disposed master bus.');
    const context = this.runtime.prepareContext();
    if (this.inputGain) return;

    this.inputGain = context.createGain();
    this.inputGain.gain.value = this.volume;

    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.12;

    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.08;

    this.inputGain.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(context.destination);
  }

  get inputNode(): AudioNode {
    if (!this.inputGain) throw new Error('Start the master bus before connecting tracks.');
    return this.inputGain;
  }

  get peakLevel(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.meterBuffer);
    let peak = 0;
    for (const sample of this.meterBuffer) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }

  get peakDb(): number {
    return 20 * Math.log10(Math.max(this.peakLevel, 0.00001));
  }

  /** Negative values indicate gain reduction from the safety limiter. */
  get gainReductionDb(): number {
    return this.limiter?.reduction ?? 0;
  }

  setParameter(parameterId: string, value: number, timestamp: number): void {
    if (parameterId !== 'volume' || !Number.isFinite(value)) return;
    this.volume = clamp(value, 0, 1);
    this.inputGain?.gain.setTargetAtTime(
      this.volume,
      this.runtime.toAudioTime(timestamp),
      0.02,
    );
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.inputGain?.disconnect();
    this.limiter?.disconnect();
    this.analyser?.disconnect();
    this.inputGain = undefined;
    this.limiter = undefined;
    this.analyser = undefined;
  }
}
