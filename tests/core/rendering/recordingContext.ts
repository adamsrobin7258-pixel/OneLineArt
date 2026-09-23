import type { RenderContext2D } from '../../../src/core';

export type Op =
  | { op: 'moveTo' | 'lineTo'; x: number; y: number }
  | { op: 'stroke'; style: unknown; width: number; alpha: number }
  | { op: 'fillRect'; style: unknown; w: number; h: number }
  | { op: 'clearRect' }
  | { op: 'drawImage'; image: unknown; w: number; h: number }
  | { op: 'beginPath' };

/** Records every drawing call, so tests can verify exactly what geometry is drawn. */
export function recordingContext(): RenderContext2D & { ops: Op[] } {
  const ops: Op[] = [];
  const ctx = {
    ops,
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    setTransform() {},
    beginPath: () => ops.push({ op: 'beginPath' }),
    moveTo: (x: number, y: number) => ops.push({ op: 'moveTo', x, y }),
    lineTo: (x: number, y: number) => ops.push({ op: 'lineTo', x, y }),
    stroke: () => ops.push({ op: 'stroke', style: ctx.strokeStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha }),
    fillRect: (_x: number, _y: number, w: number, h: number) => ops.push({ op: 'fillRect', style: ctx.fillStyle, w, h }),
    clearRect: () => ops.push({ op: 'clearRect' }),
    drawImage: (image: never, _x: number, _y: number, w: number, h: number) => ops.push({ op: 'drawImage', image, w, h }),
  };
  return ctx;
}
