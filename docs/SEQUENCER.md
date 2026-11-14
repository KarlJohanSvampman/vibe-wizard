# Sequencer and Recording

## Overview

The sequencer records and plays typed musical events and continuous automation. It does not care whether input originated from the virtual piano, theremin, MIDI, future guitar, or another instrument.

## Event categories

- Note events: note-on/off, pitch, velocity, channel, source, note-instance ID, timestamp.
- Gate events: press/release and related discrete states.
- Control automation: timestamped values tied to controller outputs or parameter destinations.
- Optional audio clips: rendered/captured audio, distinct from editable MIDI/control data.

## Recording

1. Select a track.
2. Assign or create instrument.
3. Select one or more input sources.
4. Arm recording.
5. Start transport/record.
6. Capture events with stable timestamps and source identity.
7. Stop and commit a clip.
8. Edit/replay.

Recording input events and rendered audio are separate modes. Do not confuse a recorded controller trajectory with an audio recording.

## Playback

The transport converts musical positions into scheduled audio times. Notes and automation are scheduled against the audio clock. Live input and playback may coexist; define merge/priority rules and preserve source IDs.

## Arrangement views

- Arrangement: tracks, clips, tempo, time signature, automation lanes.
- Piano roll: note pitch, start, duration, velocity.
- Rack: module instances, routing, parameters, mappings.
- Mixer: track gain/pan, inserts, sends, master.

## Editing

Support move, resize, split, delete, quantize, duplicate, and loop. Preserve original captured timing until the user explicitly quantizes.

## Automation

Automation may represent source controller movement or resolved target parameter values. Prefer retaining source identity and mapping reference so users can edit mappings later; optionally allow a “freeze/bake automation” operation to store final parameter values when decoupling is desired.
