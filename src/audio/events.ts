export interface NoteOnEvent {
  readonly kind: 'note-on';
  readonly sourceId: string;
  readonly noteId: string;
  /** MIDI note number, where A4 is 69. */
  readonly pitch: number;
  /** Normalized amplitude intent in the range 0..1. */
  readonly velocity: number;
  /** Audio-clock seconds or a consistent monotonic event-clock timestamp. */
  readonly timestamp: number;
}

export interface NoteOffEvent {
  readonly kind: 'note-off';
  readonly sourceId: string;
  readonly noteId: string;
  readonly timestamp: number;
}

export interface ControlSignal {
  readonly kind: 'control';
  readonly sourceId: string;
  readonly portId: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly timestamp: number;
}

export interface GateEvent {
  readonly kind: 'gate';
  readonly sourceId: string;
  readonly portId: string;
  readonly pressed: boolean;
  readonly timestamp: number;
}

export type MusicalEvent = NoteOnEvent | NoteOffEvent | ControlSignal | GateEvent;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function midiToFrequency(midiNote: number): number {
  return 440 * 2 ** ((midiNote - 69) / 12);
}
