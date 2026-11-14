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

Project snapshots are versioned and stored in IndexedDB. Schema version 3 stores arrangement positions in quarter-note beats and records the capture tempo for each clip. Version 1 and 2 snapshots are migrated from seconds while preserving their existing audible start positions. The application restores the most recently updated project during startup and offers a selector for saved performances on the active track. Each completed recording is persisted automatically; clip moves and track mixer changes are also saved.

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

The workbench exposes track selection, add instrument, arm, mute, solo, track level, stereo pan, Record, Stop recording, a saved-clip selector, Play clip, and Stop playback. The arrangement view displays one lane per instrument track. Clips can be dragged horizontally to change their start time or vertically to move them to another track. Play arrangement schedules clips from all tracks in sync; Stop arrangement releases held playback notes.

The selected-clip canvas below the arrangement still displays X-axis automation, Y-axis automation, and note blocks showing pitch and held duration.

## Automation

The first implementation records source controller output values and replays them through the current Parameter Bus mappings. Changing a mapping can change the result without rewriting the recorded controller trajectory. During arrangement playback the recorded signal is scoped to the clip's destination instrument, preventing one track's automation from unintentionally changing every other instrument.

A future bake-automation operation can store resolved target parameter values when decoupling is desired.

## Deferred sequencer features

Arrangement placement and shared playback use musical beats and the project's BPM/time signature. The recording and clip-audition paths retain source timestamps in seconds; a clip stores its capture tempo so its events can be interpreted musically when the project tempo changes. Tempo maps, loop sections, clip resizing/trimming, duplication, multi-select, piano-roll note editing, and rendered audio recording remain future work.
