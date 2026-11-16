import { describe, expect, it, vi } from 'vitest';
import { AudioConnectionGraph } from './AudioConnectionGraph.js';
import type { AudioPortModule } from './audioPorts.js';

function module(id: string): AudioPortModule {
  const input = { connect: vi.fn(), disconnect: vi.fn() };
  const output = { connect: vi.fn(), disconnect: vi.fn() };
  return {
    id,
    kind: 'effect',
    ports: [
      { id: 'in', direction: 'input', mediaType: 'audio' },
      { id: 'out', direction: 'output', mediaType: 'audio' },
    ],
    getAudioPortNode: (portId: string) => portId === 'in' ? input as unknown as AudioNode : output as unknown as AudioNode,
    setParameter: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('AudioConnectionGraph', () => {
  it('physically connects valid output-to-input patch cables and disconnects them', () => {
    const graph = new AudioConnectionGraph();
    const source = module('source');
    const destination = module('destination');
    graph.register(source);
    graph.register(destination);
    const cable = { sourceModuleId: 'source', sourcePortId: 'out', destinationModuleId: 'destination', destinationPortId: 'in' };

    graph.connect(cable);
    expect(graph.list()).toEqual([cable]);
    expect(source.getAudioPortNode('out').connect).toHaveBeenCalledWith(destination.getAudioPortNode('in'));
    expect(graph.disconnect(cable)).toBe(true);
    expect(graph.disconnect(cable)).toBe(false);
    expect(graph.list()).toHaveLength(0);
  });

  it('rejects invalid direction, unknown modules, duplicate cables, and occupied inputs', () => {
    const graph = new AudioConnectionGraph();
    const a = module('a');
    const b = module('b');
    const c = module('c');
    graph.register(a); graph.register(b); graph.register(c);
    const cable = { sourceModuleId: 'a', sourcePortId: 'in', destinationModuleId: 'b', destinationPortId: 'in' };
    expect(() => graph.connect(cable)).toThrow('output port');
    const valid = { ...cable, sourcePortId: 'out' };
    graph.connect(valid);
    expect(() => graph.connect(valid)).toThrow('already exists');
    expect(() => graph.connect({ ...valid, sourceModuleId: 'c' })).toThrow('connection limit');
    expect(() => graph.connect({ ...valid, sourceModuleId: 'missing' })).toThrow('Unknown source');
  });

  it('rejects self-connections and indirect routing cycles', () => {
    const graph = new AudioConnectionGraph();
    for (const id of ['a', 'b', 'c']) graph.register(module(id));
    const connect = (from: string, to: string) => graph.connect({
      sourceModuleId: from, sourcePortId: 'out', destinationModuleId: to, destinationPortId: 'in',
    });
    expect(() => connect('a', 'a')).toThrow('itself');
    connect('a', 'b'); connect('b', 'c');
    expect(() => connect('c', 'a')).toThrow('cycle');
  });

  it('removes all patch cables attached to a module', () => {
    const graph = new AudioConnectionGraph();
    const a = module('a'); const b = module('b'); const c = module('c');
    graph.register(a); graph.register(b); graph.register(c);
    graph.connect({ sourceModuleId: 'a', sourcePortId: 'out', destinationModuleId: 'b', destinationPortId: 'in' });
    graph.connect({ sourceModuleId: 'b', sourcePortId: 'out', destinationModuleId: 'c', destinationPortId: 'in' });
    graph.removeModule('b');
    expect(graph.list()).toHaveLength(0);
  });
});
