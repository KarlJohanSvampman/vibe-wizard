import type { AudioGenerationProgress, GeneratedAudioSample } from './AudioGenerationProvider.js';

export interface AudioTransformationRequest {
  readonly prompt: string;
  readonly durationSeconds: number;
  readonly referenceStartMs: number;
  readonly referenceEndMs: number;
  readonly conditionStrength: 'low' | 'medium' | 'high' | 'xhigh';
}

export interface AudioTransformationProviderOptions {
  readonly fetcher?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
  readonly maxBytes?: number;
}

interface JobResponse {
  readonly jobId?: unknown;
}

interface StatusResponse {
  readonly status?: unknown;
  readonly progress?: unknown;
  readonly message?: unknown;
  readonly result?: {
    readonly downloadUrl?: unknown;
    readonly fileName?: unknown;
    readonly mimeType?: unknown;
  };
}

function resolveUrl(value: string, base?: URL): URL {
  const url = base ? new URL(value, base) : new URL(value);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username || url.password
  ) {
    throw new Error('AI service URLs must use HTTP(S) and must not contain credentials.');
  }
  url.hash = '';
  return url;
}

async function readJson<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 500); } catch { /* Keep status. */ }
    throw new Error(context + ' failed (HTTP ' + response.status + ')' + (detail ? ': ' + detail : ''));
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error(context + ' returned invalid JSON.');
  }
}

