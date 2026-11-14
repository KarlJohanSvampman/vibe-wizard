import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControlSignal, NoteOffEvent, NoteOnEvent } from '../audio/events.js';
import { ParameterBus } from '../rack/ParameterBus.js';
import type { ParameterTarget } from '../rack/types.js';
import type { RecordingClip } from './Recorder.js';
import { SequencerTransport } from './SequencerTransport.js';

class FakeAudio {
  readonly notesOn: NoteOnEvent[] = [];
  readonly notesOff: NoteOffEvent[] = [];

  get isRunning(): boolean { return true; }
  get currentTime(): number { return performance.now() / 1000; }

  performanceTimeForAudioTime(audioTime: number): number { return audioTime; }
  noteOn(event: NoteOnEvent): void { this.notesOn.push(event); }
  noteOff(event: NoteOffEvent): void { this.notesOff.push(event); }
}

class TestTarget implements ParameterTarget {
  readonly values: number[] = [];
  constructor(readonly id: string) {}
  setParameter(_parameterId: string, value: number): void { this.values.push(value); }
}

afterEach(() => vi.useRealTimers());

describe('SequencerTransport', () => {
  it('schedules notes and routes recorded controller automation', () => {
    vi.useFakeTimers();
    const audio = new FakeAudio();
    const bus = new ParameterBus();
    const target = new TestTarget('synth');
    bus.registerTarget(target);
    bus.addMapping({
      id: 'x-to-pitch',
      sourceModuleId: 'theremin',
      sourcePortId: 'x',
      targetModuleId: 'synth',
      targetParameterId: 'pitch',
      inputRange: [0, 1],
      outputRange: [48, 84],
      curve: 'linear',
      invert: false,
      deadZone: 0,
      smoothingMs: 0,
    });

    const clip: RecordingClip = {
      id: 'clip-1',
      durationSeconds: 0.2,
      events: [
        {
          offsetSeconds: 0,
          event: {
            kind: 'note-on',
            sourceId: 'theremin',
            noteId: 'note-1',
            pitch: 66,
            velocity: 0.7,
            timestamp: 1,
          },
        },
        {
          offsetSeconds: 0.04,
          event: {
            kind: 'control',
            sourceId: 'theremin',
            portId: 'x',
            value: 0.5,
            min: 0,
            max: 1,
            timestamp: 1.04,
          } satisfies ControlSignal,
        },
        {
          offsetSeconds: 0.1,
          event: {
            kind: 'note-off',
            sourceId: 'theremin',
            noteId: 'note-1',
            timestamp: 1.1,
          },
        },
      ],
    };

    const transport = new SequencerTransport(audio, bus);
    transport.play(clip);
    expect(transport.currentState).toBe('playing');
    expect(audio.notesOn).toHaveLength(1);
    expect(audio.notesOn[0]?.sourceId).toBe('sequencer');
    // Later clip events enter the look-ahead window on subsequent scheduler ticks.
    expect(target.values).toEqual([]);
    expect(audio.notesOff).toHaveLength(0);

    vi.advanceTimersByTime(125);
    expect(target.values).toEqual([66]);
    expect(audio.notesOff).toHaveLength(1);

    vi.advanceTimersByTime(500);
    expect(transport.currentState).toBe('completed');
    transport.dispose();
  });

  it('releases notes left active when a shortened clip reaches its end', () => {
    vi.useFakeTimers();
    const audio = new FakeAudio();
    const clip: RecordingClip = {
      id: 'trimmed',
      durationSeconds: 0.05,
      events: [{
        offsetSeconds: 0,
        event: {
          kind: 'note-on', sourceId: 'theremin', noteId: 'held',
          pitch: 60, velocity: 1, timestamp: 1,
        },
      }],
    };
    const transport = new SequencerTransport(audio, new ParameterBus());
    transport.play(clip);
    vi.advanceTimersByTime(250);
    expect(transport.currentState).toBe('completed');
    expect(audio.notesOff).toHaveLength(1);
    transport.dispose();
  });

  it('releases queued playback notes when Stop is pressed', () => {
    vi.useFakeTimers();
    const audio = new FakeAudio();
    const bus = new ParameterBus();
    const clip: RecordingClip = {
      id: 'held',
      durationSeconds: 2,
      events: [{
        offsetSeconds: 0,
        event: {
          kind: 'note-on',
          sourceId: 'theremin',
          noteId: 'held-note',
          pitch: 60,
          velocity: 1,
          timestamp: 1,
        },
      }],
    };

    const transport = new SequencerTransport(audio, bus);
    transport.play(clip);
    expect(audio.notesOn).toHaveLength(1);
    transport.stop();
    expect(audio.notesOff).toHaveLength(1);
    expect(transport.currentState).toBe('stopped');
    transport.dispose();
  });
});
