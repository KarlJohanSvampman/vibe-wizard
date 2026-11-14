# Vibe-Wizard Architecture

## 1. Product shape

Vibe-Wizard is a local-first DAW and immersive instrument playground. Its central abstraction is a **modular rack** connected to tracks and an audio graph. Inputs generate typed musical/control events; the sequencer can record and replay those events; controller outputs can also modulate arbitrary rack parameters.

The application is split into independently testable domains:

1. **Audio engine** — audio graph, scheduling, instruments, effects, mixing.
2. **Rack** — module lifecycle, module registry, ports, track assignment, routing.
3. **Input** — XR hands/controllers, virtual keyboard, MIDI devices, desktop input.
4. **Parameter system** — typed control sources mapped to module parameters.
5. **Sequencer** — transport, event tracks, automation, arrangement, piano roll.
6. **Persistence** — project serialization, IndexedDB asset store, presets.
7. **AI integration** — asynchronous generation/transformation providers.
8. **Presentation** — desktop DAW views and IWSDK-powered spatial interactions.

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
       Audio graph <--- parameter updates
          |
       Track mixer
          |
      Master output

Sequencer recorder observes event/control streams and persists timestamped clips.
AI providers --(async assets)--> validation/import --> local sample/instrument library
```

## 4. Rack model

A project owns one global rack. The rack contains instruments, effects, and controllers. Instruments are assigned to one or more tracks (subject to routing rules); effects can be inserted into track or send paths; controllers are not necessarily assigned to a track and may target any parameter.

A track references an instrument instance or instrument routing endpoint. Do not make each track own a separate, duplicated module registry.

## 5. Typed ports

Do not represent all inputs as floating-point values. At minimum distinguish:

- `NoteEvent`: note-on, note-off, pitch, velocity, channel, timestamp, source.
- `ControlSignal`: normalized or unit-bearing continuous value, timestamp, source.
- `GateEvent`: press/release or on/off event.
- `AudioPort`: audio input/output endpoint.
- `ClockEvent`: transport timing or synchronization event.

Modules declare accepted input and output port types, supported parameter definitions, and routing constraints.

## 6. Scheduling and performance

- Schedule audio ahead using the AudioContext clock; do not rely on animation-frame timing for note precision.
- Keep rendering and audio timing independent.
- Preload samples before playback and avoid decoding or large allocations in the audio callback.
- Use AudioWorklet for custom DSP only where native Web Audio nodes are insufficient.
- Make polyphony, voice stealing, and resource budgets explicit.
- Use feature detection for WebXR, hand tracking, MIDI, and optional browser APIs.

## 7. Persistence

Projects are versioned JSON documents. Large binary assets are stored separately in IndexedDB and referenced by stable asset IDs. Autosave should be transactional and resilient to tab closure. Presets should serialize module configuration and mapping definitions without serializing runtime AudioNode objects.

## 8. IWSDK integration

IWSDK provides app lifecycle, ECS, XR input integration, scene/runtime tools, and optional interaction systems. Use it for the immersive scene and spatial interactions, but isolate the audio engine and DAW domain from the ECS. The SDK is Three.js-based; ordinary Three.js math and objects remain available. Follow the current official generator and generated starter conventions.

## 9. First milestone acceptance criteria

- One polyphonic synth module produces sound.
- Theremin X/Y are exposed as typed controller outputs.
- Parameter mappings alter synth pitch and amplitude predictably.
- A controller can be disconnected and remapped without rebuilding the synth.
- Recording captures both note/gate events and continuous control automation.
- Playback reproduces the performance with stable scheduling.
- Core tests run without a headset; XR interaction gets a separate hardware validation pass.
