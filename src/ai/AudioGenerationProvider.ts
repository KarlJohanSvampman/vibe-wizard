export interface AudioGenerationRequest {
  readonly prompt: string;
  readonly durationSeconds: number;
}

export interface AudioGenerationProgress {
  readonly jobId: string;
  readonly status: 'queued' | 'running';
  readonly progress?: number;
  readonly message?: string;
}

export interface GeneratedAudioSample {
  readonly jobId: string;
  readonly providerId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly data: ArrayBuffer;
}

export type AudioGenerationProgressListener = (progress: AudioGenerationProgress) => void;

export interface AudioGenerationProvider {
  readonly id: string;
  generateSample(
    request: AudioGenerationRequest,
    onProgress?: AudioGenerationProgressListener,
    signal?: AbortSignal,
  ): Promise<GeneratedAudioSample>;
}

export interface HttpAudioGenerationProviderOptions {
  readonly fetcher?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
  readonly maxBytes?: number;
}

interface GenerationJobResponse {
  readonly jobId?: unknown;
  readonly id?: unknown;
}

interface GenerationStatusResponse {
  readonly status?: unknown;
  readonly progress?: unknown;
  readonly message?: unknown;
  readonly result?: {
    readonly downloadUrl?: unknown;
    readonly fileName?: unknown;
    readonly mimeType?: unknown;
  };
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

function ensureHttpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(label + ' must be a valid absolute URL.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username || url.password
  ) {
    throw new Error(label + ' must use HTTP(S) and must not contain credentials.');
  }
  url.hash = '';
  return url;
}

function cleanFileName(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const name = value.trim().split(/[\\/]/).pop() ?? fallback;
  return name.replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 120) || fallback;
}

async function responseError(response: Response, context: string): Promise<Error> {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 500);
  } catch {
    // Preserve the HTTP status if the response body is not readable.
  }
  return new Error(
    context + ' failed (HTTP ' + response.status + ')' + (detail ? ': ' + detail : ''),
  );
}

async function readJson<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) throw await responseError(response, context);
  try {
    return await response.json() as T;
  } catch {
    throw new Error(context + ' returned invalid JSON.');
  }
}

