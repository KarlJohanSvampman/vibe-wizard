import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './AudioEngine.js';
import type { AudioRuntime } from './AudioRuntime.js';

function parameter(initial = 0) {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function node() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

function createHarness() {
  const sources: Array<ReturnType<typeof node> & {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    frequency: ReturnType<typeof parameter>;
    detune: ReturnType<typeof parameter>;
    onended: (() => void) | null;
    type: string;
  }> = [];
  const gains: Array<ReturnType<typeof node> & { gain: ReturnType<typeof parameter> }> = [];
  const context = {
    state: 'running',
    currentTime: 10,
    destination: node(),
    createGain: vi.fn(() => {
      const gain = Object.assign(node(), { gain: parameter() });
      gains.push(gain);
      return gain;
    }),
    createBiquadFilter: vi.fn(() => Object.assign(node(), {
      type: 'lowpass',
      frequency: parameter(),
      Q: parameter(),
    })),
    createOscillator: vi.fn(() => {
      const source = Object.assign(node(), {
        start: vi.fn(),
        stop: vi.fn(),
        frequency: parameter(),
        detune: parameter(),
        onended: null as (() => void) | null,
        type: 'sine',
      });
      sources.push(source);
      return source;
    }),
  };
  const runtime = {
    prepareContext: () => context,
    requireContext: () => context,
    start: vi.fn(async () => undefined),
    get context() { return context; },
    get currentTime() { return context.currentTime; },
    get isRunning() { return true; },
    toAudioTime: (timestamp: number) => Math.max(context.currentTime, timestamp),
    dispose: vi.fn(async () => undefined),
  } as unknown as AudioRuntime;
  return { context, runtime, sources, gains };
}

describe('AudioEngine voice lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('performance', { now: () => 10_000 });
  });

  it('keeps equal note IDs from different sources independent', async () => {
    const h = createHarness();
    const engine = new AudioEngine('synth-a', h.runtime);
    await engine.start();

    engine.noteOn({ kind: 'note-on', sourceId: 'keyboard', noteId: '60', pitch: 60, velocity: 1, timestamp: 10 });
    engine.noteOn({ kind: 'note-on', sourceId: 'sequencer', noteId: '60', pitch: 60, velocity: 1, timestamp: 10 });

    expect(engine.activeVoiceCount).toBe(2);
    engine.noteOff({ kind: 'note-off', sourceId: 'keyboard', noteId: '60', timestamp: 10.1 });
    expect(h.sources[0]!.stop).toHaveBeenCalled();
    expect(h.sources[1]!.stop).not.toHaveBeenCalled();
    await engine.dispose();
  });

  it('retriggering the same source and note immediately retires the previous voice', async () => {
    const h = createHarness();
    const engine = new AudioEngine('synth-b', h.runtime);
    await engine.start();

    const event = { kind: 'note-on' as const, sourceId: 'keyboard', noteId: 'C4', pitch: 60, velocity: 0.8, timestamp: 10 };
    engine.noteOn(event);
    engine.noteOn({ ...event, timestamp: 10.01 });

    expect(engine.activeVoiceCount).toBe(1);
    expect(h.sources[0]!.stop).toHaveBeenCalledOnce();
    expect(h.sources[0]!.disconnect).toHaveBeenCalledOnce();
    expect(h.sources[1]!.start).toHaveBeenCalledOnce();
    await engine.dispose();
  });

  it('steals a voice at the configured polyphony ceiling', async () => {
    const h = createHarness();
    const engine = new AudioEngine('synth-c', h.runtime);
    await engine.start();
    engine.setMaxPolyphony(2);

    for (const noteId of ['one', 'two', 'three']) {
      engine.noteOn({ kind: 'note-on', sourceId: 'test', noteId, pitch: 60, velocity: 0.7, timestamp: 10 });
    }

    expect(engine.activeVoiceCount).toBe(2);
    expect(h.sources[0]!.stop).toHaveBeenCalledOnce();
    expect(h.sources[2]!.start).toHaveBeenCalledOnce();
    await engine.dispose();
  });

  it('panic immediately stops and disconnects every voice', async () => {
    const h = createHarness();
    const engine = new AudioEngine('synth-d', h.runtime);
    await engine.start();
    engine.noteOn({ kind: 'note-on', sourceId: 'live', noteId: 'a', pitch: 60, velocity: 1, timestamp: 10 });
    engine.noteOn({ kind: 'note-on', sourceId: 'live', noteId: 'b', pitch: 62, velocity: 1, timestamp: 10 });

    engine.panic();

    expect(engine.activeVoiceCount).toBe(0);
    for (const source of h.sources) {
      expect(source.stop).toHaveBeenCalledOnce();
      expect(source.disconnect).toHaveBeenCalledOnce();
    }
    await engine.dispose();
  });

  it('disposal panics voices and disposes only an owned runtime', async () => {
    const h = createHarness();
    const engine = new AudioEngine('synth-e', h.runtime);
    await engine.start();
    engine.noteOn({ kind: 'note-on', sourceId: 'live', noteId: 'a', pitch: 60, velocity: 1, timestamp: 10 });

    await engine.dispose();
    await engine.dispose();

    expect(engine.activeVoiceCount).toBe(0);
    expect(h.sources[0]!.stop).toHaveBeenCalledOnce();
    expect(h.runtime.dispose).not.toHaveBeenCalled();
    expect(() => engine.noteOn({ kind: 'note-on', sourceId: 'live', noteId: 'b', pitch: 62, velocity: 1, timestamp: 10 })).toThrow();
  });
  
  it('reclaims completed voices and disconnects their graph nodes', async () => {
    const h = createHarness();
    const engine = new AudioEngine('synth-cleanup', h.runtime);
    await engine.start();
    engine.noteOn({ kind: 'note-on', sourceId: 'live', noteId: 'ended', pitch: 60, velocity: 1, timestamp: 10 });

    expect(engine.activeVoiceCount).toBe(1);
    h.sources[0]!.onended?.();

    expect(engine.activeVoiceCount).toBe(0);
    expect(h.sources[0]!.disconnect).toHaveBeenCalledOnce();
    expect(h.gains[1]!.disconnect).toHaveBeenCalledOnce();
    await engine.dispose();
  });

  it('panic stops autonomous drum one-shots', async () => {
    const h = createHarness();
    const engine = new AudioEngine('drums-panic', h.runtime, 'drums');
    await engine.start();
    engine.noteOn({ kind: 'note-on', sourceId: 'sequencer', noteId: 'kick', pitch: 36, velocity: 1, timestamp: 10 });

    engine.panic();

    expect(engine.activeVoiceCount).toBe(0);
    expect(h.sources[0]!.stop).toHaveBeenCalled();
    expect(h.sources[0]!.disconnect).toHaveBeenCalledOnce();
    await engine.dispose();
  });

  it('clamps configurable polyphony to the supported range', async () => {
    const h = createHarness();
    const engine = new AudioEngine('synth-bounds', h.runtime);
    await engine.start();

    engine.setMaxPolyphony(0);
    engine.noteOn({ kind: 'note-on', sourceId: 'test', noteId: 'a', pitch: 60, velocity: 1, timestamp: 10 });
    engine.noteOn({ kind: 'note-on', sourceId: 'test', noteId: 'b', pitch: 62, velocity: 1, timestamp: 10 });
    expect(engine.activeVoiceCount).toBe(1);

    engine.setMaxPolyphony(128);
    for (let index = 0; index < 128; index += 1) {
      engine.noteOn({ kind: 'note-on', sourceId: 'test', noteId: String(index), pitch: 60, velocity: 0.5, timestamp: 10 });
    }
    expect(engine.activeVoiceCount).toBe(128);
    await engine.dispose();
  });
});
