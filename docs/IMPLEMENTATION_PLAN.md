# Vibe-Wizard Implementation Plan

Last reconciled: 2026-11-27

This plan reflects the implementation currently present on `main`. Completed items are not reopened simply because this document previously lagged behind the codebase. Continue in small, testable increments and keep the global rack, platform-neutral audio domain, typed event streams, local-first asset storage, and asynchronous AI boundary intact.

## Product direction

Vibe-Wizard is a local-first, browser-first DAW with a shared desktop/VR workflow. The near-term priority is reliable music creation: stable audio lifecycle, expressive instruments and effects, a useful mixer, and a coherent local sound library. AI generation and transformation should produce validated local assets, never run in the real-time audio path.

## Phase 0 — Foundation and runtime

- [x] Manifest-first TypeScript Meta IWSDK project and Vite setup.
- [x] Desktop development surface and IWSDK/IWER workflow.
- [x] Architecture, subsystem contracts, and technical decision documentation.
- [ ] Repeat clean-install, typecheck, test, and production-build verification in a fresh environment.
- [ ] Validate the generated scene and hand tracking on physical Quest hardware.

## Phase 1 — Audio engine and instruments

- [x] One lazily initialized shared AudioContext per project.
- [x] Shared audio clock conversion and look-ahead scheduling.
- [x] Analog-style synth, additive piano, synthesized drum kit, and chromatic sampler.
- [x] Independent instrument outputs and per-track gain/pan buses.
- [x] Sample decoding and local asset restoration before playback.
- [x] Explicit reporting for missing or invalid sampler assets.
- [x] PCM WAV recording/encoding coverage for recorded audio.
- [x] Enforce bounded per-instrument polyphony (16 synth/piano/sampler voices; 32 drum voices by default; configurable 1..128).
- [x] Add deterministic voice stealing: oldest releasing voice first, otherwise oldest active voice.
- [x] Scope note identity by event source and note ID; immediately retire a voice on same-ID retrigger.
- [x] Add immediate panic semantics for every voice, including one-shots, and use them during disposal.
- [x] Add deterministic AudioEngine lifecycle tests for source-scoped note identity, rapid retrigger, polyphony bounds/stealing, panic, disposal, one-shot cleanup, and multi-source voice cleanup.\n- [x] Cover arrangement stop and loop-wrap note release in ArrangementTransport tests.\n- [ ] Add an app-level track-switching regression test and manual long-session/clipping smoke tests.
- [ ] Add audio lifecycle/resource-leak tests and manual clipping/long-session smoke tests.

## Phase 2 — Global rack, routing, and mixing

- [x] Global rack/module registry and module lifecycle.
- [x] Parameter Bus with range conversion, curves, inversion, dead zone, quantization, smoothing, and fan-out.
- [x] Tracks reference unique instrument instances; all tracks share the same AudioRuntime.
- [x] Independent track level, pan, mute, and solo.
- [x] Add module port metadata and connection validation.
- [x] Add ordered, bypassable per-track delay and reverb insert chains.
- [x] Persist track insert effects and shared send/return levels and parameters through project schema v9.
- [x] Add mixer controls for effect insertion, bypass, reordering, removal, and parameters.
- [x] Add a project master bus with bounded output gain, a safety limiter, and post-limiter peak metering.
- [x] Add insert effects and send/return routing with explicit ownership and disposal.
- [x] Persist shared delay time/feedback and reverb decay in project schema v9; expose project-wide return controls in the Mixer.
- [x] Build a dedicated Mixer dock with track level/pan, insert effects, shared sends/returns, master gain, peak meter, and limiter status.\n- [x] Add a global Rack dock listing instruments, effects, controllers, and utility modules, with track selection from instrument entries.
- [ ] Persist rack presets and editable parameter mappings.

## Phase 3 — Controllers and spatial performance

