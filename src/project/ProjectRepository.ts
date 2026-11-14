import {
  migrateProjectRecord,
  validateProjectSnapshot,
  type ProjectSnapshot,
} from './ProjectModel.js';

export interface ProjectRepository {
  readonly durability: 'persistent' | 'ephemeral';
  loadLatest(): Promise<ProjectSnapshot | undefined>;
  save(snapshot: ProjectSnapshot): Promise<void>;
}

const DATABASE_NAME = 'vibe-wizard-projects';
const DATABASE_VERSION = 3;
const PROJECT_STORE = 'projects';

function cloneSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ProjectSnapshot;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction;
      let store: IDBObjectStore;

      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        store = database.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      } else {
        store = transaction!.objectStore(PROJECT_STORE);
      }

      if (event.oldVersion > 0 && event.oldVersion < 3) {
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          try {
            cursor.update(migrateProjectRecord(cursor.value));
          } catch (error) {
            transaction!.abort();
            reject(error);
            return;
          }
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open project storage.'));
    request.onblocked = () => reject(new Error('Project storage upgrade is blocked by another tab.'));
  });
}

/** IndexedDB-backed, atomic snapshot persistence for browser projects. */
export class IndexedDbProjectRepository implements ProjectRepository {
  readonly durability = 'persistent' as const;
  private readonly database: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = globalThis.indexedDB) {
    this.database = openDatabase(factory);
  }

  async loadLatest(): Promise<ProjectSnapshot | undefined> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, 'readonly');
      const request = transaction.objectStore(PROJECT_STORE).getAll();
      request.onsuccess = () => {
        try {
          const projects = (request.result as unknown[])
            .map((item) => validateProjectSnapshot(migrateProjectRecord(item)))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          resolve(projects[0]);
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('Could not read local projects.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Project read was aborted.'));
    });
  }

  async save(snapshot: ProjectSnapshot): Promise<void> {
    const safeSnapshot = validateProjectSnapshot(snapshot);
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, 'readwrite');
      transaction.objectStore(PROJECT_STORE).put(cloneSnapshot(safeSnapshot));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the project.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Project save was aborted.'));
    });
  }
}

export class MemoryProjectRepository implements ProjectRepository {
  readonly durability = 'ephemeral' as const;
  private readonly projects = new Map<string, ProjectSnapshot>();

  async loadLatest(): Promise<ProjectSnapshot | undefined> {
    const latest = [...this.projects.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return latest ? cloneSnapshot(latest) : undefined;
  }

  async save(snapshot: ProjectSnapshot): Promise<void> {
    const safeSnapshot = validateProjectSnapshot(snapshot);
    this.projects.set(safeSnapshot.id, cloneSnapshot(safeSnapshot));
  }
}

export function createProjectRepository(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): ProjectRepository {
  return factory
    ? new IndexedDbProjectRepository(factory)
    : new MemoryProjectRepository();
}
