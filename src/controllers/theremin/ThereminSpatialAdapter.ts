import { VisibilityState, type World } from '@iwsdk/core';
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { ThereminController } from './ThereminController.js';
import {
  DEFAULT_THEREMIN_VOLUME,
  normalizeThereminPoint,
  type NormalizedThereminPoint,
  type ThereminVolumeDimensions,
} from './ThereminSpatialMapping.js';

export interface ThereminSpatialAdapterOptions {
  readonly handedness?: 'left' | 'right';
  readonly dimensions?: ThereminVolumeDimensions;
  readonly forwardDistance?: number;
  readonly verticalOffset?: number;
  readonly onActiveChange?: (
    active: boolean,
    point: NormalizedThereminPoint | undefined,
    time: number,
  ) => void;
}

/**
 * Connects a tracked index fingertip to the platform-neutral theremin
 * controller. IWSDK updates its XR input stack before onXRFrame callbacks,
 * so this adapter samples the current joint pose once per XR frame.
 */
export class ThereminSpatialAdapter {
  private readonly handedness: 'left' | 'right';
  private readonly dimensions: ThereminVolumeDimensions;
  private readonly forwardDistance: number;
  private readonly verticalOffset: number;
  private readonly root = new Group();
  private readonly cursor = new Group();
  private readonly headPosition = new Vector3();
  private readonly forward = new Vector3();
  private readonly volumeCenter = new Vector3();
  private readonly handWorldPosition = new Vector3();
  private readonly handLocalPosition = new Vector3();
  private lastX = 0.5;
  private readonly stopXRFrame: () => void;
  private readonly stopVisibilitySubscription: () => void;
  private active = false;

  constructor(
    private readonly world: World,
    private readonly controller: ThereminController,
    private readonly options: ThereminSpatialAdapterOptions = {},
  ) {
    this.handedness = options.handedness ?? 'right';
    this.dimensions = options.dimensions ?? DEFAULT_THEREMIN_VOLUME;
    this.forwardDistance = options.forwardDistance ?? 0.72;
    this.verticalOffset = options.verticalOffset ?? 0.36;

    this.root.name = 'vibe-wizard-theremin-volume';
    this.root.visible = world.visibilityState.value !== VisibilityState.NonImmersive;
    this.createVolumeVisuals();
    world.scene.add(this.root);

    this.stopVisibilitySubscription = world.visibilityState.subscribe((state) => {
      const immersive = state !== VisibilityState.NonImmersive;
      this.root.visible = immersive;
      if (!immersive) {
        this.deactivate(performance.now() / 1000);
      }
    });

    // The callback runs after IWSDK's ECS/input systems have sampled the
    // current XRFrame, so the requested hand-joint pose is fresh this frame.
    this.stopXRFrame = world.onXRFrame((frame, _delta, time) => {
      this.update(frame, time);
    });
  }

  dispose(): void {
    this.stopXRFrame();
    this.stopVisibilitySubscription();
    this.deactivate(performance.now() / 1000);
    this.world.scene.remove(this.root);

    this.root.traverse((object) => {
      const renderable = object as typeof object & {
        geometry?: BufferGeometry;
        material?: MeshBasicMaterial | LineBasicMaterial | Array<MeshBasicMaterial | LineBasicMaterial>;
      };
      renderable.geometry?.dispose();
      if (Array.isArray(renderable.material)) {
        renderable.material.forEach((material) => material.dispose());
      } else {
        renderable.material?.dispose();
      }
    });
  }

  private update(frame: XRFrame, time: number): void {
    this.positionVolume();

    const inputSource = this.world.input.xr.getPrimaryInputSource(this.handedness);
    const indexTipSpace = inputSource?.hand?.get('index-finger-tip');
    const referenceSpace = this.world.xrReferenceSpace;

    if (!indexTipSpace || !referenceSpace) {
      this.deactivate(time);
      return;
    }

    const pose = frame.getPose(indexTipSpace, referenceSpace);
    if (!pose) {
      this.deactivate(time);
      return;
    }

    // WebXR joint poses are local to the XR reference space. Convert through
    // the player rig so the tracked fingertip and scene volume share world space.
    this.handWorldPosition.set(
      pose.transform.position.x,
      pose.transform.position.y,
      pose.transform.position.z,
    );
    this.world.player.updateMatrixWorld(true);
    this.world.player.localToWorld(this.handWorldPosition);

    this.handLocalPosition.copy(this.handWorldPosition);
    this.root.worldToLocal(this.handLocalPosition);

    const point = normalizeThereminPoint(this.handLocalPosition, this.dimensions);
    if (!point) {
      this.deactivate(time);
      return;
    }

    this.lastX = point.x;
    this.controller.move(point.x, point.y, time);
    this.cursor.position.set(this.handLocalPosition.x, this.handLocalPosition.y, 0.012);
    this.cursor.visible = true;
    this.cursor.children[0]?.scale.setScalar(1 + Math.sin(time * 5.5) * 0.12);

    if (!this.active) {
      this.active = true;
      this.options.onActiveChange?.(true, point, time);
    }
  }

