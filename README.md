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
- A tempo-aware beat/bar grid, BPM and time-signature controls, and configurable clip snap.
- An animated arrangement playhead and bar-based loop regions with automatic note release at loop boundaries.
- Non-destructive clip resizing and duplication on the beat grid.
- Synchronized playback of clips across tracks using one AudioContext start clock.
- Track-scoped playback of each clip's recorded controller automation.
- A versioned project model, IndexedDB persistence, and migration from schema versions 1, 2, and 3.
- Track selection/arming, saved-clip selection, and X/Y automation + note visualization.

Multiple tracks currently use the same prototype oscillator synth. Independent routing and arrangement playback are in place; instrument variety and a full piano-roll editor remain future milestones.

## Run locally

Requirements: Node.js 20.19+ (20 line), 22.12+ (22 line), or 24+, with npm 11.6+.
npm 10 has a peer-dependency resolver bug affecting some current Vite/Vitest dependency graphs; update npm before installing:

```bash
npm install --global npm@11.19.1
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
2. Set the project tempo and time signature in the timing toolbar.
3. Choose a snap resolution, then drag clips horizontally to move them by bars/beats; drag vertically to reassign them to another instrument lane.
4. Press Play arrangement. All clips are scheduled against one shared AudioContext start time, so events on separate tracks stay aligned at the project tempo.
5. Change the tempo to audition the same arrangement faster or slower without moving its beat positions.
6. Set Loop In and Loop Out to bar boundaries, then enable Loop arrangement to repeat that region. The playhead wraps to Loop In and active notes are released at each loop boundary.
7. Drag a clip's right-edge handle to resize its musical length without deleting captured event data. Use Duplicate clip to create a copy placed immediately after the selected clip.
8. Press Stop arrangement to release any notes still held by the arrangement transport.

The separate Play clip button remains available for auditioning just the selected clip. Resizing is non-destructive: events beyond the visible clip length are skipped during playback and can be recovered by extending the clip again. Loop and clip edits are saved with the project.

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
