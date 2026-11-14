import type { ControlSignal } from '../audio/events.js';
import { clamp } from '../audio/events.js';
import type { ParameterTarget } from './types.js';

export type TransferCurve = 'linear' | 'exponential' | 'logarithmic';

export interface ParameterMapping {
  readonly id: string;
  readonly sourceModuleId: string;
  readonly sourcePortId: string;
  readonly targetModuleId: string;
  readonly targetParameterId: string;
  readonly inputRange: readonly [number, number];
  readonly outputRange: readonly [number, number];
  readonly curve: TransferCurve;
  readonly invert: boolean;
  /** Fraction removed from the low end of the normalized input range. */
  readonly deadZone: number;
  /** Number of intervals; zero/undefined disables quantization. */
  readonly quantizationSteps?: number;
  /** Exponential smoothing time constant in milliseconds; zero disables smoothing. */
  readonly smoothingMs: number;
}

export class ParameterBus {
  private readonly targets = new Map<string, ParameterTarget>();
  private readonly mappings = new Map<string, ParameterMapping>();
  private readonly smoothedValues = new Map<string, number>();
  private readonly lastTimestamps = new Map<string, number>();

  registerTarget(target: ParameterTarget): void {
    this.targets.set(target.id, target);
  }

  unregisterTarget(targetId: string): void {
    this.targets.delete(targetId);
    for (const [mappingId, mapping] of this.mappings) {
      if (mapping.targetModuleId === targetId) {
        this.removeMapping(mappingId);
      }
    }
  }

  addMapping(mapping: ParameterMapping): void {
    if (this.mappings.has(mapping.id)) {
      throw new Error(`A parameter mapping with id "${mapping.id}" already exists.`);
    }
    if (!this.targets.has(mapping.targetModuleId)) {
      throw new Error(`Unknown parameter target "${mapping.targetModuleId}".`);
    }
    if (mapping.inputRange[0] === mapping.inputRange[1]) {
      throw new Error('A mapping input range must have a non-zero span.');
    }
    if (!Number.isFinite(mapping.deadZone) || mapping.deadZone < 0 || mapping.deadZone >= 1) {
      throw new Error('deadZone must be in the range [0, 1).');
    }
    this.mappings.set(mapping.id, mapping);
  }

  removeMapping(mappingId: string): boolean {
    this.smoothedValues.delete(mappingId);
    this.lastTimestamps.delete(mappingId);
    return this.mappings.delete(mappingId);
  }

  /**
   * Route one continuous signal to matching mappings. Supplying a target module
   * scopes recorded automation to the instrument that owns its arrangement clip.
   */
  process(signal: ControlSignal, targetModuleId?: string): number {
    let applied = 0;

    for (const mapping of this.mappings.values()) {
      if (
        mapping.sourceModuleId !== signal.sourceId ||
        mapping.sourcePortId !== signal.portId ||
        (targetModuleId !== undefined && mapping.targetModuleId !== targetModuleId)
      ) {
        continue;
      }

      const target = this.targets.get(mapping.targetModuleId);
      if (!target) continue;

      const inputSpan = mapping.inputRange[1] - mapping.inputRange[0];
      let normalized = clamp((signal.value - mapping.inputRange[0]) / inputSpan, 0, 1);

      if (mapping.deadZone > 0) {
        normalized = normalized <= mapping.deadZone
          ? 0
          : (normalized - mapping.deadZone) / (1 - mapping.deadZone);
      }
      if (mapping.invert) normalized = 1 - normalized;

      switch (mapping.curve) {
        case 'exponential':
          normalized **= 2;
          break;
        case 'logarithmic':
          normalized = Math.log1p(9 * normalized) / Math.log(10);
          break;
        case 'linear':
          break;
      }

      if (mapping.quantizationSteps && mapping.quantizationSteps > 0) {
        normalized = Math.round(normalized * mapping.quantizationSteps) /
          mapping.quantizationSteps;
      }

      const [outMin, outMax] = mapping.outputRange;
      const mappedValue = clamp(
        outMin + normalized * (outMax - outMin),
        Math.min(outMin, outMax),
        Math.max(outMin, outMax),
      );

      let output = mappedValue;
      const previous = this.smoothedValues.get(mapping.id);
      const previousTime = this.lastTimestamps.get(mapping.id);
      if (
        mapping.smoothingMs > 0 &&
        previous !== undefined &&
        previousTime !== undefined &&
        signal.timestamp > previousTime
      ) {
        const elapsedMs = (signal.timestamp - previousTime) * 1000;
        const alpha = 1 - Math.exp(-elapsedMs / mapping.smoothingMs);
        output = previous + alpha * (mappedValue - previous);
      }

      this.smoothedValues.set(mapping.id, output);
      this.lastTimestamps.set(mapping.id, signal.timestamp);
      target.setParameter(mapping.targetParameterId, output, signal.timestamp);
      applied += 1;
    }

    return applied;
  }
}
