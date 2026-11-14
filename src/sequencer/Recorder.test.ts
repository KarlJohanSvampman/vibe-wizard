import { describe, expect, it } from 'vitest';
import { EventRecorder } from './Recorder.js';

describe('EventRecorder', () => {
  it('records notes and controller automation relative to recording start', () => {
    const recorder = new EventRecorder();
    recorder.start(10);

    recorder.record({
      kind: 'control',
      sourceId: 'theremin',
      portId: 'x',
      value: 0.25,
      min: 0,
      max: 1,
      timestamp: 10.2,
    });
    recorder.record({
      kind: 'note-on',
      sourceId: 'theremin',
      noteId: 'note-1',
      pitch: 60,
      velocity: 0.8,
      timestamp: 10.25,
    });
    recorder.record({
      kind: 'note-off',
      sourceId: 'theremin',
      noteId: 'note-1',
      timestamp: 10.5,
    });

    const clip = recorder.stop(10.6, 'clip-test');
    expect(clip?.durationSeconds).toBeCloseTo(0.6);
    const offsets = clip?.events.map(item => item.offsetSeconds) ?? [];
    expect(offsets).toHaveLength(3);
    expect(offsets[0]).toBeCloseTo(0.2);
    expect(offsets[1]).toBeCloseTo(0.25);
    expect(offsets[2]).toBeCloseTo(0.5);
    expect(clip?.events[0]?.event.kind).toBe('control');
  });

  it('rejects events before recording starts and ignores events after stop', () => {
    const recorder = new EventRecorder();
    recorder.start(5);
    expect(recorder.record({
      kind: 'control',
      sourceId: 'theremin',
      portId: 'x',
      value: 0.5,
      min: 0,
      max: 1,
      timestamp: 4.99,
    })).toBe(false);
    expect(recorder.stop(5, 'empty')?.events).toEqual([]);
    expect(recorder.record({
      kind: 'control',
      sourceId: 'theremin',
      portId: 'x',
      value: 0.5,
      min: 0,
      max: 1,
      timestamp: 5.1,
    })).toBe(false);
  });

  it('automatically closes notes still held when recording stops', () => {
    const recorder = new EventRecorder();
    recorder.start(20);
    recorder.record({
      kind: 'note-on',
      sourceId: 'piano',
      noteId: 'held-note',
      pitch: 64,
      velocity: 1,
      timestamp: 20.1,
    });

    const clip = recorder.stop(20.8, 'closed-note');
    expect(clip?.events).toHaveLength(2);
    expect(clip?.events[1]?.event).toMatchObject({
      kind: 'note-off',
      sourceId: 'piano',
      noteId: 'held-note',
      timestamp: 20.8,
    });
  });
});
