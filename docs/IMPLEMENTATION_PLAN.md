# Implementation Plan

## Guiding strategy

Build a narrow vertical slice that validates the architecture before building a large DAW surface. The repository now has the IWSDK project foundation, a basic Web Audio synth, a global rack registry, a reusable Parameter Bus, and a desktop theremin control panel. Continue by strengthening and connecting those pieces, not by building disconnected demos.

## Phase 0 — Foundation (repository baseline)

- [x] Set up a manifest-first TypeScript IWSDK project.
- [x] Add an application entry point and Vite configuration.
- [x] Establish a desktop UI surface independent of the XR scene.
- [x] Add initial architecture and subsystem documents.
- [ ] Install dependencies and verify typecheck/build locally.
- [ ] Verify the generated scene starts in desktop IWER and on Quest.

**Exit:** clean install, development session, typecheck, test, and production build pass.

## Phase 1 — Audio foundation

- [x] Define deferred AudioContext initialization.
- [x] Implement a small polyphonic Web Audio synthesizer with note-on/off.
- [ ] Add audio scheduler and transport clock.
- [ ] Add polyphony limits and voice-stealing policy.
- [ ] Add panic/cleanup behavior tests and manual audio smoke tests.

**Exit:** desktop user can play and release notes; no XR dependency in audio modules.

## Phase 2 — Rack and parameter system

- [x] Define global rack registry and module lifecycle.
- [x] Implement Parameter Bus mappings with range conversion, curves, inversion, dead zone, quantization, smoothing, and fan-out.
- [ ] Add module port metadata and connection validation.
- [ ] Add instrument-to-track assignment and effect-chain routing.
- [ ] Add mapping editor and preset serialization.

**Exit:** create a synth module, expose parameters, and connect controller output to its parameters.

## Phase 3 — Input and theremin

- [x] Define a platform-neutral two-axis theremin controller.
- [x] Add desktop pointer/slider emulation.
- [ ] Add harmonic mode and scale quantization.
- [ ] Add IWSDK hand-tracking adapter and spatial feedback volume.
- [ ] Add calibration, tracking-loss recovery, and controller visualizations.

**Exit:** desktop and XR can control synth pitch and volume.

## Phase 4 — Recording and sequencer

- [x] Add typed note/control event models.
- [x] Add a timestamped event recorder for note and control events.
- [ ] Add transport, clip playback, and scheduler integration.
- [ ] Add automation lane and event editing.
- [ ] Add piano roll and recording workflow (arm, record, stop, commit).

**Exit:** record a theremin performance, replay it, edit it, and compare output.

## Phase 5 — Studio views and project persistence

- [ ] Arrangement view, track selection/arming, rack view, mixer view.
- [ ] IndexedDB project and asset persistence with schema versioning.
- [ ] Save/load project and rack presets.
- [ ] Add undo/redo for editing actions.

**Exit:** user can save a project and reopen it with the same rack and clips.

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

## Test strategy

- Unit-test event typing, mappings, transforms, scheduler math, project serialization, and module lifecycle.
- Test audio behavior manually on desktop and Quest hardware; browser audio behavior is not fully represented by unit tests.
- Use desktop IWER emulation for fast XR iteration, then validate on physical Quest.
- Track audio latency, glitching under load, hand-tracking stability, and sustained session memory use.

## Definition of done for the first vertical slice

1. Synth creates audible polyphonic notes.
2. Theremin controls pitch and volume.
3. Parameter mapping changes do not require instrument changes.
4. Note/control data is recorded with stable timestamps.
5. Playback reproduces the performance with stable scheduling.
6. Typecheck, tests, and production build pass.