  private positionVolume(): void {
    this.world.player.head.getWorldPosition(this.headPosition);
    this.world.player.head.getWorldDirection(this.forward);
    this.forward.y = 0;

    if (this.forward.lengthSq() < 0.0001) {
      this.forward.set(0, 0, -1);
    } else {
      this.forward.normalize();
    }

    this.volumeCenter
      .copy(this.headPosition)
      .addScaledVector(this.forward, this.forwardDistance);
    this.volumeCenter.y -= this.verticalOffset;

    this.root.position.copy(this.volumeCenter);
    this.root.rotation.set(
      0,
      Math.atan2(-this.forward.x, -this.forward.z),
      0,
    );
    this.root.updateMatrixWorld(true);
  }

  private deactivate(time: number): void {
    this.cursor.visible = false;
    if (!this.active) return;

    this.active = false;
    this.controller.move(this.lastX, 0, time);
    this.options.onActiveChange?.(false, undefined, time);
  }

  private createVolumeVisuals(): void {
    const { width, height, depth } = this.dimensions;

    const fill = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({
        color: 0x483267,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    fill.position.z = -depth / 2 + 0.002;
    this.root.add(fill);

    const framePositions: number[] = [];
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const halfDepth = depth / 2;
    const corners = [
      [-halfWidth, -halfHeight, -halfDepth],
      [halfWidth, -halfHeight, -halfDepth],
      [halfWidth, halfHeight, -halfDepth],
      [-halfWidth, halfHeight, -halfDepth],
      [-halfWidth, -halfHeight, halfDepth],
      [halfWidth, -halfHeight, halfDepth],
      [halfWidth, halfHeight, halfDepth],
      [-halfWidth, halfHeight, halfDepth],
    ];
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    for (const [start, end] of edges) {
      framePositions.push(...corners[start], ...corners[end]);
    }

    const frameGeometry = new BufferGeometry();
    frameGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(framePositions, 3),
    );
    this.root.add(new LineSegments(
      frameGeometry,
      new LineBasicMaterial({
        color: 0x9875d4,
        transparent: true,
        opacity: 0.8,
      }),
    ));

    const gridPositions: number[] = [];
    const semitoneDivisions = 36;
    for (let step = 0; step <= semitoneDivisions; step += 1) {
      const gridX = -halfWidth + (width * step) / semitoneDivisions;
      gridPositions.push(gridX, -halfHeight, -halfDepth + 0.006);
      gridPositions.push(gridX, halfHeight, -halfDepth + 0.006);
    }
    for (let step = 1; step < 4; step += 1) {
      const gridY = -halfHeight + (height * step) / 4;
      gridPositions.push(-halfWidth, gridY, -halfDepth + 0.006);
      gridPositions.push(halfWidth, gridY, -halfDepth + 0.006);
    }

    const gridGeometry = new BufferGeometry();
    gridGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(gridPositions, 3),
    );
    this.root.add(new LineSegments(
      gridGeometry,
      new LineBasicMaterial({
        color: 0x66517f,
        transparent: true,
        opacity: 0.48,
      }),
    ));

    const glow = new Mesh(
      new SphereGeometry(0.052, 16, 12),
      new MeshBasicMaterial({
        color: 0xc69aff,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    const core = new Mesh(
      new SphereGeometry(0.018, 20, 16),
      new MeshBasicMaterial({
        color: 0xffffff,
        toneMapped: false,
      }),
    );
    this.cursor.add(glow, core);
    this.cursor.visible = false;
    this.root.add(this.cursor);
  }
}
