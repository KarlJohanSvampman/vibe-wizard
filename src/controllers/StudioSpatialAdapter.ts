import { VisibilityState, type World } from '@iwsdk/core';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { StudioObjectPlacement } from './ControllerModel.js';

/** Renders project placements in the immersive room and supports pinch-to-move with either hand. */
export class StudioSpatialAdapter {
  private readonly root = new Group();
  private readonly meshes = new Map<string, Mesh>();
  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private readonly handWorld = new Vector3();
  private readonly handLocal = new Vector3();
  private placements: StudioObjectPlacement[] = [];
  private draggingId?: string;
  private pinching = false;
  private readonly stopFrame: () => void;
  private readonly stopVisibility: () => void;

  constructor(private readonly world: World, private readonly onCommit: (placements: readonly StudioObjectPlacement[]) => void) {
    this.root.name = 'vibe-wizard-spatial-studio';
    this.root.visible = world.visibilityState.value !== VisibilityState.NonImmersive;
    world.scene.add(this.root);
    this.stopVisibility = world.visibilityState.subscribe(state => { this.root.visible = state !== VisibilityState.NonImmersive; });
    this.stopFrame = world.onXRFrame(frame => this.update(frame));
  }

  setLayout(placements: readonly StudioObjectPlacement[]): void {
    this.placements = placements.map(item => ({ ...item, position: { ...item.position }, rotation: { ...item.rotation }, scale: { ...item.scale } }));
    const active = new Set(this.placements.map(item => item.id));
    for (const [id, mesh] of this.meshes) if (!active.has(id)) { this.root.remove(mesh); mesh.geometry.dispose(); (mesh.material as MeshStandardMaterial).dispose(); this.meshes.delete(id); }
    for (const placement of this.placements) {
      let mesh = this.meshes.get(placement.id);
      if (!mesh) {
        const color = placement.objectType === 'instrument-track' ? 0x6b8dd6 : 0xd99b42;
        mesh = new Mesh(new BoxGeometry(0.34, 0.16, 0.24), new MeshStandardMaterial({ color, roughness: 0.6 }));
        mesh.name = placement.id; this.meshes.set(placement.id, mesh); this.root.add(mesh);
      }
      mesh.position.set(placement.position.x, placement.position.y, placement.position.z);
      mesh.rotation.set(placement.rotation.x, placement.rotation.y, placement.rotation.z);
      mesh.scale.set(placement.scale.x, placement.scale.y, placement.scale.z);
    }
  }

  dispose(): void {
    this.stopFrame(); this.stopVisibility(); this.world.scene.remove(this.root);
    for (const mesh of this.meshes.values()) { mesh.geometry.dispose(); (mesh.material as MeshStandardMaterial).dispose(); }
    this.meshes.clear();
  }

  private update(frame: XRFrame): void {
    this.world.player.head.getWorldPosition(this.head);
    this.world.player.head.getWorldDirection(this.forward); this.forward.y = 0;
    if (this.forward.lengthSq() < 0.0001) this.forward.set(0, 0, -1); else this.forward.normalize();
    this.root.position.copy(this.head).addScaledVector(this.forward, 0.95); this.root.position.y -= 0.38;
    this.root.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
    this.root.updateMatrixWorld(true);

    const source = this.world.input.xr.getPrimaryInputSource('right') ?? this.world.input.xr.getPrimaryInputSource('left');
    const index = source?.hand?.get('index-finger-tip'); const thumb = source?.hand?.get('thumb-tip');
    const reference = this.world.xrReferenceSpace;
    if (!index || !thumb || !reference) { this.finishDrag(); return; }
    const indexPose = frame.getPose(index, reference); const thumbPose = frame.getPose(thumb, reference);
    if (!indexPose || !thumbPose) { this.finishDrag(); return; }
    this.handWorld.set(indexPose.transform.position.x, indexPose.transform.position.y, indexPose.transform.position.z);
    this.world.player.updateMatrixWorld(true); this.world.player.localToWorld(this.handWorld);
    this.handLocal.copy(this.handWorld); this.root.worldToLocal(this.handLocal);
    const thumbWorld = new Vector3(thumbPose.transform.position.x, thumbPose.transform.position.y, thumbPose.transform.position.z);
    this.world.player.localToWorld(thumbWorld);
    const pinching = this.handWorld.distanceTo(thumbWorld) < 0.035;
    if (pinching && !this.pinching) {
      let nearest: { id: string; distance: number } | undefined;
      for (const [id, mesh] of this.meshes) {
        const distance = mesh.position.distanceTo(this.handLocal);
        if (distance < 0.24 && (!nearest || distance < nearest.distance)) nearest = { id, distance };
      }
      this.draggingId = nearest?.id;
    }
    if (pinching && this.draggingId) {
      const mesh = this.meshes.get(this.draggingId);
      mesh?.position.copy(this.handLocal);
      this.placements = this.placements.map(item => item.id === this.draggingId
        ? { ...item, position: { x: this.handLocal.x, y: this.handLocal.y, z: this.handLocal.z } } : item);
    }
    if (!pinching && this.pinching) this.finishDrag();
    this.pinching = pinching;
  }

  private finishDrag(): void {
    if (this.draggingId) this.onCommit(this.placements);
    this.draggingId = undefined; this.pinching = false;
  }
}