- [x] Platform-neutral two-axis theremin controller.
- [x] Desktop slider adapter and tracked right-index-finger adapter.
- [x] Spatial interaction volume, chromatic guide lines, and fingertip cursor.
- [x] Release notes when the fingertip exits the volume or tracking is lost.
- [x] Record timestamped controller movement alongside note events.
- [ ] Add harmonic mode and scale quantization.
- [ ] Add calibration and left-hand selection.
- [ ] Validate tracking comfort, latency, and sustained use on Quest hardware.

## Phase 4 — Recording, clips, and arrangement

- [x] Typed note/control recording and automatic closure of held notes on recording stop.
- [x] Per-track clip ownership and clip audition.
- [x] Multi-track arrangement canvas with cross-track clip moves.
- [x] Shared arrangement transport clock for synchronized playback.
- [x] BPM, time signature, beat/bar ruler, and configurable snap.
- [x] Loop regions with note release at loop boundaries.
- [x] Non-destructive clip resizing and duplication.
- [x] Piano roll note creation, selection, move, resize, delete, and velocity editing.
- [x] Snapshot undo/redo for piano-roll and supported arrangement edits.
- [x] Turntable recording takes and arrangement placement.
- [ ] Add multi-select, grouping, and broader undo coverage.
- [ ] Add rendered master-output recording/export as a separate recording mode.
- [ ] Add WAV export for full arrangements with offline rendering where supported.

## Phase 5 — Projects, persistence, and sound library

- [x] Versioned project model and IndexedDB project persistence.
- [x] Schema migrations through version 9.
- [x] Separate IndexedDB binary asset store for imported/generated samples.
- [x] Restore imported and generated sampler audio after reload.
- [x] Persist turntable takes and refresh the sound library after saving.
- [x] Validate restored assets before playback and surface missing-asset errors.
- [ ] Add user-facing sound-library organization, tags, search, and preview.
- [ ] Add project backup/restore and explicit asset cleanup for unused samples.
- [ ] Add persistent rack presets and project-level settings coverage.

## Phase 6 — Effects and advanced instruments

- [x] Implement modular reverb and delay.
- [ ] Implement EQ, distortion, compressor/limiter, chorus, and phaser.
- [ ] Add effect parameter metadata, presets, and automation support.
- [ ] Expand sampler to zones, root-key ranges, velocity layers, loop points, envelopes, and pitch mapping.
- [ ] Add sample trimming and time-stretching as separate, testable capabilities.
- [ ] Add a flexible drum-pad/sample-player instrument.
- [ ] Add feature-detected, permission-gated MIDI input and output.

## Phase 7 — AI creation and transformation

- [x] Provider abstraction and asynchronous generation job lifecycle.
- [x] Local FastAPI gateway with provider credentials kept server-side.
- [x] ElevenLabs sound-effect generation integrated into the local sample workflow.
- [x] Generated audio imported as sampler tracks with prompt/provider provenance.
- [ ] Add audio transformation jobs (variation, extend, inpaint, style/texture changes where provider supports them).
- [ ] Validate generated file type, duration, sample rate, channels, and decode success before import.
- [ ] Build a complete Instrument Designer package: sample zones, root keys, velocity maps, loops, envelopes, metadata, and preview.
- [ ] Add provider capability discovery and clear job cancellation/error/retry states.
- [ ] Build the music assistant for arrangement-level suggestions and edits, always through explicit user-approved operations.

## Recommended execution order

1. **Audio reliability:** add the remaining app-level track-switching regression and perform manual long-session/clipping smoke tests.
2. **Sampler depth:** add sample zones and loop/envelope controls without breaking existing single-sample projects.
3. **Sound library and export:** improve asset discovery/management and render complete arrangements to audio.
4. **AI transformation and music assistant:** build on the now-stable asset and arrangement contracts.

## Quality gates

Before each commit, run:

```bash
npm run typecheck
npm test
npm run build
```

For audio changes, add deterministic unit tests for scheduling and lifecycle behavior. For XR-facing changes, test desktop IWER and report physical-Quest validation separately; never imply hardware validation has happened when it has not.
