# Projects and Tracks

## Project document

A saved project is a versioned, JSON-serializable snapshot. Schema version 2 stores:
- Project identity and name, creation/update timestamps, tempo, and time signature.
- Stable track IDs, active track ID, instrument-module references, order, mute/solo, and record-arm state.
- Per-track level (0..1) and stereo pan (-1..1).
- Clips with stable IDs, their owning track IDs, arrangement start positions, durations, and typed musical events.

The runtime can create multiple instrument tracks. Each track references a unique instrument module and owns an independent TrackAudioBus. All instrument instances share the project's AudioRuntime and AudioContext.

## Track routing and mixing

Every instrument's output gain connects to its track bus input. The track bus applies the independent track level and stereo pan before connecting to the shared destination. Muting a track sets its effective bus level to zero. When one or more tracks are soloed, only soloed tracks remain audible.

The global theremin controller is routed through Parameter Bus mappings to each track's instrument. Live notes are assigned to the selected active track. Note ownership is retained at note-on so a note-off still reaches the original instrument if the active track changes while the note is held.

A clip is played by the transport belonging to its owning track. Transport playback is mutually exclusive in the current UI, although simultaneous live notes across tracks are supported by the shared audio graph.

## Clip ownership and time

A clip belongs to exactly one track through trackId. Events remain clip-relative and keep their existing typed note/control/gate representation. The clip's startSeconds is its position on the future arrangement timeline; it is zero for newly recorded performances in this milestone.

The project stores tempo and time signature now so the document has a stable musical-session identity. The current recorder and transport still use seconds, not beats. Tempo-aware conversion, musical grid editing, clip resizing, and arrangement playback remain future work.

## Persistence and migration

IndexedDB database: vibe-wizard-projects, version 2, object store: projects (keyPath id). Each write saves one complete project snapshot in a single read/write transaction.

Existing version 1 projects are migrated during the IndexedDB version upgrade. Existing track IDs, instrument IDs, clips, and events are preserved; new track mix fields default to volume 0.8 and pan 0. The data validator rejects unsupported schemas, duplicate IDs, duplicate instrument assignment, orphaned clips, and out-of-range mix values.

On startup, the app loads the most recently updated project. Stopping a recording appends it to the active track and saves the project automatically. The track selector changes the active track and filters the clip selector to clips on that track. The project mixer controls save mute, solo, arm, level, and pan state.

If IndexedDB is missing or cannot be opened, the app switches to a clearly labelled in-memory repository. That fallback is intentionally session-only and does not imply that recordings survived a reload.

## Runtime separation

The project document stores only JSON-compatible domain data. AudioContext, AudioNodes, XR objects, DOM references, timers, controllers, and module instances are reconstructed at runtime and never serialized.

## Known limitations

- Multiple tracks currently instantiate the same prototype oscillator synth; an instrument type chooser and actual piano/sampler modules are future work.
- The arrangement origin is stored in seconds; tempo/grid semantics are not active.
- Parameter mappings and custom rack configuration are initialized by application code rather than persisted as editable rack state.
- There is no cloud sync, cross-device collaboration, undo history, or audio-asset library yet.
