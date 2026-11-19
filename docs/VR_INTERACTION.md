# VR Interaction Design

## Interaction principles

- Make spatial instruments understandable through persistent visual feedback.
- Use the same domain commands for desktop and VR; only the interaction adapter differs.
- Keep audio timing independent from tracking/render frame rate.
- Calibrate and visualize interaction volume rather than relying on hidden coordinate assumptions.

## Theremin spatial controller — prototype 02

The spatial adapter uses IWSDK's managed XR input stack and a per-frame \`World.onXRFrame\` callback. IWSDK updates tracked input before invoking userland XR-frame callbacks.

The default right-hand index fingertip is sampled from the current \`XRFrame\` using the \`index-finger-tip\` joint. The pose is transformed through the player rig into world space, then into the local coordinates of the floating theremin volume. This uses a real tracked joint pose, not the rendered hand mesh or a controller grip approximation.

The volume follows the viewer's horizontal facing direction and sits approximately 0.72 m in front of the head, 0.36 m below head height. Its default dimensions are 0.72 m wide, 0.48 m high, and 0.24 m deep.

- X maps left-to-right to pitch (MIDI 48–84).
- Y maps bottom-to-top to volume.
- Depth is a tolerance slab, not a third musical axis.
- When the index fingertip enters the volume, the spatial adapter starts a note.
- When the fingertip leaves the volume or tracking is lost, it releases that note and mutes the controller.
- The glowing cursor shows the current fingertip position.
- The grid shows chromatic semitone divisions across the initial three-octave range.

The theremin controller itself remains platform-neutral. The adapter is responsible for reading XR tracking, coordinate conversion, visuals, and entry/exit behavior.

## Input adapters

Create a platform-neutral controller model. Desktop pointer/slider input is useful for development and accessibility. IWSDK hand/controller input adapters translate tracked poses and gestures into normalized controller output. Do not place XR-specific types into the audio or sequencer domain.

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

## Quest validation checklist

1. Serve the development session using HTTPS and open its network URL in Meta Quest Browser.
2. Press **Enter VR** from a user gesture; this also resumes the local audio context.
3. Enable hand tracking on the headset and use the right hand.
4. Move the right index fingertip into the floating rectangular field.
5. Sweep left/right and verify pitch changes continuously.
6. Sweep bottom/top and verify volume changes continuously.
7. Move the fingertip outside the depth/edge bounds and verify the note releases.
8. Hide the hand from tracking and verify the note releases rather than sticking.
9. Repeat for a sustained session and monitor audio glitches, controller drift, and tracking reacquisition.

The repository implementation is not a substitute for this physical-device validation. Record the actual headset/browser result before treating Quest behavior as verified.


## Workstation UI in immersive mode

The existing DOM workstation remains the primary editing surface in VR. When the world enters an immersive visibility state, the page switches to an expanded scrollable layout: the root can scroll vertically, and the dock, browser, track list, and arrangement retain independent scroll regions. Scroll containers use touch/overscroll settings intended for headset pointer and touch interaction. Validate actual Quest Browser DOM-overlay scrolling with both hand and controller input; browser/OS-level scroll gesture behavior can vary by runtime.

## Playable spatial piano and drums

Instrument-track placements carry their instrument family. Piano tracks render a full-width keyboard; drum tracks render an electronic tabletop kit with six pads and two cymbals.

- Both index fingertips can play instruments independently. Piano keys send gated note-on/note-off events; drum pads and cymbals send one-shot hits.
- A controller trigger ray can also play the key or pad it intersects.
- Piano strike velocity is estimated from downward fingertip speed, with a quiet but audible minimum and a capped maximum. Sideways hand movement does not increase velocity.
- Pressed piano keys depress and glow blue. Drum pads compress and flash amber. Feedback returns to the material's original appearance on release.
- Contact is evaluated against each key or pad's local hit region. A lost fingertip releases its held piano notes; adapter disposal and XR reference-space loss also release held notes.
- The VR adapter sends the same timestamped musical note events into the track's instrument and recorder path as other live input. To capture a performance, select the target track, arm it, press Record, play the spatial instrument, then Stop. The recorded take follows the existing clip/arrangement workflow.

The contact thresholds, hand ergonomics, controller ray alignment, and audio timing still require validation on a physical Quest headset. Desktop/browser CI cannot establish headset behavior.

## Fixed studio slots

The immersive studio now uses six fixed docking bays arranged in a shallow arc in front of the player. Green transparent outlines indicate the available slot volumes. Instruments are no longer grabbed or repositioned by either hand: this avoids accidental movement while playing piano keys or drum pads.

The left index fingertip is used to hover a slot. Pinch the left thumb and index finger together while remaining inside a slot for approximately three seconds to trigger its dwell confirmation. The slot gives a stronger green visual confirmation. This is the first interaction layer for the slot workflow; track/representation selection in a contextual menu is the next interaction increment and is not yet wired.

The right-hand pinch is reserved for scratching the turntable record. It does not move studio objects. Fingertip contact with piano keys and drum pads remains independent of slot interaction.

The studio adds hemisphere, ambient, and directional lighting, and the piano chassis/key materials have been brightened for better contrast. Validate lighting, slot reach, hand-tracking thresholds, and dwell timing on the target Quest headset; desktop/browser tests cannot establish headset ergonomics.
