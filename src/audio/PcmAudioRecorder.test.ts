import { describe, expect, it, vi } from 'vitest';
import { PcmAudioRecorder } from './PcmAudioRecorder.js';

function makeHarness() {
  let process: ((event: AudioProcessingEvent) => void) | null = null;
  const processor = {
    set onaudioprocess(callback: ((event: AudioProcessingEvent) => void) | null) { process = callback; },
    get onaudioprocess() { return process; },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const silentGain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const destination = {};
  const context = {
    state: 'running',
    sampleRate: 48000,
    destination,
    createScriptProcessor: vi.fn(() => processor),
    createGain: vi.fn(() => silentGain),
  } as unknown as AudioContext;
  const source = { connect: vi.fn() } as unknown as AudioNode;
  return {
    recorder: new PcmAudioRecorder(context, source),
    processor,
    source,
    silentGain,
    emit(left: number[], right: number[]) {
      const inputBuffer = {
        numberOfChannels: 2,
        length: left.length,
        getChannelData: (channel: number) => new Float32Array(channel === 0 ? left : right),
      };
      process?.({ inputBuffer } as AudioProcessingEvent);
    },
  };
}

describe('PcmAudioRecorder', () => {
  it('captures stereo samples and encodes a valid 16-bit PCM WAV', () => {
    const h = makeHarness();
    h.emit([0, 0.5, -1], [1, -0.5, 0]);
    const wav = h.recorder.stop();
    const view = new DataView(wav);
    const bytes = new Uint8Array(wav);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
    expect([...Array.from({ length: 6 }, (_, index) => view.getInt16(44 + index * 2, true))])
      .toEqual([0, 32767, 16383, -16384, -32768, 0]);
    expect(h.source.connect).toHaveBeenCalledWith(h.processor);
    expect(h.processor.disconnect).toHaveBeenCalled();
    expect(h.silentGain.disconnect).toHaveBeenCalled();
  });

  it('duplicates mono input into both output channels', () => {
    const h = makeHarness();
    h.emit([0.25, -0.25], [0.25, -0.25]);
    const wav = h.recorder.stop();
    const view = new DataView(wav);
    expect(view.getInt16(44, true)).toBe(8191);
    expect(view.getInt16(46, true)).toBe(8191);
  });

  it('rejects an empty recording and rejects a closed audio context', () => {
    const h = makeHarness();
    expect(() => h.recorder.stop()).toThrow(/no audio was captured/i);
    expect(() => new PcmAudioRecorder({ state: 'closed' } as AudioContext, {} as AudioNode))
      .toThrow(/audio context is closed/i);
  });
});
