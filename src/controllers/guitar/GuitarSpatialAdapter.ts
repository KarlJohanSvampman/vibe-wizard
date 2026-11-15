import { VisibilityState, type World } from '@iwsdk/core';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { GuitarController } from './GuitarController.js';

/** Quest hand-tracking adapter: left index finger selects one of six chord buttons; right hand swipes the strings. */
export class GuitarSpatialAdapter {
  private readonly root = new Group();
  private readonly pads: Mesh[] = [];
  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private readonly leftWorld = new Vector3();
  private readonly rightWorld = new Vector3();
  private previousRight?: Vector3;
  private previousTime = 0;
  private lastChordIndex = -1;
  private readonly stopFrame: () => void;
  private readonly stopVisibility: () => void;

  constructor(private readonly world: World, private readonly guitar: GuitarController, private readonly onStrum?: (message: string) => void) {
    this.root.name = 'vibe-wizard-vr-guitar';
    this.root.visible = world.visibilityState.value !== VisibilityState.NonImmersive;
    for (let index = 0; index < 6; index++) {
      const pad = new Mesh(new BoxGeometry(0.12, 0.055, 0.035), new MeshBasicMaterial({ color: index === 0 ? 0xffb347 : 0x66558a }));
      pad.position.set((index - 2.5) * 0.16, 0, 0); this.root.add(pad); this.pads.push(pad);
    }
    world.scene.add(this.root);
    this.stopVisibility = world.visibilityState.subscribe(state => { this.root.visible = state !== VisibilityState.NonImmersive; });
    this.stopFrame = world.onXRFrame((frame, _delta, renderTime) => this.update(frame, renderTime / 1000));
  }

  dispose(): void {
    this.stopFrame(); this.stopVisibility(); this.world.scene.remove(this.root);
    for (const pad of this.pads) { pad.geometry.dispose(); (pad.material as MeshBasicMaterial).dispose(); }
  }

  private update(frame: XRFrame, time: number): void {
    this.world.player.head.getWorldPosition(this.head);
    this.world.player.head.getWorldDirection(this.forward); this.forward.y = 0;
    if (this.forward.lengthSq() < 0.0001) this.forward.set(0, 0, -1); else this.forward.normalize();
    this.root.position.copy(this.head).addScaledVector(this.forward, 0.65); this.root.position.y -= 0.22;
    this.root.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
    this.root.updateMatrixWorld(true);

    const left = this.world.input.xr.getPrimaryInputSource('left')?.hand?.get('index-finger-tip');
    const right = this.world.input.xr.getPrimaryInputSource('right')?.hand?.get('index-finger-tip');
    const reference = this.world.xrReferenceSpace;
    if (left && reference) {
      const pose = frame.getPose(left, reference);
      if (pose) {
        this.leftWorld.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
        this.world.player.updateMatrixWorld(true); this.world.player.localToWorld(this.leftWorld);
        const local = this.root.worldToLocal(this.leftWorld.clone());
        let nearest = -1, distance = 0.09;
        this.pads.forEach((pad, index) => { const d = pad.position.distanceTo(local); if (d < distance) { distance = d; nearest = index; } });
        if (nearest >= 0 && nearest !== this.lastChordIndex) { this.lastChordIndex = nearest; this.guitar.selectChord(this.guitar.chords[nearest]!.id); this.pads.forEach((pad, index) => (pad.material as MeshBasicMaterial).color.setHex(index === nearest ? 0xffb347 : 0x66558a)); }
      }
    }
    if (right && reference) {
      const pose = frame.getPose(right, reference);
      if (pose) {
        this.rightWorld.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
        this.world.player.updateMatrixWorld(true); this.world.player.localToWorld(this.rightWorld);
        const local = this.root.worldToLocal(this.rightWorld.clone());
        if (this.previousRight) {
          const delta = local.distanceTo(this.previousRight);
          if (delta > 0.045 && time - this.previousTime < 0.18) {
            this.guitar.strum(this.guitar.selectedChord, Math.min(1, delta * 4), time, local.y >= this.previousRight.y ? 'down' : 'up');
            this.onStrum?.('VR strum · ' + this.guitar.selectedChord.name);
            this.previousRight = undefined;
          } else this.previousRight.copy(local);
        } else { this.previousRight = local.clone(); this.previousTime = time; }
        if (this.previousRight) this.previousTime = time;
      }
    } else this.previousRight = undefined;
  }
}
