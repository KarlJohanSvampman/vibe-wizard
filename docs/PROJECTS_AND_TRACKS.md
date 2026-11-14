# Projects and Tracks

## Project document

A saved project is a versioned, JSON-serializable snapshot. Schema version 2 stores:
- Project identity and name, creation/update timestamps, tempo, and time signature.
- Stable track IDs, active track ID, instrument-module references, order, mute/solo, and record-arm state.
- Per-track level (0..1) and stereo pan (-1..1).
- Clips with stable IDs, owning track IDs, arrangement start positions, durations, creation times, and typed musical events.

The runtime can create multiple instrument tracks. Each track references a unique instrument module and owns an independent TrackAudioBus. All instrument instances share the project's AudioRuntime and AudioContext.

## Track routing and mixing

Every instrument's output gain connects to its track bus input. The track bus applies independent track level and stereo pan before connecting to the shared destination. Muting a track sets its effective bus level to zero. When one or more tracks are soloed, only soloed tracks remain audible.

The global theremin controller is routed through Parameter Bus mappings to each track's instrument. Live notes are assigned to the selected active track. Note ownership is retained at note-on so a note-off still reaches the original instrument if the active track changes while the note is held.

## Clip ownership and arrangement position

A clip belongs to exactly one track through `trackId`. Its events remain clip-relative: the first event is still at offset zero even when the clip is moved later in the arrangement. `startSeconds` is the clip's position on the project timeline.

A clip can be moved horizontally to change `startSeconds`, or vertically to change `trackId`. Moving it to another lane changes which instrument receives its note events and scopes its recorded controller automation to that instrument. The clip's event content and IDs remain unchanged.

The arrangement view orders lanes by each track's `order` field. Newly recorded clips start at zero; moving a clip snaps the UI position to quarter-second increments. The project model itself stores a finite non-negative seconds value and does not enforce the UI snap.

## Audio playback

One shared ArrangementTransport schedules events from all clips against one AudioContext start time. The transport sorts events by arrangement position, then by their stable source order. Each note event is dispatched to the instrument assigned to its owning track, while controller automation is routed through the Parameter Bus with that track's instrument as its target scope.

The track mixer remains independent of clip placement: mute, solo, volume, and pan are applied in the track's audio bus. A selected clip can also be auditioned on its own through the per-track clip transport. Starting either playback mode stops the other mode.

The arrangement transport uses look-ahead scheduling and a single scheduler clock. This avoids the small start-time skew that would result from independently starting one timer/transport per track.

## Tempo and time

The project stores tempo and time signature, but this arrangement prototype still uses seconds for clip positions and event offsets. Musical beat conversion, tempo maps, bar/beat grid, quantization, loop sections, clip resizing, and snap settings remain future work.

## Persistence and migration

IndexedDB database: vibe-wizard-projects, version 2, object store: projects (keyPath id). Each write saves one complete project snapshot in a single read/write transaction.

Existing version 1 projects are migrated during the IndexedDB version upgrade. Existing track IDs, instrument IDs, clips, and events are preserved; new track mix fields default to volume 0.8 and pan 0. The data validator rejects unsupported schemas, duplicate IDs, duplicate instrument assignment, orphaned clips, and out-of-range mix values.

On startup, the app loads the most recently updated project. Stopping a recording appends a clip to the armed track and saves the project automatically. Track selection filters the clip selector to clips on that track. Track mixer controls and arrangement clip moves are also saved.

If IndexedDB is missing or cannot be opened, the app switches to a clearly labelled in-memory repository. That fallback is intentionally session-only and does not imply that recordings survived a reload.

## Runtime separation

The project document stores only JSON-compatible domain data. AudioContext, AudioNodes, XR objects, DOM references, timers, controllers, and module instances are reconstructed at runtime and never serialized.

## Known limitations

- Multiple tracks currently instantiate the same prototype oscillator synth; an instrument type chooser and actual piano/sampler modules are future work.
- The arrangement UI uses a seconds scale and simple quarter-second snapping, not a tempo-aware musical grid.
- The prototype moves clips by dragging; it does not yet support resizing, trimming, duplication, or multi-select.
- Parameter mappings and custom rack configuration are initialized by application code rather than persisted as editable rack state.
- There is no cloud sync, cross-device collaboration, undo history, or audio-asset library yet.
