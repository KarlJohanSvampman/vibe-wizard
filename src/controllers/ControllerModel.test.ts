import { describe, expect, it } from 'vitest';
import {
  createControllerInstance, createControllerPreset,
  validateControllerInstance, validateControllerPreset, validateStudioPlacement,
} from './ControllerModel.js';

describe('universal controller model', () => {
  it('creates a reusable empty board with sensible dimensions', () => {
    const preset = createControllerPreset('Live Synth Board', new Date('2026-11-15T00:00:00Z'));
    expect(preset.board).toEqual({ columns: 8, rows: 4 });
    expect(preset.components).toEqual([]);
    expect(preset.visibility).toBe('private');
  });

  it('validates reusable components and permits instance-relative routing', () => {
    const preset = createControllerPreset();
    const withKnob = { ...preset, components: [{
      id: 'cutoff', kind: 'knob', label: 'Filter cutoff', x: 0, y: 0, width: 1, height: 1,
      min: 0, max: 1, defaultValue: 0.5,
      binding: { action: 'parameter', targetScope: 'instance-track', targetParameterId: 'cutoff',
        outputRange: [80, 18000], curve: 'exponential', invert: false, smoothingMs: 15 },
    }] };
    expect(validateControllerPreset(withKnob).components).toHaveLength(1);
    const instance = createControllerInstance(preset.id);
    expect(validateControllerInstance(instance, new Set([preset.id])).presetId).toBe(preset.id);
    expect(() => validateControllerInstance(instance, new Set())).toThrow(/missing preset/i);
  });

  it('rejects overlapping board bounds and invalid parameter ranges', () => {
    const preset = createControllerPreset();
    const invalid = { ...preset, components: [{
      id: 'bad', kind: 'slider', label: 'Bad', x: 7, y: 0, width: 2, height: 1,
      min: 1, max: 1, defaultValue: 1,
      binding: { action: 'parameter', targetScope: 'master', outputRange: [0, 1],
        curve: 'linear', invert: false, smoothingMs: 0 },
    }] };
    expect(() => validateControllerPreset(invalid)).toThrow(/invalid component/i);
  });

  it('validates spatial placements', () => {
    expect(validateStudioPlacement({
      id: 'p1', objectType: 'controller-instance', objectRefId: 'c1',
      position: { x: 1, y: 0, z: -2 }, rotation: { x: 0, y: 1, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }).position.z).toBe(-2);
    expect(() => validateStudioPlacement({
      id: 'p2', objectType: 'speaker', objectRefId: 's1',
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0, y: 1, z: 1 },
    })).toThrow(/placement is invalid/i);
  });
});
