import { describe, expect, it } from 'vitest';
import { EventRecorder } from '../sequencer/Recorder.js';
import {
  addInstrumentTrack,
  addRecordingToProject,
  createDefaultProject,
  migrateProjectRecord,
  setActiveProjectTrack,
  updateProjectTrack,
  validateProjectSnapshot,
} from './ProjectModel.js';

describe('project model', () => {
  it('creates a project with a ready-to-mix instrument track', () => {
    const project = createDefaultProject('synth-main', new Date('2026-11-14T12:00:00.000Z'));
    expect(project.schemaVersion).toBe(2);
    expect(project.tempoBpm).toBe(120);
    expect(project.tracks).toHaveLength(1);
    expect(project.activeTrackId).toBe(project.tracks[0]?.id);
    expect(project.tracks[0]).toMatchObject({
      kind: 'instrument',
      instrumentModuleId: 'synth-main',
      armed: true,
      muted: false,
      solo: false,
      volume: 0.8,
      pan: 0,
    });
  });

  it('adds an independently identified instrument track and switches record arm', () => {
    const project = createDefaultProject('synth-main');
    const second = addInstrumentTrack(project, 'Piano Layer', 'synth-piano');
    expect(second.tracks).toHaveLength(2);
    expect(second.activeTrackId).toBe(second.tracks[1]?.id);
    expect(second.tracks[0]?.armed).toBe(false);
    expect(second.tracks[1]).toMatchObject({
      name: 'Piano Layer',
      instrumentModuleId: 'synth-piano',
      armed: true,
      volume: 0.8,
      pan: 0,
    });
    expect(() => addInstrumentTrack(second, 'Duplicate', 'synth-piano'))
      .toThrow(/already assigned/i);
  });

  it('updates track mix and selection without changing clip ownership', () => {
    const project = createDefaultProject('synth-main');
    const second = addInstrumentTrack(project, 'Second', 'synth-second');
    const trackId = project.activeTrackId;
    const mixed = updateProjectTrack(second, trackId, {
      volume: 0.42,
      pan: -0.5,
      muted: true,
      solo: true,
    });
    const selected = setActiveProjectTrack(mixed, trackId);
    expect(selected.activeTrackId).toBe(trackId);
    expect(selected.tracks.find(track => track.id === trackId)).toMatchObject({
      volume: 0.42,
      pan: -0.5,
      muted: true,
      solo: true,
    });
  });

  it('attaches a recorded clip to its owning track and updates project metadata', () => {
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

  it('migrates a version 1 project while preserving its tracks and clips', () => {
    const project = createDefaultProject('synth-main');
    const version1 = {
      ...project,
      schemaVersion: 1,
      tracks: project.tracks.map(({ volume: _volume, pan: _pan, ...track }) => track),
    };
    const migrated = validateProjectSnapshot(migrateProjectRecord(version1));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.tracks[0]).toMatchObject({ volume: 0.8, pan: 0 });
    expect(migrated.id).toBe(project.id);
  });

  it('rejects invalid track mix values, duplicate module assignments, and unsupported schemas', () => {
    const project = createDefaultProject('synth-main');
    expect(() => validateProjectSnapshot({ ...project, schemaVersion: 99 }))
      .toThrow(/schema version/i);
    expect(() => validateProjectSnapshot({
      ...project,
      tracks: project.tracks.map(track => ({ ...track, pan: 2 })),
    })).toThrow(/invalid track/i);
    expect(() => validateProjectSnapshot({
      ...project,
      tracks: [...project.tracks, {
        ...project.tracks[0]!,
        id: 'second-track',
        name: 'Second',
        order: 1,
      }],
    })).toThrow(/more than one track/i);
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
