import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpAudioGenerationProvider } from './AudioGenerationProvider.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP audio generation provider', () => {
  it('submits a prompt, polls progress, downloads the result, and reports metadata', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-42' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'running', progress: 35, message: 'Rendering audio',
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'succeeded',
        result: {
          downloadUrl: '/files/bright-pad.wav',
          fileName: 'bright-pad.wav',
          mimeType: 'audio/wav',
        },
      })))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { 'Content-Type': 'audio/wav', 'Content-Length': '4' },
      }));
    const progress: Array<{ status: string; progress?: number }> = [];
    const provider = new HttpAudioGenerationProvider('http://localhost:8787/api', {
      fetcher,
      pollIntervalMs: 0,
    });
    const result = await provider.generateSample(
      { prompt: 'A warm analog bass note', durationSeconds: 4 },
      item => progress.push(item),
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      prompt: 'A warm analog bass note', durationSeconds: 4, outputFormat: 'wav',
    });
    expect(String(fetcher.mock.calls[1]?.[0])).toBe('http://localhost:8787/api/audio/generations/job-42');
    expect(String(fetcher.mock.calls[3]?.[0])).toBe('http://localhost:8787/files/bright-pad.wav');
    expect(progress).toEqual([{ jobId: 'job-42', status: 'running', progress: 35, message: 'Rendering audio' }]);
    expect(result).toMatchObject({
      jobId: 'job-42', providerId: 'http-audio-generation',
      fileName: 'bright-pad.wav', mimeType: 'audio/wav',
    });
    expect([...new Uint8Array(result.data)]).toEqual([1, 2, 3, 4]);
  });

  it('rejects invalid prompts, durations, and unsafe service URLs', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => new HttpAudioGenerationProvider('file:///tmp/ai')).toThrow(/HTTP/);
    expect(() => new HttpAudioGenerationProvider('https://user:pass@example.com')).toThrow(/credentials/);
    const provider = new HttpAudioGenerationProvider('http://localhost:8787/api', {
      fetcher, pollIntervalMs: 0,
    });
    await expect(provider.generateSample({ prompt: '  ', durationSeconds: 4 })).rejects.toThrow(/prompt/i);
    await expect(provider.generateSample({ prompt: 'test', durationSeconds: 61 })).rejects.toThrow(/duration/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects non-audio downloads and results over the configured size limit', async () => {
    const htmlFetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'html-job' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'succeeded', result: { downloadUrl: '/files/result' },
      })))
      .mockResolvedValueOnce(new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }));
    const htmlProvider = new HttpAudioGenerationProvider('http://localhost:8787', {
      fetcher: htmlFetcher, pollIntervalMs: 0,
    });
    await expect(htmlProvider.generateSample({ prompt: 'test sound', durationSeconds: 2 }))
      .rejects.toThrow(/not identified as audio/i);

    const largeFetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'large-job' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'succeeded', result: { downloadUrl: '/files/large.wav', mimeType: 'audio/wav' },
      })))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { 'Content-Type': 'audio/wav' },
      }));
    const provider = new HttpAudioGenerationProvider('http://localhost:8787', {
      fetcher: largeFetcher, pollIntervalMs: 0, maxBytes: 3,
    });
    await expect(provider.generateSample({ prompt: 'test sound', durationSeconds: 2 }))
      .rejects.toThrow(/size limit/i);
  });

  it('honors abort signals before submitting', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>();
    const provider = new HttpAudioGenerationProvider('http://localhost:8787', {
      fetcher, pollIntervalMs: 0,
    });
    await expect(provider.generateSample(
      { prompt: 'test sound', durationSeconds: 2 }, undefined, controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('surfaces provider job failures', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'failed-job' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'failed', message: 'The model rejected this request',
      })));
    const provider = new HttpAudioGenerationProvider('http://localhost:8787', {
      fetcher, pollIntervalMs: 0,
    });
    await expect(provider.generateSample({ prompt: 'test sound', durationSeconds: 2 }))
      .rejects.toThrow(/model rejected/i);
  });
});
