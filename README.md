# Vibe-Wizard

**Create instruments. Shape sounds. Make music.**

Vibe-Wizard is a browser-first digital audio workstation for immersive music creation in VR, with desktop development and editing support. It combines a modular instrument rack, expressive spatial controllers, a sequencer, and AI-assisted sample and instrument creation.

## Current status

The prototype includes:
- Meta IWSDK project setup and desktop development runtime.
- A local Web Audio synthesizer, global rack, and reusable Parameter Bus.
- Desktop slider input and tracked right-index-finger spatial theremin control.
- Typed recording of notes and continuous controller movement.
- Look-ahead clip playback through the same rack and mappings.
- A versioned project/track model and IndexedDB persistence for performances.
- Automatic startup loading, a saved-clip selector, and a simple X/Y automation + note timeline.

The current runtime has one theremin-driven synth instrument track. The project model supports multiple instrument tracks, but independent multi-track audio routing and arrangement editing are future milestones.

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

## Record, save, and replay

1. Wait for the project status to report that local project storage is ready.
2. Enable audio.
3. Press Record and perform with the desktop controls or tracked VR hand.
4. Press Stop recording. The clip is attached to the active instrument track and saved automatically.
5. Choose any saved performance from the selector and press Play clip.
6. Rename the project and press Save project to persist the new name.

Projects are stored in this browser's IndexedDB and are available after reload in the same browser profile. Clearing site data removes them. When IndexedDB is unavailable, the UI explicitly reports session-only storage.

## Architecture

- src/audio — Web Audio engine and typed events.
- src/rack — global module registry and Parameter Bus.
- src/controllers — platform-neutral theremin and XR hand adapter.
- src/sequencer — event recording and look-ahead clip transport.
- src/project — versioned project model and IndexedDB repository.
- src/app — desktop controls and timeline visualization.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Projects and tracks](docs/PROJECTS_AND_TRACKS.md)
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
