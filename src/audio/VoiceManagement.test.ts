import { describe, expect, it } from 'vitest';
import { defaultPolyphony, selectVoiceToSteal, voiceKey } from './VoiceManagement.js';

describe('voice allocation policy', () => {
  it('prefers the oldest voice already in its release phase', () => {
    expect(selectVoiceToSteal([
      { key: 'newest', startTime: 3 },
      { key: 'oldest-active', startTime: 1 },
      { key: 'releasing', startTime: 2, releaseTime: 4 },
    ])).toBe('releasing');
  });

  it('steals the oldest active voice when none are releasing', () => {
    expect(selectVoiceToSteal([
      { key: 'later', startTime: 2 },
      { key: 'earlier', startTime: 1 },
    ])).toBe('earlier');
  });

  it('uses a stable key to break equal-time ties', () => {
    expect(selectVoiceToSteal([
      { key: 'z', startTime: 1 },
      { key: 'a', startTime: 1 },
    ])).toBe('a');
  });

  it('returns no victim for an empty allocation', () => {
    expect(selectVoiceToSteal([])).toBeUndefined();
  });

  it('keeps note IDs unique across independent event sources', () => {
    expect(voiceKey('live', 'same')).not.toBe(voiceKey('sequencer', 'same'));
    expect(voiceKey('live', 'same')).toBe(voiceKey('live', 'same'));
  });

  it('uses bounded defaults for each instrument family', () => {
    expect(defaultPolyphony('synth')).toBe(16);
    expect(defaultPolyphony('piano')).toBe(16);
    expect(defaultPolyphony('sampler')).toBe(16);
    expect(defaultPolyphony('drums')).toBe(32);
  });
});
