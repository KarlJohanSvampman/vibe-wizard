# VR Interaction Design

## Interaction principles

- Make spatial instruments understandable through persistent visual feedback.
- Use the same domain commands for desktop and VR; only the interaction adapter differs.
- Keep audio timing independent from tracking/render frame rate.
- Calibrate and visualize interaction volume rather than relying on hidden coordinate assumptions.

## Theremin

A floating interaction volume sits in front of the performer. The hand position is normalized into X/Y values:
- X: pitch or another mapped continuous parameter.
- Y: volume/expression or another mapped parameter.

Show a cursor/sphere for hand position, axis bounds, scale/note markers, and current output. In harmonic mode, quantize X to a selected scale (chromatic, major, minor, pentatonic, custom, or unquantized). Hysteresis can prevent rapid switching at boundaries.

## Input adapters

Create a platform-neutral controller model. Desktop pointer input is useful for development and accessibility. IWSDK hand/controller input adapters translate tracked poses and gestures into normalized controller output. Do not place XR-specific types into the audio or sequencer domain.

## Virtual piano

For hand-tracked keys, use fingertip-to-key surface distance and hysteresis:
- Note-on when crossing the press threshold.
- Note-off when leaving the release threshold.
- Estimate velocity from approach speed, with filtering and sensible caps.
- Track note-instance identity per hand/key to avoid stuck notes.

## Spatial UI

Use IWSDK's supported spatial UI and interaction systems where they fit. Prefer standard DOM/desktop views for dense precision editing such as piano roll and mixer, with VR-friendly spatial controls for performance and rack manipulation.

## Comfort and robustness

- Provide calibration/reset.
- Avoid requiring extreme reach or continuous arm elevation.
- Handle hand tracking loss by releasing active gates/notes safely.
- Expose visual and audio feedback.
- Validate actual Quest hand tracking behavior and browser feature support on hardware.
