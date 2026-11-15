import { describe, expect, it, vi } from 'vitest';
import { ParameterBus } from '../rack/ParameterBus.js';
import { createControllerInstance, createControllerPreset } from './ControllerModel.js';
import { ControllerRuntime } from './ControllerRuntime.js';

describe('ControllerRuntime', () => {
  it('routes a reusable control to the selected track parameter', () => {
    const bus = new ParameterBus();
    const setParameter = vi.fn();
    bus.registerTarget({ id: 'instrument-1', setParameter });
    const preset = createControllerPreset('Filter controls');
    const component = {
      id: 'cutoff', kind: 'knob' as const, label: 'Cutoff',
      x: 0, y: 0, width: 1, height: 1, min: 0, max: 1, defaultValue: 0.5,
      binding: { action: 'parameter' as const, targetScope: 'instance-track' as const,
        targetParameterId: 'cutoff', outputRange: [100, 10000] as const,
        curve: 'linear' as const, invert: false, smoothingMs: 0 },
    };
    const instance = { ...createControllerInstance(preset.id), targetTrackId: 'track-1' };
    const runtime = new ControllerRuntime({
      parameterBus: bus,
      resolveTarget: () => ({ id: 'instrument-1', setParameter }),
    });
    runtime.connect({ ...preset, components: [component] }, instance);
    runtime.setValue(instance, component, 0.75, 10);
    expect(setParameter).toHaveBeenCalledWith('cutoff', 7525, 10);
    runtime.disconnect(instance.id);
    runtime.setValue(instance, component, 0.5, 11);
    expect(setParameter).toHaveBeenCalledTimes(1);
  });

  it('emits paired note events for a momentary component', () => {
    const emit = vi.fn();
    const bus = new ParameterBus();
    const preset = createControllerPreset();
    const instance = createControllerInstance(preset.id);
    const component = {
      id: 'pad', kind: 'button' as const, label: 'Pad',
      x: 0, y: 0, width: 1, height: 1, min: 0, max: 1, defaultValue: 0,
      binding: { action: 'gate' as const, targetScope: 'instance-track' as const,
        outputRange: [60, 60] as const, curve: 'linear' as const, invert: false, smoothingMs: 0 },
    };
    const runtime = new ControllerRuntime({ parameterBus: bus, resolveTarget: () => undefined, onMusicalEvent: emit });
    runtime.setGate(instance, component, true, 1);
    runtime.setGate(instance, component, false, 2);
    expect(emit.mock.calls.map(call => call[0].kind)).toEqual(['note-on', 'note-off']);
  });
});
