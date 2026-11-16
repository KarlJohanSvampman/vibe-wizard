import type { AudioPortModule } from './audioPorts.js';

export interface AudioEffectChainEntry {
  readonly effect: AudioPortModule;
  readonly enabled: boolean;
}

/**
 * Owns the serial insert path between a track bus and its destination.
 * Effects retain their own wet/dry topology; bypass simply routes around a
 * module without destroying its state or parameter values.
 */
export class AudioEffectChain {
  private readonly input: GainNode;
  private readonly output: GainNode;
  private entries: AudioEffectChainEntry[] = [];
  private disposed = false;

  constructor(context: BaseAudioContext, source: AudioNode, destination: AudioNode) {
    this.input = context.createGain();
    this.output = context.createGain();
    source.connect(this.input);
    this.output.connect(destination);
  }

  get effects(): readonly AudioEffectChainEntry[] {
    return this.entries;
  }

  setEffects(entries: readonly AudioEffectChainEntry[]): void {
    if (this.disposed) throw new Error('Cannot update a disposed audio effect chain.');
    const ids = new Set<string>();
    for (const entry of entries) {
      if (ids.has(entry.effect.id)) throw new Error('An effect can only appear once in an insert chain.');
      ids.add(entry.effect.id);
      const input = entry.effect.ports.find(port => port.id === 'audio-in' && port.direction === 'input');
      const output = entry.effect.ports.find(port => port.id === 'audio-out' && port.direction === 'output');
      if (!input || !output) throw new Error('Insert effects must expose audio-in and audio-out ports.');
      // Accessing both ports also ensures the module has been started.
      entry.effect.getAudioPortNode(input.id);
      entry.effect.getAudioPortNode(output.id);
    }

    this.input.disconnect();
    this.output.disconnect();
    for (const entry of this.entries) {
      const output = entry.effect.getAudioPortNode('audio-out');
      output.disconnect();
    }

    const active = entries.filter(entry => entry.enabled);
    let previous: AudioNode = this.input;
    for (const entry of active) {
      const input = entry.effect.getAudioPortNode('audio-in');
      const output = entry.effect.getAudioPortNode('audio-out');
      previous.connect(input);
      previous = output;
    }
    previous.connect(this.output);
    this.entries = entries.slice();
  }

  async dispose(disposeEffects = true): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.input.disconnect();
    this.output.disconnect();
    for (const entry of this.entries) {
      entry.effect.getAudioPortNode('audio-in').disconnect();
      entry.effect.getAudioPortNode('audio-out').disconnect();
      if (disposeEffects) await entry.effect.dispose?.();
    }
    this.entries = [];
  }
}
