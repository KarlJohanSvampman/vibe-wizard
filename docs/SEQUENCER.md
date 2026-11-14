# Sequencer and Recording

## Overview

The sequencer records and plays typed musical events and continuous automation. It does not care whether input originated from the virtual piano, theremin, MIDI, future guitar, or another source.

## Event categories

- Note events: note-on/off, pitch, velocity, channel, source, note-instance ID, timestamp.
- Gate events: press/release and related discrete states.
- Control automation: timestamped values tied to controller outputs or parameter destinations.
- Optional audio clips: rendered/captured audio, distinct from editable MIDI/control data.

## Recording

The first capture path uses one monotonic event clock: performance-time seconds.

1. Select and arm an instrument track.
2. Start recording; the recorder remembers that track as the clip destination.
3. Capture note-on/off events and timestamped controller output signals.
4. Stop recording to commit a clip to the armed track.
5. Automatically close note instances still held at stop time.
6. Inspect the X/Y automation lanes and note-duration lane.
7. Audition the selected clip on the instrument assigned to its owning track.

The theremin publishes control signals to observers after routing them through the Parameter Bus. The recorder subscribes to that stream, so it captures the same normalized values regardless of whether a desktop slider or tracked fingertip produced them.

## Project and clip persistence

A project owns stable track records; each clip references one track by `trackId`. The runtime creates one clip-audition transport per instrument track and one project-wide arrangement transport. Recordings are appended to the active armed track, with their original clip-relative event offsets preserved.

Project snapshots are versioned and stored in IndexedDB. Schema version 4 stores arrangement positions and clip lengths in quarter-note beats, records the capture tempo for each clip, and persists a loop region. Version 1, 2, and 3 snapshots are migrated while preserving existing audible clip timing. The application restores the most recently updated project during startup and offers a selector for saved performances on the active track. Each completed recording is persisted automatically; clip moves and track mixer changes are also saved.

The IndexedDB repository writes a complete project snapshot in one transaction. If IndexedDB is unavailable or fails to open, the app uses a session-only memory repository and labels this in the UI. Browser storage is local to the current browser profile and is not a backup or cloud-sync service.

See [Projects and Tracks](PROJECTS_AND_TRACKS.md) and [Arrangement Editing](ARRANGEMENT.md) for the document and interaction contracts.

## Playback and scheduling

- The per-track clip audition transport uses a short look-ahead scheduler.
- The project-wide arrangement transport schedules every clip against one shared AudioContext start time.
- Event time is computed from the beat-based clip position plus the clip-relative offset converted from capture tempo to project tempo.
- Events are sorted once by event time and then by stable source order; they are sent to the instrument belonging to the clip's track.
- Playback note IDs are namespaced by clip and transport sequence so they do not collide with live input or other arranged clips.
- Stopping the arrangement releases notes whose matching note-off events have not yet been scheduled.
- Each clip's recorded controller automation is sent through the Parameter Bus but scoped to the clip's owning instrument. Live controller output remains free to fan out to compatible mapped instruments.

The render loop is not used as the audio clock. XR frames update tracked input; both transports schedule against AudioContext time.

## Current prototype UI

The workbench exposes track selection, add instrument, arm, mute, solo, track level, stereo pan, Record, Stop recording, a saved-clip selector, Play clip, Duplicate clip, and Stop playback. The arrangement view displays one lane per instrument track, a musical playhead, and loop range. Clips can be dragged horizontally to move them, vertically to move them between tracks, or by the right-edge handle to resize their beat length. Play arrangement schedules clips from all tracks in sync; enabled loop regions repeat and release held notes at each boundary.

The selected-clip timeline displays X-axis automation, Y-axis automation, and a compact note overview. The piano roll below it provides editable note blocks on a beat/pitch grid. Click empty cells to add notes; drag note bodies to change pitch and start time; drag right edges to adjust duration; use the velocity slider to alter the selected note; and Delete/Backspace to remove it. The editor works on paired note-on/off events, retaining source/note IDs and unrelated controller events.

## Automation

The first implementation records source controller output values and replays them through the current Parameter Bus mappings. Changing a mapping can change the result without rewriting the recorded controller trajectory. During arrangement playback the recorded signal is scoped to the clip's destination instrument, preventing one track's automation from unintentionally changing every other instrument.

A future bake-automation operation can store resolved target parameter values when decoupling is desired.

## Piano-roll note editing and history

Notes are derived by pairing note-on and note-off events with the same `sourceId` and `noteId`. Piano-roll positions are expressed in quarter-note beats using each clip's `recordedAtTempoBpm`; event offsets are converted back to seconds when a note is moved or resized. Pitch is a MIDI integer from 0 to 127, velocity is normalized from 0 to 1, and note duration must remain positive and within the clip's current `lengthBeats`.

Note creation inserts a new note-on/off pair with a unique note ID. Note movement and resize update both paired event offsets; pitch and velocity changes update the note-on event. Deletion removes only that pair. All other recorded events, including controller automation, remain untouched.

`ProjectHistory` keeps up to 100 prior immutable project snapshots. Committing a new edit clears the redo branch. Undo and redo restore the complete project snapshot and persist it through the same IndexedDB repository.

## Deferred sequencer features

Arrangement placement and shared playback use musical beats and the project's BPM/time signature. The recording path retains source timestamps in seconds; each clip stores its capture tempo so events can be interpreted musically when the project tempo changes. The current loop model stores one fixed bar-aligned region; tempo maps, multiple loop regions, multi-select, piano-roll zoom, multiple velocity lanes, and rendered audio recording remain future work.
