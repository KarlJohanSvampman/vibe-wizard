# Audio Engine Design

## Responsibilities

A project owns one shared, lazily created AudioContext through AudioRuntime. Instruments own their voices and instrument-output gain stages; tracks own independent TrackAudioBus stages; effect modules expose named audio input/output ports. AudioConnectionGraph validates and physically wires patch cables, rejecting invalid directions, occupied inputs, duplicate connections, and routing cycles. This keeps audio modules separate from UI, XR, and controller implementations while allowing all tracks to mix in one browser audio graph.

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

An instrument receives typed musical events and produces audio. The runtime currently provides four instrument families behind the same event/track contract:

- **Analog Synth** — polyphonic sawtooth voice with pitch and expression-volume control.
- **Piano** — additive struck-string approximation with a bright harmonic attack and a longer natural decay.
- **Drum Kit** — one-shot kick, snare, tom, and cymbal synthesis. General MIDI-style percussion pitches are used (kick 35/36, snare 38/40, closed/open hi-hat 42/46).
- **Sampler** — chromatic playback of a user-imported audio file, with MIDI note 60 as its root pitch. When no sample is loaded, a quiet triangle fallback keeps the track testable.

All families implement the same note-on/note-off/parameter interface and share the project's one AudioContext. The piano and percussion sounds are generated locally from native Web Audio oscillators, filters, envelopes, and a cached noise buffer; the piano is an intentionally compact additive model rather than a large multisample library.

Sampler audio bytes live in a separate IndexedDB database (`vibe-wizard-audio-assets`) so project JSON snapshots remain small. A project track stores only the sample asset ID and display filename. Imported files are decoded with `decodeAudioData` on the shared AudioContext and never uploaded.

A track bus owns independent output level and stereo pan for its track. Mute and solo are resolved by the project mixer before volume is applied. This separates instrument expression from the track fader.\n\n## Effects and routing\n\n- Audio modules publish named `audio` ports with explicit `input` or `output` direction and optional connection limits.\n- `AudioConnectionGraph` validates endpoints, enforces one incoming cable per input by default, permits explicit output fan-out, prevents self-links and directed cycles, and disconnects physical Web Audio edges when cables/modules are removed.\n- `DelayEffect` provides independent wet/dry paths, delay time (10 ms–2 s), and bounded feedback (0–0.85). Its feedback loop contains a DelayNode and is intentionally internal to the effect.\n- `ReverbEffect` provides convolution reverb using a locally generated stereo impulse response, wet/dry mix, and decay time (0.1–8 s). No network assets are required.\n- Effect parameters can be set before audio startup; values are retained and applied when the graph is created. Effect modules own and disconnect all nodes they create.\n- The effect modules and validated patch graph are the routing foundation; per-track insert chains and shared send/return controls are the next integration step.\n\nThe project master bus owns the final output gain (0..1), a fast broadband safety limiter (−3 dB threshold, 20:1 ratio), and a post-limiter peak analyser. The Mixer pane exposes master level, live dBFS peak, and limiter gain-reduction status. The limiter catches transient overs; it does not replace sensible track gain staging or mastering.

## Voices

- Synth, piano, and sampler default to 16 simultaneous voices; drums default to 32 short-lived one-shot voices.
- The per-instrument voice ceiling can be changed at runtime (1..128); lowering it immediately reclaims voices until the new limit is met.
- When capacity is reached, the allocator steals the oldest voice already in release; if none are releasing, it steals the oldest active voice. Equal-time ties are deterministic.
- Voice identity is scoped by both event source and note ID, preventing live input and sequencer playback from colliding.
- Retriggering an existing source/note pair immediately retires its previous voice before starting the replacement.
- `allNotesOff()` schedules a short release for sustained voices; `panic()` immediately silences every voice, including one-shots, and is used during instrument disposal.
- The workbench Stop controls stop arrangement and clip transports, stop live desktop/spatial notes, and panic every active track instrument. This is the user-facing project-wide stop-all path.
- Drum voices are one-shots with short autonomous decays; note-off does not truncate a triggered drum hit.
- A note instance is identified by source and unique note ID within its instrument instance.
- Stopping playback or disposing an input source must release its owned notes.
- A scheduled note-off can move an existing release earlier when playback is stopped.

## Resource rules

- Decode and preload samples before playback.
- Avoid large allocations, decoding, or unbounded graph construction in audio callbacks.
- Use AudioWorklet for custom time-critical processing.
- Monitor CPU and memory on target Quest hardware.

## Testing

Unit tests cover project mix metadata, migration, scheduling, event normalization, mappings, recorder behavior, master routing/limiter settings, peak metering, disposal, effect parameter bounds, effect-node cleanup, patch direction/cardinality validation, duplicate/self/cycle rejection, and cable removal. AudioEngine lifecycle tests cover source-scoped notes, rapid retrigger, bounded polyphony, panic, and disposal. Manual tests must still cover simultaneous instruments, track mute/solo/volume/pan, actual output, latency, limiter behavior, suspension, and long sessions.
