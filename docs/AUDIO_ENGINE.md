# Audio Engine Design

## Responsibilities

The audio engine owns the AudioContext, graph construction, scheduling, voices, instruments, effects, track mixing, and master output. It does not know about Three.js, IWSDK entities, UI components, or hand tracking.

## Lifecycle

- Construct without starting audio.
- Initialize/resume only in response to an explicit user gesture where browser autoplay policy requires it.
- Expose running state and AudioContext time.
- Support deterministic disposal.
- Never create a new AudioContext per note or component.

## Clock model

Input adapters use performance-time seconds as a common monotonic event timestamp. AudioEngine translates that clock into AudioContext time when scheduling notes and parameter values.

The sequencer schedules against AudioContext time with a short look-ahead window. It converts clip-relative event positions into future performance-time timestamps, which the audio engine maps to its clock. Animation frames are for visuals and tracking, not note scheduling.

## Instrument contract

An instrument receives typed musical events and produces audio. It exposes parameter descriptors and serializable configuration. The first synth uses OscillatorNode and GainNode per voice.

Required event handling includes note-on, note-off, pitch bend/expression where supported, and all-notes-off.

Velocity affects amplitude. Release is envelope-based rather than abrupt.

## Voices

- Explicit maximum polyphony is still planned.
- A note instance is identified by source and unique note ID.
- Prevent stuck notes with all-notes-off and input-source lifecycle cleanup.
- A scheduled note-off can move an existing release earlier when playback is stopped.

## Resource rules

- Decode and preload samples before playback.
- Avoid large allocations, decoding, or unbounded graph construction in audio callbacks.
- Use AudioWorklet for custom time-critical processing.
- Monitor CPU and memory on target Quest hardware.

## Testing

Unit tests cover scheduling, event normalization, mappings, and recorder behavior. Manual tests cover actual output, latency, clipping, suspension, and long sessions.
