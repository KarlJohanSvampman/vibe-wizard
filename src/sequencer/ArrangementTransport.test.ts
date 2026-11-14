import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControlSignal, NoteOffEvent, NoteOnEvent } from '../audio/events.js';
import { addInstrumentTrack, createDefaultProject } from '../project/ProjectModel.js';
import type { ProjectSnapshot } from '../project/ProjectModel.js';
import { ParameterBus } from '../rack/ParameterBus.js';
import type { ParameterTarget } from '../rack/types.js';
import type { ArrangementAudioClock, ArrangementTrackSink } from './ArrangementTransport.js';
import { ArrangementTransport } from './ArrangementTransport.js';

class FakeClock implements ArrangementAudioClock {
  time = 0;
  running = true;
  get isRunning(): boolean { return this.running; }
  get currentTime(): number { return this.time; }
  performanceTimeForAudioTime(audioTime: number): number { return 100 + audioTime; }
}

class FakeInstrument implements ArrangementTrackSink {
  readonly notesOn: NoteOnEvent[] = [];
  readonly notesOff: NoteOffEvent[] = [];
  noteOn(event: NoteOnEvent): void { this.notesOn.push(event); }
  noteOff(event: NoteOffEvent): void { this.notesOff.push(event); }
}

class TestTarget implements ParameterTarget {
  readonly values: number[] = [];
  constructor(readonly id: string) {}
  setParameter(_parameterId: string, value: number): void { this.values.push(value); }
}

const event = (
  offsetSeconds: number,
  musicalEvent: ControlSignal | NoteOnEvent | NoteOffEvent,
) => ({ offsetSeconds, event: musicalEvent });

afterEach(() => vi.useRealTimers());

