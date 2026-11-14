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
7. Play the selected clip through the Parameter Bus and the instrument assigned to its owning track.

The theremin publishes control signals to observers after routing them through the Parameter Bus. The recorder subscribes to that stream, so it captures the same normalized values regardless of whether a desktop slider or tracked fingertip produced them.

## Project and clip persistence

A project owns stable track records; each clip references one track by trackId. The runtime creates one transport per instrument track. Recordings are appended to the active armed track, with their original clip-relative event offsets preserved. Selecting a different track filters the clip picker to that track's clips.

Project snapshots are versioned and stored in IndexedDB. The application restores the most recently updated project during startup and offers a selector for its saved performances. Each completed recording is persisted automatically; project renames are saved with Save project.

The IndexedDB repository writes a complete project snapshot in one transaction. If IndexedDB is unavailable or fails to open, the app uses a session-only memory repository and labels this in the UI. Browser storage is local to the current browser profile and is not a backup or cloud-sync service.

See [Projects and Tracks](PROJECTS_AND_TRACKS.md) for the document schema and storage contract.

## Playback and scheduling

- The transport uses a short look-ahead scheduler driven by a lightweight interval.
- Each event is translated from clip-relative seconds into a future AudioContext time.
- The audio engine converts the future audio time back into the shared performance-time clock, allowing AudioParam values and notes to be scheduled ahead.
- Playback note IDs are namespaced so recorded voices do not collide with live input note IDs.
- Stopping playback releases notes owned by the playback source.
- Live and playback control signals use the same global Parameter Bus mappings. In this prototype, a controller's X/Y signals fan out to the compatible instrument parameters registered on each track.

The render loop is not used as the audio clock. XR frames update tracked input; audio scheduling is performed against AudioContext time.

## Current prototype UI

The workbench exposes track selection, add instrument, arm, mute, solo, track level, stereo pan, Record, Stop recording, a saved-performance selector, Play clip, and Stop playback. Each clip is played by the transport associated with its owning track. The current UI stops other clip transports before starting a selected clip; simultaneous arrangement playback is deferred. The canvas timeline shows X-axis automation, Y-axis automation, and note blocks showing pitch and held duration.

## Automation

The first implementation records source controller output values and replays them through the current Parameter Bus mappings. Changing a mapping can change the result without rewriting the recorded controller trajectory. A future bake-automation operation can store resolved target parameter values when decoupling is desired.

## Deferred sequencer features

The project already reserves tempo and time-signature metadata, but transport and event offsets remain seconds-based. Musical beat conversion, tempo maps, quantization, loop sections, clip editing, simultaneous arrangement playback across tracks, and rendered audio recording remain future work.
