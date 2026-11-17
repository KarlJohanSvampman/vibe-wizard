import { VisibilityState, type World } from '@iwsdk/core';
import {
  BoxGeometry, CircleGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  RingGeometry, SphereGeometry, Vector3,
} from 'three';
import type { StudioObjectPlacement } from './ControllerModel.js';

/** Recognisable procedural studio props, plus a hand-scratchable VR turntable. */
export class StudioSpatialAdapter {
  private readonly root = new Group();
  private readonly meshes = new Map<string, Group>();
  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private readonly handWorld = new Vector3();
  private readonly handLocal = new Vector3();
  private readonly activeInstrumentNotes = new Map<string, { trackId: string; noteId: string; sourceId: string }>();
  private readonly turntable = new Group();
  private readonly record = new Mesh(new CylinderGeometry(0.31, 0.31, 0.018, 48), new MeshStandardMaterial({ color: 0x202124, roughness: 0.42 }));
  private readonly tonearm = new Group();
  private readonly turntablePosition = new Vector3(0.72, -0.26, -0.82);
  private placements: StudioObjectPlacement[] = [];
  private draggingId?: string;
  private pinching = false;
  private lastScratchNormalized = -1;
  private lastScratchAt = 0;
  private readonly stopFrame: () => void;
  private readonly stopVisibility: () => void;

  constructor(private readonly world: World, private readonly onCommit: (placements: readonly StudioObjectPlacement[]) => void, private readonly onScratch?: (normalizedPosition: number) => void, private readonly getPlaybackPosition?: () => number | undefined, private readonly onInstrumentNoteOn?: (trackId: string, sourceId: string, noteId: string, pitch: number, velocity: number, timestamp: number) => void, private readonly onInstrumentNoteOff?: (trackId: string, sourceId: string, noteId: string, timestamp: number) => void) {
    this.root.name = 'vibe-wizard-spatial-studio';
    this.root.visible = world.visibilityState.value !== VisibilityState.NonImmersive;
    this.buildTurntable();
    world.scene.add(this.root);
    this.stopVisibility = world.visibilityState.subscribe(state => { this.root.visible = state !== VisibilityState.NonImmersive; });
    this.stopFrame = world.onXRFrame(frame => this.update(frame));
  }

  setLayout(placements: readonly StudioObjectPlacement[]): void {
    this.placements = placements.map(item => ({ ...item, position: { ...item.position }, rotation: { ...item.rotation }, scale: { ...item.scale } }));
    const active = new Set(this.placements.map(item => item.id));
    for (const [id, group] of this.meshes) if (!active.has(id)) { this.root.remove(group); this.disposeGroup(group); this.meshes.delete(id); }
    for (const placement of this.placements) {
      let group = this.meshes.get(placement.id);
      if (!group) { group = this.createStudioObject(placement); group.name = placement.id; this.meshes.set(placement.id, group); this.root.add(group); }
      group.position.set(placement.position.x, placement.position.y, placement.position.z);
      group.rotation.set(placement.rotation.x, placement.rotation.y, placement.rotation.z);
      group.scale.set(placement.scale.x, placement.scale.y, placement.scale.z);
    }
  }

  dispose(): void {
    this.stopFrame(); this.stopVisibility(); this.releaseInstrumentNotes(); this.world.scene.remove(this.root);
    for (const group of this.meshes.values()) this.disposeGroup(group);
    this.meshes.clear(); this.disposeGroup(this.turntable);
  }

