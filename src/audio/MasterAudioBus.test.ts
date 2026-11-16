import { describe, expect, it, vi } from 'vitest';
import { MasterAudioBus } from './MasterAudioBus.js';
import type { AudioRuntime } from './AudioRuntime.js';

describe('MasterAudioBus', () => {
  it('routes the project output through a bounded gain and safety limiter', async () => {
    const gain = { value: 0, setTargetAtTime: vi.fn() };
    const input = { gain, connect: vi.fn(), disconnect: vi.fn() };
    const limiter = {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      reduction: -4.5,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getFloatTimeDomainData: vi.fn((samples: Float32Array) => samples.fill(0.5)),
    };
    const context = {
      destination: {},
      createGain: vi.fn(() => input),
      createDynamicsCompressor: vi.fn(() => limiter),
      createAnalyser: vi.fn(() => analyser),
    };
    const runtime = {
      prepareContext: () => context,
      toAudioTime: (timestamp: number) => timestamp + 2,
    } as unknown as AudioRuntime;
    const bus = new MasterAudioBus('master-test', runtime);

    await bus.start();

    expect(gain.value).toBe(0.8);
    expect(input.connect).toHaveBeenCalledWith(limiter);
    expect(limiter.connect).toHaveBeenCalledWith(analyser);
    expect(analyser.connect).toHaveBeenCalledWith(context.destination);
    expect(limiter.threshold.value).toBe(-3);
    expect(limiter.ratio.value).toBe(20);

    bus.setParameter('volume', 1.4, 10);
    expect(gain.setTargetAtTime).toHaveBeenCalledWith(1, 12, 0.02);
    expect(bus.peakLevel).toBeCloseTo(0.5);
    expect(bus.peakDb).toBeCloseTo(20 * Math.log10(0.5));
    expect(bus.gainReductionDb).toBe(-4.5);

    await bus.dispose();
    await bus.dispose();
    expect(input.disconnect).toHaveBeenCalledOnce();
    expect(limiter.disconnect).toHaveBeenCalledOnce();
    expect(analyser.disconnect).toHaveBeenCalledOnce();
  });

  it('rejects starting after disposal and reports silence before startup', async () => {
    const context = {
      destination: {},
      createGain: vi.fn(),
      createDynamicsCompressor: vi.fn(),
      createAnalyser: vi.fn(),
    };
    const runtime = { prepareContext: () => context } as unknown as AudioRuntime;
    const bus = new MasterAudioBus('master-disposed', runtime);

    expect(bus.peakLevel).toBe(0);
    await bus.dispose();
    await expect(bus.start()).rejects.toThrow('disposed');
  });
});
