import { describe, expect, it } from 'vitest';
import { MemoryAudioAssetStore } from './AudioAssetStore.js';

describe('memory audio asset store', () => {
  it('stores independent copies of imported audio data', async () => {
    const store = new MemoryAudioAssetStore();
    const original = new Uint8Array([1, 2, 3, 4]).buffer;
    await store.save({
      id: 'sample-1',
      name: 'loop.wav',
      mimeType: 'audio/wav',
      data: original,
      updatedAt: '2026-11-14T00:00:00.000Z',
      origin: { kind: 'ai-generated', providerId: 'test-provider', jobId: 'job-1', prompt: 'warm pad' },
    });

    new Uint8Array(original)[0] = 99;
    const loaded = await store.load('sample-1');
    expect(loaded?.name).toBe('loop.wav');
    expect(loaded?.origin).toMatchObject({ kind: 'ai-generated', jobId: 'job-1', prompt: 'warm pad' });
    expect([...new Uint8Array(loaded!.data)]).toEqual([1, 2, 3, 4]);
    expect(await store.load('missing')).toBeUndefined();
  });
});
