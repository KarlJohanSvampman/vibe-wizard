import { describe, expect, it } from 'vitest';
import { EventRecorder } from '../sequencer/Recorder.js';
import {
  addRecordingToProject,
  createDefaultProject,
  validateProjectSnapshot,
} from './ProjectModel.js';

describe('project model', () => {
  it('creates a project with an armed instrument track', () => {
    const project = createDefaultProject('synth-main', new Date('2026-11-14T12:00:00.000Z'));
    expect(project.schemaVersion).toBe(1);
    expect(project.tempoBpm).toBe(120);
    expect(project.tracks).toHaveLength(1);
    expect(project.activeTrackId).toBe(project.tracks[0]?.id);
    expect(project.tracks[0]).toMatchObject({
      kind: 'instrument',
      instrumentModuleId: 'synth-main',
      armed: true,
      muted: false,
      solo: false,
    });
  });

  it('attaches a recorded clip to a track and updates project metadata', () => {
    const project = createDefaultProject('synth-main', new Date('2026-11-14T12:00:00.000Z'));
    const recorder = new EventRecorder();
    recorder.start(10);
    recorder.record({
      kind: 'note-on',
      sourceId: 'theremin-main',
      noteId: 'note-1',
      pitch: 60,
      velocity: 0.8,
      timestamp: 10.1,
    });
    const clip = recorder.stop(10.5, 'clip-1')!;
    const updated = addRecordingToProject(
      project,
      project.activeTrackId,
      clip,
      new Date('2026-11-14T12:01:00.000Z'),
    );

    expect(updated.clips[0]).toMatchObject({
      id: 'clip-1',
      trackId: project.activeTrackId,
      name: 'Performance 01',
      startSeconds: 0,
      durationSeconds: 0.5,
    });
    expect(updated.updatedAt).toBe('2026-11-14T12:01:00.000Z');
    expect(validateProjectSnapshot(updated)).toEqual(updated);
  });

  it('rejects clips that point to a missing track', () => {
    const project = createDefaultProject('synth-main');
    const recorder = new EventRecorder();
    recorder.start(1);
    const clip = recorder.stop(1, 'empty')!;
    expect(() => addRecordingToProject(project, 'missing-track', clip)).toThrow(/unknown track/i);
  });

  it('rejects corrupted clips and unsupported schema versions', () => {
    const project = createDefaultProject('synth-main');
    expect(() => validateProjectSnapshot({
      ...project,
      schemaVersion: 99,
    })).toThrow(/schema version/i);
    expect(() => validateProjectSnapshot({
      ...project,
      clips: [{
        id: 'orphan',
        name: 'Broken',
        trackId: 'missing-track',
        startSeconds: 0,
        createdAt: new Date().toISOString(),
        durationSeconds: 1,
        events: [],
      }],
    })).toThrow(/invalid clip|orphaned/i);
  });
});
