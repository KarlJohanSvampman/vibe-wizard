import { describe, expect, it } from 'vitest';
import {
  getInstrumentDescription,
  getInstrumentLabel,
  INSTRUMENT_DEFINITIONS,
  isInstrumentType,
} from './InstrumentTypes.js';

describe('instrument definitions', () => {
  it('exposes the four built-in instrument families', () => {
    expect(INSTRUMENT_DEFINITIONS.map(item => item.id))
      .toEqual(['synth', 'piano', 'drums', 'sampler']);
    expect(getInstrumentLabel('piano')).toBe('Piano');
    expect(getInstrumentDescription('sampler')).toMatch(/imported audio/i);
  });

  it('rejects unsupported persisted instrument types', () => {
    expect(isInstrumentType('drums')).toBe(true);
    expect(isInstrumentType('granular')).toBe(false);
    expect(isInstrumentType(undefined)).toBe(false);
  });
});
