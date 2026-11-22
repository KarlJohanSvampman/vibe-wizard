import { VisibilityState, type World } from '@iwsdk/core';
import {
  AmbientLight, BoxGeometry, CircleGeometry, CylinderGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  RingGeometry, SphereGeometry, Vector3, Quaternion, Raycaster, EdgesGeometry, LineBasicMaterial, LineSegments, CanvasTexture, PlaneGeometry,
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
  private readonly activeInstrumentNotes = new Map<string, { trackId: string; noteId: string; sourceId: string; mesh: Mesh; baseScaleY: number; oneShot: boolean; baseEmissive: number; baseEmissiveIntensity: number }>();
  private readonly previousFingerPositions = new Map<'left' | 'right', Vector3>();
  private readonly previousFingerTimes = new Map<'left' | 'right', number>();
  private readonly controllerTriggerDown = new Map<'left' | 'right', boolean>();
  private readonly controllerActive = new Map<'left' | 'right', { trackId: string; sourceId: string; noteId: string; mesh: Mesh; oneShot: boolean }>();
  private readonly controllerRaycaster = new Raycaster();
  private readonly controllerDirection = new Vector3(0, 0, -1);
  private readonly controllerQuaternion = new Quaternion();
  private readonly roomRoot = new Group();
  private readonly room = new Group();
  private roomAnchored = false;
  private readonly turntable = new Group();
  private readonly record = new Mesh(new CylinderGeometry(0.31, 0.31, 0.018, 48), new MeshStandardMaterial({ color: 0x202124, roughness: 0.42 }));
  private readonly tonearm = new Group();
  private readonly turntablePosition = new Vector3(0.72, -0.26, -0.82);
  private placements: StudioObjectPlacement[] = [];
  private readonly slotGroups: Group[] = [];
  private slotPinchStartedAt = 0;
  private slotPinchConsumed = false;
  private slotHoverIndex = -1;
  private leftWasPinching = false;
  private menu?: Mesh;
  private menuCanvas?: HTMLCanvasElement;
  private menuContext?: CanvasRenderingContext2D;
  private menuStage: 'tracks' | 'representations' = 'tracks';
  private menuSlotIndex = -1;
  private menuTrackId?: string;
  private menuRows: Array<{ label: string; value: string }> = [];
  private readonly representationGroups = new Map<number, Group>();
  private lastScratchNormalized = -1;
  private lastScratchAt = 0;
  private readonly stopFrame: () => void;
  private readonly stopVisibility: () => void;

  constructor(private readonly world: World, private readonly onCommit: (placements: readonly StudioObjectPlacement[]) => void, private readonly onScratch?: (normalizedPosition: number) => void, private readonly getPlaybackPosition?: () => number | undefined, private readonly getSelectedTrackId?: () => string | undefined, private readonly onInstrumentNoteOn?: (trackId: string, sourceId: string, noteId: string, pitch: number, velocity: number, timestamp: number) => void, private readonly onInstrumentNoteOff?: (trackId: string, sourceId: string, noteId: string, timestamp: number) => void, private readonly getTrackOptions?: () => Array<{ id: string; name: string; instrumentType: string; objectType?: 'instrument-track' | 'controller-instance' }>) {
    this.root.name = 'vibe-wizard-spatial-studio';
    this.root.visible = world.visibilityState.value !== VisibilityState.NonImmersive;
    this.roomRoot.visible = this.root.visible;
    this.buildRoom();
    this.buildLighting();
    this.buildTurntable();
    this.buildSlots();
    this.buildMenu();
    world.scene.add(this.root);
    this.stopVisibility = world.visibilityState.subscribe(state => { this.root.visible = state !== VisibilityState.NonImmersive; this.roomRoot.visible = this.root.visible; });
    this.stopFrame = world.onXRFrame(frame => this.update(frame));
  }

  setLayout(placements: readonly StudioObjectPlacement[]): void {
    this.placements = placements.map(item => ({ ...item, position: { ...item.position }, rotation: { ...item.rotation }, scale: { ...item.scale } }));
    const active = new Set(this.placements.map(item => item.id));
    for (const [id, group] of this.meshes) if (!active.has(id)) { this.root.remove(group); this.disposeGroup(group); this.meshes.delete(id); }
    for (const placement of this.placements) {
      let group = this.meshes.get(placement.id);
      if (!group || group.userData.instrumentType !== placement.instrumentType || group.userData.objectType !== placement.objectType) { if (group) { this.root.remove(group); this.disposeGroup(group); } group = this.createStudioObject(placement); group.name = placement.id; group.userData.instrumentType = placement.instrumentType; group.userData.objectType = placement.objectType; this.meshes.set(placement.id, group); this.root.add(group); }
      group.position.set(placement.position.x, placement.position.y, placement.position.z);
      group.rotation.set(placement.rotation.x, placement.rotation.y, placement.rotation.z);
      group.scale.set(placement.scale.x, placement.scale.y, placement.scale.z);
    }
  }

  dispose(): void {
    this.stopFrame(); this.stopVisibility(); this.releaseInstrumentNotes(); this.world.scene.remove(this.root); this.world.scene.remove(this.roomRoot);
    for (const group of this.meshes.values()) this.disposeGroup(group);
    this.meshes.clear(); this.disposeGroup(this.turntable); this.disposeGroup(this.room);
    if (this.menu) { this.root.remove(this.menu); this.disposeGroup(new Group().add(this.menu)); this.menu = undefined; }
    for (const group of this.representationGroups.values()) { this.root.remove(group); this.disposeGroup(group); }
    this.representationGroups.clear();
  }

  private buildRoom(): void {
    this.room.name = 'vibe-wizard-studio-room';
    const panel = (geometry: BoxGeometry, color: number, position: [number, number, number], opacity = 1): void => {
      const mesh = new Mesh(geometry, new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: 2 }));
      mesh.position.set(...position); this.room.add(mesh);
    };
    panel(new BoxGeometry(4.2, 0.12, 4.4), 0x343b46, [0, -1.12, -1.15]);
    panel(new BoxGeometry(4.2, 2.9, 0.12), 0x293440, [0, 0.32, -3.32]);
    panel(new BoxGeometry(0.12, 2.9, 4.4), 0x202b36, [-2.1, 0.32, -1.15]);
    panel(new BoxGeometry(0.12, 2.9, 4.4), 0x202b36, [2.1, 0.32, -1.15]);
    panel(new BoxGeometry(4.2, 0.08, 4.4), 0x202a35, [0, 1.78, -1.15], 0.78);
    for (let i = 0; i < 5; i++) {
      const x = -1.48 + i * 0.74;
      panel(new BoxGeometry(0.48, 1.15, 0.035), 0x435363, [x, 0.48, -3.245]);
      panel(new BoxGeometry(0.52, 0.025, 0.045), 0x42d995, [x, 1.16, -3.22]);
    }
    panel(new BoxGeometry(3.7, 0.035, 0.035), 0x56b9e9, [0, 1.58, -3.22]);
    panel(new BoxGeometry(3.7, 0.035, 0.035), 0x56b9e9, [0, -0.72, -3.22]);
    for (let x = -1.8; x <= 1.8; x += 0.45) panel(new BoxGeometry(0.012, 0.006, 4.05), 0x657381, [x, -1.055, -1.15], 0.72);
    for (let z = -3.0; z <= 0.7; z += 0.45) panel(new BoxGeometry(3.9, 0.006, 0.012), 0x657381, [0, -1.055, z], 0.72);
    this.roomRoot.add(this.room);
    this.world.scene.add(this.roomRoot);
  }

  private buildLighting(): void {
    this.root.add(new HemisphereLight(0xeaf4ff, 0x46505b, 2.8));
    this.root.add(new AmbientLight(0xffffff, 1.35));
    const key = new DirectionalLight(0xffffff, 3.2); key.position.set(-2, 3, 2); this.root.add(key);
    const fill = new DirectionalLight(0xb9d8ff, 1.8); fill.position.set(2, 1, -2); this.root.add(fill);
  }

  private buildMenu(): void {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 768;
    const context = canvas.getContext('2d'); if (!context) return;
    this.menuCanvas = canvas; this.menuContext = context;
    const texture = new CanvasTexture(canvas); texture.colorSpace = 'srgb';
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: 2 });
    this.menu = new Mesh(new PlaneGeometry(0.64, 0.64), material); this.menu.name = 'studio-slot-context-menu'; this.menu.visible = false; this.root.add(this.menu);
  }

  private renderMenu(title: string, rows: Array<{label:string;value:string}>): void {
    const ctx = this.menuContext; if (!ctx) return;
    this.menuRows = rows;
    ctx.clearRect(0,0,768,768); ctx.fillStyle = 'rgba(12,18,26,0.96)'; ctx.fillRect(0,0,768,768);
    ctx.strokeStyle = '#52f28c'; ctx.lineWidth = 8; ctx.strokeRect(8,8,752,752);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 42px sans-serif'; ctx.fillText(title,36,66);
    ctx.font = '26px sans-serif';
    rows.forEach((row,index) => { const y=112+index*86; ctx.fillStyle=index%2?'#263545':'#1d2a38'; ctx.fillRect(24,y,720,72); ctx.fillStyle='#eaf5ef'; ctx.fillText(row.label.slice(0,38),46,y+46); });
    const material=this.menu?.material as MeshBasicMaterial | undefined; material?.map?.needsUpdate && (material.map.needsUpdate=true);
    if (material?.map) material.map.needsUpdate=true;
  }

  private openSlotMenu(slotIndex: number): void {
    this.menuSlotIndex=slotIndex; this.menuStage='tracks'; this.menuTrackId=undefined;
    const tracks=this.getTrackOptions?.() ?? [];
    this.renderMenu('Choose a project object', tracks.map(track=>({label:(track.objectType === 'controller-instance' ? 'CONTROLLER · ' : 'TRACK · ') + track.name,value:track.id})));
    if (!tracks.length) this.renderMenu('No tracks in project', [{label:'Add a track in the workstation',value:'noop'}]);
    const slot=this.slotGroups[slotIndex];
    if (this.menu && slot) { this.menu.position.set(slot.position.x,slot.position.y+0.46,slot.position.z); this.menu.rotation.set(0,0,0); this.menu.visible=true; }
  }

  private selectMenuRow(local: Vector3): void {
    if (!this.menu?.visible) return;
    const p=this.menu.worldToLocal(this.root.localToWorld(local.clone()));
    const x=p.x+0.32, y=0.32-p.y;
    if (x<0.02||x>0.62||y<0.09||y>0.64) return;
    this.selectMenuChoice(Math.floor((y-0.09)/0.112));
  }

  private selectMenuChoice(row: number): void {
    const choice=this.menuRows[row]; if (!choice || choice.value==='noop') return;
    if (this.menuStage==='tracks') {
      this.menuTrackId=choice.value; this.menuStage='representations';
      this.renderMenu('Choose representation',[
        {label:'Instrument',value:'instrument'}, {label:'Sequencer',value:'sequencer'},
        {label:'Track editor',value:'editor'}, {label:'Controller surface',value:'controller'},
        {label:'Cancel',value:'cancel'},
      ]);
      return;
    }
    const menu = this.menu;
    if (choice.value==='cancel') { if (menu) menu.visible = false; return; }
    this.assignSlot(this.menuSlotIndex,this.menuTrackId!,choice.value);
    if (menu) menu.visible = false;
  }

  private assignSlot(slotIndex:number,trackId:string,representation:string):void {
    const slot=this.slotGroups[slotIndex]; if(!slot)return;
    const existing=this.placements.find(item=>(item.objectType==='instrument-track'||item.objectType==='controller-instance')&&item.objectRefId===trackId);
    if(representation==='instrument'){
      const track=this.getTrackOptions?.().find(item=>item.id===trackId);
      if(!track)return;
      const objectType = track.objectType ?? 'instrument-track';
      const placement: StudioObjectPlacement = {
        id: existing?.id ?? (objectType === 'controller-instance' ? 'controller:' : 'track:') + trackId,
        objectType, objectRefId: trackId,
        ...(objectType === 'instrument-track' ? { instrumentType: track.instrumentType as StudioObjectPlacement['instrumentType'] } : {}),
        position: { x: slot.position.x, y: slot.position.y - 0.12, z: slot.position.z },
        rotation: { x: 0, y: slot.rotation.y, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      };
      const next=this.placements.filter(item=>item.objectRefId!==trackId && Math.hypot(item.position.x-slot.position.x, item.position.z-slot.position.z)>0.35);
      next.push(placement);
      this.setLayout(next); this.onCommit(this.placements); return;
    }
    const placement: StudioObjectPlacement = {
      id: 'slot:' + slotIndex, objectType: 'furniture', objectRefId: representation + ':' + trackId,
      position: { x: slot.position.x, y: slot.position.y - 0.08, z: slot.position.z },
      rotation: { x: 0, y: slot.rotation.y, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    };
    const next = this.placements.filter(item => item.id !== placement.id &&
      Math.hypot(item.position.x - slot.position.x, item.position.z - slot.position.z) > 0.35);
    next.push(placement);
    this.setLayout(next); this.onCommit(this.placements);
  }

  private buildSlots(): void {
    const stations = [
      { name: 'FRONT', x: 0, z: -1.18, yaw: 0 },
      { name: 'LEFT', x: -1.08, z: -0.58, yaw: -0.52 },
      { name: 'RIGHT', x: 1.08, z: -0.58, yaw: 0.52 },
    ];
    stations.forEach((station, index) => {
      const slot = new Group(); slot.name = 'studio-slot-' + (index + 1);
      slot.position.set(station.x, -0.48, station.z); slot.rotation.y = station.yaw; slot.userData.slotIndex = index;
      const shape = new BoxGeometry(0.9, 0.11, 0.62);
      const fill = new Mesh(shape, new MeshBasicMaterial({ color: 0x35e879, transparent: true, opacity: 0.16, depthWrite: false }));
      const outline = new LineSegments(new EdgesGeometry(new BoxGeometry(0.9, 0.11, 0.62)), new LineBasicMaterial({ color: 0x63ffad, transparent: true, opacity: 1 }));
      const marker = new Mesh(new BoxGeometry(0.42, 0.018, 0.035), new MeshBasicMaterial({ color: 0x9affc7 }));
      marker.position.set(0, 0.07, 0.25);
      const labelCanvas = document.createElement('canvas'); labelCanvas.width = 512; labelCanvas.height = 128;
      const labelContext = labelCanvas.getContext('2d');
      if (labelContext) {
        labelContext.fillStyle = '#07131b'; labelContext.fillRect(0, 0, 512, 128);
        labelContext.fillStyle = '#aaffd0'; labelContext.font = 'bold 64px sans-serif'; labelContext.textAlign = 'center';
        labelContext.fillText(station.name, 256, 86);
        const label = new Mesh(new PlaneGeometry(0.46, 0.115), new MeshBasicMaterial({ map: new CanvasTexture(labelCanvas), transparent: true, side: 2 }));
        label.position.set(0, 0.16, 0.28); slot.add(label);
      }
      slot.add(fill, outline, marker); this.root.add(slot); this.slotGroups.push(slot);
    });
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
      this.add(group, new BoxGeometry(1.12, 0.12, 0.34), 0x59616d, [0, 0, 0]);
      this.add(group, new BoxGeometry(1.02, 0.018, 0.22), 0xffffff, [0, -0.018, 0.035]);
      const whitePitches = [0, 2, 4, 5, 7, 9, 11];
      for (let i = 0; i < 24; i++) { const key = this.add(group, new BoxGeometry(0.041, 0.025, 0.19), 0xffffff, [-0.48 + i * 0.0417, 0.002, 0.035]); key.userData.instrumentKey = true; key.userData.pitch = 48 + Math.floor(i / 7) * 12 + whitePitches[i % 7]; key.userData.hitHalfExtents = [0.0205, 0.055, 0.095]; }
      for (let i = 0; i < 23; i++) if (![2, 6].includes(i % 7)) { const key = this.add(group, new BoxGeometry(0.026, 0.038, 0.12), 0x080a0e, [-0.459 + i * 0.0417, 0.018, -0.005]); key.userData.instrumentKey = true; key.userData.blackKey = true; key.userData.pitch = 48 + Math.floor(i / 7) * 12 + [1, 3, 0, 6, 8, 10, 0][i % 7]; key.userData.hitHalfExtents = [0.013, 0.07, 0.06]; }
      for (let i = 0; i < 5; i++) this.add(group, new CylinderGeometry(0.025, 0.025, 0.02, 16), 0xc38e4b, [0.32 + i * 0.09, 0.075, -0.1]);
    } else if (placement.objectType === 'instrument-track' && placement.instrumentType === 'drums') {
      // Compact tabletop electronic drum kit: kick, snare, toms and cymbal pads.
      this.add(group, new BoxGeometry(1.0, 0.09, 0.58), 0x252a31, [0, 0, 0]);
      const pads: Array<[number, number, number, number]> = [
        [-0.32, 0.08, -0.14, 0x9c4545], [0, 0.08, -0.14, 0x477b9d], [0.32, 0.08, -0.14, 0x477b9d],
        [-0.32, 0.08, 0.16, 0x477b9d], [0, 0.08, 0.16, 0x9c4545], [0.32, 0.08, 0.16, 0x477b9d],
      ];
      const drumPitches = [36, 38, 42, 45, 46, 49];
      pads.forEach(([x, y, z, color], index) => { const pad = this.add(group, new CylinderGeometry(0.115, 0.115, 0.055, 32), color, [x, y, z]); pad.userData.drumPad = true; pad.userData.pitch = drumPitches[index]; pad.userData.hitRadius = 0.115; pad.userData.hitHalfHeight = 0.12; });
      const leftCymbal = this.add(group, new CylinderGeometry(0.16, 0.16, 0.018, 32), 0xc6a64e, [-0.46, 0.28, -0.22], [1, 0.12, 1]);
      leftCymbal.userData.drumPad = true; leftCymbal.userData.pitch = 46; leftCymbal.userData.hitRadius = 0.16; leftCymbal.userData.hitHalfHeight = 0.14;
      const rightCymbal = this.add(group, new CylinderGeometry(0.16, 0.16, 0.018, 32), 0xc6a64e, [0.46, 0.28, 0.22], [1, 0.12, 1]);
      rightCymbal.userData.drumPad = true; rightCymbal.userData.pitch = 51; rightCymbal.userData.hitRadius = 0.16; rightCymbal.userData.hitHalfHeight = 0.14;
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
    if (!this.roomAnchored) { this.roomRoot.position.copy(this.root.position); this.roomRoot.rotation.copy(this.root.rotation); this.roomRoot.updateMatrixWorld(true); this.roomAnchored = true; }
    const reference=this.world.xrReferenceSpace;
    if (reference) this.updateControllerTriggers(frame, reference);
    if (reference) this.updateInstrumentContacts(frame, reference); else this.releaseInstrumentNotes();
    const playbackPosition = this.getPlaybackPosition?.();
    if (playbackPosition !== undefined && Number.isFinite(playbackPosition)) this.record.rotation.y = playbackPosition * Math.PI * 8;

    // Fixed-slot dwell gesture: a stable pinch over a bay is detected once.
    // Assignment UI is deliberately not coupled to instrument contact/play gestures.
    const leftSource = this.world.input.xr.getPrimaryInputSource('left');
    const leftIndex = leftSource?.hand?.get('index-finger-tip');
    const leftThumb = leftSource?.hand?.get('thumb-tip');
    const leftIndexPose = reference && leftIndex ? frame.getPose(leftIndex, reference) : undefined;
    const leftThumbPose = reference && leftThumb ? frame.getPose(leftThumb, reference) : undefined;
    if (leftIndexPose && leftThumbPose && reference) {
      const point = new Vector3(leftIndexPose.transform.position.x, leftIndexPose.transform.position.y, leftIndexPose.transform.position.z);
      const thumb = new Vector3(leftThumbPose.transform.position.x, leftThumbPose.transform.position.y, leftThumbPose.transform.position.z);
      this.world.player.updateMatrixWorld(true); this.world.player.localToWorld(point); this.world.player.localToWorld(thumb);
      const local = this.root.worldToLocal(point.clone());
      const pinching = point.distanceTo(thumb) < 0.028;
      const pinchStarted = pinching && !this.leftWasPinching;
      this.leftWasPinching = pinching;
      if (this.menu?.visible) {
        if (pinchStarted) this.selectMenuRow(local);
        this.slotGroups.forEach((slot,index)=>{const fill=slot.children[0] as Mesh;(fill.material as MeshBasicMaterial).opacity=index===this.menuSlotIndex?0.16:0.075;});
        this.slotPinchStartedAt=0; this.slotPinchConsumed=true; return;
      }
      let hover = -1;
      this.slotGroups.forEach((slot, index) => {
        const p = slot.position;
        if (Math.abs(local.x - p.x) < 0.39 && Math.abs(local.y - p.y) < 0.12 && Math.abs(local.z - p.z) < 0.28) hover = index;
      });
      if (hover !== this.slotHoverIndex) {
        this.slotHoverIndex = hover;
        this.slotPinchStartedAt = 0;
        this.slotPinchConsumed = false;
      }
      this.slotGroups.forEach((slot, index) => {
        const fill = slot.children[0] as Mesh;
        (fill.material as MeshBasicMaterial).opacity = index === hover ? 0.2 : 0.075;
      });
      if (pinching && hover >= 0 && !this.slotPinchConsumed) {
        if (!this.slotPinchStartedAt) this.slotPinchStartedAt = performance.now();
        if (performance.now() - this.slotPinchStartedAt >= 3000) {
          this.slotPinchConsumed = true;
          this.slotGroups[hover]!.userData.dwellConfirmed = true;
          const fill = this.slotGroups[hover]!.children[0] as Mesh;
          (fill.material as MeshBasicMaterial).opacity = 0.38;
          this.openSlotMenu(hover);
        }
      } else if (!pinching) {
        this.slotPinchStartedAt = 0;
        this.slotPinchConsumed = false;
        if (hover >= 0) this.slotGroups[hover]!.userData.dwellConfirmed = false;
      }
    } else {
      this.slotPinchStartedAt = 0; this.slotPinchConsumed = false; this.slotHoverIndex = -1; this.leftWasPinching = false;
    }

    // Right-hand pinch is reserved for turntable scratching; it never grabs objects.
    const source=this.world.input.xr.getPrimaryInputSource('right');
    const index=source?.hand?.get('index-finger-tip'),thumb=source?.hand?.get('thumb-tip');
    // Scratch input is optional: losing the right hand must not silence notes
    // currently being played by the left hand (or by a controller).
    if(!index||!thumb||!reference){this.lastScratchNormalized=-1;return;}
    const indexPose=frame.getPose(index,reference),thumbPose=frame.getPose(thumb,reference);
    if(!indexPose||!thumbPose){this.lastScratchNormalized=-1;return;}
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
    // No freehand object dragging: instrument models stay docked and stable.
  }

  private updateInstrumentContacts(frame: XRFrame, reference: XRReferenceSpace): void {
    const seen = new Set<string>();
    const now = performance.now() / 1000;
    this.world.player.updateMatrixWorld(true);
    for (const hand of ['left', 'right'] as const) {
      const source = this.world.input.xr.getPrimaryInputSource(hand);
      const joint = source?.hand?.get('index-finger-tip');
      const pose = joint ? frame.getPose(joint, reference) : undefined;
      if (!pose) {
        this.previousFingerPositions.delete(hand);
        this.previousFingerTimes.delete(hand);
        continue;
      }
      const point = new Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
      this.world.player.localToWorld(point);
      const previous = this.previousFingerPositions.get(hand);
      const previousAt = this.previousFingerTimes.get(hand);
      const elapsed = previousAt === undefined ? 0 : Math.max(0.001, now - previousAt);
      // MIDI velocity follows the downward strike component, not sideways
      // hand travel. A soft floor keeps gentle presses audible; fast strikes
      // reach the top of the range without being affected by frame rate.
      const downwardSpeed = previous && elapsed > 0 ? Math.max(0, (previous.y - point.y) / elapsed) : 0;
      const velocity = Math.max(0.18, Math.min(1, 0.22 + downwardSpeed * 0.72));
      this.previousFingerPositions.set(hand, point.clone());
      this.previousFingerTimes.set(hand, now);

      const candidates: Array<{ placement: StudioObjectPlacement; mesh: Mesh; pitch: number; oneShot: boolean; score: number }> = [];
      for (const placement of this.placements) {
        if (placement.objectType !== 'instrument-track' || (placement.instrumentType !== 'piano' && placement.instrumentType !== 'drums')) continue;
        const group = this.meshes.get(placement.id);
        if (!group) continue;
        group.updateMatrixWorld(true);
        group.traverse(object => {
          const mesh = object as Mesh;
          const data = mesh.userData;
          if (!data.instrumentKey && !data.drumPad) return;
          const local = mesh.worldToLocal(point.clone());
          let touching = false;
          if (data.instrumentKey) {
            const half = data.hitHalfExtents as number[];
            touching = Math.abs(local.x) <= half[0]! &&
              Math.abs(local.y) <= half[1]! &&
              Math.abs(local.z) <= half[2]!;
          } else {
            const radius = Number(data.hitRadius ?? 0.115);
            const halfHeight = Number(data.hitHalfHeight ?? 0.12);
            // Include cymbal-specific radii and reject hover well above pads.
            touching = local.x * local.x + local.z * local.z <= radius * radius &&
              local.y >= -0.045 && local.y <= Math.min(0.065, halfHeight);
          }
          if (!touching) return;
          const center = mesh.getWorldPosition(new Vector3());
          const blackKeyPriority = data.instrumentKey && data.blackKey ? -0.035 : 0;
          const score = point.distanceTo(center) + blackKeyPriority;
          candidates.push({ placement, mesh, pitch: Number(data.pitch), oneShot: Boolean(data.drumPad), score });
        });
      }
      // One fingertip should play one key/pad. Black keys win where their
      // physical hit zones overlap the neighbouring white keys.
      candidates.sort((a, b) => a.score - b.score);
      const best = candidates[0];
      if (best) {
        const { placement, mesh, pitch, oneShot } = best;
        const key = placement.id + ':' + hand + ':' + String(pitch);
        seen.add(key);
        if (!this.activeInstrumentNotes.has(key)) {
          const noteId = 'vr:' + key;
          const sourceId = placement.objectRefId;
          const material = mesh.material as MeshStandardMaterial;
          this.activeInstrumentNotes.set(key, {
            trackId: placement.objectRefId, noteId, sourceId, mesh,
            baseScaleY: mesh.scale.y, oneShot,
            baseEmissive: material.emissive.getHex(),
            baseEmissiveIntensity: material.emissiveIntensity,
          });
          this.onInstrumentNoteOn?.(placement.objectRefId, sourceId, noteId, pitch, velocity, now);
          // One-shot drums are recorded with a short gate even though their
          // synthesized voice plays to completion independently.
          if (oneShot) this.onInstrumentNoteOff?.(placement.objectRefId, sourceId, noteId, now + 0.08);
          mesh.scale.y = oneShot ? 1.2 : 0.68;
          material.emissive.setHex(oneShot ? 0xffb347 : 0x55c8ff);
          material.emissiveIntensity = oneShot ? 0.95 : 0.42;
        }
      }
    }
    for (const [key, note] of this.activeInstrumentNotes) {
      if (seen.has(key)) continue;
      if (!note.oneShot) this.onInstrumentNoteOff?.(note.trackId, note.sourceId, note.noteId, now);
      note.mesh.scale.y = note.baseScaleY;
      const material = note.mesh.material as MeshStandardMaterial;
      material.emissive.setHex(note.baseEmissive);
      material.emissiveIntensity = note.baseEmissiveIntensity;
      this.activeInstrumentNotes.delete(key);
    }
  }

  /** Controller trigger plays the instrument under the pointing ray. */
  private updateControllerTriggers(frame: XRFrame, reference: XRReferenceSpace): void {
    const now = performance.now() / 1000;
    for (const hand of ['left', 'right'] as const) {
      const source = this.world.input.xr.getPrimaryInputSource(hand);
      const pressed = Boolean(source?.gamepad?.buttons?.[0]?.pressed);
      const wasPressed = this.controllerTriggerDown.get(hand) ?? false;
      if (pressed && !wasPressed && source?.targetRaySpace) {
        const pose = frame.getPose(source.targetRaySpace, reference);
        if (pose) {
          const p = pose.transform.position, o = pose.transform.orientation;
          this.controllerRaycaster.ray.origin.set(p.x, p.y, p.z);
          this.world.player.updateMatrixWorld(true);
          this.world.player.localToWorld(this.controllerRaycaster.ray.origin);
          this.controllerQuaternion.set(o.x, o.y, o.z, o.w);
          this.controllerDirection.set(0, 0, -1).applyQuaternion(this.controllerQuaternion).normalize();
          this.world.player.getWorldQuaternion(this.controllerQuaternion);
          this.controllerDirection.applyQuaternion(this.controllerQuaternion).normalize();
          this.controllerRaycaster.ray.direction.copy(this.controllerDirection);
          if (this.menu?.visible) {
            const menuHit = this.controllerRaycaster.intersectObject(this.menu, false)[0];
            if (menuHit?.uv) this.selectMenuChoice(Math.floor(((1 - menuHit.uv.y) * 768 - 112) / 86));
            this.controllerTriggerDown.set(hand, pressed);
            continue;
          }
          const slotHit = this.controllerRaycaster.intersectObjects(this.slotGroups, true)[0]?.object;
          if (slotHit) {
            let slotGroup: Group | null = slotHit as Group;
            while (slotGroup && !Number.isInteger(slotGroup.userData.slotIndex)) slotGroup = slotGroup.parent as Group | null;
            if (slotGroup) this.openSlotMenu(Number(slotGroup.userData.slotIndex));
            this.controllerTriggerDown.set(hand, pressed);
            continue;
          }
          const targets: Mesh[] = [];
          for (const placement of this.placements) {
            if (placement.objectType !== 'instrument-track' || (placement.instrumentType !== 'piano' && placement.instrumentType !== 'drums')) continue;
            const group = this.meshes.get(placement.id); if (!group) continue; group.updateMatrixWorld(true);
            group.traverse(obj => { const mesh = obj as Mesh; if (mesh.userData.instrumentKey || mesh.userData.drumPad) targets.push(mesh); });
          }
          const hit = this.controllerRaycaster.intersectObjects(targets, false)[0]?.object as Mesh | undefined;
          if (hit) {
            const group = hit.parent;
            const placement = this.placements.find(item => this.meshes.get(item.id) === group);
            const trackId = placement?.objectRefId;
            if (trackId) {
              const noteId = 'vr:controller:' + hand + ':' + placement!.id + ':' + String(hit.userData.pitch);
              const oneShot = Boolean(hit.userData.drumPad);
              const triggerValue = Number(source?.gamepad?.buttons?.[0]?.value ?? (pressed ? 1 : 0));
              const velocity = Math.max(0.2, Math.min(1, 0.2 + triggerValue * 0.8));
              this.onInstrumentNoteOn?.(trackId, trackId, noteId, Number(hit.userData.pitch), velocity, now);
              if (oneShot) this.onInstrumentNoteOff?.(trackId, trackId, noteId, now + 0.08);
              const material = hit.material as MeshStandardMaterial;
              hit.userData.controllerBaseScaleY ??= hit.scale.y;
              hit.scale.y = oneShot ? 1.2 : 0.76; material.emissive.setHex(0x385b80); material.emissiveIntensity = 0.5;
              this.controllerActive.set(hand, { trackId, sourceId: trackId, noteId, mesh: hit, oneShot });
              if (oneShot) setTimeout(() => { hit.scale.y = hit.userData.controllerBaseScaleY ?? hit.scale.y; material.emissiveIntensity = 0; }, 140);
            }
          }
        }
      }
      if (!pressed && wasPressed) {
        const active = this.controllerActive.get(hand);
        if (active && !active.oneShot) this.onInstrumentNoteOff?.(active.trackId, active.sourceId, active.noteId, now);
        if (active) { active.mesh.scale.y = active.mesh.userData.controllerBaseScaleY ?? active.mesh.scale.y; (active.mesh.material as MeshStandardMaterial).emissiveIntensity = 0; }
        this.controllerActive.delete(hand);
      }
      this.controllerTriggerDown.set(hand, pressed);
    }
  }
  private releaseInstrumentNotes(): void {
    const now = performance.now() / 1000;
    for (const note of this.activeInstrumentNotes.values()) {
      if (!note.oneShot) this.onInstrumentNoteOff?.(note.trackId, note.sourceId, note.noteId, now);
      note.mesh.scale.y = note.baseScaleY;
      const material = note.mesh.material as MeshStandardMaterial;
      material.emissive.setHex(note.baseEmissive);
      material.emissiveIntensity = note.baseEmissiveIntensity;
    }
    this.activeInstrumentNotes.clear();
    // Release controller-held notes as well when XR tracking is lost or the
    // adapter is disposed, so no instrument can sustain indefinitely.
    for (const active of this.controllerActive.values()) {
      if (!active.oneShot) this.onInstrumentNoteOff?.(active.trackId, active.sourceId, active.noteId, now);
      active.mesh.scale.y = active.mesh.userData.controllerBaseScaleY ?? active.mesh.scale.y;
      (active.mesh.material as MeshStandardMaterial).emissiveIntensity = 0;
    }
    this.controllerActive.clear();
    this.controllerTriggerDown.clear();
    this.previousFingerPositions.clear();
    this.previousFingerTimes.clear();
  }


}
