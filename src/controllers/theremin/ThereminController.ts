import type { ControlSignal } from '../../audio/events.js';
import { clamp } from '../../audio/events.js';
import type { RackModule } from '../../rack/types.js';
import { ParameterBus } from '../../rack/ParameterBus.js';

/** Platform-neutral two-axis controller. XR and desktop adapters feed normalized coordinates. */
export class ThereminController implements RackModule {
  readonly kind = 'controller' as const;
  private x = 0.5;
  private y = 0.5;

  constructor(
    readonly id: string,
    private readonly parameterBus: ParameterBus,
  ) {}

  move(x: number, y: number, timestamp = performance.now() / 1000): void {
    this.x = clamp(x, 0, 1);
    this.y = clamp(y, 0, 1);

    const xSignal: ControlSignal = {
      kind: 'control',
      sourceId: this.id,
      portId: 'x',
      value: this.x,
      min: 0,
      max: 1,
      timestamp,
    };
    const ySignal: ControlSignal = {
      kind: 'control',
      sourceId: this.id,
      portId: 'y',
      value: this.y,
      min: 0,
      max: 1,
      timestamp,
    };

    this.parameterBus.process(xSignal);
    this.parameterBus.process(ySignal);
  }

  get position(): Readonly<{ x: number; y: number }> {
    return { x: this.x, y: this.y };
  }

  setParameter(parameterId: string, value: number, _timestamp: number): void {
    if (parameterId === 'x') this.x = clamp(value, 0, 1);
    if (parameterId === 'y') this.y = clamp(value, 0, 1);
  }
}
