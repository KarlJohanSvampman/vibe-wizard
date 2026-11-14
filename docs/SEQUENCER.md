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

1. Start recording.
2. Capture note-on/off events and timestamped controller output signals.
3. Stop recording to commit an in-memory clip.
4. Automatically close note instances still held at stop time.
5. Inspect the X/Y automation lanes and note-duration lane.
6. Play the clip through the same Parameter Bus and instrument rack.

The theremin publishes control signals to observers after routing them through the Parameter Bus. The recorder subscribes to that stream, so it captures the same normalized values regardless of whether a desktop slider or tracked fingertip produced them.

## Playback and scheduling

- The transport uses a short look-ahead scheduler driven by a lightweight interval.
- Each event is translated from clip-relative seconds into a future AudioContext time.
- The audio engine converts the future audio time back into the shared performance-time clock, allowing AudioParam values and notes to be scheduled ahead.
- Playback note IDs are namespaced so recorded voices do not collide with live input note IDs.
- Stopping playback releases notes owned by the playback source.
- Live and playback control signals use the same Parameter Bus mappings.

The render loop is not used as the audio clock. XR frames update tracked input; audio scheduling is performed against AudioContext time.

## Current prototype UI

The workbench exposes Record, Stop recording, Play clip, and Stop playback. Its canvas timeline shows X-axis automation, Y-axis automation, and note blocks showing pitch and held duration.

The clip currently remains in memory for the lifetime of the page. Persistence, multiple tracks, tempo/grid editing, loop sections, and rendered audio recording are future work.

## Automation

The first implementation records source controller output values and replays them through the current Parameter Bus mappings. Changing a mapping can change the result without rewriting the recorded controller trajectory. A future bake-automation operation can store resolved target parameter values when decoupling is desired.
