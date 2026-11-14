import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEREMIN_VOLUME,
  normalizeThereminPoint,
} from './ThereminSpatialMapping.js';

describe('normalizeThereminPoint', () => {
  it('maps the centre of the volume to the centre of the controller range', () => {
    expect(normalizeThereminPoint({ x: 0, y: 0, z: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it('maps the lower-left and upper-right corners to normalized extremes', () => {
    const halfWidth = DEFAULT_THEREMIN_VOLUME.width / 2;
    const halfHeight = DEFAULT_THEREMIN_VOLUME.height / 2;

    expect(normalizeThereminPoint({
      x: -halfWidth,
      y: -halfHeight,
      z: 0,
    })).toEqual({ x: 0, y: 0 });

    expect(normalizeThereminPoint({
      x: halfWidth,
      y: halfHeight,
      z: 0,
    })).toEqual({ x: 1, y: 1 });
  });

  it('rejects a point outside the depth slab', () => {
    expect(normalizeThereminPoint({
      x: 0,
      y: 0,
      z: DEFAULT_THEREMIN_VOLUME.depth,
    })).toBeNull();
  });

  it('rejects points outside the horizontal and vertical boundaries', () => {
    expect(normalizeThereminPoint({ x: 1, y: 0, z: 0 })).toBeNull();
    expect(normalizeThereminPoint({ x: 0, y: -1, z: 0 })).toBeNull();
  });

  it('rejects invalid dimensions and non-finite points', () => {
    expect(normalizeThereminPoint({ x: Number.NaN, y: 0, z: 0 })).toBeNull();
    expect(normalizeThereminPoint(
      { x: 0, y: 0, z: 0 },
      { width: 0, height: 1, depth: 1 },
    )).toBeNull();
  });
});
