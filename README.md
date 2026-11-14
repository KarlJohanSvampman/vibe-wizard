# Vibe-Wizard

**Create instruments. Shape sounds. Make music.**

Vibe-Wizard is a browser-first digital audio workstation for immersive music creation in VR, with desktop development and editing support. It combines a modular instrument rack, expressive spatial controllers, a sequencer, and AI-assisted sample and instrument creation.

## Current status

The repository contains an IWSDK 1.1 project scaffold, core audio/rack/controller abstractions, and a small desktop theremin-to-synth prototype. The VR scene and desktop controls are deliberately kept separate from the audio domain. Hand-tracked spatial controls and richer studio views are the next implementation steps.

## Product principles

- **The rack is the heart of the application.** Instruments, effects, and controllers are independent modules with declared ports and parameters.
- **Inputs are interchangeable.** Instruments can receive notes and controls from a virtual piano, theremin, sequencer, MIDI devices, and future sources.
- **Controllers are reusable.** A controller can target parameters on any rack module, including multiple instruments.
- **Performances are recordable.** Notes and continuous controller movements are recorded as editable events and automation.
- **Audio stays local.** The audio engine runs client-side; AI generation is asynchronous and never sits in the real-time audio path.
- **VR is a first-class interface, not a constraint.** The same project remains usable on desktop.

## Technology

- TypeScript, Vite, and Vitest
- Three.js through Meta's Immersive Web SDK (IWSDK)
- Web Audio API, with AudioWorklet available for later custom DSP
- IndexedDB planned for local project and sample storage
- IWSDK's IWER emulator for desktop XR testing, followed by physical Quest validation

The current scaffold follows the manifest-first IWSDK project structure. Official guidance: [IWSDK overview](https://developers.meta.com/vr/documentation/iwsdk/guides/overview/), [project setup](https://developers.meta.com/vr/documentation/iwsdk/guides/01-project-setup/), and [Meta's SDK repository](https://github.com/meta/immersive-web-sdk).

## Run locally

Requirements: Node.js 20.19+ (20 line), 22.12+ (22 line), or 24+; npm is included with Node.js.

```bash
npm install
npm run dev
```

The IWSDK CLI starts a managed development session and reports the actual local/network URLs. Use its desktop IWER emulation first; use the network URL over HTTPS when testing on Quest. Other useful commands:

```bash
npm run typecheck
npm test
npm run build
npm run preview
npm run dev:status
npm run dev:down
```

The browser may require a user gesture before audio can start. Open the desktop controls and press **Enable audio**, then press and hold **Play theremin**.

## First vertical slice

1. Create a polyphonic synthesizer instrument.
2. Create a virtual theremin controller with normalized X/Y outputs.
3. Map theremin X to pitch and Y to volume using a reusable Parameter Bus.
4. Play the instrument continuously from the theremin.
5. Record note/control events and controller automation.
6. Replay and edit the performance.
7. Change mappings without changing the instrument.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Audio engine](docs/AUDIO_ENGINE.md)
- [Rack and module contracts](docs/RACK_SYSTEM.md)
- [Parameter mapping](docs/PARAMETER_MAPPING.md)
- [Sequencer and recording](docs/SEQUENCER.md)
- [VR interaction](docs/VR_INTERACTION.md)
- [AI integration](docs/AI_INTEGRATION.md)
- [Technical decisions](docs/TECHNICAL_DECISIONS.md)

## Scope

The current prototype is intentionally small. Mixing polish, extensive effects, a sampler, drum pads, virtual guitar, cloud collaboration, and AI instrument generation follow after the core rack/input/recording workflow is proven.
