# Rack and Module Contracts

## Rack model

A project has one global rack. The rack stores module instances and connections. Tracks reference an instrument instance and its independent audio output bus; the rack remains global rather than being duplicated per track.

## Module categories

- **Instrument:** consumes note/control events and produces audio.
- **Effect:** consumes audio and produces audio; exposes parameters.
- **Controller:** consumes physical/virtual input and emits note, gate, or control events.
- **Utility/router:** optional module that transforms or routes events/audio. A TrackAudioBus is the per-track output utility in the current prototype.

## Common module metadata

Every module has:
- stable instance ID
- module type and schema version
- display name
- category
- serializable configuration
- declared input and output ports
- parameter descriptors
- lifecycle state

Runtime objects (AudioNodes, XR entities, event subscriptions) are not serialized.

## Port types

- `note-event`
- `control-signal`
- `gate-event`
- `audio`
- `clock`

Port definitions include direction, cardinality, accepted source types, and optional channel semantics.

## Instrument contract

An instrument must:
- declare accepted musical/control event types
- expose an audio output
- expose parameter descriptors with units and valid ranges
- handle note-on/off, panic, and disposal
- provide serializable configuration and a preset representation

Multiple instruments share the project's AudioRuntime but retain independent voices and output gain stages. One instrument instance is assigned to at most one track in schema version 2. This keeps ownership and track mixing unambiguous.

## Controller contract

A controller may emit any declared combination of:
- NoteEvent
- ControlSignal
- GateEvent

A theremin emits X and Y control signals. The same global controller can fan out to compatible parameters on multiple rack instruments through the Parameter Bus.

## Track audio bus

Each instrument track has a TrackAudioBus between its instrument output and the shared destination. It currently provides:
- track level (0..1)
- stereo pan (-1..1)
- mute and solo behavior resolved by the project mixer

The instrument's own output level remains separate from the track fader so expression controls do not overwrite the user's mix level. The bus is the future insertion point for track effects and sends.

## Effect contract

An effect exposes audio input/output and parameter descriptors. Effects can be placed in track insert chains or shared send/return paths.

## Registry and lifecycle

The module registry resolves module type IDs to constructors/factories. Creating a module allocates stable identity and validates configuration. Removing a module must detach mappings, event subscriptions, audio connections, and XR representations. Presets capture module type/configuration and connections, not runtime objects.
