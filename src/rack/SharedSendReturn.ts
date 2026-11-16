import type { AudioPortModule } from './audioPorts.js';

/** Shared project return: many track sends feed one effect instance and output. */
export class SharedSendReturn {
  private readonly input: GainNode;
  private started = false;
  private disposed = false;

  constructor(
    readonly id: string,
    private readonly context: BaseAudioContext,
    private readonly effect: AudioPortModule & { start(): Promise<void> },
    private readonly destination: AudioNode,
  ) {
    this.input = context.createGain();
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Cannot start a disposed send return.');
    if (this.started) return;
    await this.effect.start();
    this.input.connect(this.effect.getAudioPortNode('audio-in'));
    this.effect.getAudioPortNode('audio-out').connect(this.destination);
    this.started = true;
  }

  get inputNode(): AudioNode {
    if (!this.started) throw new Error('Start the send return before connecting sends.');
    return this.input;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.input.disconnect();
    this.effect.getAudioPortNode('audio-in').disconnect();
    this.effect.getAudioPortNode('audio-out').disconnect();
    await this.effect.dispose?.();
    this.started = false;
  }
}
