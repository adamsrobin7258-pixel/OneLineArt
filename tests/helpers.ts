import { createPath, type OneLinePath, type Point, type RasterImage } from '../src/core';

export function blankImage(width = 64, height = 48): RasterImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function pathFrom(points: Point[], width = 100, height = 100): OneLinePath {
  return createPath(points, { width, height }, { generatorId: 'test', generatorVersion: '0', seed: 0 });
}
