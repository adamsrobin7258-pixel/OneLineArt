import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { MIN_CROP_FRACTION, panOf, rotatedSize, withPan, withZoom, zoomOf, type ImageEdit, type ImageRotation } from '../../core';
import { cropLayout, frameIn, resizeCrop, toImage, type Corner, type CropLayout } from '../viewport/cropLayout';
import type { Point, Size } from '../viewport/viewTransform';
import { wheelZoomFactor } from '../viewport/viewTransform';

interface CropStageProps {
  /** Unedited display copy (never modified; drawn rotated). */
  image: ImageBitmap;
  edit: ImageEdit;
  /** Locks the frame corners to this pixel aspect ratio (null = free). */
  aspect: number | null;
  onChange: (edit: ImageEdit) => void;
  label: string;
}

const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];
const KEY_STEP = 0.01;

/** Draws `image` rotated by quarter turns with its (rotated) top-left at `origin`, scaled by `scale`. */
export function drawRotated(ctx: CanvasRenderingContext2D, image: CanvasImageSource & Size, rotation: ImageRotation, origin: Point, scale: number): void {
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.scale(scale, scale);
  if (rotation === 90) ctx.translate(image.height, 0);
  if (rotation === 180) ctx.translate(image.width, image.height);
  if (rotation === 270) ctx.translate(0, image.width);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

/**
 * Crop editor stage: the crop frame stays centred, the image lies under it.
 * Drag = move the image (pan), wheel/pinch = zoom, frame corners = resize,
 * arrow keys = pan, +/− = zoom. Works on the display copy only.
 */
export function CropStage({ image, edit, aspect, onChange, label }: CropStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  /** Layout frozen while a corner is dragged (the frame moves, the image stays). */
  const [frozen, setFrozen] = useState<CropLayout | null>(null);
  const gesture = useRef<
    | { kind: 'pan'; start: Point; edit: ImageEdit; layout: CropLayout }
    | { kind: 'corner'; corner: Corner }
    | { kind: 'pinch'; distance: number; zoom: number }
    | null
  >(null);
  const pointers = useRef(new Map<number, Point>());

  const size = rotatedSize(image, edit.rotation);
  const margin = stage.width < 560 ? 20 : 32;
  const layout = frozen ?? cropLayout(edit.crop, size, stage, margin);
  const frame = frozen ? frameIn(frozen, edit.crop, size) : layout.frame;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setStage({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || stage.width === 0 || image.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(stage.width * dpr);
    canvas.height = Math.round(stage.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stage.width, stage.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawRotated(ctx, image, edit.rotation, layout.origin, layout.scale);
    // Dim everything outside the frame.
    ctx.fillStyle = 'rgba(21, 21, 20, 0.6)';
    ctx.beginPath();
    ctx.rect(0, 0, stage.width, stage.height);
    ctx.rect(frame.x, frame.y, frame.width, frame.height);
    ctx.fill('evenodd');
  }, [image, edit.rotation, layout, frame, stage]);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const box = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  const zoomTo = useCallback((zoom: number) => onChange(withZoom(edit, zoom, image)), [edit, image, onChange]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const corner = target.dataset.corner as Corner | undefined;
    if (corner) {
      setFrozen(layout);
      gesture.current = { kind: 'corner', corner };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      gesture.current = { kind: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoomOf(edit, image) };
    } else {
      gesture.current = { kind: 'pan', start: local(e), edit, layout };
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pan') {
      // The image follows the finger: the crop moves the opposite way.
      const s = g.layout.scale;
      const c = panOf(g.edit);
      onChange(withPan(g.edit, { x: c.x - (p.x - g.start.x) / (size.width * s), y: c.y - (p.y - g.start.y) / (size.height * s) }));
    } else if (g.kind === 'corner' && frozen) {
      onChange({ rotation: edit.rotation, crop: resizeCrop(edit.crop, g.corner, toImage(frozen, size, p), size, MIN_CROP_FRACTION, aspect) });
    } else if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      zoomTo((g.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.distance);
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      setFrozen(null);
    }
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => zoomTo(zoomOf(edit, image) * wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const c = panOf(edit);
    const moves: Record<string, Point> = { ArrowLeft: { x: -KEY_STEP, y: 0 }, ArrowRight: { x: KEY_STEP, y: 0 }, ArrowUp: { x: 0, y: -KEY_STEP }, ArrowDown: { x: 0, y: KEY_STEP } };
    const move = moves[e.key];
    if (move) onChange(withPan(edit, { x: c.x + move.x, y: c.y + move.y }));
    else if (e.key === '+' || e.key === '=') zoomTo(zoomOf(edit, image) * 1.1);
    else if (e.key === '-') zoomTo(zoomOf(edit, image) / 1.1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={stageRef}
      className="crop-stage"
      data-testid="crop-stage"
      role="group"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="crop-stage__canvas" aria-hidden="true" />
      <div className="crop-stage__frame" style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }} aria-hidden="true">
        <span className="crop-stage__grid" />
        {CORNERS.map((corner) => (
          <span key={corner} className={`crop-stage__handle crop-stage__handle--${corner}`} data-corner={corner} />
        ))}
      </div>
    </div>
  );
}

/** Small live preview of the resulting image (same drawing as the stage, clipped to the crop). */
export function CropPreview({ image, edit, size = 160 }: { image: ImageBitmap; edit: ImageEdit; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rotated = rotatedSize(image, edit.rotation);
  const layout = cropLayout(edit.crop, rotated, { width: size, height: size }, 0);
  const width = Math.max(1, Math.round(layout.frame.width));
  const height = Math.max(1, Math.round(layout.frame.height));
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || image.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawRotated(ctx, image, edit.rotation, { x: layout.origin.x - layout.frame.x, y: layout.origin.y - layout.frame.y }, layout.scale);
  }, [image, edit.rotation, layout, width, height]);
  return <canvas ref={ref} className="crop-preview" style={{ width, height }} data-testid="crop-preview" role="img" aria-label="Vorschau des Ausschnitts" />;
}
