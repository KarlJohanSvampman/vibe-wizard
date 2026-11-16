import { describe, expect, it, vi } from 'vitest';
import { AudioEffectChain } from './AudioEffectChain.js';
import type { AudioPortModule } from './audioPorts.js';

function node() {
  return { connect: vi.fn(), disconnect: vi.fn() } as unknown as GainNode;
}
function effect(id: string): AudioPortModule {
  const input = node();
  const output = node();
  return {
    id, kind: 'effect',
    ports: [
      { id: 'audio-in', direction: 'input', mediaType: 'audio' },
      { id: 'audio-out', direction: 'output', mediaType: 'audio' },
    ],
    getAudioPortNode: (portId: string) => portId === 'audio-in' ? input : output,
    setParameter: vi.fn(),
    dispose: vi.fn(),
  };
}
function setup() {
  const source = node();
  const destination = node();
  const input = node();
  const output = node();
  const context = { createGain: vi.fn().mockReturnValueOnce(input).mockReturnValueOnce(output) };
  return {
    source, destination, input, output,
    chain: new AudioEffectChain(context as unknown as BaseAudioContext, source, destination),
  };
}

describe('AudioEffectChain', () => {
  it('connects enabled effects in order and keeps the destination connected', () => {
    const h = setup();
    const first = effect('first');
    const second = effect('second');
    h.chain.setEffects([{ effect: first, enabled: true }, { effect: second, enabled: true }]);
    expect(h.input.connect).toHaveBeenCalledWith(first.getAudioPortNode('audio-in'));
    expect(first.getAudioPortNode('audio-out').connect).toHaveBeenCalledWith(second.getAudioPortNode('audio-in'));
    expect(second.getAudioPortNode('audio-out').connect).toHaveBeenCalledWith(h.output);
    expect(h.output.connect).toHaveBeenLastCalledWith(h.destination);
  });

  it('bypasses disabled effects without disposing them', () => {
    const h = setup();
    const first = effect('first');
    const second = effect('second');
    h.chain.setEffects([{ effect: first, enabled: false }, { effect: second, enabled: true }]);
    expect(h.input.connect).toHaveBeenCalledWith(second.getAudioPortNode('audio-in'));
    expect(first.dispose).not.toHaveBeenCalled();
  });

  it('rejects duplicate effect IDs and disconnects owned routing on disposal', async () => {
    const h = setup();
    const first = effect('first');
    expect(() => h.chain.setEffects([{ effect: first, enabled: true }, { effect: first, enabled: true }]))
      .toThrow(/once/i);
    h.chain.setEffects([{ effect: first, enabled: true }]);
    await h.chain.dispose();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(h.input.disconnect).toHaveBeenCalled();
    expect(h.output.disconnect).toHaveBeenCalled();
  });
});
