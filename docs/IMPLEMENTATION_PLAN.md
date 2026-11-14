# Implementation Plan

## Guiding strategy

Build a narrow vertical slice that validates the architecture before building a large DAW surface. The repository now has the IWSDK project foundation, a basic Web Audio synth, global rack, Parameter Bus, desktop and tracked-hand theremin, and an in-memory recording/playback loop.

## Phase 0 — Foundation

- [x] Set up a manifest-first TypeScript IWSDK project.
- [x] Add an application entry point and Vite configuration.
- [x] Establish a desktop UI surface independent of the XR scene.
- [x] Add initial architecture and subsystem documents.
- [ ] Verify clean install, typecheck, tests, and production build locally.
- [ ] Verify the generated scene on physical Quest hardware.

## Phase 1 — Audio foundation

- [x] Define deferred AudioContext initialization.
- [x] Implement a basic Web Audio synthesizer with note-on/off.
- [x] Translate shared event timestamps to AudioContext time.
- [x] Add look-ahead note and parameter scheduling for clip playback.
- [ ] Add explicit polyphony limits and voice-stealing policy.
- [ ] Add panic/cleanup behavior tests and manual audio smoke tests.

## Phase 2 — Rack and parameter system

- [x] Define global rack registry and module lifecycle.
- [x] Implement Parameter Bus mappings with range conversion, curves, inversion, dead zone, quantization, smoothing, and fan-out.
- [ ] Add module port metadata and connection validation.
- [ ] Add instrument-to-track assignment and effect-chain routing.
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
- [x] Add a simple automation/note timeline visualization.
- [ ] Add tempo, musical grid, quantization, and loop sections.
- [ ] Add clip editing and multiple tracks.
- [ ] Add persistence for clips and projects.
- [ ] Add rendered audio recording as a separate mode.

## Phase 5 — Studio views and project persistence

- [ ] Arrangement view, track selection/arming, rack view, mixer view.
- [ ] IndexedDB project and asset persistence with schema versioning.
- [ ] Save/load project and rack presets.
- [ ] Add undo/redo for editing actions.

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

Build a proper project/track model and persistent clip storage. That creates the data foundation for the arrangement view, piano roll, and multi-instrument rack routing.
