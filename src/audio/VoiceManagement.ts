export interface VoiceAllocationCandidate {
  readonly key: string;
  readonly startTime: number;
  readonly releaseTime?: number;
}

/**
 * Prefer reclaiming a voice already in its release phase; otherwise steal
 * the oldest voice. Stable key ordering makes ties deterministic.
 */
export function selectVoiceToSteal(
  voices: readonly VoiceAllocationCandidate[],
): string | undefined {
  if (voices.length === 0) return undefined;
  const ordered = [...voices].sort((a, b) => {
    const aReleasing = a.releaseTime === undefined ? 1 : 0;
    const bReleasing = b.releaseTime === undefined ? 1 : 0;
    return aReleasing - bReleasing ||
      a.startTime - b.startTime ||
      a.key.localeCompare(b.key);
  });
  return ordered[0]?.key;
}

export function voiceKey(sourceId: string, noteId: string): string {
  return sourceId + '\u0000' + noteId;
}

export function defaultPolyphony(instrumentType: string): number {
  return instrumentType === 'drums' ? 32 : 16;
}
