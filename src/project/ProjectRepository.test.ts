import { describe, expect, it } from 'vitest';
import { createDefaultProject } from './ProjectModel.js';
import { MemoryProjectRepository } from './ProjectRepository.js';

describe('MemoryProjectRepository', () => {
  it('round-trips an independent project snapshot', async () => {
    const repository = new MemoryProjectRepository();
    const project = createDefaultProject('synth-main');
    await repository.save(project);

    const loaded = await repository.loadLatest();
    expect(loaded).toEqual(project);
    expect(repository.durability).toBe('ephemeral');
  });

  it('returns the most recently updated project', async () => {
    const repository = new MemoryProjectRepository();
    const older = {
      ...createDefaultProject('synth-main'),
      id: 'older',
      updatedAt: '2026-11-01T10:00:00.000Z',
    };
    const newer = {
      ...createDefaultProject('synth-main'),
      id: 'newer',
      updatedAt: '2026-11-02T10:00:00.000Z',
    };
    await repository.save(older);
    await repository.save(newer);

    expect((await repository.loadLatest())?.id).toBe('newer');
  });

  it('lists all saved projects newest first', async () => {
    const repository = new MemoryProjectRepository();
    const older = {
      ...createDefaultProject('synth-main'),
      id: 'older',
      updatedAt: '2026-11-01T10:00:00.000Z',
    };
    const newer = {
      ...createDefaultProject('synth-main'),
      id: 'newer',
      updatedAt: '2026-11-02T10:00:00.000Z',
    };
    await repository.save(older);
    await repository.save(newer);

    expect((await repository.list()).map(project => project.id)).toEqual(['newer', 'older']);
  });

  it('returns independent snapshots from the project list', async () => {
    const repository = new MemoryProjectRepository();
    await repository.save(createDefaultProject('synth-main'));

    const listed = await repository.list();
    (listed[0] as { name: string }).name = 'Changed outside repository';
    expect((await repository.list())[0]?.name).toBe('Untitled Session');
  });

  it('does not expose stored state by reference', async () => {
    const repository = new MemoryProjectRepository();
    const project = createDefaultProject('synth-main');
    await repository.save(project);

    const loaded = await repository.loadLatest();
    expect(loaded).toBeDefined();
    (loaded as { name: string }).name = 'Changed outside repository';
    expect((await repository.loadLatest())?.name).toBe('Untitled Session');
  });
});