  private material(color: number, metalness = 0.08, roughness = 0.55): MeshStandardMaterial {
    return new MeshStandardMaterial({ color, metalness, roughness });
  }
  private add(group: Group, geometry: BoxGeometry | CylinderGeometry | CircleGeometry | RingGeometry | SphereGeometry, color: number, position: [number,number,number], scale?: [number,number,number]): Mesh {
    const mesh = new Mesh(geometry, this.material(color)); mesh.position.set(...position); if (scale) mesh.scale.set(...scale); group.add(mesh); return mesh;
  }
  private createStudioObject(placement: StudioObjectPlacement): Group {
    const group = new Group();
    if (placement.objectType === 'instrument-track' && placement.instrumentType === 'piano') {
      // Full-width playable-looking keyboard with alternating black keys.
      this.add(group, new BoxGeometry(1.12, 0.12, 0.34), 0x292d34, [0, 0, 0]);
      this.add(group, new BoxGeometry(1.02, 0.018, 0.22), 0xe9e5dc, [0, -0.018, 0.035]);
      const whitePitches = [0, 2, 4, 5, 7, 9, 11];
      for (let i = 0; i < 24; i++) { const key = this.add(group, new BoxGeometry(0.041, 0.025, 0.19), 0xf6f2e8, [-0.48 + i * 0.0417, 0.002, 0.035]); key.userData.instrumentKey = true; key.userData.pitch = 48 + Math.floor(i / 7) * 12 + whitePitches[i % 7]; }
      for (let i = 0; i < 23; i++) if (![2, 6].includes(i % 7)) { const key = this.add(group, new BoxGeometry(0.026, 0.038, 0.12), 0x101216, [-0.459 + i * 0.0417, 0.018, -0.005]); key.userData.instrumentKey = true; key.userData.pitch = 49 + Math.floor(i / 7) * 12 + [0, 2, 0, 3, 5, 7, 0][i % 7]; }
      for (let i = 0; i < 5; i++) this.add(group, new CylinderGeometry(0.025, 0.025, 0.02, 16), 0xc38e4b, [0.32 + i * 0.09, 0.075, -0.1]);
    } else if (placement.objectType === 'instrument-track' && placement.instrumentType === 'drums') {
      // Compact tabletop electronic drum kit: kick, snare, toms and cymbal pads.
      this.add(group, new BoxGeometry(1.0, 0.09, 0.58), 0x252a31, [0, 0, 0]);
      const pads: Array<[number, number, number, number]> = [
        [-0.32, 0.08, -0.14, 0x9c4545], [0, 0.08, -0.14, 0x477b9d], [0.32, 0.08, -0.14, 0x477b9d],
        [-0.32, 0.08, 0.16, 0x477b9d], [0, 0.08, 0.16, 0x9c4545], [0.32, 0.08, 0.16, 0x477b9d],
      ];
      const drumPitches = [36, 38, 42, 45, 46, 49];
      pads.forEach(([x, y, z, color], index) => { const pad = this.add(group, new CylinderGeometry(0.115, 0.115, 0.055, 32), color, [x, y, z]); pad.userData.drumPad = true; pad.userData.pitch = drumPitches[index]; });
      this.add(group, new CylinderGeometry(0.16, 0.16, 0.018, 32), 0xc6a64e, [-0.46, 0.28, -0.22], [1, 0.12, 1]);
      this.add(group, new CylinderGeometry(0.16, 0.16, 0.018, 32), 0xc6a64e, [0.46, 0.28, 0.22], [1, 0.12, 1]);
    } else if (placement.objectType === 'instrument-track') {
      // Compact keyboard/workstation: chassis, keybed, alternating black keys and control panel.
      this.add(group, new BoxGeometry(0.72,0.12,0.28), 0x34383e, [0,0,0]);
      this.add(group, new BoxGeometry(0.58,0.018,0.14), 0xe4e1d8, [0,-0.018,0.055]);
      for (let i=0;i<14;i++) this.add(group,new BoxGeometry(0.034,0.025,0.11),0xf4f1e9,[-0.27+i*0.041,-0.002,0.055]);
      for (let i=0;i<13;i++) if (i%7!==2 && i%7!==6) this.add(group,new BoxGeometry(0.022,0.035,0.075),0x17191d,[-0.25+i*0.041,0.012,0.02]);
      for (let i=0;i<4;i++) this.add(group,new CylinderGeometry(0.022,0.022,0.018,16),0xc38e4b,[0.19+i*0.075,0.075,-0.075]);
    } else if (placement.objectType === 'controller-instance') {
      this.add(group,new BoxGeometry(0.62,0.07,0.38),0x262a31,[0,0,0]);
      for(let row=0;row<2;row++) for(let col=0;col<4;col++) this.add(group,new BoxGeometry(0.095,0.025,0.11),0x4d5968,[-0.21+col*0.14,0.048,-0.08+row*0.15]);
      for(let i=0;i<3;i++) this.add(group,new CylinderGeometry(0.035,0.035,0.035,20),0xc38e4b,[0.19,0.06,-0.11+i*0.1]);
    } else {
      this.add(group,new BoxGeometry(0.34,0.16,0.24),0x657080,[0,0,0]);
    }
    return group;
  }
  private buildTurntable(): void {
    this.turntable.name = 'vibe-wizard-vr-turntable';
    this.add(this.turntable,new BoxGeometry(0.9,0.11,0.68),0x34383e,[0,0,0]);
    this.add(this.turntable,new CylinderGeometry(0.36,0.36,0.025,48),0x111316,[0,0.075,0]);
    this.record.position.set(0,0.096,0);  this.record.castShadow=true; this.turntable.add(this.record);
    const label=this.add(this.turntable,new CylinderGeometry(0.09,0.09,0.008,32),0xb58a52,[0,0.111,0]); 
    for(let r=0.13;r<0.29;r+=0.035){const groove=new Mesh(new RingGeometry(r,r+0.002,48),this.material(0x55585c,0.2,0.65));groove.rotation.x=-Math.PI/2;groove.position.y=0.111;this.turntable.add(groove);}
    this.tonearm.position.set(0.34,0.12,-0.22);
    const arm=this.add(this.tonearm,new CylinderGeometry(0.012,0.012,0.42,12),0xbfc4ca,[0,0.18,0]);arm.rotation.z=-0.55;
    this.add(this.tonearm,new SphereGeometry(0.035,16,12),0x9ea4ab,[0,0.39,0]);
    this.add(this.tonearm,new BoxGeometry(0.07,0.035,0.06),0x24272c,[-0.18,0.02,0.02]);
    this.turntable.add(this.tonearm); this.turntable.position.copy(this.turntablePosition); this.root.add(this.turntable);
  }
  private disposeGroup(group: Group): void {
    group.traverse(object => { const mesh=object as Mesh; if(mesh.geometry) mesh.geometry.dispose(); const material=mesh.material; if(Array.isArray(material)) material.forEach(item=>item.dispose()); else if(material) material.dispose(); });
  }

