import { describe, expect, it, vi } from 'vitest';
import { TurntableDeck } from './TurntableDeck.js';

describe('TurntableDeck', () => {
  it('requires a loaded sample and clamps scratch positions', () => {
    const runtime = { prepareContext: () => ({ currentTime: 0, createGain: () => ({}), createBufferSource: () => ({}) }) } as never;
    const deck = new TurntableDeck(runtime);
    expect(() => deck.play()).toThrow(/load a sample/i);
    expect(deck.isLoaded).toBe(false);
  });
});
