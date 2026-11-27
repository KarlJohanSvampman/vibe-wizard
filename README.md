# Vibe-Wizard

**Create instruments. Shape sounds. Make music.**

Vibe-Wizard is a browser-first digital audio workstation for immersive music creation in VR, with desktop development and editing support. It combines a modular instrument rack, expressive spatial controllers, a sequencer, and AI-assisted sample and instrument creation.

## Current status

The prototype includes:
- Meta IWSDK project setup and desktop development runtime.
- A shared local Web Audio runtime and global rack.
- A dedicated Rack dock listing live instruments, effects, controllers, and utility modules, with quick selection of instrument tracks.
- A dedicated Mixer dock with track faders/pan, insert chains, shared delay/reverb sends and returns, master gain, post-limiter peak meter, and limiter status.
- Multiple instrument tracks with independent output buses, track level, pan, mute, and solo.
- Desktop slider input and tracked right-index-finger spatial theremin control.
- Typed recording of notes and continuous controller movement.
- Per-track clip audition and a shared arrangement transport.
- A multi-track arrangement canvas with draggable clips and cross-track clip moves.
- A tempo-aware beat/bar grid, BPM and time-signature controls, and configurable clip snap.
- An animated arrangement playhead and bar-based loop regions with automatic note release at loop boundaries.
- Non-destructive clip resizing and duplication on the beat grid.
- A MIDI-style piano roll for adding, selecting, moving, resizing, deleting, and setting the velocity of notes.
- Snapshot-based undo/redo for note, clip-position, clip-size, and duplication edits.
- Synchronized playback of clips across tracks using one AudioContext start clock.
- Track-scoped playback of each clip's recorded controller automation.
- A versioned project model, IndexedDB persistence, and migration from schema versions 1, 2, and 3.
- Track selection/arming, saved-clip selection, and X/Y automation + note visualization.

Instrument tracks now select from four distinct voice families: an expressive analog-style synth, an additive piano voice, a synthesized one-shot drum kit, and a chromatic sampler for imported audio. Sample bytes are stored separately in IndexedDB and projects retain a stable asset reference. The piano and drum voices are generated locally with Web Audio; the sampler plays user-provided audio without uploading it. An AI Sample Studio accepts prompts and runs asynchronous generation jobs through a configurable backend, then creates a sampler track with the generated audio and saved prompt/provider provenance.

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

## Start AI sample generation

The optional local AI gateway requires Python 3.11+ and an ElevenLabs API key:

```bash
python -m venv .venv
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r server/requirements.txt
# Copy .env.example to .env and set ELEVENLABS_API_KEY
python -m uvicorn server.ai_gateway:app --reload --host 127.0.0.1 --port 8787
```

Run the Vite workbench separately with `npm run dev`. The AI panel defaults to `/api`; the Vite development server proxies it to `http://127.0.0.1:8787`. Production hosting needs an equivalent same-origin reverse-proxy route. Prompts are sent to the local gateway; the gateway keeps the provider key server-side, submits the request to ElevenLabs, and returns an asynchronous job result. The current provider generates up to 30-second sound effects and musical components; it does not yet generate fully editable multisampled instruments or complete arrangements.

## Multiple instrument tracks

1. Wait for the local project status to report that storage is ready.
2. Enable audio.
3. Choose Analog Synth, Piano, Drum Kit, or Sampler in the New Track Instrument selector, then press + Add instrument.
4. Select a track, arm it, then record a performance. Clips are saved to the selected track.
5. Adjust its independent Track Level and Stereo Pan. Mute and Solo operate across the project mix.
6. Use the saved-clip selector and Play clip to audition one clip on its assigned instrument. Sampler tracks expose a local audio-file import control; supported files are decoded by the browser and their bytes are stored in IndexedDB.

All instrument instances share one AudioContext but have independent voices and track-output buses. Piano and drum synthesis use native Web Audio nodes, while sampler tracks decode an audio file and play it chromatically around MIDI note 60. Imported and AI-generated samples remain on the device in a separate IndexedDB asset store; no audio is uploaded. The AI Sample Studio connects to the included local FastAPI gateway through the same-origin `/api` route. The Vite dev server proxies this route to the loopback-only gateway, so the browser and Meta Quest can use the same origin. The gateway uses ElevenLabs SFX v3 text-to-sound generation, with its API key kept in the server-side `.env` file. It turns generated audio into a new Sampler track and stores the sample and prompt provenance locally.

## Arrange and play a song

1. Record one or more clips on different tracks.
2. Set the project tempo and time signature in the timing toolbar.
3. Choose a snap resolution, then drag clips horizontally to move them by bars/beats; drag vertically to reassign them to another instrument lane.
4. Press Play arrangement. All clips are scheduled against one shared AudioContext start time, so events on separate tracks stay aligned at the project tempo.
5. Change the tempo to audition the same arrangement faster or slower without moving its beat positions.
6. Set Loop In and Loop Out to bar boundaries, then enable Loop arrangement to repeat that region. The playhead wraps to Loop In and active notes are released at each loop boundary.
7. Drag a clip's right-edge handle to resize its musical length without deleting captured event data. Use Duplicate clip to create a copy placed immediately after the selected clip.
8. Press Stop arrangement to release any notes still held by the arrangement transport.

The separate Play clip button remains available for auditioning just the selected clip. Resizing is non-destructive: events beyond the visible clip length are skipped during playback and can be recovered by extending the clip again. Select a clip to open its piano roll; click empty cells to add notes, drag note bodies to change pitch/time, drag right edges to resize, adjust velocity with the slider, and use Delete to remove a note. Undo/Redo buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Y reverse note and arrangement edits. All changes are saved with the project.

## Architecture

- src/audio — shared AudioRuntime, Web Audio instruments, typed events, and local sample assets.
- src/ai — asynchronous provider contracts and HTTP job client for generated audio.
- src/rack — global module registry, Parameter Bus, and track audio buses.
- src/controllers — platform-neutral theremin and XR hand adapter.
- src/sequencer — event recording, clip audition transport, and shared arrangement transport.
- src/project — versioned project/track model, migration, arrangement operations, and IndexedDB repository.
- src/app — desktop controls, track mixer, arrangement editor, piano roll, and clip timeline.
- src/project/ProjectHistory.ts — bounded snapshot history for undo/redo.

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
