import { describe, expect, it } from 'vitest';
import { createDefaultProject, updateProjectTiming } from './ProjectModel.js';
import { ProjectHistory } from './ProjectHistory.js';

describe('ProjectHistory', () => {
  it('undoes and redoes immutable project snapshots', () => {
    const original = createDefaultProject('synth-main');
    const changed = updateProjectTiming(original, { tempoBpm: 96 });
    const history = new ProjectHistory();

    history.commit(original, changed);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    const undone = history.undo(changed);
    expect(undone).toBe(original);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    const redone = history.redo(undone!);
    expect(redone).toBe(changed);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it('clears the redo branch after a new edit', () => {
    const first = createDefaultProject('synth-main');
    const second = updateProjectTiming(first, { tempoBpm: 96 });
    const third = updateProjectTiming(first, { tempoBpm: 140 });
    const history = new ProjectHistory();

    history.commit(first, second);
    history.undo(second);
    history.commit(first, third);
    expect(history.canRedo).toBe(false);
  });

  it('keeps history within its configured limit and validates that limit', () => {
    const history = new ProjectHistory(2);
    const first = createDefaultProject('synth-main');
    const second = updateProjectTiming(first, { tempoBpm: 100 });
    const third = updateProjectTiming(second, { tempoBpm: 110 });
    const fourth = updateProjectTiming(third, { tempoBpm: 120 });

    history.commit(first, second);
    history.commit(second, third);
    history.commit(third, fourth);
    expect(history.undoDepth).toBe(2);
    expect(history.undo(fourth)).toBe(third);
    expect(history.undo(third)).toBe(second);
    expect(history.undo(second)).toBeUndefined();
    expect(() => new ProjectHistory(0)).toThrow(/positive integer/i);
  });
});
