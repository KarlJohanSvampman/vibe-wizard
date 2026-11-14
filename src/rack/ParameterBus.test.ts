import { describe, expect, it } from 'vitest';
import { ParameterBus, type ParameterMapping } from './ParameterBus.js';
import type { ParameterTarget } from './types.js';
import type { ControlSignal } from '../audio/events.js';

class TestTarget implements ParameterTarget {
  readonly values: Array<{ parameterId: string; value: number }> = [];

  constructor(readonly id: string) {}

  setParameter(parameterId: string, value: number): void {
    this.values.push({ parameterId, value });
  }
}

const baseMapping: ParameterMapping = {
  id: 'theremin-x-to-pitch',
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
};

function signal(value: number, portId = 'x'): ControlSignal {
  return {
    kind: 'control',
    sourceId: 'theremin',
    portId,
    value,
    min: 0,
    max: 1,
    timestamp: 1,
  };
}

describe('ParameterBus', () => {
  it('maps a normalized controller signal into a target parameter range', () => {
    const bus = new ParameterBus();
    const synth = new TestTarget('synth');
    bus.registerTarget(synth);
    bus.addMapping(baseMapping);

    expect(bus.process(signal(0.5))).toBe(1);
    expect(synth.values).toEqual([{ parameterId: 'pitch', value: 66 }]);
  });

  it('supports inversion and quantization', () => {
    const bus = new ParameterBus();
    const synth = new TestTarget('synth');
    bus.registerTarget(synth);
    bus.addMapping({
      ...baseMapping,
      invert: true,
      quantizationSteps: 4,
      outputRange: [0, 1],
    });

    bus.process(signal(0.26));
    expect(synth.values[0]?.value).toBe(0.75);
  });

  it('fans one controller output out to multiple destinations', () => {
    const bus = new ParameterBus();
    const synth = new TestTarget('synth');
    const second = new TestTarget('second');
    bus.registerTarget(synth);
    bus.registerTarget(second);
    bus.addMapping(baseMapping);
    bus.addMapping({
      ...baseMapping,
      id: 'theremin-x-to-filter',
      targetModuleId: 'second',
      targetParameterId: 'cutoff',
      outputRange: [200, 12000],
    });

    expect(bus.process(signal(0.5))).toBe(2);
    expect(synth.values[0]?.value).toBe(66);
    expect(second.values[0]?.value).toBe(6100);
  });

  it('rejects mappings to unknown targets', () => {
    const bus = new ParameterBus();
    expect(() => bus.addMapping(baseMapping)).toThrow(/Unknown parameter target/);
  });
});
