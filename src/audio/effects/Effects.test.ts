import { describe, expect, it, vi } from 'vitest';
import { DelayEffect } from './DelayEffect.js';
import { ReverbEffect } from './ReverbEffect.js';
import type { AudioRuntime } from '../AudioRuntime.js';

function param(initial = 0) {
  return { value: initial, setTargetAtTime: vi.fn() };
}
function gain() {
  return { gain: param(), connect: vi.fn(), disconnect: vi.fn() };
}
function harness() {
  const gains: ReturnType<typeof gain>[] = [];
  const delays: Array<{ delayTime: ReturnType<typeof param>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const convolvers: Array<{ buffer: AudioBuffer | null; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const context = {
    sampleRate: 100,
    createGain: vi.fn(() => { const value = gain(); gains.push(value); return value; }),
    createDelay: vi.fn(() => { const value = { delayTime: param(), connect: vi.fn(), disconnect: vi.fn() }; delays.push(value); return value; }),
    createConvolver: vi.fn(() => { const value = { buffer: null as AudioBuffer | null, connect: vi.fn(), disconnect: vi.fn() }; convolvers.push(value); return value; }),
    createBuffer: vi.fn((_channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: _channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    } as unknown as AudioBuffer)),
  };
  const runtime = {
    prepareContext: () => context,
    toAudioTime: (timestamp: number) => timestamp + 1,
  } as unknown as AudioRuntime;
  return { context, runtime, gains, delays, convolvers };
}

describe('DelayEffect', () => {
  it('exposes audio ports, creates bounded feedback routing, and cleans up', async () => {
    const h = harness();
    const effect = new DelayEffect('delay-test', h.runtime);
    await effect.start();
    expect(effect.ports.map(port => port.id)).toEqual(['audio-in', 'audio-out']);
    expect(h.context.createDelay).toHaveBeenCalledWith(2);
    expect(h.delays[0]!.delayTime.value).toBe(0.35);
    expect(h.gains[3]!.gain.value).toBe(0.25);

    effect.setParameter('mix', 0.6, 4);
    effect.setParameter('time', 9, 4);
    effect.setParameter('feedback', 2, 4);
    expect(h.gains[4]!.gain.setTargetAtTime).toHaveBeenCalledWith(0.6, 5, 0.015);
    expect(h.gains[5]!.gain.setTargetAtTime).toHaveBeenCalledWith(0.4, 5, 0.015);
    expect(h.delays[0]!.delayTime.setTargetAtTime).toHaveBeenCalledWith(2, 5, 0.02);
    expect(h.gains[3]!.gain.setTargetAtTime).toHaveBeenCalledWith(0.85, 5, 0.02);

    await effect.dispose();
    await effect.dispose();
    expect(h.gains.every(node => node.disconnect.mock.calls.length === 1)).toBe(true);
  });
});

describe('ReverbEffect', () => {
  it('creates a stereo impulse response and exposes adjustable wet/dry and decay', async () => {
    const h = harness();
    const effect = new ReverbEffect('reverb-test', h.runtime);
    await effect.start();
    expect(h.context.createBuffer).toHaveBeenCalledWith(2, 220, 100);
    expect(h.convolvers[0]!.buffer?.numberOfChannels).toBe(2);

    effect.setParameter('mix', 0.7, 3);
    effect.setParameter('decay', 4, 3);
    expect(h.gains[2]!.gain.setTargetAtTime).toHaveBeenCalledWith(0.7, 4, 0.015);
    expect(h.gains[3]!.gain.setTargetAtTime).toHaveBeenCalledWith(0.3, 4, 0.015);
    expect(h.context.createBuffer).toHaveBeenLastCalledWith(2, 400, 100);
    expect(h.convolvers[0]!.buffer?.length).toBe(400);

    await effect.dispose();
    expect(h.convolvers[0]!.disconnect).toHaveBeenCalledOnce();
  });
});
