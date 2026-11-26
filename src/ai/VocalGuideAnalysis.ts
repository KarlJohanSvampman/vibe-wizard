export interface VocalPhrase {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface VocalTempoCandidate {
  readonly bpm: number;
  readonly confidence: number;
}

export interface VocalAnalysisResult {
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly peakLevel: number;
  readonly averageLevel: number;
  readonly tempoCandidates: readonly VocalTempoCandidate[];
  readonly suggestedBpm?: number;
  readonly phrases: readonly VocalPhrase[];
  readonly analysisVersion: 1;
}

export interface VocalAnalysisOptions {
  readonly minBpm?: number;
  readonly maxBpm?: number;
  readonly envelopeRate?: number;
  readonly silenceThreshold?: number;
  readonly minPhraseSeconds?: number;
  readonly minGapSeconds?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Lightweight, dependency-free vocal guide analysis. Tempo is estimated from
 * the amplitude envelope; it is a suggestion, not a beat-tracking guarantee.
 * The original PCM is never modified.
 */
export function analyzeVocalGuide(
  pcm: Float32Array,
  sampleRate: number,
  options: VocalAnalysisOptions = {},
): VocalAnalysisResult {
  if (!(pcm instanceof Float32Array) || pcm.length === 0) {
    throw new Error('Choose a non-empty decoded audio file.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
    throw new Error('Audio sample rate must be between 8 kHz and 384 kHz.');
  }

  const envelopeRate = clamp(Math.round(options.envelopeRate ?? 100), 25, 200);
  const hopSize = Math.max(1, Math.round(sampleRate / envelopeRate));
  const envelope: number[] = [];
  let peak = 0;
  let sumSquares = 0;
  for (let start = 0; start < pcm.length; start += hopSize) {
    const end = Math.min(pcm.length, start + hopSize);
    let windowSquares = 0;
    for (let i = start; i < end; i += 1) {
      const sample = Number.isFinite(pcm[i]) ? pcm[i]! : 0;
      const magnitude = Math.abs(sample);
      peak = Math.max(peak, magnitude);
      windowSquares += sample * sample;
      sumSquares += sample * sample;
    }
    envelope.push(Math.sqrt(windowSquares / (end - start)));
  }

  const durationSeconds = pcm.length / sampleRate;
  const averageLevel = Math.sqrt(sumSquares / pcm.length);
  const minBpm = clamp(options.minBpm ?? 60, 40, 200);
  const maxBpm = clamp(options.maxBpm ?? 180, minBpm + 1, 240);
  const mean = envelope.reduce((total, value) => total + value, 0) / envelope.length;
  const centered = envelope.map(value => value - mean);
  const candidates: VocalTempoCandidate[] = [];

  if (durationSeconds >= 4 && mean > 0.0001) {
    const minLag = Math.max(1, Math.floor(envelopeRate * 60 / maxBpm));
    const maxLag = Math.min(envelope.length - 2, Math.ceil(envelopeRate * 60 / minBpm));
    const scores: Array<{ lag: number; score: number }> = [];
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let correlation = 0;
      let leftEnergy = 0;
      let rightEnergy = 0;
      for (let i = lag; i < centered.length; i += 1) {
        const left = centered[i]!;
        const right = centered[i - lag]!;
        correlation += left * right;
        leftEnergy += left * left;
        rightEnergy += right * right;
      }
      const score = leftEnergy > 0 && rightEnergy > 0
        ? correlation / Math.sqrt(leftEnergy * rightEnergy) : 0;
      scores.push({ lag, score });
    }
    scores.sort((a, b) => b.score - a.score);
    const selected: typeof scores = [];
    for (const item of scores) {
      if (selected.every(other => Math.abs(other.lag - item.lag) > 2)) selected.push(item);
      if (selected.length === 3) break;
    }
    const best = Math.max(0, selected[0]?.score ?? 0);
    for (const item of selected) {
      candidates.push({
        bpm: Math.round(envelopeRate * 60 / item.lag),
        confidence: Math.round(clamp(item.score / Math.max(best, 0.0001), 0, 1) * 100) / 100,
      });
    }
  }

  const threshold = Math.max(
    options.silenceThreshold ?? 0.012,
    envelope.reduce((sorted, value) => sorted + value, 0) / envelope.length * 0.16,
  );
  const minGapFrames = Math.max(1, Math.round((options.minGapSeconds ?? 0.32) * envelopeRate));
  const minPhraseFrames = Math.max(1, Math.round((options.minPhraseSeconds ?? 0.45) * envelopeRate));
  const active = envelope.map(value => value >= threshold);
  const raw: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let i = 0; i <= active.length; i += 1) {
    if (i < active.length && active[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      raw.push({ start, end: i });
      start = -1;
    }
  }
  const merged: Array<{ start: number; end: number }> = [];
  for (const phrase of raw) {
    const previous = merged[merged.length - 1];
    if (previous && phrase.start - previous.end <= minGapFrames) previous.end = phrase.end;
    else merged.push({ ...phrase });
  }
  const phrases = merged
    .filter(phrase => phrase.end - phrase.start >= minPhraseFrames)
    .map(phrase => ({
      startSeconds: Math.round(phrase.start / envelopeRate * 1000) / 1000,
      endSeconds: Math.round(Math.min(durationSeconds, phrase.end / envelopeRate) * 1000) / 1000,
    }));

  return {
    durationSeconds: Math.round(durationSeconds * 1000) / 1000,
    sampleRate,
    peakLevel: Math.round(peak * 10000) / 10000,
    averageLevel: Math.round(averageLevel * 10000) / 10000,
    tempoCandidates: candidates,
    ...(candidates[0] ? { suggestedBpm: candidates[0].bpm } : {}),
    phrases,
    analysisVersion: 1,
  };
}
