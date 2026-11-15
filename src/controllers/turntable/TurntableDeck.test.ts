import { describe, expect, it, vi } from 'vitest';
import { TurntableDeck } from './TurntableDeck.js';

function makeParam(value = 1) {
  return {
    value,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
  };
}

function makeHarness() {
  let now = 10;
  const sources: Array<Record<string, any>> = [];
  const gains: Array<Record<string, any>> = [];
  const destination = {} as AudioNode;
  const context = {
    get currentTime() { return now; },
    destination,
    createGain: vi.fn(() => {
      const node = {
        gain: makeParam(0.9),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(node);
      return node;
    }),
    createBufferSource: vi.fn(() => {
      const node: Record<string, any> = {
        playbackRate: makeParam(1),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      sources.push(node);
      return node;
    }),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
        getChannelData: (channel: number) => data[channel]!,
      };
    }),
  };
  const runtime = { prepareContext: () => context } as never;
  const bufferData = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const buffer = {
    numberOfChannels: 1, length: 4, sampleRate: 4, duration: 1,
    getChannelData: () => bufferData,
  } as unknown as AudioBuffer;
  return {
    deck: new TurntableDeck(runtime),
    context,
    sources,
    gains,
    buffer,
    destination,
    setTime: (value: number) => { now = value; },
  };
}

describe('TurntableDeck', () => {
  it('requires a loaded sample before playing', () => {
    const { deck } = makeHarness();
    expect(() => deck.play()).toThrow(/load a sample/i);
    expect(deck.isLoaded).toBe(false);
  });

  it('plays forward from the requested offset and can route to a track node', () => {
    const h = makeHarness();
    const trackInput = {} as AudioNode;
    h.deck.load(h.buffer);
    h.deck.connectOutput(trackInput);
    h.deck.play(0.25);
    expect(h.sources[0]!.buffer).toBe(h.buffer);
    expect(h.sources[0]!.start).toHaveBeenCalledWith(10, 0.25);
    expect(h.gains[0]!.connect).toHaveBeenCalledWith(trackInput);
    expect(h.deck.isPlaying).toBe(true);
  });

  it('builds and plays a reversed buffer without using an invalid end offset', () => {
    const h = makeHarness();
    h.deck.load(h.buffer);
    h.deck.setSpeed(-1);
    h.deck.play(0);
    const reversed = h.sources[0]!.buffer as AudioBuffer;
    expect(Array.from(reversed.getChannelData(0))).toEqual(expect.arrayContaining([expect.closeTo(0.4, 5), expect.closeTo(0.3, 5), expect.closeTo(0.2, 5), expect.closeTo(0.1, 5)]));
    expect(h.sources[0]!.start).toHaveBeenCalledWith(10, 0.99);
    expect(h.sources[0]!.playbackRate.setValueAtTime).toHaveBeenCalledWith(1, 10);
  });

  it('tracks position using elapsed audio time and preserves it when paused at zero speed', () => {
    const h = makeHarness();
    h.deck.load(h.buffer);
    h.deck.play(0.2);
    h.setTime(10.3);
    expect(h.deck.currentPosition()).toBeCloseTo(0.5);
    h.deck.setSpeed(0);
    expect(h.deck.isPlaying).toBe(false);
    expect(h.deck.currentPosition()).toBeCloseTo(0.5);
  });

  it('does not start playback when speed is zero', () => {
    const h = makeHarness();
    h.deck.load(h.buffer);
    h.deck.setSpeed(0);
    h.deck.play();
    expect(h.sources).toHaveLength(0);
    expect(h.deck.isPlaying).toBe(false);
  });

  it('crossfades when scratching during playback', () => {
    const h = makeHarness();
    h.deck.load(h.buffer);
    h.deck.play();
    h.deck.scratch(0.6);
    expect(h.sources).toHaveLength(2);
    expect(h.sources[0]!.stop).toHaveBeenCalledWith(10.016);
    expect(h.sources[1]!.start).toHaveBeenCalledWith(10.006, 0.6);
    expect(h.gains[0]!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.0001, 10.012);
    expect(h.deck.currentPosition()).toBeCloseTo(0.6);
  });

  it('leaves the platter at the end when forward playback completes', () => {
    const h = makeHarness();
    h.deck.load(h.buffer);
    h.deck.play(0.8);
    h.sources[0]!.onended();
    expect(h.deck.isPlaying).toBe(false);
    expect(h.deck.currentPosition()).toBeCloseTo(0.99);
  });

  it('stops and disconnects active audio nodes', () => {
    const h = makeHarness();
    h.deck.load(h.buffer);
    h.deck.play();
    h.deck.stop();
    expect(h.sources[0]!.stop).toHaveBeenCalled();
    expect(h.sources[0]!.disconnect).toHaveBeenCalled();
    expect(h.gains[0]!.disconnect).toHaveBeenCalled();
    expect(h.deck.isPlaying).toBe(false);
  });
});
