export interface DrumHitRegion {
  readonly startSample: number;
  readonly endSample: number;
  readonly peak: number;
  readonly strength: number;
}
export interface DrumHitOptions {
  readonly threshold?: number;
  readonly minGapMs?: number;
  readonly tailMs?: number;
  readonly maxHits?: number;
}

/** Detects transient onsets from a mono drum-stem envelope. It does not classify kick/snare/hat. */
export function detectDrumHits(pcm: Float32Array, sampleRate: number, options: DrumHitOptions = {}): DrumHitRegion[] {
  if (!(pcm instanceof Float32Array) || !pcm.length) throw new Error('A non-empty drum stem is required.');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new Error('Invalid drum stem sample rate.');
  const frame = Math.max(1, Math.round(sampleRate * 0.01));
  const rms: number[] = [];
  for (let start = 0; start < pcm.length; start += frame) {
    let energy = 0;
    const end = Math.min(pcm.length, start + frame);
    for (let i = start; i < end; i += 1) { const v = Number.isFinite(pcm[i]) ? pcm[i]! : 0; energy += v * v; }
    rms.push(Math.sqrt(energy / (end - start)));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const percentile = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const floor = percentile(0.35);
  const ceiling = percentile(0.98);
  const threshold = Math.max(options.threshold ?? 0.018, floor + (ceiling - floor) * 0.16);
  const minGap = Math.max(1, Math.round((options.minGapMs ?? 90) / 10));
  const tailFrames = Math.max(1, Math.round((options.tailMs ?? 360) / 10));
  const candidates: Array<{ frame: number; strength: number }> = [];
  for (let i = 1; i < rms.length - 1; i += 1) {
    const value = rms[i] ?? 0;
    if (value >= threshold && value >= (rms[i - 1] ?? 0) && value > (rms[i + 1] ?? 0)) {
      candidates.push({ frame: i, strength: value });
    }
  }
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const previous = selected[selected.length - 1];
    if (previous && candidate.frame - previous.frame < minGap) {
      if (candidate.strength > previous.strength) selected[selected.length - 1] = candidate;
    } else selected.push(candidate);
  }
  const maxHits = Math.max(1, Math.min(128, Math.round(options.maxHits ?? 64)));
  return selected.slice(0, maxHits).map((hit, index) => {
    const startSample = Math.max(0, hit.frame * frame - Math.round(sampleRate * 0.008));
    const next = selected[index + 1];
    const endSample = Math.min(pcm.length, Math.max(startSample + 1, Math.min((hit.frame + tailFrames) * frame, next ? next.frame * frame - Math.round(sampleRate * 0.015) : pcm.length)));
    return { startSample, endSample, peak: hit.strength, strength: Math.round(Math.min(1, hit.strength / Math.max(ceiling, 0.0001)) * 100) / 100 };
  }).filter(hit => hit.endSample - hit.startSample >= Math.round(sampleRate * 0.04));
}

/** Encodes mono PCM as a standards-compliant 16-bit WAV file. */
export function encodeMonoWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  if (!pcm.length || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new Error('Invalid PCM data.');
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string): void => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, Number.isFinite(pcm[i]) ? pcm[i]! : 0));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return buffer;
}

export type DrumHitType = 'kick' | 'snare' | 'hi-hat' | 'percussion' | 'unknown';

export interface DrumHitClassification {
  readonly suggestedType: DrumHitType;
  /** Heuristic confidence, not a calibrated probability. */
  readonly confidence: number;
  readonly lowRatio: number;
  readonly midRatio: number;
  readonly highRatio: number;
  readonly durationMs: number;
}

/**
 * Suggests a broad drum family from spectral balance and decay.
 * This is deliberately advisory: real drum sounds overlap and must be checked by ear.
 */
export function classifyDrumHit(pcm: Float32Array, sampleRate: number): DrumHitClassification {
  if (!(pcm instanceof Float32Array) || pcm.length < 16) throw new Error('A non-empty drum hit is required.');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new Error('Invalid drum hit sample rate.');

  const alphaLow = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  const alphaHigh = 1 - Math.exp((-2 * Math.PI * 4000) / sampleRate);
  let lowState = 0;
  let broadState = 0;
  let lowEnergy = 0;
  let midEnergy = 0;
  let highEnergy = 0;
  let totalEnergy = 0;
  let firstActive = -1;
  let lastActive = -1;
  const peak = pcm.reduce((max, value, index) => {
    const magnitude = Math.abs(Number.isFinite(value) ? value : 0);
    if (magnitude > max) return magnitude;
    return max;
  }, 0);
  const gate = Math.max(0.002, peak * 0.08);

  for (let i = 0; i < pcm.length; i += 1) {
    const sample = Number.isFinite(pcm[i]) ? pcm[i]! : 0;
    lowState += alphaLow * (sample - lowState);
    broadState += alphaHigh * (sample - broadState);
    const low = lowState;
    const mid = broadState - lowState;
    const high = sample - broadState;
    lowEnergy += low * low;
    midEnergy += mid * mid;
    highEnergy += high * high;
    totalEnergy += sample * sample;
    if (Math.abs(sample) >= gate) {
      if (firstActive < 0) firstActive = i;
      lastActive = i;
    }
  }

  const denominator = Math.max(totalEnergy, 1e-12);
  const lowRatio = lowEnergy / denominator;
  const midRatio = midEnergy / denominator;
  const highRatio = highEnergy / denominator;
  const durationMs = firstActive < 0 ? 0 : ((lastActive - firstActive + 1) / sampleRate) * 1000;

  let suggestedType: DrumHitType = 'percussion';
  let confidence = 0.42;
  if (peak < 0.005 || totalEnergy < 1e-8) {
    suggestedType = 'unknown';
    confidence = 0.2;
  } else if (lowRatio > 0.48 && highRatio < 0.22) {
    suggestedType = 'kick';
    confidence = Math.min(0.9, 0.5 + (lowRatio - 0.48) * 0.65);
  } else if (highRatio > 0.38 && durationMs < 220) {
    suggestedType = 'hi-hat';
    confidence = Math.min(0.88, 0.5 + (highRatio - 0.38) * 0.55);
  } else if (midRatio > 0.35 && highRatio > 0.12) {
    suggestedType = 'snare';
    confidence = Math.min(0.82, 0.48 + (midRatio - 0.35) * 0.5);
  }
  return {
    suggestedType,
    confidence: Math.round(confidence * 100) / 100,
    lowRatio: Math.round(lowRatio * 1000) / 1000,
    midRatio: Math.round(midRatio * 1000) / 1000,
    highRatio: Math.round(highRatio * 1000) / 1000,
    durationMs: Math.round(durationMs * 10) / 10,
  };
}
