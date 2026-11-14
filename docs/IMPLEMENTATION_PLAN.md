# Implementation Plan

## Guiding strategy

Build a narrow vertical slice that validates the architecture before building a large DAW surface. The repository now has a shared Web Audio runtime, multiple independently routed instrument tracks, the global rack and Parameter Bus, desktop and tracked-hand theremin, recording/playback, and local project persistence.

## Phase 0 — Foundation

- [x] Set up a manifest-first TypeScript IWSDK project.
- [x] Add an application entry point and Vite configuration.
- [x] Establish a desktop UI surface independent of the XR scene.
- [x] Add initial architecture and subsystem documents.
- [ ] Verify clean install, typecheck, tests, and production build locally.
- [ ] Verify the generated scene on physical Quest hardware.

## Phase 1 — Audio foundation

- [x] Define deferred shared AudioContext initialization.
- [x] Implement a basic Web Audio synthesizer with independent instrument voices.
- [x] Translate shared event timestamps to the shared AudioContext clock.
- [x] Add look-ahead note and parameter scheduling for clip playback.
- [x] Add independent track output gain and stereo pan buses.
- [ ] Add explicit polyphony limits and voice-stealing policy.
- [ ] Add panic/cleanup behavior tests and manual audio smoke tests.

## Phase 2 — Rack and parameter system

- [x] Define global rack registry and module lifecycle.
- [x] Implement Parameter Bus mappings with range conversion, curves, inversion, dead zone, quantization, smoothing, and fan-out.
- [x] Add track-to-instrument assignment and separate track audio buses.
- [ ] Add module port metadata and connection validation.
- [ ] Add effect-chain routing, sends, and master bus.
- [ ] Add mapping editor and preset serialization.

## Phase 3 — Input and theremin

- [x] Define a platform-neutral two-axis theremin controller.
- [x] Add desktop slider emulation.
- [x] Add IWSDK tracked index-finger input adapter.
- [x] Add a floating spatial interaction volume, chromatic guide lines, and fingertip cursor.
- [x] Release the spatial note when the fingertip leaves the interaction volume or tracking is lost.
- [ ] Add harmonic mode and scale quantization.
- [ ] Add calibration controls and left-hand selection.
- [ ] Validate tracking, comfort, and audio latency on physical Quest hardware.

## Phase 4 — Recording and sequencer

- [x] Add typed note/control event recording.
- [x] Capture live theremin X/Y controller output from desktop and XR.
- [x] Automatically close notes held when recording stops.
- [x] Add AudioContext look-ahead clip playback through the rack.
- [x] Add per-track clip ownership and playback.
- [x] Add a simple automation/note timeline visualization.
- [ ] Add tempo, musical grid, quantization, and loop sections.
- [ ] Add clip editing and simultaneous arrangement playback.
- [ ] Add rendered audio recording as a separate mode.

## Phase 5 — Projects, tracks, and studio views

- [x] Add a versioned project snapshot and instrument-track model.
- [x] Add IndexedDB persistence for project snapshots and recorded clips.
- [x] Restore the latest project and select between saved performances.
- [x] Add multiple instrument tracks with independent shared-context audio routing.
- [x] Add track select/arm, mute/solo, level, and pan controls.
- [ ] Add arrangement view, rack view, and mixer view.
- [ ] Add persistent rack presets and parameter mapping state.
- [x] Migrate schema version 1 projects to the version 2 track mix model.
- [ ] Add tempo-aware beat positions and undo/redo.

## Phase 6 — Effects and richer instruments

- [ ] Reverb, delay, EQ, distortion, compressor, chorus/phaser as modular effects.
- [ ] Sampler with sample zones, loop points, envelopes, pitch and velocity mapping.
- [ ] Drum pads and sample player.
- [ ] MIDI input adapter, feature-detected and permission-gated.

## Phase 7 — AI asset creation

- [ ] Provider abstraction and asynchronous job lifecycle.
- [ ] Sample generation and audio transformation.
- [ ] Validate generated audio metadata and import into local sample library.
- [ ] Instrument Designer outputs a playable package: samples/zones, pitch/velocity maps, loop points, envelopes, metadata.
- [ ] Keep API credentials out of browser builds; use an optional thin service or local inference adapter when required.

## Next recommended milestone

Build the arrangement editor with independent lane/clip placement, then move to beat-based timing and concurrent transport playback across tracks.
