import type { ProjectSnapshot } from './ProjectModel.js';

/**
 * Snapshot-based undo/redo for project edits.
 * The project model is immutable, so storing prior snapshots is cheap and safe.
 */
export class ProjectHistory {
  private readonly past: ProjectSnapshot[] = [];
  private readonly future: ProjectSnapshot[] = [];

  constructor(private readonly limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Project history limit must be a positive integer.');
    }
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoDepth(): number {
    return this.past.length;
  }

  get redoDepth(): number {
    return this.future.length;
  }

  commit(before: ProjectSnapshot, after: ProjectSnapshot): void {
    if (before === after) return;
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }

  undo(current: ProjectSnapshot): ProjectSnapshot | undefined {
    const previous = this.past.pop();
    if (!previous) return undefined;
    this.future.push(current);
    return previous;
  }

  redo(current: ProjectSnapshot): ProjectSnapshot | undefined {
    const next = this.future.pop();
    if (!next) return undefined;
    this.past.push(current);
    if (this.past.length > this.limit) this.past.shift();
    return next;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}
