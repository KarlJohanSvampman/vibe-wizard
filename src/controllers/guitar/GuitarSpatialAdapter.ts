import { VisibilityState, type World } from '@iwsdk/core';
import {
  BoxGeometry, BufferGeometry, ExtrudeGeometry, Group, Line, LineBasicMaterial,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, Shape, Vector3,
} from 'three';
import type { GuitarController } from './GuitarController.js';

/** Procedural six-string guitar prop and Quest hand-tracking interaction surface. */
export class GuitarSpatialAdapter {
  private readonly root = new Group();
  private readonly pads: Mesh[] = [];
  private readonly ownedMaterials: Array<MeshBasicMaterial | MeshStandardMaterial | LineBasicMaterial> = [];
  private readonly ownedGeometries: Array<BoxGeometry | BufferGeometry | ExtrudeGeometry> = [];
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
    this.buildGuitar();
    world.scene.add(this.root);
    this.stopVisibility = world.visibilityState.subscribe(state => { this.root.visible = state !== VisibilityState.NonImmersive; });
    this.stopFrame = world.onXRFrame((frame, _delta, renderTime) => this.update(frame, renderTime / 1000));
  }

  dispose(): void {
    this.stopFrame(); this.stopVisibility(); this.world.scene.remove(this.root);
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedGeometries.length = 0; this.ownedMaterials.length = 0;
  }

  private buildGuitar(): void {
    const wood = new MeshStandardMaterial({ color: 0x9a552b, roughness: 0.48, metalness: 0.04 });
    const darkWood = new MeshStandardMaterial({ color: 0x30251f, roughness: 0.62 });
    const trim = new MeshStandardMaterial({ color: 0xd7b77b, roughness: 0.35, metalness: 0.25 });
    const stringMaterial = new LineBasicMaterial({ color: 0xe4e0d5 });
    const padMaterial = new MeshBasicMaterial({ color: 0x66558a });
    this.ownedMaterials.push(wood, darkWood, trim, stringMaterial, padMaterial);

    const bodyShape = new Shape();
    bodyShape.moveTo(-0.13, -0.18);
    bodyShape.bezierCurveTo(-0.32, -0.08, -0.33, 0.12, -0.19, 0.2);
    bodyShape.bezierCurveTo(-0.11, 0.25, -0.08, 0.31, 0, 0.31);
    bodyShape.bezierCurveTo(0.08, 0.31, 0.11, 0.25, 0.19, 0.2);
    bodyShape.bezierCurveTo(0.33, 0.12, 0.32, -0.08, 0.13, -0.18);
    bodyShape.lineTo(0.08, -0.27); bodyShape.lineTo(-0.08, -0.27); bodyShape.closePath();
    const bodyGeometry = new ExtrudeGeometry(bodyShape, { depth: 0.065, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.012, bevelThickness: 0.012 });
    const body = new Mesh(bodyGeometry, wood); body.position.z = -0.035; this.root.add(body); this.ownedGeometries.push(bodyGeometry);

    const addBox = (width: number, height: number, depth: number, x: number, y: number, z: number, material: MeshStandardMaterial | MeshBasicMaterial) => {
      const geometry = new BoxGeometry(width, height, depth); const mesh = new Mesh(geometry, material);
      mesh.position.set(x, y, z); this.root.add(mesh); this.ownedGeometries.push(geometry); return mesh;
    };
    addBox(0.105, 0.72, 0.045, 0, 0.47, 0.018, darkWood); // neck
    addBox(0.145, 0.09, 0.055, 0, 0.86, 0.018, wood); // headstock
    addBox(0.18, 0.025, 0.025, 0, -0.12, 0.055, trim); // bridge
    addBox(0.13, 0.025, 0.025, 0, 0.79, 0.052, trim); // nut
    addBox(0.2, 0.16, 0.012, 0, 0.02, 0.047, darkWood); // pickguard

    // Six visible strings run continuously from the bridge across the fretboard.
    for (let string = 0; string < 6; string++) {
      const x = (string - 2.5) * 0.018;
      const geometry = new BufferGeometry().setFromPoints([new Vector3(x, -0.12, 0.072), new Vector3(x, 0.79, 0.052)]);
      const line = new Line(geometry, stringMaterial); this.root.add(line); this.ownedGeometries.push(geometry);
    }
    // Fret wires.
    for (let fret = 1; fret <= 8; fret++) {
      const y = 0.79 - 0.72 * (1 - Math.pow(2, -fret / 12)) / (1 - Math.pow(2, -8 / 12));
      addBox(0.108, 0.006, 0.008, 0, y, 0.048, trim);
    }
    // Chord selectors sit above the neck; the open chord is the leftmost pad.
    for (let index = 0; index < 6; index++) {
      const material = new MeshBasicMaterial({ color: index === 0 ? 0xffb347 : 0x66558a });
      this.ownedMaterials.push(material);
      const geometry = new BoxGeometry(0.12, 0.055, 0.035);
      const pad = new Mesh(geometry, material);
      pad.position.set((index - 2.5) * 0.14, 1.02, 0.04);
      this.root.add(pad); this.pads.push(pad); this.ownedGeometries.push(geometry);
    }
    // A subtle strum target sits over the sound hole.
    const strumGuide = addBox(0.34, 0.018, 0.012, 0, 0.055, 0.09, trim);
    strumGuide.name = 'guitar-strum-zone';
  }

  private update(frame: XRFrame, time: number): void {
    this.world.player.head.getWorldPosition(this.head);
    this.world.player.head.getWorldDirection(this.forward); this.forward.y = 0;
    if (this.forward.lengthSq() < 0.0001) this.forward.set(0, 0, -1); else this.forward.normalize();
    this.root.position.copy(this.head).addScaledVector(this.forward, 0.65); this.root.position.y -= 0.32;
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
        let nearest = -1, distance = 0.085;
        this.pads.forEach((pad, index) => { const d = pad.position.distanceTo(local); if (d < distance) { distance = d; nearest = index; } });
        if (nearest >= 0 && nearest !== this.lastChordIndex) {
          this.lastChordIndex = nearest;
          this.guitar.selectChord(this.guitar.chords[nearest]!.id);
          this.pads.forEach((pad, index) => (pad.material as MeshBasicMaterial).color.setHex(index === nearest ? 0xffb347 : 0x66558a));
        }
      }
    }
    if (right && reference) {
      const pose = frame.getPose(right, reference);
      if (pose) {
        this.rightWorld.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
        this.world.player.updateMatrixWorld(true); this.world.player.localToWorld(this.rightWorld);
        const local = this.root.worldToLocal(this.rightWorld.clone());
        // Only count a swipe through the string plane, not arbitrary hand movement around the room.
        const inStrumArea = Math.abs(local.x) < 0.25 && local.y > -0.15 && local.y < 0.85 && local.z > 0.015 && local.z < 0.28;
        if (!inStrumArea) { this.previousRight = undefined; return; }
        if (this.previousRight) {
          const delta = local.distanceTo(this.previousRight);
          const elapsed = time - this.previousTime;
          const dx = local.x - this.previousRight.x;
          const dy = local.y - this.previousRight.y;
          const dz = local.z - this.previousRight.z;
          if (delta > 0.035 && elapsed > 0 && elapsed < 0.22 && Math.abs(dx) > Math.abs(dy) * 0.7) {
            const intensity = Math.min(1, delta * 5);
            this.guitar.strum(this.guitar.selectedChord, intensity, time, dy >= 0 ? 'down' : 'up');
            this.onStrum?.((dy >= 0 ? 'Down' : 'Up') + ' strum · ' + this.guitar.selectedChord.name);
            this.previousRight = undefined;
          } else if (Math.abs(dz) > 0.025 && Math.abs(dx) < 0.025 && Math.abs(dy) < 0.08 && local.y > -0.12 && local.y < 0.79) {
            const stringIndex = Math.max(0, Math.min(5, Math.round(local.x / 0.018 + 2.5)));
            const pitch = this.guitar.pluckString(stringIndex, Math.min(1, Math.abs(dz) * 12), time);
            if (pitch !== undefined) this.onStrum?.('Plucked string ' + (stringIndex + 1) + ' · MIDI ' + pitch);
            this.previousRight = undefined;
          } else this.previousRight.copy(local);
        } else this.previousRight = local.clone();
        if (this.previousRight) this.previousTime = time;
      }
    } else this.previousRight = undefined;
  }
}
