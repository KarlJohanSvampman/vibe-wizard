# Vibe-Wizard

**Create instruments. Shape sounds. Make music.**

Vibe-Wizard is a browser-first digital audio workstation designed for immersive music creation in VR, with desktop development and editing support. It combines a modular instrument rack, expressive spatial controllers, a sequencer, and AI-assisted sample and instrument creation.

## Project status

Early foundation. The first milestone is a playable vertical slice proving the audio/rack/input architecture before expanding into a full DAW.

## Product principles

- **The rack is the heart of the application.** Instruments, effects, and controllers are independent modules with declared ports and parameters.
- **Inputs are interchangeable.** Instruments can receive notes and controls from a virtual piano, theremin, sequencer, MIDI devices, and future sources.
- **Controllers are reusable.** A controller can target parameters on any rack module, including multiple instruments.
- **Performances are recordable.** Notes and continuous controller movements are recorded as editable events and automation.
- **Audio stays local.** The audio engine runs client-side; AI generation is asynchronous and never sits in the real-time audio path.
- **VR is a first-class interface, not a constraint.** The same project should remain usable on desktop.

## Initial technology choices

- TypeScript and Vite
- Three.js through Meta's Immersive Web SDK (IWSDK)
- Web Audio API / AudioWorklet for audio
- IndexedDB for local projects and sample assets
- Vitest for unit tests

IWSDK is built on Three.js and an ECS runtime. The official starter generator is `npm create @iwsdk@latest`; use the generated project structure and manifest as the source of truth rather than hand-rolling an outdated SDK setup. See [IWSDK documentation](https://iwsdk.dev/) and [Meta's official repository](https://github.com/meta/immersive-web-sdk).

## First vertical slice

1. Create a polyphonic synthesizer instrument.
2. Create a virtual theremin controller with normalized X/Y outputs.
3. Map theremin X to pitch and Y to volume using a reusable Parameter Bus.
4. Play the instrument continuously from the theremin.
5. Record note/control events and controller automation.
6. Replay the performance.
7. Change the mapping without changing the instrument.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Audio engine](docs/AUDIO_ENGINE.md)
- [Rack and module contracts](docs/RACK_SYSTEM.md)
- [Parameter mapping](docs/PARAMETER_MAPPING.md)
- [Sequencer and recording](docs/SEQUENCER.md)
- [VR interaction](docs/VR_INTERACTION.md)
- [AI integration](docs/AI_INTEGRATION.md)

## Development

The initial repository contains architecture and product specifications. Scaffold the runtime using the official IWSDK generator after checking the selected starter options:

```bash
npm create @iwsdk@latest
```

Choose **TypeScript** and a **VR** experience. Enable grabbing only if useful for the first scene; physics is not required for the initial music prototype. Keep the generator's required dependency aliases, manifest, plugin configuration, and scripts intact.

Node.js requirements are version-sensitive; use the current requirement in the official setup guide. As of the checked documentation, use Node 20.19+ (20 line), 22.12+ (22 line), or 24+.

## Current scope

The first implementation should prioritize the architecture and minimal end-to-end musical interaction. Mixing polish, extensive effects, drum pads, virtual guitar, cloud collaboration, and AI instrument generation can follow once the core is proven.
