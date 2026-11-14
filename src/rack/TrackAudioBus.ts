import { clamp } from '../audio/events.js';
import type { AudioRuntime } from '../audio/AudioRuntime.js';
import type { RackModule } from '../rack/types.js';

/** Independent level/pan stage owned by one instrument track. */
export class TrackAudioBus implements RackModule {
  readonly kind = 'utility' as const;

  private inputGain: GainNode | undefined;
  private panner: StereoPannerNode | undefined;
  private volume = 0.8;
  private pan = 0;
  private disposed = false;

  constructor(readonly id: string, private readonly runtime: AudioRuntime) {}

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Cannot start a disposed track bus.');
    const context = this.runtime.prepareContext();
    if (this.inputGain) return;

    this.inputGain = context.createGain();
    this.panner = context.createStereoPanner();
    this.inputGain.gain.value = this.volume;
    this.panner.pan.value = this.pan;
    this.inputGain.connect(this.panner);
    this.panner.connect(context.destination);
  }

  get inputNode(): AudioNode {
    if (!this.inputGain) throw new Error('Start the track bus before connecting an instrument.');
    return this.inputGain;
  }

  setParameter(parameterId: string, value: number, timestamp: number): void {
    if (!Number.isFinite(value)) return;
    const at = this.runtime.toAudioTime(timestamp);

    if (parameterId === 'volume') {
      this.volume = clamp(value, 0, 1);
      this.inputGain?.gain.setTargetAtTime(this.volume, at, 0.015);
    } else if (parameterId === 'pan') {
      this.pan = clamp(value, -1, 1);
      this.panner?.pan.setTargetAtTime(this.pan, at, 0.015);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.inputGain?.disconnect();
    this.panner?.disconnect();
    this.inputGain = undefined;
    this.panner = undefined;
  }
}