  private update(frame: XRFrame): void {
    this.world.player.head.getWorldPosition(this.head);
    this.world.player.head.getWorldDirection(this.forward); this.forward.y=0;
    if(this.forward.lengthSq()<0.0001)this.forward.set(0,0,-1);else this.forward.normalize();
    this.root.position.copy(this.head).addScaledVector(this.forward,0.95);this.root.position.y-=0.38;
    this.root.rotation.set(0,Math.atan2(-this.forward.x,-this.forward.z),0);this.root.updateMatrixWorld(true);
    const source=this.world.input.xr.getPrimaryInputSource('right')??this.world.input.xr.getPrimaryInputSource('left');
    const index=source?.hand?.get('index-finger-tip'),thumb=source?.hand?.get('thumb-tip'),reference=this.world.xrReferenceSpace;
    if (reference) this.updateInstrumentContacts(frame, reference); else this.releaseInstrumentNotes();
    const playbackPosition = this.getPlaybackPosition?.();
    if (playbackPosition !== undefined && Number.isFinite(playbackPosition)) this.record.rotation.y = playbackPosition * Math.PI * 8;
    if(!index||!thumb||!reference){this.finishDrag();this.releaseInstrumentNotes();this.lastScratchNormalized=-1;return;}
    const indexPose=frame.getPose(index,reference),thumbPose=frame.getPose(thumb,reference);
    if(!indexPose||!thumbPose){this.finishDrag();this.lastScratchNormalized=-1;return;}
    this.handWorld.set(indexPose.transform.position.x,indexPose.transform.position.y,indexPose.transform.position.z);
    this.world.player.updateMatrixWorld(true);this.world.player.localToWorld(this.handWorld);this.handLocal.copy(this.handWorld);this.root.worldToLocal(this.handLocal);
    const thumbWorld=new Vector3(thumbPose.transform.position.x,thumbPose.transform.position.y,thumbPose.transform.position.z);this.world.player.localToWorld(thumbWorld);
    const pinching=this.handWorld.distanceTo(thumbWorld)<0.035;
    // Scratch by pinching and moving the index finger across the vinyl surface.
    const deckLocal=this.turntable.worldToLocal(this.handWorld.clone());
    const overRecord=Math.abs(deckLocal.x)<0.3&&Math.abs(deckLocal.z)<0.3&&deckLocal.y>0.08&&deckLocal.y<0.22;
    if(pinching&&overRecord){
      const normalized=Math.max(0,Math.min(1,(deckLocal.x+0.3)/0.6));
      const now=performance.now();
      // Avoid restarting the audio source on every XR frame; update the scrub position
      // only after a meaningful platter movement and at a bounded rate.
      if(Math.abs(normalized-this.lastScratchNormalized)>0.012 && now-this.lastScratchAt>=40){
        this.onScratch?.(normalized);this.lastScratchNormalized=normalized;this.lastScratchAt=now;
      }
    } else if(!pinching) this.lastScratchNormalized=-1;
    if(pinching&&!this.pinching){
      let nearest:{id:string;distance:number}|undefined;
      for(const [id,group] of this.meshes){const distance=group.position.distanceTo(this.handLocal);if(distance<0.24&&(!nearest||distance<nearest.distance))nearest={id,distance};}
      this.draggingId=nearest?.id;
    }
    if(pinching&&this.draggingId){const group=this.meshes.get(this.draggingId);group?.position.copy(this.handLocal);this.placements=this.placements.map(item=>item.id===this.draggingId?{...item,position:{x:this.handLocal.x,y:this.handLocal.y,z:this.handLocal.z}}:item);}
    if(!pinching&&this.pinching)this.finishDrag();
    this.pinching=pinching;
  }

