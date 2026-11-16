import type { AudioPortDefinition, AudioPortModule } from './audioPorts.js';

export interface AudioConnection {
  readonly sourceModuleId: string;
  readonly sourcePortId: string;
  readonly destinationModuleId: string;
  readonly destinationPortId: string;
}

function findPort(module: AudioPortModule, portId: string): AudioPortDefinition {
  const port = module.ports.find(candidate => candidate.id === portId);
  if (!port) throw new Error(`Unknown audio port "${portId}" on module "${module.id}".`);
  return port;
}

/** Validated directed patch graph for audio modules. Connections are physically wired. */
export class AudioConnectionGraph {
  private readonly modules = new Map<string, AudioPortModule>();
  private readonly edges = new Map<string, AudioConnection>();

  register(module: AudioPortModule): void {
    if (this.modules.has(module.id)) throw new Error(`Audio module "${module.id}" is already registered.`);
    this.modules.set(module.id, module);
  }

  list(): readonly AudioConnection[] {
    return [...this.edges.values()];
  }

  connect(connection: AudioConnection): void {
    const source = this.modules.get(connection.sourceModuleId);
    const destination = this.modules.get(connection.destinationModuleId);
    if (!source) throw new Error(`Unknown source module "${connection.sourceModuleId}".`);
    if (!destination) throw new Error(`Unknown destination module "${connection.destinationModuleId}".`);
    if (source.id === destination.id) throw new Error('A module cannot connect to itself.');

    const sourcePort = findPort(source, connection.sourcePortId);
    const destinationPort = findPort(destination, connection.destinationPortId);
    if (sourcePort.direction !== 'output') throw new Error('Connections must start at an output port.');
    if (destinationPort.direction !== 'input') throw new Error('Connections must end at an input port.');
    if (sourcePort.mediaType !== destinationPort.mediaType) throw new Error('Audio port media types do not match.');

    const key = this.key(connection);
    if (this.edges.has(key)) throw new Error('This audio connection already exists.');
    const incoming = [...this.edges.values()].filter(edge =>
      edge.destinationModuleId === destination.id && edge.destinationPortId === destinationPort.id,
    ).length;
    const maxIncoming = destinationPort.maxConnections ?? 1;
    if (incoming >= maxIncoming) throw new Error(`Input "${destination.id}.${destinationPort.id}" has reached its connection limit.`);

    if (this.hasPath(destination.id, source.id)) {
      throw new Error('This connection would create an audio routing cycle.');
    }

    source.getAudioPortNode(sourcePort.id).connect(destination.getAudioPortNode(destinationPort.id));
    this.edges.set(key, { ...connection });
  }

  disconnect(connection: AudioConnection): boolean {
    const key = this.key(connection);
    const existing = this.edges.get(key);
    if (!existing) return false;
    const source = this.modules.get(existing.sourceModuleId);
    const destination = this.modules.get(existing.destinationModuleId);
    if (source && destination) {
      source.getAudioPortNode(existing.sourcePortId).disconnect(
        destination.getAudioPortNode(existing.destinationPortId),
      );
    }
    this.edges.delete(key);
    return true;
  }

  removeModule(moduleId: string): void {
    if (!this.modules.has(moduleId)) return;
    for (const edge of [...this.edges.values()]) {
      if (edge.sourceModuleId === moduleId || edge.destinationModuleId === moduleId) {
        this.disconnect(edge);
      }
    }
    this.modules.delete(moduleId);
  }

  private hasPath(from: string, target: string): boolean {
    const visited = new Set<string>();
    const pending = [from];
    while (pending.length) {
      const current = pending.pop()!;
      if (current === target) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of this.edges.values()) {
        if (edge.sourceModuleId === current) pending.push(edge.destinationModuleId);
      }
    }
    return false;
  }

  private key(connection: AudioConnection): string {
    return [connection.sourceModuleId, connection.sourcePortId,
      connection.destinationModuleId, connection.destinationPortId].join('\u0000');
  }
}
