# Audio Engine Design

## Responsibilities

The audio engine owns the AudioContext, graph construction, scheduling, voices, instruments, effects, track mixing, and master output. It does not know about Three.js, IWSDK entities, UI components, or hand tracking.

## Lifecycle

- Construct without starting audio.
- Initialize/resume only in response to an explicit user gesture where browser autoplay policy requires it.
- Expose state: uninitialized, running, suspended, disposed.
- Support idempotent suspend/resume and deterministic disposal.
- Never create a new AudioContext per note or per component.

## Timing

Use `AudioContext.currentTime` as the audio clock. The sequencer translates musical ticks/beats into audio times. Schedule events in short look-ahead windows from a timer/worker, but schedule individual AudioNode operations against future AudioContext times. Animation frames are for visuals only.

Define a single internal timestamp convention (audio-context seconds for scheduled events; musical ticks/beats for arrangement positions). Conversion is owned by the transport/scheduler boundary.

## Instrument contract

An instrument receives typed musical events and produces audio. It should expose parameter descriptors and serializable configuration. A first synth can use OscillatorNode + GainNode per voice with a master output; future DSP can move to AudioWorklet.

Required event handling:
- note-on(pitch, velocity, timestamp)
- note-off(pitch, timestamp)
- pitch bend / expression where supported
- all-notes-off / panic

Velocity should affect amplitude and may affect timbre. Release must be envelope-based, not an abrupt stop.

## Voices

- Explicit maximum polyphony.
- Voice allocator with predictable voice stealing (oldest/quietest configurable policy).
- Prevent stuck notes with all-notes-off, source disconnection, and input-source lifecycle cleanup.
- Note identity must include source/channel/note or a unique note-instance ID so overlapping same-pitch notes can be released correctly.

## Graph

Initial:
`Instrument -> Track Gain -> Master Gain -> Destination`

Later:
`Instrument -> Insert Effects -> Track Gain -> Master/Sends -> Master -> Destination`

Graph mutation must avoid audible clicks: use scheduled ramps/crossfades when replacing connections or gain values.

## Resource rules

- Decode and preload samples before playback.
- Avoid large allocations, decoding, or unbounded graph construction in audio callbacks.
- Use AudioWorklet for custom time-critical processing.
- Make sample-rate and device output considerations explicit.
- Monitor CPU and memory on target Quest hardware.

## Testing

Unit tests cover voice allocation, event normalization, scheduling conversion, and graph ownership. Manual tests cover actual output, latency, clipping, suspension, and long sessions.
