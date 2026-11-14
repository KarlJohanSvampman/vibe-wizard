# Implementation Plan

## Guiding strategy

Build a narrow vertical slice that validates the architecture before building a large DAW surface. The first deliverable is not a feature-complete studio; it is a small but complete musical workflow: create a synth, control it with a theremin, record, and replay.

## Phase 0 — Scaffold and developer workflow

- Generate the TypeScript VR starter using `npm create @iwsdk@latest`.
- Keep generated IWSDK manifest, assets/components catalogs, Vite plugin, runtime scripts, and dependency overrides intact.
- Verify desktop/IWER emulation and production build.
- Establish linting, formatting, Vitest, and CI.
- Add project folders for domain code without prematurely coupling all features.

**Exit:** clean install, dev server, test command, production build, desktop scene.

## Phase 1 — Audio foundation

- Define AudioEngine lifecycle: initialize from user gesture, suspend/resume, dispose.
- Implement track/master gain and a scheduler using AudioContext time.
- Implement a basic polyphonic synth with note-on/off, velocity, pitch, and release.
- Add voice allocation and a documented polyphony limit.
- Add an audio smoke test/manual test page.

**Exit:** desktop user can play and release notes; no XR dependency in audio modules.

## Phase 2 — Rack and parameter system

- Define module metadata, IDs, module types, typed ports, parameter descriptors, and lifecycle.
- Implement module registry and global rack state.
- Implement track-to-instrument assignment and effects-chain placeholders.
- Implement Parameter Bus mappings, range transforms, curves, clamp, dead zone, quantization, smoothing, and fan-out.
- Add validation to prevent incompatible port connections.

**Exit:** create a synth module, expose parameters, connect a controller signal to parameters.

## Phase 3 — Input and theremin

- Define input adapters and a common event router.
- Build theremin controller model with normalized X/Y output and calibration bounds.
- Add continuous and scale-quantized pitch modes.
- Add desktop pointer emulation first; add IWSDK hand tracking/spatial control next.
- Provide visible feedback for pitch/scale boundaries, hand position, and output values.

**Exit:** both desktop and XR can control synth pitch and volume.

## Phase 4 — Recording and sequencer

- Define transport clock and timestamp conventions.
- Record NoteEvents and ControlSignal automation separately.
- Build event track and automation track playback.
- Add loop/tempo basics and quantization as an editing option, not forced during capture.
- Add a minimal piano roll or event list to inspect and edit recordings.

**Exit:** record theremin performance, replay, edit, and compare output.

## Phase 5 — Studio views and project persistence

- Arrangement view, track selection/arming, rack view, mixer view.
- IndexedDB project and asset persistence with schema versioning.
- Save/load project and rack presets.
- Add basic undo/redo for editing actions.

**Exit:** user can save a project and reopen it with the same rack and clips.

## Phase 6 — Effects and richer instruments

- Reverb, delay, EQ, distortion, compressor, chorus/phaser as modular effects.
- Sampler with sample zones, loop points, envelopes, pitch and velocity mapping.
- Drum pads and sample player.
- MIDI input adapter, feature-detected and permission-gated.

## Phase 7 — AI asset creation

- Provider abstraction and asynchronous job lifecycle.
- Sample generation and audio transformation.
- Validate generated audio metadata and import into local sample library.
- Instrument Designer outputs a playable package: samples/zones, pitch/velocity maps, loop points, envelopes, metadata.
- Keep API credentials out of browser builds; use a small optional service or local inference adapter when required.

## Later exploration

- Virtual guitar with chord/fret and strumming gesture recognition.
- Additional spatial instruments and controller types.
- Advanced mixer, sends, automation lanes, multi-channel routing.
- Cloud sync/collaboration only when local project model is stable.

## Test strategy

- Unit-test event typing, mappings, transforms, scheduler math, project serialization, and module lifecycle.
- Test audio behavior manually on desktop and Quest hardware; browser audio behavior is not fully represented by unit tests.
- Use desktop IWER emulation for fast XR iteration, then validate on physical Quest.
- Track audio latency, glitching under load, hand tracking stability, and sustained session memory use.

## Definition of done for the first vertical slice

1. Synth creates audible polyphonic notes.
2. Theremin controls pitch and volume.
3. Parameter mapping changes do not require instrument changes.
4. Note/control data is recorded with stable timestamps.
5. Playback is deterministic enough to reproduce the gesture.
6. Tests and production build pass.
