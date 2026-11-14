# Projects and Tracks

## Project document

A saved project is a versioned, JSON-serializable snapshot. Version 1 stores:
- Project identity and name, creation/update timestamps, tempo, and time signature.
- Stable track IDs, active track ID, instrument-module references, order, mute/solo, and record-arm state.
- Clips with stable IDs, their owning track IDs, arrangement start positions, durations, and typed musical events.

The current runtime creates one instrument track referencing the prototype synth module. The schema supports multiple instrument tracks, but independent track audio buses, track creation UI, and multi-instrument playback are not implemented yet.

## Clip ownership and time

A clip belongs to exactly one track through trackId. Events remain clip-relative and keep their existing typed note/control/gate representation. The clip's startSeconds is its position on the future arrangement timeline; it is zero for newly recorded performances in this milestone.

The project stores tempo and time signature now so the document has a stable musical-session identity. The current recorder and transport still use seconds, not beats. Tempo-aware conversion, musical grid editing, clip resizing, and arrangement playback are follow-up work.

## Persistence

IndexedDB database: vibe-wizard-projects, version 1, object store: projects (keyPath id). Each write saves one complete project snapshot in a single read/write transaction. This avoids partially saved track/clip relationships while the document remains small.

On startup, the app loads the most recently updated project. Stopping a recording appends it to the active track and saves the project automatically. The performance selector lets the user choose between saved clips. Save project persists project-name changes and the current document.

If IndexedDB is missing or cannot be opened, the app switches to a clearly labelled in-memory repository. That fallback is intentionally session-only and does not imply that recordings survived a reload.

## Validation and schema evolution

Every loaded or saved snapshot is validated: supported schema version, project metadata, unique track and clip IDs, valid active track, valid track references, event shapes, and finite event offsets. A future schema change must add an explicit migration before incrementing PROJECT_SCHEMA_VERSION; silently interpreting unknown versions is not allowed.

The database stores JSON-compatible domain data only. Runtime AudioNodes, XR objects, DOM references, timers, and module instances never enter the project document.

## Known limitations

- The active app only reconstructs its built-in synth and theremin; instrument parameter mappings and custom rack module state are still initialized by application code.
- Only instrument tracks are represented. Audio tracks, buses, effect chains, track gain/pan, and routing are future extensions.
- The arrangement origin is stored in seconds; tempo/grid semantics are not active.
- There is no cloud sync, cross-device collaboration, undo history, or audio-asset library yet.
