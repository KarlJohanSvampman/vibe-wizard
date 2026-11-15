export interface AudioAssetOrigin {
  readonly kind: 'user-import' | 'ai-generated' | 'ai-transformed';
  readonly sourceAssetId?: string;
  readonly providerId?: string;
  readonly jobId?: string;
  readonly prompt?: string;
  readonly createdAt?: string;
}

export interface AudioSampleAsset {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly data: ArrayBuffer;
  readonly updatedAt: string;
  readonly origin?: AudioAssetOrigin;
}

export interface AudioAssetStore {
  save(asset: AudioSampleAsset): Promise<void>;
  load(id: string): Promise<AudioSampleAsset | undefined>;
  list(): Promise<AudioSampleAsset[]>;
  delete(id: string): Promise<void>;
}

const DATABASE_NAME = 'vibe-wizard-audio-assets';
const DATABASE_VERSION = 1;
const SAMPLE_STORE = 'samples';

function cloneAsset(asset: AudioSampleAsset): AudioSampleAsset {
  return {
    ...asset,
    data: asset.data.slice(0),
    ...(asset.origin ? { origin: { ...asset.origin } } : {}),
  };
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SAMPLE_STORE)) {
        database.createObjectStore(SAMPLE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open sample storage.'));
    request.onblocked = () => reject(new Error('Sample storage upgrade is blocked by another tab.'));
  });
}

/** Separate binary asset storage keeps imported/AI audio and provenance out of JSON project snapshots. */
export class IndexedDbAudioAssetStore implements AudioAssetStore {
  private readonly database: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = globalThis.indexedDB) {
    this.database = openDatabase(factory);
  }

  async save(asset: AudioSampleAsset): Promise<void> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(SAMPLE_STORE, 'readwrite');
      transaction.objectStore(SAMPLE_STORE).put(cloneAsset(asset));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the audio sample.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Sample save was aborted.'));
    });
  }

  async list(): Promise<AudioSampleAsset[]> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(SAMPLE_STORE, 'readonly');
      const request = transaction.objectStore(SAMPLE_STORE).getAll();
      request.onsuccess = () => resolve((request.result as AudioSampleAsset[]).map(cloneAsset));
      request.onerror = () => reject(request.error ?? new Error('Could not list audio samples.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Sample listing was aborted.'));
    });
  }

  async delete(id: string): Promise<void> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(SAMPLE_STORE, 'readwrite');
      transaction.objectStore(SAMPLE_STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete the audio sample.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Sample deletion was aborted.'));
    });
  }

  async load(id: string): Promise<AudioSampleAsset | undefined> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(SAMPLE_STORE, 'readonly');
      const request = transaction.objectStore(SAMPLE_STORE).get(id);
      request.onsuccess = () => {
        const asset = request.result as AudioSampleAsset | undefined;
        resolve(asset ? cloneAsset(asset) : undefined);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not read the audio sample.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Sample read was aborted.'));
    });
  }
}

export class MemoryAudioAssetStore implements AudioAssetStore {
  private readonly assets = new Map<string, AudioSampleAsset>();

  async save(asset: AudioSampleAsset): Promise<void> {
    this.assets.set(asset.id, cloneAsset(asset));
  }

  async list(): Promise<AudioSampleAsset[]> {
    return [...this.assets.values()].map(cloneAsset);
  }

  async delete(id: string): Promise<void> {
    this.assets.delete(id);
  }

  async load(id: string): Promise<AudioSampleAsset | undefined> {
    const asset = this.assets.get(id);
    return asset ? cloneAsset(asset) : undefined;
  }
}

export function createAudioAssetStore(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): AudioAssetStore {
  return factory
    ? new IndexedDbAudioAssetStore(factory)
    : new MemoryAudioAssetStore();
}
