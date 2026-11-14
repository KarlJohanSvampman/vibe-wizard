# Vibe-Wizard

**Create instruments. Shape sounds. Make music.**

Vibe-Wizard is a browser-first digital audio workstation for immersive music creation in VR, with desktop development and editing support. It combines a modular instrument rack, expressive spatial controllers, a sequencer, and AI-assisted sample and instrument creation.

## Current status

The prototype includes:
- Meta IWSDK project setup and desktop development runtime.
- A shared local Web Audio runtime and global rack.
- Multiple instrument tracks with independent output buses, track level, pan, mute, and solo.
- Desktop slider input and tracked right-index-finger spatial theremin control.
- Typed recording of notes and continuous controller movement.
- Per-track clip audition and a shared arrangement transport.
- A multi-track arrangement canvas with draggable clips and cross-track clip moves.
- Synchronized playback of clips across tracks using one AudioContext start clock.
- Track-scoped playback of each clip's recorded controller automation.
- A versioned project model, IndexedDB persistence, and migration from schema version 1.
- Track selection/arming, saved-clip selection, and X/Y automation + note visualization.

Multiple tracks currently use the same prototype oscillator synth. Independent routing and arrangement playback are in place; instrument variety, beat-based editing, and a full piano-roll editor are future milestones.

## Run locally

Requirements: Node.js 20.19+ (20 line), 22.12+ (22 line), or 24+.

```bash
npm install
npm run dev
```

Use the desktop IWER emulator first. Press Enable audio to initialize the shared local AudioContext; use Enter VR to request the immersive session and start audio from the same user gesture. On Quest, open the HTTPS development URL in Meta Quest Browser with hand tracking enabled.

Quality checks:

```bash
npm run typecheck
npm test
npm run build
```

## Multiple instrument tracks

1. Wait for the local project status to report that storage is ready.
2. Enable audio.
3. Use + Add instrument to create another synth track.
4. Select a track, arm it, then record a performance. Clips are saved to the selected track.
5. Adjust its independent Track Level and Stereo Pan. Mute and Solo operate across the project mix.
6. Use the saved-clip selector and Play clip to audition one clip on its assigned instrument.

All instrument instances share one AudioContext but have independent voices and track-output buses. This avoids spawning an AudioContext for every instrument and enables the tracks to mix together.

## Arrange and play a song

1. Record one or more clips on different tracks.
2. In the arrangement timeline, drag a clip horizontally to change its start position. Positions snap to quarter-second increments.
3. Drag a clip vertically onto another instrument lane to reassign it to that track's instrument.
4. Press Play arrangement. All clips are scheduled against one shared AudioContext start time, so events on separate tracks stay aligned.
5. Press Stop arrangement to release any notes still held by the arrangement transport.

The separate Play clip button remains available for auditioning just the selected clip. Arrangement positions currently use seconds; tempo-aware bars/beats, quantization, looping, and simultaneous editing are still to come.

## Architecture

- src/audio — shared AudioRuntime, Web Audio instruments, and typed events.
- src/rack — global module registry, Parameter Bus, and track audio buses.
- src/controllers — platform-neutral theremin and XR hand adapter.
- src/sequencer — event recording, clip audition transport, and shared arrangement transport.
- src/project — versioned project/track model, migration, arrangement operations, and IndexedDB repository.
- src/app — desktop controls, track mixer, arrangement editor, and clip timeline.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Projects and tracks](docs/PROJECTS_AND_TRACKS.md)
- [Arrangement editing](docs/ARRANGEMENT.md)
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