  private updateInstrumentContacts(frame: XRFrame, reference: XRReferenceSpace): void {
    const seen = new Set<string>();
    const now = performance.now() / 1000;
    this.world.player.updateMatrixWorld(true);
    for (const hand of ['left', 'right'] as const) {
      const source = this.world.input.xr.getPrimaryInputSource(hand);
      const joint = source?.hand?.get('index-finger-tip');
      const pose = joint ? frame.getPose(joint, reference) : undefined;
      if (!pose) continue;
      const point = new Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
      this.world.player.localToWorld(point);
      for (const placement of this.placements) {
        if (placement.objectType !== 'instrument-track' || (placement.instrumentType !== 'piano' && placement.instrumentType !== 'drums')) continue;
        const group = this.meshes.get(placement.id);
        if (!group) continue;
        group.updateMatrixWorld(true);
        const localPoint = group.worldToLocal(point.clone());
        group.traverse(object => {
          const mesh = object as Mesh;
          const data = mesh.userData;
          if (!data.instrumentKey && !data.drumPad) return;
          const distance = mesh.getWorldPosition(new Vector3()).distanceTo(point);
          const reach = data.instrumentKey ? 0.045 : 0.14;
          if (distance > reach || Math.abs(localPoint.y - mesh.position.y) > (data.instrumentKey ? 0.065 : 0.12)) return;
          const key = placement.id + ':' + hand + ':' + String(data.pitch);
          seen.add(key);
          if (this.activeInstrumentNotes.has(key)) return;
          const noteId = 'vr:' + key;
          const sourceId = placement.objectRefId;
          this.activeInstrumentNotes.set(key, { trackId: placement.objectRefId, noteId, sourceId });
          this.onInstrumentNoteOn?.(placement.objectRefId, sourceId, noteId, Number(data.pitch), data.drumPad ? 0.9 : 0.72, now);
          mesh.scale.y = data.drumPad ? 1.18 : 0.72;
        });
      }
    }
    for (const [key, note] of this.activeInstrumentNotes) {
      if (seen.has(key)) continue;
      this.onInstrumentNoteOff?.(note.trackId, note.sourceId, note.noteId, now);
      this.activeInstrumentNotes.delete(key);
    }
  }

  private releaseInstrumentNotes(): void {
    const now = performance.now() / 1000;
    for (const note of this.activeInstrumentNotes.values()) this.onInstrumentNoteOff?.(note.trackId, note.sourceId, note.noteId, now);
    this.activeInstrumentNotes.clear();
  }

  private finishDrag():void{if(this.draggingId)this.onCommit(this.placements);this.draggingId=undefined;this.pinching=false;}
}