describe('ArrangementTransport', () => {
  it('schedules clips from multiple tracks against one shared start clock', () => {
    vi.useFakeTimers();
    const firstProject = createDefaultProject('synth-one');
    const project = addInstrumentTrack(firstProject, 'Second track', 'synth-two');
    const firstTrack = project.tracks.find(track => track.id === firstProject.activeTrackId)!;
    const secondTrack = project.tracks.find(track => track.id === project.activeTrackId)!;
    const arranged: ProjectSnapshot = {
      ...project,
      clips: [
        {
          id: 'clip-one',
          name: 'First performance',
          trackId: firstTrack.id,
          startSeconds: 0,
          createdAt: new Date().toISOString(),
          durationSeconds: 0.25,
          events: [
            event(0, {
              kind: 'note-on',
              sourceId: 'theremin-main',
              noteId: 'one-note',
              pitch: 60,
              velocity: 0.8,
              timestamp: 1,
            }),
            event(0.05, {
              kind: 'control',
              sourceId: 'theremin-main',
              portId: 'x',
              value: 0.5,
              min: 0,
              max: 1,
              timestamp: 1.05,
            }),
            event(0.2, {
              kind: 'note-off',
              sourceId: 'theremin-main',
              noteId: 'one-note',
              timestamp: 1.2,
            }),
          ],
        },
        {
          id: 'clip-two',
          name: 'Second performance',
          trackId: secondTrack.id,
          startSeconds: 0.5,
          createdAt: new Date().toISOString(),
          durationSeconds: 0.25,
          events: [
            event(0, {
              kind: 'note-on',
              sourceId: 'theremin-main',
              noteId: 'two-note',
              pitch: 72,
              velocity: 0.7,
              timestamp: 2,
            }),
            event(0.2, {
              kind: 'note-off',
              sourceId: 'theremin-main',
              noteId: 'two-note',
              timestamp: 2.2,
            }),
          ],
        },
      ],
    };
    const clock = new FakeClock();
    const bus = new ParameterBus();
    const firstTarget = new TestTarget(firstTrack.instrumentModuleId);
    const secondTarget = new TestTarget(secondTrack.instrumentModuleId);
    bus.registerTarget(firstTarget);
    bus.registerTarget(secondTarget);
    for (const target of [firstTarget, secondTarget]) {
      bus.addMapping({
        id: 'x-to-' + target.id,
        sourceModuleId: 'theremin-main',
        sourcePortId: 'x',
        targetModuleId: target.id,
        targetParameterId: 'pitch',
        inputRange: [0, 1],
        outputRange: [48, 84],
        curve: 'linear',
        invert: false,
        deadZone: 0,
        smoothingMs: 0,
      });
    }

    const firstInstrument = new FakeInstrument();
    const secondInstrument = new FakeInstrument();
    const sinks = new Map<string, ArrangementTrackSink>([
      [firstTrack.id, firstInstrument],
      [secondTrack.id, secondInstrument],
    ]);
    const transport = new ArrangementTransport(clock, bus);

    transport.play(arranged, sinks);
    expect(transport.currentState).toBe('playing');
    expect(firstInstrument.notesOn).toHaveLength(1);
    expect(firstInstrument.notesOn[0]?.timestamp).toBeCloseTo(100.12, 5);
    expect(secondInstrument.notesOn).toHaveLength(0);

    clock.time = 0.05;
    vi.advanceTimersByTime(25);
    expect(firstTarget.values).toEqual([66]);
    expect(secondTarget.values).toEqual([]);

    clock.time = 0.4;
    vi.advanceTimersByTime(25);
    expect(firstInstrument.notesOff).toHaveLength(1);
    expect(secondInstrument.notesOn).toHaveLength(0);

    clock.time = 0.5;
    vi.advanceTimersByTime(25);
    expect(secondInstrument.notesOn).toHaveLength(1);
    expect(secondInstrument.notesOn[0]?.timestamp).toBeCloseTo(100.62, 5);

    clock.time = 0.91;
    vi.advanceTimersByTime(25);
    expect(transport.currentState).toBe('completed');
    expect(secondInstrument.notesOff).toHaveLength(1);
  });

  it('releases scheduled live notes when the shared arrangement is stopped', () => {
    vi.useFakeTimers();
    const project = createDefaultProject('synth-one');
    const track = project.tracks[0]!;
    const arranged: ProjectSnapshot = {
      ...project,
      clips: [{
        id: 'sustained',
        name: 'Sustained',
        trackId: track.id,
        startSeconds: 0,
        createdAt: new Date().toISOString(),
        durationSeconds: 10,
        events: [
          event(0, {
            kind: 'note-on',
            sourceId: 'theremin-main',
            noteId: 'held-note',
            pitch: 64,
            velocity: 0.9,
            timestamp: 1,
          }),
          event(0.05, {
            kind: 'note-off',
            sourceId: 'theremin-main',
            noteId: 'held-note',
            timestamp: 9,
          }),
        ],
      }],
    };
    const clock = new FakeClock();
    const instrument = new FakeInstrument();
    const transport = new ArrangementTransport(clock, new ParameterBus());
    transport.play(arranged, new Map([[track.id, instrument]]));
    expect(instrument.notesOn).toHaveLength(1);
    clock.time = 0.1;
    vi.advanceTimersByTime(25);
    expect(instrument.notesOff).toHaveLength(1);
    expect(instrument.notesOff[0]?.timestamp).toBeCloseTo(100.17, 5);

    transport.stop();

    expect(instrument.notesOff).toHaveLength(2);
    expect(instrument.notesOff[1]).toMatchObject({
      sourceId: 'arrangement:' + track.id,
      noteId: instrument.notesOn[0]?.noteId,
      timestamp: 100.1,
    });
    expect(transport.currentState).toBe('stopped');
  });

  it('rejects a stopped audio clock, empty arrangements, and unready track sinks', () => {
    const project = createDefaultProject('synth-one');
    const clock = new FakeClock();
    const transport = new ArrangementTransport(clock, new ParameterBus());

    clock.running = false;
    expect(() => transport.play(project, new Map())).toThrow(/enable the audio engine/i);
    clock.running = true;
    expect(() => transport.play({ ...project, clips: [] }, new Map())).toThrow(/no musical events/i);
    const clipProject: ProjectSnapshot = {
      ...project,
      clips: [{
        id: 'clip',
        name: 'Clip',
        trackId: project.activeTrackId,
        startSeconds: 0,
        createdAt: new Date().toISOString(),
        durationSeconds: 0.1,
        events: [event(0, {
          kind: 'note-on',
          sourceId: 'theremin-main',
          noteId: 'n',
          pitch: 60,
          velocity: 0.5,
          timestamp: 1,
        })],
      }],
    };
    expect(() => transport.play(clipProject, new Map())).toThrow(/no ready instrument output/i);
  });
});
