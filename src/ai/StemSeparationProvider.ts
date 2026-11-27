export interface SeparatedStem {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly data: ArrayBuffer;
}

export interface StemSeparationProgress {
  readonly jobId: string;
  readonly status: 'queued' | 'running';
  readonly progress?: number;
  readonly message?: string;
}

interface JobResponse { readonly jobId?: unknown; }
interface StemStatusResponse {
  readonly status?: unknown;
  readonly progress?: unknown;
  readonly message?: unknown;
  readonly result?: { readonly stems?: unknown };
}
interface StemDescriptor {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly downloadUrl: string;
}

function abortError(): Error {
  const error = new Error('Stem separation was cancelled.');
  error.name = 'AbortError';
  return error;
}
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
async function json<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) throw new Error(label + ' failed (HTTP ' + response.status + '): ' + (await response.text()).slice(0, 400));
  return await response.json() as T;
}

/** Uploads a source mix to the local gateway and downloads each separated stem independently. */
export class HttpStemSeparationProvider {
  readonly id = 'eleven-music-stem-separation';
  private readonly base: URL;
  constructor(baseUrl: string, private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis), private readonly pollIntervalMs = 1800, private readonly maxWaitMs = 15 * 60 * 1000) {
    const origin = typeof globalThis.location !== 'undefined' ? globalThis.location.origin : undefined;
    this.base = new URL(baseUrl.trim(), origin);
    if (!['http:', 'https:'].includes(this.base.protocol) || this.base.username || this.base.password) throw new Error('AI service URL must use HTTP(S).');
  }
  async separate(file: File, variation: 'two_stems_v1' | 'six_stems_v1', onProgress?: (p: StemSeparationProgress) => void, signal?: AbortSignal): Promise<{ jobId: string; stems: SeparatedStem[] }> {
    if (!file.size || file.size > 25 * 1024 * 1024 || !file.type.toLowerCase().startsWith('audio/')) throw new Error('Choose an audio file no larger than 25 MB.');
    if (signal?.aborted) throw abortError();
    const base = this.base.href.endsWith('/') ? this.base : new URL(this.base.href + '/');
    const form = new FormData(); form.set('file', file, file.name); form.set('variation', variation);
    const submitted = await json<JobResponse>(await this.fetcher(new URL('audio/stem-separations', base), { method: 'POST', body: form, credentials: 'omit', signal }), 'Stem separation submission');
    if (typeof submitted.jobId !== 'string' || !submitted.jobId) throw new Error('AI gateway returned an invalid stem job ID.');
    const statusUrl = new URL('audio/stem-separations/' + encodeURIComponent(submitted.jobId), base);
    const started = Date.now();
    let descriptors: StemDescriptor[] | undefined;
    while (Date.now() - started < this.maxWaitMs) {
      await wait(this.pollIntervalMs, signal);
      const status = await json<StemStatusResponse>(await this.fetcher(statusUrl, { credentials: 'omit', signal }), 'Stem separation status');
      if (status.status === 'failed') throw new Error(typeof status.message === 'string' ? status.message : 'Stem separation failed.');
      if (status.status === 'queued' || status.status === 'running') {
        onProgress?.({ jobId: submitted.jobId, status: status.status, ...(typeof status.progress === 'number' ? { progress: status.progress } : {}), ...(typeof status.message === 'string' ? { message: status.message } : {}) });
        continue;
      }
      if (status.status !== 'succeeded' || !Array.isArray(status.result?.stems)) throw new Error('Stem gateway returned an invalid completed result.');
      descriptors = status.result.stems as StemDescriptor[];
      break;
    }
    if (!descriptors?.length) throw new Error('Stem separation timed out or returned no stems.');
    const stems: SeparatedStem[] = [];
    for (const stem of descriptors) {
      if (!stem || typeof stem.id !== 'string' || typeof stem.name !== 'string' || typeof stem.downloadUrl !== 'string' || typeof stem.mimeType !== 'string') continue;
      const url = new URL(stem.downloadUrl, base);
      if (url.origin !== base.origin) throw new Error('Stem download URL must remain on the configured AI gateway.');
      const response = await this.fetcher(url, { credentials: 'omit', signal });
      if (!response.ok) throw new Error('Could not download stem "' + stem.name + '" (HTTP ' + response.status + ').');
      const data = await response.arrayBuffer();
      if (!data.byteLength || data.byteLength > 25 * 1024 * 1024) throw new Error('Stem "' + stem.name + '" is empty or exceeds 25 MB.');
      stems.push({ id: stem.id, name: stem.name.split(/[\\/]/).pop()!.slice(0, 120), mimeType: stem.mimeType, data });
    }
    if (!stems.length) throw new Error('No supported stems were returned.');
    return { jobId: submitted.jobId, stems };
  }
}
