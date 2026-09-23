import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  clampView,
  fitView,
  panBy,
  wheelZoomFactor,
  zoomAt,
  type Point,
  type Size,
  type ViewTransform,
} from '../viewport/viewTransform';

interface ImageViewerProps {
  /** Display copy of the image. Zoom/pan never affects processing data. */
  image: ImageBitmap;
  label: string;
}

const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 10;
const DOUBLE_TAP_SCALE = 2.5;

/**
 * Large, undistorted image preview with pinch/wheel zoom and drag to pan.
 * Redraws from the preview bitmap at device resolution, so zoomed views stay sharp.
 */
export function ImageViewer({ image, label }: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Captured once: a released bitmap reports 0×0.
  const imageSize = useMemo<Size>(() => ({ width: image.width, height: image.height }), [image]);
  const container = useRef<Size>({ width: 0, height: 0 });
  const view = useRef<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const frame = useRef(0);
  const pointers = useRef(new Map<number, Point>());
  const lastTap = useRef<{ time: number; point: Point } | null>(null);
  const tapStart = useRef<Point | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const draw = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, container.current.width, container.current.height);
    if (image.width === 0) return; // released while a frame was pending
    const { scale, x, y } = view.current;
    const fitFactor = Math.min(container.current.width / imageSize.width, container.current.height / imageSize.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, x, y, imageSize.width * fitFactor * scale, imageSize.height * fitFactor * scale);
  }, [image, imageSize]);

  const setView = useCallback(
    (next: ViewTransform) => {
      view.current = next;
      setZoomed(next.scale > 1.001);
      if (!frame.current) frame.current = requestAnimationFrame(draw);
    },
    [draw],
  );

  // Size the canvas to the container at device resolution; refit on layout changes.
  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      container.current = { width, height };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      setView(view.current.scale > 1 ? clampView(view.current, imageSize, container.current) : fitView(imageSize, container.current));
      draw();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [draw, imageSize, setView]);

  const localPoint = (clientX: number, clientY: number): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const zoomBy = useCallback(
    (factor: number, anchor: Point) => setView(zoomAt(view.current, factor, anchor, imageSize, container.current)),
    [imageSize, setView],
  );

  const toggleZoom = (anchor: Point) =>
    view.current.scale > 1.001 ? setView(fitView(imageSize, container.current)) : zoomBy(DOUBLE_TAP_SCALE, anchor);

  // Wheel needs a non-passive listener to prevent page scroll/zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey), localPoint(event.clientX, event.clientY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPoint(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    tapStart.current = pointers.current.size === 1 ? point : null;
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const point = localPoint(event.clientX, event.clientY);
    const all = [...pointers.current.entries()];
    pointers.current.set(event.pointerId, point);

    if (all.length === 1) {
      setView(panBy(view.current, point.x - previous.x, point.y - previous.y, imageSize, container.current));
    } else if (all.length === 2) {
      const other = all.find(([id]) => id !== event.pointerId)![1];
      const before = { mid: midpoint(previous, other), dist: distance(previous, other) };
      const after = { mid: midpoint(point, other), dist: distance(point, other) };
      if (before.dist < 1) return;
      const zoomedView = zoomAt(view.current, after.dist / before.dist, after.mid, imageSize, container.current);
      setView(panBy(zoomedView, after.mid.x - before.mid.x, after.mid.y - before.mid.y, imageSize, container.current));
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const point = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    // Double-tap for touch; mouse uses the native dblclick event.
    if (event.pointerType !== 'touch' || !point || !tapStart.current || distance(point, tapStart.current) > TAP_SLOP_PX) return;
    const now = performance.now();
    if (lastTap.current && now - lastTap.current.time < DOUBLE_TAP_MS && distance(point, lastTap.current.point) < TAP_SLOP_PX * 3) {
      toggleZoom(point);
      lastTap.current = null;
    } else {
      lastTap.current = { time: now, point };
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const center = { x: container.current.width / 2, y: container.current.height / 2 };
    if (event.key === '+' || event.key === '=') zoomBy(1.25, center);
    else if (event.key === '-') zoomBy(0.8, center);
    else if (event.key === '0') setView(fitView(imageSize, container.current));
    else return;
    event.preventDefault();
  };

  return (
    <div className="viewer">
      <div
        ref={containerRef}
        className={`viewer__surface${zoomed ? ' is-zoomed' : ''}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        data-testid="image-viewer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => toggleZoom(localPoint(e.clientX, e.clientY))}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvasRef} className="viewer__canvas" aria-hidden="true" />
      </div>
      {zoomed && (
        <button type="button" className="viewer__fit" onClick={() => setView(fitView(imageSize, container.current))}>
          Einpassen
        </button>
      )}
    </div>
  );
}

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
