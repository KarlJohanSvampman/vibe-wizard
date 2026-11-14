# Technical Decisions

## Confirmed choices

| Area | Decision | Reason |
| --- | --- | --- |
| Frontend | TypeScript + Vite | Fast desktop workflow and strict domain contracts |
| 3D/XR | Three.js through Meta IWSDK | Meta's supported framework for Quest WebXR and desktop IWER |
| Audio | Web Audio API first | Native browser audio nodes before custom DSP |
| Custom DSP | AudioWorklet later | Isolate time-critical processing from UI |
| Rack | One global rack | Independent module instances and reusable routing |
| Inputs | Typed event and control streams | Notes/gates are not continuous floats |
| Recording | Note/control events separate from rendered audio | Keep performances editable |
| Persistence | IndexedDB planned | Local-first project and sample storage |
| AI | Provider abstraction, asynchronous | Keep generated assets out of the audio callback/path |

## IWSDK package compatibility

The starter uses the published IWSDK 1.1 package family and the Three.js runtime alias expected by IWSDK:

```json
{
  "dependencies": {
    "@iwsdk/core": "^1.1.0",
    "three": "npm:super-three@0.185.0"
  },
  "overrides": {
    "three": "npm:super-three@0.185.0"
  }
}
```

Keep the root `three` alias and override aligned. Do not replace this with a plain `three` package version without checking the current IWSDK compatibility guidance.

## Audio/UI separation

The audio engine and parameter bus must not import Three.js, IWSDK, or DOM types. The desktop panel and future XR systems are adapters that send platform-neutral commands and signals into the domain layer.

## Initial deliberate limitations

- The synth is a prototype oscillator instrument, not yet a production instrument.
- The theremin is represented by desktop range inputs; tracked-hand interaction is not yet wired.
- The event recorder stores typed events but transport playback and clip editing are not yet implemented.
- The initial scene is a minimal shell; workstation geometry and spatial UI will be built after the interaction/audio model is stable.
