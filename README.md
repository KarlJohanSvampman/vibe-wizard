# Vibe-Wizard

**Create instruments. Shape sounds. Make music.**

Vibe-Wizard is a browser-first digital audio workstation for immersive music creation in VR, with desktop development and editing support. It combines a modular instrument rack, expressive spatial controllers, a sequencer, and AI-assisted sample and instrument creation.

## Current status

The prototype includes:
- Meta IWSDK project setup and desktop development runtime.
- A local Web Audio synthesizer, global rack, and reusable Parameter Bus.
- Desktop slider input and tracked right-index-finger spatial theremin control.
- An in-memory event recorder for notes and continuous controller movement.
- A look-ahead sequencer that replays clips through the same rack and mappings.
- A simple timeline showing X/Y automation and note durations.

The prototype currently supports one theremin-driven synth and one in-memory clip.

## Run locally

Requirements: Node.js 20.19+ (20 line), 22.12+ (22 line), or 24+.

```bash
npm install
npm run dev
```

Use the desktop IWER emulator first. Press Enable audio to initialize local audio; use Enter VR to request the immersive session and start audio from the same user gesture. On Quest, open the HTTPS development URL in Meta Quest Browser with hand tracking enabled.

Quality checks:

```bash
npm run typecheck
npm test
npm run build
```

## Record and replay

1. Enable audio.
2. Press Record.
3. Perform using the desktop X/Y sliders and Play theremin, or enter VR and move the right index fingertip inside the floating field.
4. Press Stop recording. Notes still held at stop are automatically closed in the clip.
5. Inspect the X/Y automation lanes and note blocks.
6. Press Play clip to hear the performance replay through the current synth and Parameter Bus.
7. Press Stop playback to stop the transport and release playback voices.

The clip is held in memory only and is cleared on page reload.

## Architecture

- src/audio — Web Audio engine and typed events.
- src/rack — global module registry and Parameter Bus.
- src/controllers — platform-neutral theremin and XR hand adapter.
- src/sequencer — event recording and look-ahead clip transport.
- src/app — desktop controls and timeline visualization.

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

## Product principles

- The rack is global and modules are independent.
- Inputs are interchangeable and use typed event/control streams.
- Controllers can target any compatible rack parameter.
- Audio stays local; AI asset creation remains asynchronous.
- VR and desktop use the same domain logic through separate input adapters.
