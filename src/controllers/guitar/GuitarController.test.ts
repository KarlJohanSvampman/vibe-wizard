import { describe, expect, it, vi } from 'vitest';
import { GuitarController } from './GuitarController.js';

describe('GuitarController', () => {
  it('selects one of six chord buttons and emits chord notes on a strum', () => {
    const emit = vi.fn();
    const guitar = new GuitarController({ sourceId: 'guitar', emit, now: () => 1 });
    guitar.selectChord('c');
    guitar.strum(undefined, 0.8, 1);
    expect(emit).toHaveBeenCalledTimes(10);
    expect(emit.mock.calls[0]?.[0]).toMatchObject({ kind: 'note-on', pitch: 48, velocity: 0.8 });
    expect(emit.mock.calls[1]?.[0]).toMatchObject({ kind: 'note-off' });
  });
  it('recognizes a fast swipe and rejects a short movement', () => {
    const emit = vi.fn();
    const guitar = new GuitarController({ sourceId: 'guitar', emit, now: () => 1 });
    guitar.beginStrum(0, 0, 1);
    expect(guitar.endStrum(0.01, 0.01, 1.1)).toBeUndefined();
    guitar.beginStrum(0, 0, 1);
    expect(guitar.endStrum(0, 0.3, 1.15)?.direction).toBe('down');
    expect(emit).toHaveBeenCalled();
  });
  it('allows chord assignments and rejects invalid buttons', () => {
    const guitar = new GuitarController({ sourceId: 'g', emit: () => undefined });
    guitar.assignChord(5, 'c');
    guitar.selectChord('c');
    expect(guitar.selectedChord.name).toBe('C');
    expect(() => guitar.assignChord(6, 'c')).toThrow(/between 0 and 5/);
  });
});
