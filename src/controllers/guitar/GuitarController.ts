import type { MusicalEvent } from '../../audio/events.js';

export interface GuitarChord { readonly id: string; readonly name: string; readonly midiNotes: readonly number[]; }
export interface GuitarControllerOptions {
  readonly sourceId: string;
  readonly emit: (event: MusicalEvent) => void;
  readonly now?: () => number;
  readonly minimumSwipeDistance?: number;
  readonly maximumSwipeMs?: number;
}
export interface StrumResult {
  readonly direction: 'down' | 'up';
  readonly intensity: number;
  readonly velocity: number;
  readonly chord: GuitarChord;
  readonly stringPitches: readonly number[];
}

/** Chord selector plus six independently pluckable strings and directional strumming. */
export class GuitarController {
  readonly chordLibrary: readonly GuitarChord[] = [
    { id: 'open', name: 'Open', midiNotes: [40, 47, 52, 57, 62, 67] },
    { id: 'c', name: 'C', midiNotes: [48, 55, 60, 64, 67] },
    { id: 'g', name: 'G', midiNotes: [43, 50, 55, 59, 62, 67] },
    { id: 'd', name: 'D', midiNotes: [38, 45, 50, 54, 57, 62] },
    { id: 'a', name: 'A', midiNotes: [45, 52, 57, 61, 64] },
    { id: 'e', name: 'E', midiNotes: [40, 47, 52, 56, 59, 64] },
  ];
  /** Six independently assignable performance buttons; the library remains intact. */
  readonly chords: GuitarChord[] = [...this.chordLibrary];
  private selectedChordId = 'open';
  private activeNotes = new Set<string>();
  private swipeStart?: { x: number; y: number; time: number };
  private noteSequence = 0;
  private readonly now: () => number;

  constructor(private readonly options: GuitarControllerOptions) { this.now = options.now ?? (() => performance.now() / 1000); }
  get selectedChord(): GuitarChord { return this.chords.find(chord => chord.id === this.selectedChordId)!; }
  selectChord(id: string): void { if (!this.chordLibrary.some(chord => chord.id === id)) throw new Error('Unknown guitar chord: ' + id); this.selectedChordId = id; }
  assignChord(buttonIndex: number, chordId: string): void {
    if (!Number.isInteger(buttonIndex) || buttonIndex < 0 || buttonIndex > 5) throw new Error('Guitar chord button must be between 0 and 5.');
    const chord = this.chordLibrary.find(item => item.id === chordId);
    if (!chord) throw new Error('Unknown guitar chord: ' + chordId);
    this.chords[buttonIndex] = chord;
  }
  beginStrum(x: number, y: number, time = this.now()): void { this.swipeStart = { x, y, time }; }
  endStrum(x: number, y: number, time = this.now()): StrumResult | undefined {
    const start = this.swipeStart; this.swipeStart = undefined; if (!start) return;
    const dx = x - start.x, dy = y - start.y;
    const distance = Math.hypot(dx, dy), elapsed = Math.max(0.001, time - start.time);
    if (distance < (this.options.minimumSwipeDistance ?? 0.08) || elapsed * 1000 > (this.options.maximumSwipeMs ?? 700)) return;
    const intensity = Math.min(1, distance / 0.55);
    const velocity = Math.min(1, Math.max(0.12, intensity * (0.22 / elapsed)));
    const chord = this.selectedChord;
    const direction = dy >= 0 ? 'down' : 'up';
    this.strum(chord, velocity, time, direction);
    return { direction, intensity, velocity, chord, stringPitches: chord.midiNotes };
  }

  /** Pluck a single string (0 = lowest-pitched/low-E string). */
  pluckString(stringIndex: number, intensity = 0.7, timestamp = this.now()): number | undefined {
    const pitch = this.selectedChord.midiNotes[stringIndex];
    if (pitch === undefined) return undefined;
    this.emitPluck(pitch, Math.min(1, Math.max(0.05, intensity)), timestamp, 0.34);
    return pitch;
  }

  /** Down-strums play low-to-high; up-strums play high-to-low with a velocity contour. */
  strum(chord = this.selectedChord, intensity = 0.75, timestamp = this.now(), direction: 'down' | 'up' = 'down'): void {
    const safe = Math.min(1, Math.max(0, intensity));
    const pitches = direction === 'down' ? [...chord.midiNotes] : [...chord.midiNotes].reverse();
    const spread = 0.009 + (1 - safe) * 0.018;
    pitches.forEach((pitch, index) => {
      const contour = direction === 'down' ? 1 - index * 0.055 : 1 - index * 0.055;
      const velocity = Math.max(0.04, Math.min(1, safe * contour));
      this.emitPluck(pitch, velocity, timestamp + index * spread, 0.24 + safe * 0.12);
    });
  }

  stopAll(timestamp = this.now()): void {
    for (const noteId of this.activeNotes) this.options.emit({ kind: 'note-off', sourceId: this.options.sourceId, noteId, timestamp });
    this.activeNotes.clear();
  }

  private emitPluck(pitch: number, velocity: number, timestamp: number, duration: number): void {
    const noteId = 'guitar-string-' + (++this.noteSequence);
    this.activeNotes.add(noteId);
    this.options.emit({ kind: 'note-on', sourceId: this.options.sourceId, noteId, pitch, velocity, timestamp });
    // Emit note-off with its intended musical timestamp; the audio event consumer schedules it.
    this.options.emit({ kind: 'note-off', sourceId: this.options.sourceId, noteId, timestamp: timestamp + duration });
    this.activeNotes.delete(noteId);
  }
}
