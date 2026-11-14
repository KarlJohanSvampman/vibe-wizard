# Parameter Bus

## Purpose

The Parameter Bus connects controller outputs to parameters on any module, without hard-coding controller/instrument pairs. A single controller may control multiple parameters; multiple sources may target one parameter only when an explicit combination policy is configured.

## Mapping definition

A mapping stores:
- stable ID
- source module ID and output port
- target module ID and parameter ID
- source and destination ranges/units
- transform curve: linear, exponential, logarithmic, stepped, or custom
- invert flag
- clamp behavior
- dead zone
- quantization/step size
- smoothing time
- enabled/bypass flag

## Processing pipeline

1. Validate source signal and timestamp.
2. Convert source domain into normalized 0..1 where appropriate.
3. Apply dead zone and optional inversion.
4. Apply transfer curve.
5. Map into target range and unit.
6. Quantize/step if configured.
7. Clamp to legal target range.
8. Smooth where appropriate.
9. Dispatch a parameter update with timestamp.

Note/gate events are not values and must not pass through this continuous mapping pipeline.

## Combining sources

Default: one active mapping per parameter. To allow multiple sources, require a combine policy such as last-value-wins, sum, product, min/max, or priority. Define ownership and reset behavior so a disconnected controller cannot leave a parameter stuck.

## Example

Theremin X -> oscillator pitch (continuous frequency or scale-quantized MIDI pitch).
Theremin Y -> amplitude.
Knob -> reverb wet.
Slider -> filter cutoff.
Button -> sustain gate (use GateEvent, not a float).
One controller may map X to pitch on one synth and filter cutoff on another.

## Safety and performance

- Validate target parameter existence and type.
- Clamp to descriptor range.
- Use timestamps to preserve automation timing.
- Smooth only when desired; too much smoothing adds latency.
- Avoid allocating new mapping objects per sample/frame.
- Provide mapping visualization and a clear disable/bypass state.