function abortError(): Error {
  const error = new Error('Audio generation was cancelled.');
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

/**
 * Browser-side adapter for a provider-neutral audio-generation proxy.
 * The proxy owns API credentials; this client only handles jobs and returned audio.
 */
export class HttpAudioGenerationProvider implements AudioGenerationProvider {
  readonly id = 'http-audio-generation';

  private readonly fetcher: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly maxBytes: number;
  private readonly baseUrl: URL;

  constructor(baseUrl: string, options: HttpAudioGenerationProviderOptions = {}) {
    this.baseUrl = ensureHttpUrl(baseUrl.trim(), 'AI service URL');
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.pollIntervalMs = options.pollIntervalMs ?? 1500;
    this.maxWaitMs = options.maxWaitMs ?? 10 * 60 * 1000;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (
      !Number.isFinite(this.pollIntervalMs) || this.pollIntervalMs < 0 ||
      !Number.isFinite(this.maxWaitMs) || this.maxWaitMs <= 0 ||
      !Number.isInteger(this.maxBytes) || this.maxBytes <= 0
    ) {
      throw new Error('AI service polling and download limits must be positive values.');
    }
  }

  async generateSample(
    request: AudioGenerationRequest,
    onProgress?: AudioGenerationProgressListener,
    signal?: AbortSignal,
  ): Promise<GeneratedAudioSample> {
    const prompt = request.prompt.trim();
    if (!prompt || prompt.length > 4000) {
      throw new Error('Enter a prompt between 1 and 4000 characters.');
    }
    if (
      !Number.isFinite(request.durationSeconds) ||
      request.durationSeconds < 1 || request.durationSeconds > 60
    ) {
      throw new Error('Generated sample duration must be between 1 and 60 seconds.');
    }
    if (signal?.aborted) throw abortError();

    const base = this.baseUrl.href.endsWith('/') ? this.baseUrl : new URL(this.baseUrl.href + '/');
    const submitUrl = new URL('audio/generations', base);
    const submitResponse = await this.fetcher(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        prompt,
        durationSeconds: request.durationSeconds,
        outputFormat: 'wav',
      }),
      credentials: 'omit',
      signal,
    });
    const submitted = await readJson<GenerationJobResponse>(submitResponse, 'Audio generation submission');
    const jobId = typeof submitted.jobId === 'string'
      ? submitted.jobId
      : typeof submitted.id === 'string' ? submitted.id : '';
    if (!jobId || jobId.length > 200) {
      throw new Error('AI service did not return a valid generation job ID.');
    }

    const statusUrl = new URL('audio/generations/' + encodeURIComponent(jobId), base);
    const startedAt = Date.now();
    let downloadUrl: URL | undefined;
    let fileName = 'ai-sample-' + jobId + '.wav';
    let resultMimeType: string | undefined;

    while (Date.now() - startedAt <= this.maxWaitMs) {
      await wait(this.pollIntervalMs, signal);
      const statusResponse = await this.fetcher(statusUrl, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        signal,
      });
      const status = await readJson<GenerationStatusResponse>(statusResponse, 'Audio generation status');

      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new Error(
          typeof status.message === 'string' && status.message.trim()
            ? status.message
            : 'The AI service could not generate this sample.',
        );
      }
      if (status.status === 'queued' || status.status === 'running') {
        const progress = typeof status.progress === 'number' && Number.isFinite(status.progress)
          ? Math.min(100, Math.max(0, status.progress))
          : undefined;
        onProgress?.({
          jobId,
          status: status.status,
          ...(progress === undefined ? {} : { progress }),
          ...(typeof status.message === 'string' ? { message: status.message.slice(0, 300) } : {}),
        });
        continue;
      }
      if (status.status !== 'succeeded') {
        throw new Error('AI service returned an unknown generation status.');
      }
      const result = status.result;
      if (!result || typeof result.downloadUrl !== 'string') {
        throw new Error('Completed AI job did not include a downloadable audio result.');
      }
      downloadUrl = ensureHttpUrl(new URL(result.downloadUrl, this.baseUrl).href, 'Generated audio URL');
      fileName = cleanFileName(result.fileName, fileName);
      resultMimeType = typeof result.mimeType === 'string' ? result.mimeType : undefined;
      break;
    }

    if (!downloadUrl) throw new Error('AI sample generation timed out. The job may still be running.');

    const audioResponse = await this.fetcher(downloadUrl, {
      headers: { Accept: 'audio/*, application/octet-stream' },
      credentials: 'omit',
      signal,
    });
    if (!audioResponse.ok) throw await responseError(audioResponse, 'Generated audio download');
    const headerSize = Number(audioResponse.headers.get('Content-Length') ?? 0);
    if (headerSize > this.maxBytes) {
      throw new Error('Generated sample exceeds the ' + Math.round(this.maxBytes / 1024 / 1024) + ' MB size limit.');
    }
    const mimeType = (audioResponse.headers.get('Content-Type') ?? resultMimeType ?? '')
      .split(';', 1)[0]!.trim().toLowerCase();
    if (!(mimeType.startsWith('audio/') || mimeType === 'application/octet-stream')) {
      throw new Error('AI service returned a file that is not identified as audio.');
    }
    const data = await audioResponse.arrayBuffer();
    if (data.byteLength === 0) throw new Error('AI service returned an empty audio file.');
    if (data.byteLength > this.maxBytes) {
      throw new Error('Generated sample exceeds the ' + Math.round(this.maxBytes / 1024 / 1024) + ' MB size limit.');
    }

    return { jobId, providerId: this.id, fileName, mimeType, data };
  }
}
