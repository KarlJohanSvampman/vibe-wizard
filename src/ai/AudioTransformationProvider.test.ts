import { describe, expect, it, vi } from 'vitest';
import { HttpAudioTransformationProvider } from './AudioTransformationProvider.js';

describe('HTTP audio transformation provider', () => {
  it('uploads a source, polls the job, downloads the transformed audio and reports progress', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'transform-42' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'running', progress: 45, message: 'Conditioning source audio',
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'succeeded',
        result: {
          downloadUrl: '/api/audio/generations/transform-42/result',
          fileName: 'dark-piano.mp3',
          mimeType: 'audio/mpeg',
        },
      })))
      .mockResolvedValueOnce(new Response(new Uint8Array([5, 4, 3, 2]), {
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '4' },
      }));
    const progress: Array<{ status: string; progress?: number }> = [];
    const provider = new HttpAudioTransformationProvider('http://localhost/api', {
      fetcher,
      pollIntervalMs: 0,
      maxWaitMs: 1000,
    });
    const source = new File([new Uint8Array([1, 2, 3])], 'source.wav', { type: 'audio/wav' });

    const result = await provider.transformSample({
      prompt: 'Dark ambient piano texture',
      durationSeconds: 5,
      referenceStartMs: 250,
      referenceEndMs: 2250,
      conditionStrength: 'high',
    }, source, item => progress.push(item));

    expect(result.jobId).toBe('transform-42');
    expect(result.providerId).toBe('eleven-music-conditioned-transform');
    expect(result.fileName).toBe('dark-piano.mp3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect([...new Uint8Array(result.data)]).toEqual([5, 4, 3, 2]);
    expect(progress).toEqual([{
      jobId: 'transform-42',
      status: 'running',
      progress: 45,
      message: 'Conditioning source audio',
    }]);
    const [submitUrl, init] = fetcher.mock.calls[0]!;
    expect(String(submitUrl)).toContain('/api/audio/transformations');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get('prompt')).toBe('Dark ambient piano texture');
    expect(form.get('referenceStartMs')).toBe('250');
    expect(form.get('referenceEndMs')).toBe('2250');
    expect(form.get('conditionStrength')).toBe('high');
  });

  it('rejects a source that is not audio', async () => {
    const provider = new HttpAudioTransformationProvider('http://localhost/api', {
      fetcher: vi.fn<typeof fetch>(),
    });
    const source = new File(['not audio'], 'notes.txt', { type: 'text/plain' });
    await expect(provider.transformSample({
      prompt: 'Transform this',
      durationSeconds: 5,
      referenceStartMs: 0,
      referenceEndMs: 1000,
      conditionStrength: 'high',
    }, source)).rejects.toThrow('Choose an audio file');
  });

  it('rejects a reference region shorter than 50 ms', async () => {
    const provider = new HttpAudioTransformationProvider('http://localhost/api', {
      fetcher: vi.fn<typeof fetch>(),
    });
    const source = new File([new Uint8Array([1])], 'source.wav', { type: 'audio/wav' });
    await expect(provider.transformSample({
      prompt: 'Transform this',
      durationSeconds: 5,
      referenceStartMs: 100,
      referenceEndMs: 120,
      conditionStrength: 'high',
    }, source)).rejects.toThrow('outside the supported range');
  });

  it('surfaces a failed transformation job', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'bad-job' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'failed', message: 'Music API access is not enabled',
      })));
    const provider = new HttpAudioTransformationProvider('http://localhost/api', {
      fetcher,
      pollIntervalMs: 0,
      maxWaitMs: 1000,
    });
    const source = new File([new Uint8Array([1])], 'source.wav', { type: 'audio/wav' });
    await expect(provider.transformSample({
      prompt: 'Transform this',
      durationSeconds: 5,
      referenceStartMs: 0,
      referenceEndMs: 1000,
      conditionStrength: 'high',
    }, source)).rejects.toThrow('Music API access is not enabled');
  });
});
