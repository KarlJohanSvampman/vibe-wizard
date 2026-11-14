# Arrangement Editing

## Arrangement model

The project has one lane per instrument track. Each clip retains its own event list and duration, plus three timing/ownership fields:
- `trackId`: the instrument track that receives the clip.
- `startBeats`: where the clip begins on the project timeline, in quarter-note beats.
- `recordedAtTempoBpm`: the tempo at which the performance was captured.

Event offsets and duration remain clip-relative seconds, interpreted at `recordedAtTempoBpm`. The arrangement converts those offsets into musical time and scales them against the current project tempo. Moving a clip never rewrites its recorded note or automation events.

## Timeline interaction

The arrangement canvas renders track lanes in track order and clips as blocks:
- Drag horizontally to change a clip's start position.
- Drag vertically to move it onto another instrument lane.
- The ruler displays bars using the project's time signature.
- Drag positions snap to a user-selected musical subdivision (quarter, eighth, sixteenth, thirty-second note, or off).
- A successful move commits through the project model and is saved to IndexedDB.
- Moving a clip to another track changes its playback instrument and the target of its recorded controller automation.

The data model accepts any finite non-negative beat position; snapping is a presentation-layer behavior.

## Shared playback

Play arrangement starts one `ArrangementTransport` for the whole project. The transport:
1. Collects the events from all non-empty clips.
2. Computes each event's project time from the beat-based clip position, converting clip-relative seconds from the capture tempo to project tempo.
3. Sorts events by time with stable source order for equal timestamps.
4. Chooses one future AudioContext start time.
5. Sends each note to the instrument assigned to the clip's owning track.
6. Routes each recorded control signal through the Parameter Bus with the owning instrument as its target scope.
7. Releases active notes when playback is stopped or the arrangement completes.

The global live theremin still fans out to its registered instrument mappings. Arrangement automation is scoped because it belongs to a particular clip/track performance.

The selected-clip Play clip control remains a single-track audition path. Starting arrangement playback or clip audition stops the other mode so overlapping duplicate playback is not accidental.

## Timing limitations

The project stores clip start positions in quarter-note beats. A bar contains `numerator × 4 / denominator` quarter-note beats, allowing signatures such as 3/4 and 6/8 to share one timeline representation. Project tempo converts beat positions to AudioContext seconds; each clip's captured tempo converts its relative event seconds to musical time. Tempo changes therefore preserve clip placement and note relationships while changing playback duration. There is no tempo map, loop region, clip resizing, trimming, duplication, selection groups, or undo yet.

## Manual acceptance checks

1. Create two instrument tracks and record one clip on each.
2. Drag one clip later in time and verify its saved block stays at that position after reload.
3. Drag a clip to the other track's lane and verify the clip remains intact but now plays through the destination track's instrument.
4. Enable audio and press Play arrangement. Verify both tracks begin in sync and their notes overlap at the intended project times.
5. Change one track's level/pan, mute, and solo settings and confirm the project mixer continues to affect only the intended track.
6. Stop arrangement playback while a long note is held and confirm that the voice is released.
