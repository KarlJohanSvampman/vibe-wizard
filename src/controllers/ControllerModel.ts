export type ControllerComponentKind = 'knob' | 'slider' | 'button' | 'toggle' | 'xy-pad' | 'keyboard' | 'drum-pad' | 'guitar-fret' | 'turntable';
export type ControllerControlAction = 'parameter' | 'note' | 'gate' | 'transport' | 'scratch';
export type ControllerTargetScope = 'instance-track' | 'project-track' | 'master';

export interface ControllerParameterBinding {
  readonly action: ControllerControlAction;
  readonly targetScope: ControllerTargetScope;
  readonly targetTrackId?: string;
  readonly targetParameterId?: string;
  readonly outputRange: readonly [number, number];
  readonly curve: 'linear' | 'exponential' | 'logarithmic';
  readonly invert: boolean;
  readonly smoothingMs: number;
}

export interface ControllerComponentDefinition {
  readonly id: string;
  readonly kind: ControllerComponentKind;
  readonly label: string;
  /** Position and dimensions are in board-grid cells. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
  readonly binding: ControllerParameterBinding;
}

export interface ControllerPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly board: { readonly columns: number; readonly rows: number };
  readonly components: readonly ControllerComponentDefinition[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorId?: string;
  readonly visibility: 'private' | 'unlisted' | 'public';
  readonly version: number;
}

export interface ControllerInstance {
  readonly id: string;
  readonly presetId: string;
  readonly name: string;
  readonly targetTrackId?: string;
  readonly placement: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly rotationY: number;
    readonly scale: number;
  };
  readonly enabled: boolean;
}

export interface StudioObjectPlacement {
  readonly id: string;
  readonly objectType: 'instrument-track' | 'controller-instance' | 'microphone' | 'speaker' | 'furniture';
  readonly objectRefId: string;
  /** Instrument family rendered for an instrument-track placement. */
  readonly instrumentType?: 'synth' | 'piano' | 'drums' | 'sampler';
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotation: { readonly x: number; readonly y: number; readonly z: number };
  readonly scale: { readonly x: number; readonly y: number; readonly z: number };
}

export function createControllerPreset(name = 'Untitled Controller', now = new Date()): ControllerPreset {
  const timestamp = now.toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() ?? 'controller-' + Date.now().toString(36),
    name: name.trim() || 'Untitled Controller',
    description: '',
    board: { columns: 8, rows: 4 },
    components: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    visibility: 'private',
    version: 1,
  };
}

export function createControllerInstance(
  presetId: string,
  name = 'Controller',
  now = new Date(),
): ControllerInstance {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? 'controller-instance-' + Date.now().toString(36),
    presetId,
    name,
    placement: { x: 0, y: 0, z: 0, rotationY: 0, scale: 1 },
    enabled: true,
  };
}

export function validateControllerPreset(value: unknown): ControllerPreset {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' ||
      typeof value.description !== 'string' || !isRecord(value.board) ||
      !integerInRange(value.board.columns, 1, 32) || !integerInRange(value.board.rows, 1, 32) ||
      !Array.isArray(value.components) || typeof value.createdAt !== 'string' ||
      typeof value.updatedAt !== 'string' ||
      !['private', 'unlisted', 'public'].includes(String(value.visibility)) ||
      !integerInRange(value.version, 1, 100000)) {
    throw new Error('Controller preset metadata is invalid.');
  }
  const ids = new Set<string>();
  const components = value.components.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || ids.has(item.id) ||
        !['knob','slider','button','toggle','xy-pad','keyboard','drum-pad','guitar-fret','turntable'].includes(String(item.kind)) ||
        typeof item.label !== 'string' ||
        !integerInRange(item.x, 0, value.board.columns - 1) ||
        !integerInRange(item.y, 0, value.board.rows - 1) ||
        !integerInRange(item.width, 1, value.board.columns) ||
        !integerInRange(item.height, 1, value.board.rows) ||
        item.x + item.width > value.board.columns || item.y + item.height > value.board.rows ||
        !finite(item.min) || !finite(item.max) || item.min >= item.max ||
        !finite(item.defaultValue) || item.defaultValue < item.min || item.defaultValue > item.max ||
        !isRecord(item.binding) ||
        !['parameter','note','gate','transport','scratch'].includes(String(item.binding.action)) ||
        !['instance-track','project-track','master'].includes(String(item.binding.targetScope)) ||
        !Array.isArray(item.binding.outputRange) || item.binding.outputRange.length !== 2 ||
        !finite(item.binding.outputRange[0]) || !finite(item.binding.outputRange[1]) ||
        !['linear','exponential','logarithmic'].includes(String(item.binding.curve)) ||
        typeof item.binding.invert !== 'boolean' ||
        !finite(item.binding.smoothingMs) || item.binding.smoothingMs < 0 || item.binding.smoothingMs > 5000) {
      throw new Error('Controller preset contains an invalid component.');
    }
    if (item.binding.targetScope === 'project-track' && typeof item.binding.targetTrackId !== 'string') {
      throw new Error('Project-track controller bindings require a target track ID.');
    }
    ids.add(item.id);
    return item as unknown as ControllerComponentDefinition;
  });
  return { ...value, components } as unknown as ControllerPreset;
}

export function validateControllerInstance(value: unknown, presetIds?: ReadonlySet<string>): ControllerInstance {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.presetId !== 'string' ||
      typeof value.name !== 'string' || !isRecord(value.placement) ||
      !finite(value.placement.x) || !finite(value.placement.y) || !finite(value.placement.z) ||
      !finite(value.placement.rotationY) || !finite(value.placement.scale) ||
      value.placement.scale <= 0 || value.placement.scale > 20 ||
      typeof value.enabled !== 'boolean' || (presetIds && !presetIds.has(value.presetId))) {
    throw new Error('Controller instance is invalid or references a missing preset.');
  }
  return value as unknown as ControllerInstance;
}

export function validateStudioPlacement(value: unknown): StudioObjectPlacement {
  if (!isRecord(value) || typeof value.id !== 'string' ||
      !['instrument-track','controller-instance','microphone','speaker','furniture'].includes(String(value.objectType)) ||
      typeof value.objectRefId !== 'string' ||
      (value.instrumentType !== undefined && !['synth','piano','drums','sampler'].includes(String(value.instrumentType))) ||
      !isRecord(value.position) ||
      !isRecord(value.rotation) || !isRecord(value.scale) ||
      !['x','y','z'].every(key => finite(value.position[key]) && finite(value.rotation[key]) &&
        finite(value.scale[key]) && value.scale[key] > 0 && value.scale[key] <= 20)) {
    throw new Error('Studio object placement is invalid.');
  }
  return value as unknown as StudioObjectPlacement;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function integerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}
