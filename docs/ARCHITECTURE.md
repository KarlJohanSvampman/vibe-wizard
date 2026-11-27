# Vibe-Wizard Architecture

## 1. Product shape

Vibe-Wizard is a local-first DAW and immersive instrument playground. Its central abstraction is a **modular rack** connected to tracks and an audio graph. Inputs generate typed musical/control events; the sequencer records and replays those events; controller outputs can modulate compatible rack parameters.

The application is split into independently testable domains:

1. **Audio engine** — audio graph, scheduling, instruments, effects, mixing.
2. **Rack** — module lifecycle, module registry, ports, track assignment, routing.
3. **Input** — XR hands/controllers, virtual keyboard, MIDI devices, desktop input.
4. **Parameter system** — typed control sources mapped to module parameters.
5. **Sequencer** — clip audition, arrangement transport, automation, piano roll.
6. **Persistence** — project serialization, IndexedDB asset store, presets.
7. **AI integration** — asynchronous generation/transformation providers.
8. **Presentation** — desktop DAW views and IWSDK-powered spatial interactions.

The desktop workstation exposes separate Instrument, Rack, Mixer, Controllers, and Editor dock views. Rack is a live inventory of registered modules and can select the owning instrument track. Mixer owns track level/pan, insert effect order/bypass/parameters, shared send/return controls, and master output monitoring. These views are presentation adapters over the project/rack domains; they do not own audio nodes.

## 2. Runtime boundaries

Keep the audio domain independent of Three.js, IWSDK, and the visual scene. Audio code must be usable in a non-VR frontend later.

The UI and XR layer may issue commands and subscribe to state, but must not directly manipulate internal audio nodes. Use typed application-level interfaces and explicit lifecycle methods.

AI calls are outside the real-time audio graph. Generation returns an asset/package which is validated and then imported into local project storage.

## 3. Data flow

```text
XR hands / Desktop / MIDI / Sequencer
                |
          Input adapters
                |
       Typed event / control router
          |               |
     Note events      Control signals
          |               |
      Instrument      Parameter Bus
          |               |
       Shared AudioRuntime
          |
    Instrument output gain
          |
    Per-track audio bus
     (level / pan / mute)
          |
       Track mixer
          |
      Master output

ArrangementTransport --(one AudioContext clock)--> all instrument tracks
Sequencer recorder observes event/control streams and persists timestamped clips.
AI providers --(async assets)--> validation/import --> local sample/instrument library
```

## 4. Rack and track model

A project owns one global rack. The rack contains instruments, effects, and controllers. Each instrument track references a unique instrument instance and its independent track audio bus. Track metadata selects an instrument family (`synth`, `piano`, `drums`, or `sampler`). All instrument instances in a project share one lazy AudioRuntime/AudioContext, but retain independent voice pools and output connections. Sampler tracks reference local binary assets stored separately from the JSON project snapshot.

A track bus applies track level and stereo pan; project mute/solo state is applied to its bus level. Controllers are not necessarily assigned to one track and may target any compatible parameter through the global Parameter Bus.

## 5. Typed ports

Do not represent all inputs as floating-point values. At minimum distinguish:

- `NoteEvent`: note-on, note-off, pitch, velocity, channel, timestamp, source.
- `ControlSignal`: normalized or unit-bearing continuous value, timestamp, source.
- `GateEvent`: press/release or on/off event.
- `AudioPort`: audio input/output endpoint.
- `ClockEvent`: transport timing or synchronization event.

Modules declare accepted input and output port types, supported parameter definitions, and routing constraints.

## 6. Scheduling and performance

- Schedule audio ahead using the shared AudioContext clock; do not rely on animation-frame timing for note precision.
- The arrangement transport converts quarter-note beat positions to AudioContext seconds using project BPM, then scales clip-relative seconds from each clip's capture tempo.
- Enabled loop regions repeat on a shared AudioContext clock; the transport releases active voices at loop boundaries before starting the next iteration.
- A clip's beat length controls its visible/playable extent. Editing the length does not mutate captured events.
- All arrangement clips share one start time and scheduler, preserving alignment across instrument tracks.
- Automation recorded into a clip is routed to the instrument assigned to that clip's track; live controllers may still fan out globally.
- Keep rendering and audio timing independent.
- Preload samples before playback and avoid decoding or large allocations in the audio callback. Sampler files are decoded asynchronously through `decodeAudioData` before note scheduling.
- Use AudioWorklet for custom DSP only where native Web Audio nodes are insufficient.
- Make polyphony, voice stealing, and resource budgets explicit.
- Use feature detection for WebXR, hand tracking, MIDI, and optional browser APIs.

## 7. Persistence

Projects are versioned JSON documents. Schema version 4 stores instrument-track routing references, beat-based clip start positions and lengths, per-clip capture tempo, a loop region, and independent level/pan/mute/solo/arm state. IndexedDB upgrades migrate schema versions 1, 2, and 3 while preserving existing audible clip placement. Large binary assets are stored separately in IndexedDB and referenced by stable asset IDs. Presets should serialize module configuration and mapping definitions without serializing runtime AudioNode objects.

## 8. IWSDK integration

IWSDK provides app lifecycle, ECS, XR input integration, scene/runtime tools, and optional interaction systems. Use it for the immersive scene and spatial interactions, but isolate the audio engine and DAW domain from the ECS. The SDK is Three.js-based; ordinary Three.js math and objects remain available. Follow the current official generator and generated starter conventions.

## 9. First milestone acceptance criteria

- One synth module produces sound.
- Theremin X/Y are exposed as typed controller outputs.
- Parameter mappings alter synth pitch and amplitude predictably.
- A controller can be disconnected and remapped without rebuilding the synth.
- Recording captures both note/gate events and continuous control automation.
- Per-track and shared-arrangement playback use stable AudioContext scheduling.
- Core tests run without a headset; XR interaction gets a separate hardware validation pass.
