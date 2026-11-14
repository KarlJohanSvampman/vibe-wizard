# Agent notes for Vibe-Wizard

## Non-negotiable architecture rules

1. The rack is global. Tracks reference instrument instances; do not create a separate module registry per track.
2. Keep audio, rack, mapping, event, and sequencer code independent of Three.js and IWSDK.
3. Keep XR tracking and UI in adapters. Convert hand/controller poses into platform-neutral typed events and control signals.
4. Preserve event types. Note events, gate events, continuous control signals, clock events, and audio ports are not interchangeable.
5. Controllers can target parameters on any rack module. Do not hard-code the theremin to one synthesizer.
6. Record controller movements as timestamped automation/control events as well as recording note events.
7. AI generation/transformation is asynchronous asset work. Never put network/model calls in the real-time audio path.
8. Store serializable module configuration, not live AudioNodes, Three.js objects, or ECS entities.

## IWSDK conventions

- Keep project configuration in `iwsdk.config.json`; use the manifest-first Vite plugin setup.
- Keep `World.create` and XR/ECS integration in the application entry/integration layer.
- Follow official IWSDK package version and Three.js alias/override requirements.
- Use IWSDK's generated project layout and its supported input/interaction systems rather than copying stale WebXR snippets.

## Quality checks

Before committing changes, run:

```bash
npm run typecheck
npm test
npm run build
```

For XR-facing changes, test the desktop IWER workflow and record a separate physical-Quest validation result. Do not claim Quest hand tracking, browser MIDI, or audio latency works until it has been tested on target hardware.
