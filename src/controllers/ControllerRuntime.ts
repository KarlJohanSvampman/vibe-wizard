import type { ControlSignal, MusicalEvent } from '../audio/events.js';
import type { ParameterBus } from '../rack/ParameterBus.js';
import type { ParameterTarget } from '../rack/types.js';
import type { ControllerComponentDefinition, ControllerInstance, ControllerPreset } from './ControllerModel.js';

export interface ControllerRuntimeOptions {
  readonly parameterBus: ParameterBus;
  readonly resolveTarget: (instance: ControllerInstance, component: ControllerComponentDefinition) => ParameterTarget | undefined;
  readonly onMusicalEvent?: (event: MusicalEvent) => void;
}

/** Runtime bridge between reusable controller layouts and live instrument targets. */
export class ControllerRuntime {
  private readonly bindings = new Map<string, { targetId: string; mappingId: string }>();
  private readonly activeNotes = new Map<string, { sourceId: string; noteId: string }>();
  private disposed = false;

  constructor(private readonly options: ControllerRuntimeOptions) {}

  connect(preset: ControllerPreset, instance: ControllerInstance): void {
    this.disconnect(instance.id);
    if (!instance.enabled || this.disposed) return;
    for (const component of preset.components) {
      const binding = component.binding;
      if (binding.action !== 'parameter' || !binding.targetParameterId) continue;
      const target = this.options.resolveTarget(instance, component);
      if (!target) continue;
      const sourceId = this.sourceId(instance.id, component.id);
      const mappingId = 'controller-map:' + instance.id + ':' + component.id;
      this.options.parameterBus.addMapping({
        id: mappingId,
        sourceModuleId: sourceId,
        sourcePortId: 'value',
        targetModuleId: target.id,
        targetParameterId: binding.targetParameterId,
        inputRange: [component.min, component.max],
        outputRange: binding.outputRange,
        curve: binding.curve,
        invert: binding.invert,
        deadZone: 0,
        smoothingMs: binding.smoothingMs,
      });
      this.bindings.set(mappingId, { targetId: target.id, mappingId });
    }
  }

  disconnect(instanceId: string): void {
    for (const [key, binding] of this.bindings) {
      if (key.startsWith('controller-map:' + instanceId + ':')) {
        this.options.parameterBus.removeMapping(binding.mappingId);
        this.bindings.delete(key);
      }
    }
    for (const [key, note] of this.activeNotes) {
      if (note.sourceId.startsWith('controller:' + instanceId + ':')) {
        this.options.onMusicalEvent?.({
          kind: 'note-off', sourceId: note.sourceId, noteId: note.noteId,
          timestamp: performance.now() / 1000,
        });
        this.activeNotes.delete(key);
      }
    }
  }

  setValue(instance: ControllerInstance, component: ControllerComponentDefinition, value: number, timestamp = performance.now() / 1000): void {
    if (this.disposed || !instance.enabled || !Number.isFinite(value)) return;
    const normalized = Math.min(component.max, Math.max(component.min, value));
    const binding = component.binding;
    const sourceId = this.sourceId(instance.id, component.id);
    if (binding.action === 'parameter') {
      const signal: ControlSignal = {
        kind: 'control', sourceId, portId: 'value', value: normalized,
        min: component.min, max: component.max, timestamp,
      };
      this.options.parameterBus.process(signal);
      return;
    }
    if (binding.action === 'note' || binding.action === 'gate') {
      const noteId = 'component:' + component.id;
      const key = instance.id + ':' + component.id;
      const active = this.activeNotes.get(key);
      const pressed = normalized > component.min;
      if (pressed && !active) {
        const note = { sourceId, noteId };
        this.activeNotes.set(key, note);
        this.options.onMusicalEvent?.({
          kind: 'note-on', sourceId, noteId,
          pitch: Math.round(binding.outputRange[0]),
          velocity: Math.min(1, Math.max(0, (normalized - component.min) / (component.max - component.min))),
          timestamp,
        });
      } else if (!pressed && active) {
        this.activeNotes.delete(key);
        this.options.onMusicalEvent?.({ kind: 'note-off', sourceId, noteId, timestamp });
      }
    }
  }

  setGate(instance: ControllerInstance, component: ControllerComponentDefinition, pressed: boolean, timestamp = performance.now() / 1000): void {
    this.setValue(instance, component, pressed ? component.max : component.min, timestamp);
  }

  dispose(): void {
    if (this.disposed) return;
    for (const id of [...new Set([...this.bindings.keys()].map(key => key.split(':')[1] ?? ''))]) this.disconnect(id);
    this.disposed = true;
    for (const note of this.activeNotes.values()) this.options.onMusicalEvent?.({
      kind: 'note-off', sourceId: note.sourceId, noteId: note.noteId, timestamp: performance.now() / 1000,
    });
    this.activeNotes.clear();
  }

  private sourceId(instanceId: string, componentId: string): string {
    return 'controller:' + instanceId + ':' + componentId;
  }
}
