export type RackModuleKind = 'instrument' | 'effect' | 'controller' | 'utility';

export interface ParameterTarget {
  readonly id: string;
  setParameter(parameterId: string, value: number, timestamp: number): void;
}

export interface RackModule extends ParameterTarget {
  readonly kind: RackModuleKind;
  dispose?(): void | Promise<void>;
}
