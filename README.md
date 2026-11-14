# Vibe-Wizard

**Create instruments. Shape sounds. Make music.**

Vibe-Wizard is a browser-first digital audio workstation for immersive music creation in VR, with desktop development and editing support. It combines a modular instrument rack, expressive spatial controllers, a sequencer, and AI-assisted sample and instrument creation.

## Current status

The repository contains an IWSDK 1.1 project scaffold, a basic Web Audio synthesizer, a global rack and Parameter Bus, a desktop theremin control surface, and a spatial theremin that reads the tracked right index fingertip during immersive sessions.

The second prototype milestone adds the real tracked-joint path and an in-world interaction volume. Physical Quest behavior still needs to be checked on target hardware.

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
- IWSDK IWER emulator for desktop XR testing, followed by physical Quest validation

The current scaffold follows the manifest-first IWSDK project structure. Official guidance: [IWSDK overview](https://developers.meta.com/vr/documentation/iwsdk/guides/overview/), [XR input overview](https://developers.meta.com/vr/documentation/iwsdk/concepts/xr-input/), and [Meta's SDK repository](https://github.com/meta/immersive-web-sdk).

## Run locally

Requirements: Node.js 20.19+ (20 line), 22.12+ (22 line), or 24+; npm is included with Node.js.

\`\`\`bash
npm install
npm run dev
\`\`\`

Use the desktop IWER emulation first. When the page opens, press **Enter VR** to resume audio and request an immersive session. In the emulator, select hand input mode if available. On Quest, use the network URL over HTTPS in Meta Quest Browser and enable hand tracking.

Other useful commands:

\`\`\`bash
npm run typecheck
npm test
npm run build
npm run preview
npm run dev:status
npm run dev:down
\`\`\`

## Current theremin workflow

- Desktop: enable audio, move the X/Y sliders, and press/hold **Play theremin**.
- VR: press **Enter VR**, then move the right index fingertip into the floating field in front of you. Horizontal movement changes pitch; vertical movement changes volume. Leaving the field or losing tracking releases the note.
- The floating field is approximately 72 cm wide, 48 cm high, and 24 cm deep. It follows the viewer's horizontal facing direction.

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

This prototype deliberately focuses on the core rack/input/recording workflow. Mixing polish, extensive effects, a sampler, drum pads, virtual guitar, cloud collaboration, and AI instrument generation follow after the core interaction and recording model are proven.
