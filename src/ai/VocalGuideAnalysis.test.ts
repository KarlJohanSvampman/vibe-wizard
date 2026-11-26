import { describe, expect, it } from 'vitest';
import { analyzeVocalGuide } from './VocalGuideAnalysis.js';

function pulseTrain(bpm: number, seconds: number, sampleRate = 8000): Float32Array {
  const pcm = new Float32Array(Math.floor(seconds * sampleRate));
  const beatSamples = Math.round(sampleRate * 60 / bpm);
  for (let beat = 0; beat < seconds * bpm / 60; beat += 1) {
    const start = beat * beatSamples;
    for (let i = 0; i < Math.min(500, pcm.length - start); i += 1) {
      const envelope = Math.exp(-i / 100);
      pcm[start + i] = Math.sin(i * 0.18) * envelope * 0.8;
    }
  }
  return pcm;
}

describe('vocal guide analysis', () => {
  it('suggests a tempo from a pulsed vocal-like amplitude envelope', () => {
    const result = analyzeVocalGuide(pulseTrain(120, 16), 8000);
    expect(result.durationSeconds).toBe(16);
    expect(result.suggestedBpm).toBeDefined();
    expect(Math.min(...result.tempoCandidates.map(item => Math.abs(item.bpm - 120)))).toBeLessThanOrEqual(2);
  });

  it('finds separated vocal phrases and preserves source metadata', () => {
    const sampleRate = 8000;
    const pcm = new Float32Array(sampleRate * 4);
    for (const [from, to] of [[0.2, 1.1], [2.1, 3.4]]) {
      for (let i = Math.floor(from * sampleRate); i < Math.floor(to * sampleRate); i += 1) {
        pcm[i] = Math.sin(i * 0.04) * 0.35;
      }
    }
    const result = analyzeVocalGuide(pcm, sampleRate, { minGapSeconds: 0.25 });
    expect(result.phrases).toHaveLength(2);
    expect(result.phrases[0]!.startSeconds).toBeCloseTo(0.2, 1);
    expect(result.phrases[1]!.startSeconds).toBeCloseTo(2.1, 1);
    expect(result.peakLevel).toBeGreaterThan(0);
    expect(result.averageLevel).toBeGreaterThan(0);
  });

  it('rejects invalid input and does not invent tempo for silence', () => {
    expect(() => analyzeVocalGuide(new Float32Array(), 44100)).toThrow(/non-empty/i);
    expect(() => analyzeVocalGuide(new Float32Array(100), 1000)).toThrow(/sample rate/i);
    const silence = analyzeVocalGuide(new Float32Array(44100 * 5), 44100);
    expect(silence.suggestedBpm).toBeUndefined();
    expect(silence.phrases).toEqual([]);
  });
});