function abortError(): Error {
  const error = new Error('Audio transformation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Browser adapter for the gateway's upload + prompt-conditioned audio transformation workflow. */
export class HttpAudioTransformationProvider {
  readonly id = 'eleven-music-conditioned-transform';

  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly maxBytes: number;

  constructor(baseUrl: string, options: AudioTransformationProviderOptions = {}) {
    const trimmed = baseUrl.trim();
    try {
      const pageOrigin = typeof globalThis.location !== 'undefined' ? globalThis.location.origin : undefined;
      this.baseUrl = resolveUrl(trimmed, pageOrigin ? new URL(pageOrigin) : undefined);
    } catch {
      throw new Error('AI service URL must be a valid HTTP(S) URL.');
    }
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.pollIntervalMs = options.pollIntervalMs ?? 1500;
    this.maxWaitMs = options.maxWaitMs ?? 10 * 60 * 1000;
    this.maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
    if (
      !Number.isFinite(this.pollIntervalMs) || this.pollIntervalMs < 0 ||
      !Number.isFinite(this.maxWaitMs) || this.maxWaitMs <= 0 ||
      !Number.isInteger(this.maxBytes) || this.maxBytes <= 0
    ) {
      throw new Error('AI transformation polling and download limits must be positive values.');
    }
  }

  async transformSample(
    request: AudioTransformationRequest,
    source: File,
    onProgress?: (progress: AudioGenerationProgress) => void,
    signal?: AbortSignal,
  ): Promise<GeneratedAudioSample> {
    const prompt = request.prompt.trim();
    if (!prompt || prompt.length > 4000) throw new Error('Enter a transformation prompt between 1 and 4000 characters.');
    if (!source.size || source.size > this.maxBytes) throw new Error('Source audio must be between 1 byte and 25 MB.');
    if (!source.type.toLowerCase().startsWith('audio/')) throw new Error('Choose an audio file to transform.');
    if (
      !Number.isFinite(request.durationSeconds) || request.durationSeconds < 3 || request.durationSeconds > 30 ||
      !Number.isInteger(request.referenceStartMs) || request.referenceStartMs < 0 ||
      !Number.isInteger(request.referenceEndMs) || request.referenceEndMs > 30000 ||
      request.referenceEndMs - request.referenceStartMs < 50
    ) {
      throw new Error('Transformation duration or selected reference region is outside the supported range.');
    }
    if (signal?.aborted) throw abortError();

    const base = this.baseUrl.href.endsWith('/') ? this.baseUrl : new URL(this.baseUrl.href + '/');
    const submitUrl = new URL('audio/transformations', base);
    const form = new FormData();
    form.set('file', source, source.name);
    form.set('prompt', prompt);
    form.set('durationSeconds', String(request.durationSeconds));
    form.set('referenceStartMs', String(request.referenceStartMs));
    form.set('referenceEndMs', String(request.referenceEndMs));
    form.set('conditionStrength', request.conditionStrength);

    const submitted = await readJson<JobResponse>(await this.fetcher(submitUrl, {
      method: 'POST',
      body: form,
      credentials: 'omit',
      signal,
    }), 'Audio transformation submission');
    if (typeof submitted.jobId !== 'string' || !submitted.jobId || submitted.jobId.length > 200) {
      throw new Error('AI service did not return a valid transformation job ID.');
    }

    const statusUrl = new URL('audio/generations/' + encodeURIComponent(submitted.jobId), base);
    const startedAt = Date.now();
    let downloadUrl: URL | undefined;
    let fileName = 'transformed-sample.mp3';
    let resultMimeType: string | undefined;
    while (Date.now() - startedAt <= this.maxWaitMs) {
      await wait(this.pollIntervalMs, signal);
      const status = await readJson<StatusResponse>(await this.fetcher(statusUrl, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        signal,
      }), 'Audio transformation status');

      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new Error(typeof status.message === 'string' && status.message.trim()
          ? status.message : 'The AI service could not transform this sample.');
      }
      if (status.status === 'queued' || status.status === 'running') {
        const progress = typeof status.progress === 'number' && Number.isFinite(status.progress)
          ? Math.min(100, Math.max(0, status.progress)) : undefined;
        onProgress?.({
          jobId: submitted.jobId,
          status: status.status,
          ...(progress === undefined ? {} : { progress }),
          ...(typeof status.message === 'string' ? { message: status.message.slice(0, 300) } : {}),
        });
        continue;
      }
      if (status.status !== 'succeeded' || !status.result || typeof status.result.downloadUrl !== 'string') {
        throw new Error('AI service returned an invalid completed transformation.');
      }
      downloadUrl = resolveUrl(status.result.downloadUrl, base);
      if (typeof status.result.fileName === 'string' && status.result.fileName.trim()) {
        fileName = status.result.fileName.trim().split(/[\\/]/).pop()!.slice(0, 120);
      }
      resultMimeType = typeof status.result.mimeType === 'string' ? status.result.mimeType : undefined;
      break;
    }
    if (!downloadUrl) throw new Error('Audio transformation timed out. The job may still be running.');

    const response = await this.fetcher(downloadUrl, {
      headers: { Accept: 'audio/*, application/octet-stream' },
      credentials: 'omit',
      signal,
    });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.text()).slice(0, 500); } catch { /* Keep status. */ }
      throw new Error('Transformed audio download failed (HTTP ' + response.status + ')' + (detail ? ': ' + detail : ''));
    }
    const headerSize = Number(response.headers.get('Content-Length') ?? 0);
    if (headerSize > this.maxBytes) throw new Error('Transformed audio exceeds the 25 MB size limit.');
    const mimeType = (response.headers.get('Content-Type') ?? resultMimeType ?? '').split(';', 1)[0]!.trim().toLowerCase();
    if (!mimeType.startsWith('audio/') && mimeType !== 'application/octet-stream') {
      throw new Error('AI service returned a file that is not identified as audio.');
    }
    const data = await response.arrayBuffer();
    if (!data.byteLength) throw new Error('AI service returned an empty transformed sample.');
    if (data.byteLength > this.maxBytes) throw new Error('Transformed audio exceeds the 25 MB size limit.');
    return {
      jobId: submitted.jobId,
      providerId: this.id,
      fileName,
      mimeType: mimeType === 'application/octet-stream' ? (resultMimeType ?? 'audio/mpeg') : mimeType,
      data,
    };
  }
}
