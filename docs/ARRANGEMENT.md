# Arrangement Editing

## Arrangement model

The project has one lane per instrument track. Each clip retains its own event list and duration, plus three timing/ownership fields:
- `trackId`: the instrument track that receives the clip.
- `startBeats`: where the clip begins on the project timeline, in quarter-note beats.
- `lengthBeats`: the non-destructive visible/playable clip length.
- `recordedAtTempoBpm`: the tempo at which the performance was captured.

Event offsets and the original recorded duration remain clip-relative seconds, interpreted at `recordedAtTempoBpm`. The arrangement converts those offsets into musical time and scales them against the current project tempo. Moving or resizing a clip never rewrites its recorded note or automation events.

## Timeline interaction

The arrangement canvas renders track lanes in track order and clips as blocks:
- Drag horizontally to change a clip's start position.
- Drag vertically to move it onto another instrument lane.
- The ruler displays bars using the project's time signature.
- Drag positions snap to a user-selected musical subdivision (quarter, eighth, sixteenth, thirty-second note, or off).
- Drag a clip's right edge to resize its non-destructive musical length. Events beyond the clip edge are skipped until the clip is extended again.
- Use Duplicate clip to create a content-identical copy immediately after the source clip.
- Set Loop In/Out by bar number and enable Loop arrangement to repeat that region.
- A vertical playhead marks current playback position; it wraps within an active loop.
- Successful edits commit through the project model and are saved to IndexedDB.
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
7. Releases active notes when playback is stopped, the arrangement completes, or a loop boundary is reached.

The global live theremin still fans out to its registered instrument mappings. Arrangement automation is scoped because it belongs to a particular clip/track performance.

The selected-clip Play clip control remains a single-track audition path. Starting arrangement playback or clip audition stops the other mode so overlapping duplicate playback is not accidental.

## Piano-roll editing

The selected clip's piano roll pairs each note-on with its matching note-off using the event's `sourceId` and `noteId`. Note start and duration are displayed in quarter-note beats using the clip's recorded tempo, so changing project BPM does not rewrite the captured musical positions.

- Click an empty pitch/time cell to add a note on the current grid snap; new notes default to one beat or the remaining clip length.
- Drag a note body to move it in time and pitch. Drag the right edge to change its duration.
- Select a note and use the velocity slider to edit its normalized velocity; Delete or Backspace removes it.
- Edits update both paired note events, preserve unrelated controller automation, and save the project.
- The editor shows the full MIDI pitch range needed by the clip; longer note ranges use vertical scrolling.

Undo/Redo uses bounded immutable project snapshots (up to 100 commits). It covers piano-roll note edits, clip moves/resizes, and clip duplication. The toolbar buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Y shortcuts are supported.

## Timing limitations

The project stores clip start positions and lengths in quarter-note beats. A bar contains `numerator × 4 / denominator` quarter-note beats, allowing signatures such as 3/4 and 6/8 to share one timeline representation. Project tempo converts beat positions to AudioContext seconds; each clip's captured tempo converts its relative event seconds to musical time. Tempo changes therefore preserve clip placement and note relationships while changing playback duration. Loop In/Out are stored as beat positions and expressed in bars in the UI. Clip resizing changes only `lengthBeats`; event data remains intact. Tempo maps, selection groups, piano-roll zoom, multiple velocity lanes, and a full MIDI workflow remain future work.

## Manual acceptance checks

1. Create two instrument tracks and record one clip on each.
2. Drag one clip later in time and verify its saved block stays at that position after reload.
3. Drag a clip to the other track's lane and verify the clip remains intact but now plays through the destination track's instrument.
4. Enable audio and press Play arrangement. Verify both tracks begin in sync and their notes overlap at the intended project times.
5. Change one track's level/pan, mute, and solo settings and confirm the project mixer continues to affect only the intended track.
6. Stop arrangement playback while a long note is held and confirm that the voice is released.
7. Enable a loop spanning two or more bars, play across the loop out point, and confirm that the playhead wraps and held notes release cleanly.
8. Shorten a clip with its right-edge handle, play it, then extend it again and confirm the previously hidden events are still present.
9. Duplicate a clip and verify the copy retains its events and starts immediately after the source clip.
10. Add a note in the piano roll, move it, resize it, change velocity, and delete it; verify each edit persists after reload.
11. Undo and redo multiple note edits and confirm the paired note-on/note-off events and unaffected automation are restored exactly.
