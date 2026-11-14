export const INSTRUMENT_DEFINITIONS = [
  {
    id: 'synth',
    label: 'Analog Synth',
    description: 'Polyphonic sawtooth synth with expressive pitch and volume control.',
  },
  {
    id: 'piano',
    label: 'Piano',
    description: 'Bright additive piano voice with layered harmonics and a natural decay.',
  },
  {
    id: 'drums',
    label: 'Drum Kit',
    description: 'One-shot kick, snare, tom, and cymbal voices triggered by MIDI drum notes.',
  },
  {
    id: 'sampler',
    label: 'Sampler',
    description: 'Play an imported audio file chromatically across the keyboard.',
  },
] as const;

export type InstrumentType = typeof INSTRUMENT_DEFINITIONS[number]['id'];

export function isInstrumentType(value: unknown): value is InstrumentType {
  return INSTRUMENT_DEFINITIONS.some(definition => definition.id === value);
}

export function getInstrumentLabel(type: InstrumentType): string {
  return INSTRUMENT_DEFINITIONS.find(definition => definition.id === type)?.label ?? 'Analog Synth';
}

export function getInstrumentDescription(type: InstrumentType): string {
  return INSTRUMENT_DEFINITIONS.find(definition => definition.id === type)?.description ?? '';
}
