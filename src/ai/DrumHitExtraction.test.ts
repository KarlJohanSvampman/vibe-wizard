import { describe, expect, it } from 'vitest';
import { detectDrumHits, encodeMonoWav } from './DrumHitExtraction.js';

describe('detectDrumHits', () => {
  it('finds distinct transient peaks and creates bounded sample regions', () => {
    const sampleRate = 10000;
    const pcm = new Float32Array(sampleRate * 2);
    for (const at of [0.2, 0.7, 1.3]) {
      const start = Math.floor(at * sampleRate);
      for (let i = 0; i < 80; i += 1) pcm[start + i] = Math.sin(i * 0.4) * (1 - i / 100);
    }
    const hits = detectDrumHits(pcm, sampleRate, { threshold: 0.02, minGapMs: 120, tailMs: 250 });
    expect(hits).toHaveLength(3);
    expect(hits[0]!.startSample).toBeLessThan(2000);
    expect(hits[2]!.endSample).toBeLessThanOrEqual(pcm.length);
  });

  it('returns no regions for silence', () => {
    expect(detectDrumHits(new Float32Array(10000), 10000)).toEqual([]);
  });
});

describe('encodeMonoWav', () => {
  it('writes a valid PCM WAV header and samples', () => {
    const wav = encodeMonoWav(new Float32Array([-1, 0, 1]), 44100);
    const view = new DataView(wav);
    expect(String.fromCharCode(...new Uint8Array(wav.slice(0, 4)))).toBe('RIFF');
    expect(String.fromCharCode(...new Uint8Array(wav.slice(8, 12)))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(6);
  });
});
