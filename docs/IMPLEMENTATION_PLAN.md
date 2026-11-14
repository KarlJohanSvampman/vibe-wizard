# Implementation Plan

## Guiding strategy

Build a narrow vertical slice that validates the architecture before building a large DAW surface. The repository has the IWSDK project foundation, a basic Web Audio synth, a global rack registry, a reusable Parameter Bus, and both desktop and tracked-hand theremin input paths.

## Phase 0 — Foundation

- [x] Set up a manifest-first TypeScript IWSDK project.
- [x] Add an application entry point and Vite configuration.
- [x] Establish a desktop UI surface independent of the XR scene.
- [x] Add initial architecture and subsystem documents.
- [ ] Run install, typecheck, test, and production build locally after each milestone.
- [ ] Verify the generated scene on physical Quest hardware.

## Phase 1 — Audio foundation

- [x] Define deferred AudioContext initialization.
- [x] Implement a small polyphonic Web Audio synthesizer with note-on/off.
- [ ] Add audio scheduler and transport clock.
- [ ] Add polyphony limits and voice-stealing policy.
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

- [x] Add typed note/control event models.
- [x] Add a timestamped event recorder for note and control events.
- [ ] Connect live note/control events to the recorder.
- [ ] Add transport, clip playback, and scheduler integration.
- [ ] Add automation lane and event editing.
- [ ] Add piano roll and recording workflow (arm, record, stop, commit).

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

## Later exploration

- Virtual guitar with chord/fret and strumming gesture recognition.
- Additional spatial instruments and controller types.
- Advanced mixer, sends, automation lanes, multi-channel routing.
- Cloud sync/collaboration only when local project model is stable.

## Current vertical-slice acceptance criteria

1. Synth creates audible polyphonic notes.
2. Theremin controls pitch and volume from desktop sliders.
3. A tracked right index fingertip controls pitch and volume inside the spatial volume.
4. Leaving the spatial volume or losing tracking releases the active spatial note.
5. Parameter mapping changes do not require instrument changes.
6. Typecheck, tests, and production build pass.
