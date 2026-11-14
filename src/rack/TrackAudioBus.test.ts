import { describe, expect, it, vi } from 'vitest';
import { TrackAudioBus } from './TrackAudioBus.js';
import type { AudioRuntime } from '../audio/AudioRuntime.js';

describe('TrackAudioBus', () => {
  it('keeps track level and pan independent and applies smooth parameter changes', async () => {
    const volume = { value: 0, setTargetAtTime: vi.fn() };
    const pan = { value: 0, setTargetAtTime: vi.fn() };
    const input = {
      gain: volume,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const panner = {
      pan,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const context = {
      createGain: vi.fn(() => input),
      createStereoPanner: vi.fn(() => panner),
      destination: {},
    };
    const runtime = {
      prepareContext: () => context,
      toAudioTime: (timestamp: number) => timestamp + 1,
    } as unknown as AudioRuntime;
    const bus = new TrackAudioBus('track-bus-test', runtime);

    await bus.start();
    expect(volume.value).toBe(0.8);
    expect(pan.value).toBe(0);
    expect(input.connect).toHaveBeenCalledWith(panner);
    expect(panner.connect).toHaveBeenCalledWith(context.destination);

    bus.setParameter('volume', 0.4, 10);
    bus.setParameter('pan', -0.6, 10.5);
    expect(volume.setTargetAtTime).toHaveBeenCalledWith(0.4, 11, 0.015);
    expect(pan.setTargetAtTime).toHaveBeenCalledWith(-0.6, 11.5, 0.015);

    await bus.dispose();
    expect(input.disconnect).toHaveBeenCalledTimes(1);
    expect(panner.disconnect).toHaveBeenCalledOnce();
  });

  it('clamps fader values to their declared parameter ranges', async () => {
    const volume = { value: 0, setTargetAtTime: vi.fn() };
    const pan = { value: 0, setTargetAtTime: vi.fn() };
    const input = { gain: volume, connect: vi.fn(), disconnect: vi.fn() };
    const panner = { pan, connect: vi.fn(), disconnect: vi.fn() };
    const context = {
      createGain: () => input,
      createStereoPanner: () => panner,
      destination: {},
    };
    const runtime = {
      prepareContext: () => context,
      toAudioTime: (timestamp: number) => timestamp,
    } as unknown as AudioRuntime;
    const bus = new TrackAudioBus('track-bus-clamp', runtime);
    await bus.start();

    bus.setParameter('volume', 2, 0);
    bus.setParameter('pan', -2, 0);

    expect(volume.setTargetAtTime).toHaveBeenCalledWith(1, 0, 0.015);
    expect(pan.setTargetAtTime).toHaveBeenCalledWith(-1, 0, 0.015);
  });
});
