import type { RackModule } from './types.js';

/** One project-wide registry for instruments, effects, controllers, and utilities. */
export class Rack {
  private readonly moduleMap = new Map<string, RackModule>();

  add<T extends RackModule>(module: T): T {
    if (this.moduleMap.has(module.id)) {
      throw new Error(`A rack module with id "${module.id}" already exists.`);
    }
    this.moduleMap.set(module.id, module);
    return module;
  }

  get<T extends RackModule = RackModule>(id: string): T | undefined {
    return this.moduleMap.get(id) as T | undefined;
  }

  list(): readonly RackModule[] {
    return [...this.moduleMap.values()];
  }

  async remove(id: string): Promise<boolean> {
    const module = this.moduleMap.get(id);
    if (!module) return false;
    this.moduleMap.delete(id);
    await module.dispose?.();
    return true;
  }

  async dispose(): Promise<void> {
    const modules = [...this.moduleMap.values()];
    this.moduleMap.clear();
    await Promise.all(modules.map((module) => module.dispose?.()));
  }
}
