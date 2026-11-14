# Rack and Module Contracts

## Rack model

A project has one global rack. The rack stores module instances and connections. Tracks refer to instrument instances or instrument output routes; they do not own isolated copies of the module registry.

## Module categories

- **Instrument:** consumes note/control events and produces audio.
- **Effect:** consumes audio and produces audio; exposes parameters.
- **Controller:** consumes physical/virtual input and emits note, gate, or control events.
- **Utility/router:** optional module that transforms or routes events/audio.

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
- expose audio output
- expose parameter descriptors with units and valid ranges
- handle note-on/off, panic, and disposal
- provide serializable configuration and a preset representation

Instruments may accept multiple simultaneous sources (e.g. live theremin and sequencer), with source identity retained so note-off from one source does not release another source's note.

## Controller contract

A controller may emit any declared combination of:
- NoteEvent
- ControlSignal
- GateEvent

A theremin emits X and Y control signals. In harmonic mode, X may also generate quantized note events. Do not force every controller to emit notes.

## Effect contract

An effect exposes audio input/output and parameter descriptors. Effects can be placed in track insert chains or shared send/return paths.

## Registry and lifecycle

The module registry resolves module type IDs to constructors/factories. Creating a module allocates stable identity and validates configuration. Removing a module must detach mappings, event subscriptions, audio connections, and XR representations. Presets capture module type/configuration and connections, not runtime objects.

## Track assignment

A track can receive events from one or several sources and route them to an instrument. Explicitly define whether an instrument may be shared across tracks; initial MVP may enforce one track per instrument instance to keep routing simple, while the rack remains global.
