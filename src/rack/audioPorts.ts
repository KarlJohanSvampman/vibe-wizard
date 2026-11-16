import type { RackModule } from './types.js';

export type AudioPortDirection = 'input' | 'output';

export interface AudioPortDefinition {
  readonly id: string;
  readonly direction: AudioPortDirection;
  readonly mediaType: 'audio';
  /** Maximum simultaneous patch cables. Inputs default to one; outputs are unlimited. */
  readonly maxConnections?: number;
}

/** Rack module exposing named Web Audio connection points. */
export interface AudioPortModule extends RackModule {
  readonly ports: readonly AudioPortDefinition[];
  getAudioPortNode(portId: string): AudioNode;
}
