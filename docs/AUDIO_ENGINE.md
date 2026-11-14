# Audio Engine Design

## Responsibilities

A project owns one shared, lazily created AudioContext through AudioRuntime. Instruments own their voices and instrument-output gain stages; tracks own independent TrackAudioBus stages. This keeps audio modules separate from UI, XR, and controller implementations while allowing all tracks to mix in one browser audio graph.

## Lifecycle

- Construct AudioRuntime, instruments, and track buses without starting audio.
- Initialize/resume the shared AudioContext only in response to an explicit user gesture.
- Every instrument in a project receives the same AudioRuntime.
- A track bus creates its gain and stereo-panner nodes after the shared context starts.
- Each instrument output connects to its owning track bus; each bus connects to the shared destination.
- Dispose instruments and buses before closing the shared runtime.

The project does not create a new AudioContext per instrument or note.

## Clock model

Input adapters use performance-time seconds as a common monotonic event timestamp. AudioRuntime translates that clock into the one shared AudioContext time domain. The sequencer schedules against AudioContext time with a short look-ahead window and converts clip-relative positions into future performance-time timestamps.

Animation frames are for visuals and tracking, not note scheduling.

## Instrument and track contracts

An instrument receives typed musical events and produces audio. It owns its voices and instrument-level parameters, including the theremin expression-volume mapping.

A track bus owns independent output level and stereo pan for its track. Mute and solo are resolved by the project mixer before volume is applied. This separates instrument expression from the track fader.

## Voices

- Explicit maximum polyphony is still planned.
- A note instance is identified by source and unique note ID within its instrument instance.
- Stopping playback or disposing an input source must release its owned notes.
- A scheduled note-off can move an existing release earlier when playback is stopped.

## Resource rules

- Decode and preload samples before playback.
- Avoid large allocations, decoding, or unbounded graph construction in audio callbacks.
- Use AudioWorklet for custom time-critical processing.
- Monitor CPU and memory on target Quest hardware.

## Testing

Unit tests cover project mix metadata, migration, scheduling, event normalization, mappings, and recorder behavior. Manual tests must cover simultaneous instruments, track mute/solo/volume/pan, actual output, latency, clipping, suspension, and long sessions.
