import { describe, expect, it, vi } from 'vitest';
import { SharedSendReturn } from './SharedSendReturn.js';
import type { AudioPortModule } from './audioPorts.js';

describe('SharedSendReturn', () => {
  it('fans multiple send nodes into one started effect and routes its output to the master', async () => {
    const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as GainNode;
    const effectInput = { disconnect: vi.fn() } as unknown as AudioNode;
    const effectOutput = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
    const effect: AudioPortModule & { start(): Promise<void> } = {
      id: 'shared-delay', kind: 'effect',
      ports: [
        { id: 'audio-in', direction: 'input', mediaType: 'audio' },
        { id: 'audio-out', direction: 'output', mediaType: 'audio' },
      ],
      start: vi.fn(async () => undefined),
      getAudioPortNode: id => id === 'audio-in' ? effectInput : effectOutput,
      setParameter: vi.fn(),
      dispose: vi.fn(),
    };
    const master = {} as AudioNode;
    const context = { createGain: vi.fn(() => input) } as unknown as BaseAudioContext;
    const sendReturn = new SharedSendReturn('delay-return', context, effect, master);
    await sendReturn.start();
    expect(effect.start).toHaveBeenCalledOnce();
    expect(input.connect).toHaveBeenCalledWith(effectInput);
    expect(effectOutput.connect).toHaveBeenCalledWith(master);
    expect(sendReturn.inputNode).toBe(input);
    await sendReturn.dispose();
    expect(input.disconnect).toHaveBeenCalledOnce();
    expect(effect.dispose).toHaveBeenCalledOnce();
  });
});
