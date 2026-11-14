# Projects and Tracks

## Project document

A saved project is a versioned, JSON-serializable snapshot. Schema version 4 stores:
- Project identity and name, creation/update timestamps, tempo, and time signature.
- Stable track IDs, active track ID, instrument-module references and instrument family (`synth`, `piano`, `drums`, or `sampler`), order, mute/solo, and record-arm state.
- Optional sampler asset ID and original filename; binary audio bytes live separately in the local IndexedDB audio-asset database.
- Per-track level (0..1) and stereo pan (-1..1).
- Clips with stable IDs, owning track IDs, beat-based start positions and lengths, capture tempo, original recorded durations, creation times, and typed musical events.
- A project loop region with an enabled flag and start/end positions in quarter-note beats.

The runtime can create multiple instrument tracks and each track chooses an instrument family. Every track references a unique instrument module and owns an independent TrackAudioBus. All instrument instances share the project's AudioRuntime and AudioContext. Legacy project tracks without an `instrumentType` field are normalized to `synth` when loaded, so this addition does not require a project schema bump.

## Track routing and mixing

Every instrument's output gain connects to its track bus input. The track bus applies independent track level and stereo pan before connecting to the shared destination. Muting a track sets its effective bus level to zero. When one or more tracks are soloed, only soloed tracks remain audible.

The global theremin controller is routed through Parameter Bus mappings to each track's instrument. Live notes are assigned to the selected active track. Note ownership is retained at note-on so a note-off still reaches the original instrument if the active track changes while the note is held.

## Clip ownership and arrangement position

A clip belongs to exactly one track through `trackId`. Its events remain clip-relative: the first event is still at offset zero even when the clip is moved later in the arrangement. `startBeats` is its position on the project timeline in quarter-note beats; `lengthBeats` is the visible/playable extent; and `recordedAtTempoBpm` records the tempo at which its clip-relative seconds were captured.

A clip can be moved horizontally to change `startBeats`, or vertically to change `trackId`. Moving it to another lane changes which instrument receives its note events and scopes its recorded controller automation to that instrument. The clip's event content and IDs remain unchanged.

The arrangement view orders lanes by each track's `order` field. Newly recorded clips start at beat zero. The ruler displays bars and beats using the project time signature; clip movement snaps to the selected musical subdivision (quarter, eighth, sixteenth, thirty-second note, or off). The project model itself stores any finite non-negative beat position and does not enforce the UI snap.

## Audio playback

One shared ArrangementTransport schedules events from all clips against one AudioContext start time. The transport sorts events by arrangement position, then by their stable source order. Each note event is dispatched to the instrument assigned to its owning track, while controller automation is routed through the Parameter Bus with that track's instrument as its target scope.

The track mixer remains independent of clip placement: mute, solo, volume, and pan are applied in the track's audio bus. A selected clip can also be auditioned on its own through the per-track clip transport. Starting either playback mode stops the other mode.

The arrangement transport uses look-ahead scheduling and a single scheduler clock. This avoids the small start-time skew that would result from independently starting one timer/transport per track.

## Tempo and time

Project tempo converts quarter-note beat positions to AudioContext seconds. Each clip's captured tempo converts its relative event seconds into musical duration and event timing. Changing BPM therefore preserves the arrangement's beat positions and note relationships while changing playback speed. Time signature determines bar length and the displayed ruler; BPM is expressed as quarter-note beats per minute. Loop regions are stored in beats and edited using bar numbers. Resizing changes `lengthBeats` only; playback ignores events beyond that edge without deleting them. Piano-roll edits modify paired note-on/off events in musical beats while preserving unrelated automation. Snapshot undo/redo covers the main editing operations. Tempo maps, multi-select, piano-roll zoom, and multiple velocity lanes remain future work.

## Persistence and migration

IndexedDB database: vibe-wizard-projects, version 4, object store: projects (keyPath id). Each write saves one complete project snapshot in a single read/write transaction.

Existing schema version 1, 2, and 3 projects are migrated during the IndexedDB version upgrade. Schema v1/v2 second-based clip starts convert to quarter-note beats using the saved project tempo; v3 beat positions and capture tempos are preserved. Each clip receives a `lengthBeats` value derived from its recorded duration and capture tempo. Projects without loop metadata receive a disabled default loop region. Existing track IDs, instrument IDs, clips, and events are preserved; old track mix fields default to volume 0.8 and pan 0. The data validator rejects unsupported schemas, duplicate IDs, duplicate instrument assignment, orphaned clips, and out-of-range mix values.

On startup, the app loads the most recently updated project. Stopping a recording appends a clip to the armed track and saves the project automatically. Track selection filters the clip selector to clips on that track. Track mixer controls and arrangement clip moves are also saved.

If IndexedDB is missing or cannot be opened, the app switches to a clearly labelled in-memory repository. That fallback is intentionally session-only and does not imply that recordings survived a reload.

## Runtime separation

The project document stores only JSON-compatible domain data. AudioContext, AudioNodes, XR objects, DOM references, timers, controllers, and module instances are reconstructed at runtime and never serialized.

## Known limitations

- Piano and drum voices are compact local synthesis models, not high-fidelity sampled libraries. The sampler supports one chromatic sample per track; multisampling, zones, velocity layers, looping, time-stretching, and sample trimming remain future work.
- Sampler asset bytes are stored in a separate local IndexedDB database. Clearing browser site data removes those samples; projects retain a reference but do not embed the audio bytes.
- The arrangement UI displays bars/beats with configurable musical snap; BPM changes affect playback speed while preserving beat placement.
- Clip resizing, duplication, and piano-roll note editing are supported. Multi-select, clip groups, and advanced MIDI editing remain future work.
- Parameter mappings and custom rack configuration are initialized by application code rather than persisted as editable rack state.
- Undo/redo currently covers piano-roll note edits, clip moves/resizes, and clip duplication. It does not yet cover every project setting or track-mixer change.
- There is no cloud sync, cross-device collaboration, or audio-asset library yet.
