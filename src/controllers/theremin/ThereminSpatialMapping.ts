export interface ThereminPoint3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ThereminVolumeDimensions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface NormalizedThereminPoint {
  /** 0 is the left edge; 1 is the right edge. */
  readonly x: number;
  /** 0 is the bottom edge; 1 is the top edge. */
  readonly y: number;
}

export const DEFAULT_THEREMIN_VOLUME: ThereminVolumeDimensions = {
  width: 0.72,
  height: 0.48,
  depth: 0.24,
};

/**
 * Converts a point in local volume coordinates to normalized controller
 * coordinates. Points outside the finite volume return null, allowing the
 * interaction to disengage instead of silently clamping at its edges.
 */
export function normalizeThereminPoint(
  point: ThereminPoint3,
  dimensions: ThereminVolumeDimensions = DEFAULT_THEREMIN_VOLUME,
): NormalizedThereminPoint | null {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(point.z) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.depth <= 0
  ) {
    return null;
  }

  const halfWidth = dimensions.width / 2;
  const halfHeight = dimensions.height / 2;
  const halfDepth = dimensions.depth / 2;

  if (
    point.x < -halfWidth ||
    point.x > halfWidth ||
    point.y < -halfHeight ||
    point.y > halfHeight ||
    point.z < -halfDepth ||
    point.z > halfDepth
  ) {
    return null;
  }

  return {
    x: (point.x + halfWidth) / dimensions.width,
    y: (point.y + halfHeight) / dimensions.height,
  };
}
