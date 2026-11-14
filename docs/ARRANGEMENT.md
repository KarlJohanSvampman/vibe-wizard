# Arrangement Editing

## Arrangement model

The project has one lane per instrument track. Each clip retains its own event list and duration, plus two arrangement-level fields:
- `trackId`: the instrument track that receives the clip.
- `startSeconds`: where the clip begins on the project timeline.

Event offsets remain clip-relative. Moving a clip never rewrites its recorded note or automation events.

## Timeline interaction

The arrangement canvas renders track lanes in track order and clips as blocks:
- Drag horizontally to change a clip's start position.
- Drag vertically to move it onto another instrument lane.
- The start position snaps to 0.25-second increments in the prototype UI.
- A successful move commits through the project model and is saved to IndexedDB.
- Moving a clip to another track changes its playback instrument and the target of its recorded controller automation.

The data model accepts any finite non-negative start position; snapping is a presentation-layer behavior.

## Shared playback

Play arrangement starts one `ArrangementTransport` for the whole project. The transport:
1. Collects the events from all non-empty clips.
2. Computes each event's project time as `clip.startSeconds + event.offsetSeconds`.
3. Sorts events by time with stable source order for equal timestamps.
4. Chooses one future AudioContext start time.
5. Sends each note to the instrument assigned to the clip's owning track.
6. Routes each recorded control signal through the Parameter Bus with the owning instrument as its target scope.
7. Releases active notes when playback is stopped or the arrangement completes.

The global live theremin still fans out to its registered instrument mappings. Arrangement automation is scoped because it belongs to a particular clip/track performance.

The selected-clip Play clip control remains a single-track audition path. Starting arrangement playback or clip audition stops the other mode so overlapping duplicate playback is not accidental.

## Timing limitations

The UI and project store start positions in seconds. Moving clips uses quarter-second snapping, not bars and beats. Tempo and time signature are saved but are not yet used by arrangement placement or transport. There is no loop region, tempo map, clip resizing, trimming, duplication, selection groups, or undo yet.

## Manual acceptance checks

1. Create two instrument tracks and record one clip on each.
2. Drag one clip later in time and verify its saved block stays at that position after reload.
3. Drag a clip to the other track's lane and verify the clip remains intact but now plays through the destination track's instrument.
4. Enable audio and press Play arrangement. Verify both tracks begin in sync and their notes overlap at the intended project times.
5. Change one track's level/pan, mute, and solo settings and confirm the project mixer continues to affect only the intended track.
6. Stop arrangement playback while a long note is held and confirm that the voice is released.
