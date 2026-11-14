import { describe, expect, it } from 'vitest';
import { EventRecorder } from '../sequencer/Recorder.js';
import {
  addInstrumentTrack,
  addRecordingToProject,
  createDefaultProject,
  getArrangementDurationBeats,
  projectClipToRecordingClip,
  updateProjectTiming,
  migrateProjectRecord,
  moveProjectClip,
  setActiveProjectTrack,
  updateProjectTrack,
  validateProjectSnapshot,
} from './ProjectModel.js';

describe('project model', () => {
  it('creates a project with a ready-to-mix instrument track', () => {
    const project = createDefaultProject('synth-main', new Date('2026-11-14T12:00:00.000Z'));
    expect(project.schemaVersion).toBe(3);
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
      startBeats: 0,
      recordedAtTempoBpm: 120,
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

  it('moves a clip to another track and updates the arrangement duration', () => {
    const firstProject = createDefaultProject('synth-main');
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
    const recording = recorder.stop(11, 'clip-move')!;
    const withClip = addRecordingToProject(
      firstProject,
      firstProject.activeTrackId,
      recording,
    );
    const withSecondTrack = addInstrumentTrack(withClip, 'Second', 'synth-second');
    const targetTrackId = withSecondTrack.activeTrackId;
    const moved = moveProjectClip(
      withSecondTrack,
      recording.id,
      targetTrackId,
      3.25,
      new Date('2026-11-14T12:02:00.000Z'),
    );

    expect(moved.clips[0]).toMatchObject({
      id: recording.id,
      trackId: targetTrackId,
      startBeats: 3.25,
    });
    expect(getArrangementDurationBeats(moved)).toBe(16);
    expect(getArrangementDurationBeats(moved, 1)).toBeCloseTo(5.25);
    expect(projectClipToRecordingClip(moved.clips[0]!, 60).durationSeconds).toBe(2);
  });

  it('rejects negative positions and unknown tracks when moving clips', () => {
    const project = createDefaultProject('synth-main');
    expect(() => moveProjectClip(project, 'missing', project.activeTrackId, 0))
      .toThrow(/unknown clip/i);
    expect(() => moveProjectClip(project, 'missing', 'missing-track', 0))
      .toThrow(/unknown track/i);
  });

  it('migrates a version 1 project while preserving its tracks and clips', () => {
    const project = createDefaultProject('synth-main');
    const version1 = {
      ...project,
      schemaVersion: 1,
      tracks: project.tracks.map(({ volume: _volume, pan: _pan, ...track }) => track),
    };
    const migrated = validateProjectSnapshot(migrateProjectRecord(version1));
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.tracks[0]).toMatchObject({ volume: 0.8, pan: 0 });
    expect(migrated.id).toBe(project.id);
  });

  it('migrates legacy second positions into beats without changing audible timing', () => {
    const project = createDefaultProject('synth-main');
    const legacy = {
      ...project,
      schemaVersion: 2,
      tempoBpm: 100,
      clips: [{
        id: 'legacy-clip',
        name: 'Legacy',
        trackId: project.activeTrackId,
        startSeconds: 3,
        createdAt: new Date().toISOString(),
        durationSeconds: 1.2,
        events: [{ offsetSeconds: 0.6, event: {
          kind: 'note-on', sourceId: 'piano', noteId: 'n', pitch: 60, velocity: 0.8, timestamp: 1,
        } }],
      }],
    };
    const migrated = validateProjectSnapshot(migrateProjectRecord(legacy));
    expect(migrated.clips[0]).toMatchObject({ startBeats: 5, recordedAtTempoBpm: 100 });
    expect(projectClipToRecordingClip(migrated.clips[0]!, 100).events[0]?.offsetSeconds).toBe(0.6);
  });

  it('updates tempo and time signature while retaining clip beat positions', () => {
    const project = createDefaultProject('synth-main');
    const updated = updateProjectTiming(project, {
      tempoBpm: 96,
      timeSignature: { numerator: 3, denominator: 4 },
    });
    expect(updated).toMatchObject({
      tempoBpm: 96,
      timeSignature: { numerator: 3, denominator: 4 },
    });
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
        startBeats: 0,
        recordedAtTempoBpm: 120,
        createdAt: new Date().toISOString(),
        durationSeconds: 1,
        events: [],
      }],
    })).toThrow(/invalid clip|orphaned/i);
  });
});
