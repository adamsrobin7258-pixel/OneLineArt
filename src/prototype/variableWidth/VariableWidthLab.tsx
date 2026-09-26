import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { importImage, type ProcessedImage, type Size } from '../../core';
import {
  DEFAULT_VARIABLE_WIDTH_PARAMETERS,
  MAX_WIDTH_SHARES,
  VARIABLE_WIDTH_LIMITS,
  buildStages,
  measureLineGeometry,
  segmentStats,
  variableWidthSvg,
  type LineGeometry,
  type SegmentStats,
  type VariableWidthCurve,
  type VariableWidthLine,
  type VariableWidthMode,
  type VariableWidthParameters,
  type VariableWidthRoute,
} from '../../core/experimental/variableWidth';
import { bitmapDecoder } from '../../platform/browser/bitmapDecoder';
import { createId } from '../../platform/browser/ids';
import { Button } from '../../ui/components/Button';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { Slider } from '../../ui/components/Slider';
import { MEASURE_EDGE, drawOrganic, isLatticeRoute, measureVariants, runProduction, type OrganicResult, type ProductionStyle, type VariantMeasurement } from './compare';
import { FULL_VIEW, applyView, canvasOf, download, drawLine, drawRoute, drawSpacingMap, drawStartMarker, sizeFor, type ViewWindow } from './draw';
import { runVariableWidth, type VariableWidthOutcome } from './runner';
import { TEST_IMAGES } from './testImages';

interface Source {
  readonly id: string;
  readonly name: string;
  readonly processed: ProcessedImage;
}

type View = 'result' | 'route' | 'compare';

const EXPORT_EDGE = 2048;
const fmt = (digits: number, unit = '') => (v: number) => `${v.toFixed(digits)}${unit}`;

/** The route shapes of Phases 15.2–15.4, plus the Phase 15.1 extras. */
const ROUTES: ReadonlyArray<{ value: VariableWidthRoute; label: string; short: string }> = [
  { value: 'meander-rows', label: 'Mäander – Referenz', short: 'Mäander – Referenz' },
  { value: 'arc-spiral', label: 'Spirale', short: 'Spirale' },
  { value: 'organic-meander', label: 'Organischer Mäander', short: 'Organ. Mäander' },
  { value: 'flow', label: 'Fließende Kurve', short: 'Fließende Kurve' },
  { value: 'free-orthogonal', label: 'Free Orthogonal (15.3)', short: 'Free Orthogonal' },
  { value: 'free-orthogonal-grown', label: 'Free Orthogonal – gewachsen (15.4)', short: 'FO gewachsen' },
];

/** One panel of the comparison: the current parameters with these overrides. */
interface CompareVariant {
  readonly key: string;
  readonly label: string;
  readonly short: string;
  readonly params: Partial<VariableWidthParameters>;
}
type CompareSet = '15.4' | '15.3';
const COMPARE_SETS: Readonly<Record<CompareSet, { readonly label: string; readonly variants: readonly CompareVariant[]; readonly production: readonly ProductionStyle[] }>> = {
  '15.4': {
    label: 'Free Orthogonal (15.4)',
    variants: [
      { key: 'fo-0', label: 'Free Orthogonal 15.3 · Ordnung 0', short: 'FO 15.3 · 0', params: { route: 'free-orthogonal', mazeOrder: 0 } },
      { key: 'grown', label: 'Free Orthogonal gewachsen (15.4)', short: 'FO gewachsen', params: { route: 'free-orthogonal-grown' } },
      { key: 'fo-0.1', label: 'Free Orthogonal 15.3 · Ordnung 0,1', short: 'FO 15.3 · 0,1', params: { route: 'free-orthogonal', mazeOrder: 0.1 } },
      { key: 'fo-0.2', label: 'Free Orthogonal 15.3 · Ordnung 0,2', short: 'FO 15.3 · 0,2', params: { route: 'free-orthogonal', mazeOrder: 0.2 } },
      { key: 'flow', label: 'Fließende Kurve', short: 'Fließende Kurve', params: { route: 'flow' } },
      { key: 'meander', label: 'Mäander – Referenz', short: 'Mäander', params: { route: 'meander-rows' } },
    ],
    production: ['orthogonal'],
  },
  '15.3': {
    label: 'Alle Routen (15.3)',
    variants: ROUTES.filter((r) => r.value !== 'free-orthogonal-grown').map((r) => ({ key: r.value, label: r.label, short: r.short, params: { route: r.value } })),
    production: ['orthogonal', 'organic'],
  },
};

/** Animation stages measured in Phase 15.4 (share of the line drawn). */
const STAGES = [0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 1] as const;
/** Duration of "Entstehung abspielen" from 0 to 100 %. */
const PLAY_MS = 12000;

const PRODUCTION: ReadonlyArray<{ value: ProductionStyle; label: string }> = [
  { value: 'orthogonal', label: 'Orthogonal (App)' },
  { value: 'organic', label: 'Organisch (App)' },
];
const EXTRA_ROUTES: ReadonlyArray<{ value: VariableWidthRoute; label: string }> = [
  { value: 'meander-columns', label: 'Mäander in Spalten (15.1)' },
  { value: 'spiral', label: 'Spirale 15.1 (freier Mittelpunkt, mit Rand)' },
];

const ROUTE_HINTS: Readonly<Record<VariableWidthRoute, string>> = {
  'meander-rows': 'Phase 15.1, unverändert: gerade Zeilen, Halbkreis-Wenden. Start an der nächstgelegenen Ecke.',
  'meander-columns': 'Phase 15.1: wie die Referenz, in Spalten.',
  spiral: 'Phase 15.1: Mittelpunkt frei, Windungen außerhalb des Bildes laufen als Rahmen am Rand.',
  'arc-spiral':
    'Kreisbögen im exakten Abstand um ein Zentrum an oder außerhalb der Start-Ecke. Mit einem Zentrum im Bild ist eine einzige Linie ohne Rand und Sprünge nicht möglich (siehe Doku).',
  'organic-meander': 'Zeilen über die ganze Breite mit langsamer, rein geometrischer Krümmung. Der Abstand ist hier nur näherungsweise konstant (gemessen).',
  flow: 'Exakte Parallelkurven einer langsamen Flusskurve, schräg durchs Bild, Start an der nächstgelegenen Ecke.',
  'free-orthogonal':
    'Labyrinth nur aus waagerechten und senkrechten Linien auf einem Gitter im exakten Abstand: die Linie läuft um einen Baum aus Korridoren herum. Start frei wählbar; das Ende liegt einen Abstand daneben.',
  'free-orthogonal-grown':
    'Phase 15.4: dasselbe Gitter und dieselbe Umrundung wie Free Orthogonal, aber das Labyrinth wird wie von Hand „gegraben“ (wachsender Baum): weniger Sackgassen-Noppen und Treppen, längere Wege. Unabhängig vom Bild.',
};

const START_PRESETS = [
  { value: 'tl', label: '↖', x: 0, y: 0 },
  { value: 'tr', label: '↗', x: 1, y: 0 },
  { value: 'c', label: '•', x: 0.5, y: 0.5 },
  { value: 'bl', label: '↙', x: 0, y: 1 },
  { value: 'br', label: '↘', x: 1, y: 1 },
] as const;

/** Spacing presets keep the Phase 15.1 width shares (min 11.25 %, max 82.5 % of the spacing). */
const SPACING_PRESETS = [3, 4, 5, 6, 8, 10] as const;
const MIN_SHARE = 0.45 / 4, MAX_SHARE = 3.3 / 4;
/** Maximum width a mode switch sets, as a share of the spacing. */
const MODE_MAX_SHARE: Readonly<Record<VariableWidthMode, number>> = { safe: MAX_SHARE, controlled: 1.15, free: 1.8 };
const ZOOMS = [1, 2, 4, 8] as const;

function testSource(index: number): Source {
  const t = TEST_IMAGES[index]!;
  return { id: `test-${t.id}`, name: t.label, processed: { sourceImageId: `test-${t.id}`, pixels: t.create(), scale: 1 } };
}

interface PointerHandlers {
  /** Pointer pressed / moved while pressed / released, at normalized picture coordinates. */
  readonly onDown?: (x: number, y: number) => void;
  readonly onMove?: (x: number, y: number) => void;
  readonly onUp?: (x: number, y: number) => void;
}

/** Canvas that re-draws whenever `draw` changes, at device resolution of its CSS width. */
function ArtCanvas({
  bounds,
  draw,
  label,
  pointer,
  picking = false,
  native,
}: {
  bounds: Size;
  draw: (ctx: CanvasRenderingContext2D, size: Size) => void;
  label: string;
  pointer?: PointerHandlers;
  picking?: boolean;
  /** 1:1 view: shown at this size in CSS pixels (one working-grid pixel each), drawn at device resolution. */
  native?: Size;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pressed = useRef(false);
  const [cssWidth, setCssWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setCssWidth(Math.round(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || cssWidth === 0) return;
    // 1:1 view: one working-grid pixel per CSS pixel, drawn at device resolution (no downscaling).
    const nativeEdge = native ? Math.min(4096, Math.round(Math.max(native.width, native.height) * (window.devicePixelRatio || 1))) : 0;
    const longEdge = native ? nativeEdge : Math.min(EXPORT_EDGE, Math.round(cssWidth * (window.devicePixelRatio || 1) * (Math.max(bounds.width, bounds.height) / bounds.width)));
    const size = sizeFor(bounds, longEdge);
    el.width = size.width;
    el.height = size.height;
    const ctx = el.getContext('2d');
    if (ctx) draw(ctx, size);
  }, [bounds, draw, cssWidth, native]);
  const nativeStyle = native ? { width: `${sizeFor(bounds, Math.max(native.width, native.height)).width}px`, maxWidth: 'none' } : {};
  const at = (event: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = event.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (event.clientY - r.top) / r.height))];
  };
  return (
    <canvas
      ref={ref}
      className={`lab__canvas${picking ? ' is-picking' : ''}${pointer ? ' is-interactive' : ''}`}
      style={{ aspectRatio: `${bounds.width} / ${bounds.height}`, ...nativeStyle }}
      aria-label={label}
      onPointerDown={(e) => {
        if (!pointer) return;
        pressed.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointer.onDown?.(...at(e));
      }}
      onPointerMove={(e) => pressed.current && pointer?.onMove?.(...at(e))}
      onPointerUp={(e) => {
        if (!pressed.current) return;
        pressed.current = false;
        pointer?.onUp?.(...at(e));
      }}
      onPointerCancel={() => (pressed.current = false)}
    />
  );
}

/** Picture coordinates of a tap inside a magnified view. */
function unzoom(view: ViewWindow, x: number, y: number): [number, number] {
  const z = Math.max(1, view.zoom);
  const half = 1 / (2 * z);
  const cx = Math.min(1 - half, Math.max(half, view.cx)), cy = Math.min(1 - half, Math.max(half, view.cy));
  return [cx + (x - 0.5) / z, cy + (y - 0.5) / z];
}

const n1 = (v: number | undefined, d = 2) => (v === undefined ? '–' : v.toFixed(d));
const pct = (v: number | undefined) => (v === undefined ? '–' : `${(v * 100).toFixed(1)} %`);

function MeasureTable({ columns, data }: { columns: ReadonlyArray<{ key: string; label: string }>; data: Map<string, VariantMeasurement> }) {
  const row = (label: string, get: (m: VariantMeasurement) => string | undefined) => (
    <tr key={label}>
      <th scope="row">{label}</th>
      {columns.map((c) => {
        const m = data.get(c.key);
        return <td key={c.key}>{m ? (get(m) ?? '–') : '–'}</td>;
      })}
    </tr>
  );
  const g = (f: (x: LineGeometry) => string) => (m: VariantMeasurement) => (m.geometry ? f(m.geometry) : undefined);
  const sg = (f: (x: SegmentStats) => string) => (m: VariantMeasurement) => (m.segments ? f(m.segments) : undefined);
  return (
    <div className="lab__tablewrap">
      <table className="lab__table">
        <thead>
          <tr>
            <th scope="col">Messwert</th>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="lab__group">
            <th colSpan={columns.length + 1}>Abstand zur Nachbarbahn (Arbeitsraster-px)</th>
          </tr>
          {row('Mittelwert', g((x) => n1(x.spacing.mean, 3)))}
          {row('Minimum', g((x) => n1(x.spacing.min)))}
          {row('Maximum', g((x) => n1(x.spacing.max)))}
          {row('Standardabweichung', g((x) => n1(x.spacing.std, 3)))}
          {row('5 % … 95 %', g((x) => `${n1(x.spacing.p05)} … ${n1(x.spacing.p95)}`))}
          <tr className="lab__group">
            <th colSpan={columns.length + 1}>Linie</th>
          </tr>
          {row('Pfadlänge (px)', g((x) => Math.round(x.length).toLocaleString('de-DE')))}
          {row('Pfadpunkte', g((x) => x.points.toLocaleString('de-DE')))}
          {row('Dicke min … max (px)', g((x) => `${n1(x.width.min)} … ${n1(x.width.max)}`))}
          {row('Überlappende Dicke', g((x) => pct(x.overlapShare)))}
          {row('Sehr dünn / sehr dick', g((x) => `${pct(x.thinShare)} / ${pct(x.thickShare)}`))}
          {row('Berechnung (ms)', (m) => (m.durationMs === null ? undefined : Math.round(m.durationMs).toString()))}
          <tr className="lab__group">
            <th colSpan={columns.length + 1}>Gerade Stücke (nur Gitter-Routen, in Abständen)</th>
          </tr>
          {row('Anzahl', sg((x) => x.count.toLocaleString('de-DE')))}
          {row('Min / Max', sg((x) => `${n1(x.min, 1)} / ${n1(x.max, 1)}`))}
          {row('Mittel / Median', sg((x) => `${n1(x.mean)} / ${n1(x.median, 1)}`))}
          {row('5 / 25 / 75 / 95 %', sg((x) => `${n1(x.p05, 1)} / ${n1(x.p25, 1)} / ${n1(x.p75, 1)} / ${n1(x.p95, 1)}`))}
          {row('Anteil 1× (= < 1,5× und < 2×)', sg((x) => pct(x.atMost1)))}
          {row('Anteil ≤ 2× / ≤ 3×', sg((x) => `${pct(x.atMost2)} / ${pct(x.atMost3)}`))}
          {row('Treppenstufen', sg((x) => pct(x.stairShare)))}
          {row('Knicke je 100 Abstände', sg((x) => n1(x.turnsPer100, 1)))}
          <tr className="lab__group">
            <th colSpan={columns.length + 1}>Bild (bei {MEASURE_EDGE} px, aus Betrachtungsabstand)</th>
          </tr>
          {row('Detail-Stärke hell', (m) => n1(m.tone.light.detailGain))}
          {row('Detail-Stärke mittel', (m) => n1(m.tone.mid.detailGain))}
          {row('Detail-Stärke dunkel', (m) => n1(m.tone.dark.detailGain))}
          {row('Tonabweichung hell / mittel / dunkel (L*)', (m) => `${n1(m.tone.light.toneError * 100, 1)} / ${n1(m.tone.mid.toneError * 100, 1)} / ${n1(m.tone.dark.toneError * 100, 1)}`)}
          {row('Geschlossene Fläche / leere Fläche', (m) => `${pct(m.tone.closedInkShare)} / ${pct(m.tone.emptyShare)}`)}
        </tbody>
      </table>
      <p className="lab__hint">
        Abstand: Entfernung jedes Linienpunkts (alle halben Abstände, inklusive Wenden) zur nächsten anderen Bahn der Linie. Detail-Stärke: wie kräftig lokale
        Strukturen (1–4 Linienabstände) ankommen, 1 = voller Kontrast. Die organische Linie stellt Ton über die Liniendichte auf größerem Maßstab dar. Die Zahlen
        beschreiben Unterschiede, sie sind keine Wertung.
      </p>
    </div>
  );
}

export function VariableWidthLab() {
  const [source, setSource] = useState<Source>(() => testSource(0));
  const [params, setParams] = useState<VariableWidthParameters>(DEFAULT_VARIABLE_WIDTH_PARAMETERS);
  // Each result remembers the request it answers: a newer request makes it stale (busy) without extra state.
  const request = useMemo(() => ({ source, params }), [source, params]);
  const [result, setResult] = useState<{ request: typeof request; outcome: VariableWidthOutcome | null; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('result');
  const [progress, setProgress] = useState(1);
  const [picking, setPicking] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [zoomView, setZoomView] = useState<ViewWindow>(FULL_VIEW);
  const [production, setProduction] = useState<{ id: string; results: Partial<Record<ProductionStyle, OrganicResult>> } | null>(null);
  const [productionBusy, setProductionBusy] = useState(false);
  const [showSpacing, setShowSpacing] = useState(false);
  const [native, setNative] = useState(false);
  const [compareSet, setCompareSet] = useState<CompareSet>('15.4');
  const [variants, setVariants] = useState<{ request: typeof request; set: CompareSet; lines: Map<string, VariableWidthOutcome> } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [measured, setMeasured] = useState<{ key: unknown[]; data: Map<string, VariantMeasurement> } | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [geometry, setGeometry] = useState<{ line: VariableWidthLine; geometry: LineGeometry } | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  const set = useCallback(<K extends keyof VariableWidthParameters>(key: K, value: VariableWidthParameters[K]) => setParams((p) => ({ ...p, [key]: value })), []);

  useEffect(() => {
    const job = runVariableWidth(request.source.processed.pixels, request.params);
    job.promise.then(
      (outcome) => setResult({ request, outcome, error: null }),
      (e: unknown) => setResult({ request, outcome: null, error: String(e) }),
    );
    return job.cancel;
  }, [request]);

  // Comparison: the variants of the chosen set with exactly the same image and parameters (only the overrides differ).
  useEffect(() => {
    if (view !== 'compare') return;
    let cancelled = false;
    let job: ReturnType<typeof runVariableWidth> | null = null;
    const lines = new Map<string, VariableWidthOutcome>();
    (async () => {
      for (const v of COMPARE_SETS[compareSet].variants) {
        if (cancelled) return;
        job = runVariableWidth(request.source.processed.pixels, { ...request.params, ...v.params });
        try {
          lines.set(v.key, await job.promise);
        } catch (e) {
          if (!cancelled) setError(`${v.label}: ${String(e)}`);
          return;
        }
        if (!cancelled) setVariants({ request, set: compareSet, lines: new Map(lines) });
      }
    })();
    return () => {
      cancelled = true;
      job?.cancel();
    };
  }, [request, view, compareSet]);

  // "Entstehung abspielen": the drawn share grows from 0 to 100 % in PLAY_MS.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / PLAY_MS);
      setProgress(Math.max(0.001, t));
      if (t < 1) frame = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const busy = result?.request !== request;
  // Keep showing the last line while a new one is computed.
  const [shown, setShown] = useState<VariableWidthOutcome | null>(null);
  const outcome = result?.outcome ?? shown;
  if (result?.outcome && result.outcome !== shown) setShown(result.outcome);
  const line = outcome?.line ?? null;
  const productionResults = production?.id === source.id ? production.results : null;
  const compare = COMPARE_SETS[compareSet];
  const variantLines = variants?.request === request && variants.set === compareSet ? variants.lines : null;
  const measurement = measured && measured.key[0] === variantLines && measured.key[1] === productionResults ? measured.data : null;
  const lineGeometry = geometry && geometry.line === line ? geometry.geometry : null;
  // Phase 15.4: segment lengths of lattice routes, and how the line builds up at the current progress.
  const segments = useMemo(() => (line && isLatticeRoute(line.parameters.route) ? segmentStats(line.path.coords, line.spacing) : null), [line]);
  const stage = useMemo(
    () => (line && !playing && progress < 1 ? buildStages(line.path.coords, line.path.bounds, line.spacing, [progress])[0]! : null),
    [line, progress, playing],
  );
  // Spacing heat map: measured once per line, only while shown.
  if (showSpacing && line && !lineGeometry?.samples) setGeometry({ line, geometry: measureLineGeometry(line, { samples: true }) });
  const shownError = error ?? (busy ? null : (result?.error ?? null));

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const imported = await importImage(file, { decoder: bitmapDecoder, createId });
      bitmapDecoder.releasePreview(imported.preview);
      setSource({ id: imported.original.id, name: file.name, processed: imported.processed });
      setZoomView(FULL_VIEW);
    } catch (e) {
      setError(`Bild konnte nicht geladen werden: ${String(e)}`);
    }
  };

  const computeProduction = async () => {
    setProductionBusy(true);
    setError(null);
    const id = source.id;
    const results: Partial<Record<ProductionStyle, OrganicResult>> = { ...productionResults };
    try {
      for (const style of compare.production) {
        results[style] = await runProduction(source.processed, style);
        setProduction({ id, results: { ...results } });
      }
    } catch (e) {
      setError(`Produktive Linie fehlgeschlagen: ${String(e)}`);
    } finally {
      setProductionBusy(false);
    }
  };

  const runMeasure = () => {
    if (!variantLines) return;
    setMeasuring(true);
    // Let the button state paint before the synchronous measurement.
    setTimeout(() => {
      const lines = compare.variants.flatMap((v) => {
        const o = variantLines.get(v.key);
        return o ? [{ key: v.key, line: o.line, durationMs: o.durationMs }] : [];
      });
      const paths = new Map(compare.production.flatMap((p) => (productionResults?.[p] ? [[p as string, productionResults[p]!.path] as const] : [])));
      setMeasured({ key: [variantLines, productionResults], data: measureVariants(source.processed, lines, paths) });
      setMeasuring(false);
    }, 30);
  };

  const exportPng = () => {
    if (!line) return;
    const size = sizeFor(line.path.bounds, EXPORT_EDGE);
    const { canvas, ctx } = canvasOf(size);
    drawLine(ctx, line, size);
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (exported) URL.revokeObjectURL(exported);
      setExported(URL.createObjectURL(blob));
      download(blob, `variable-linie-${params.route}-${params.spacing}px.png`);
    }, 'image/png');
  };

  const exportSvg = () => {
    if (!line) return;
    download(new Blob([variableWidthSvg(line, { longEdge: EXPORT_EDGE })], { type: 'image/svg+xml' }), `variable-linie-${params.route}-${params.spacing}px.svg`);
  };

  const bounds = useMemo(() => ({ width: source.processed.pixels.width, height: source.processed.pixels.height }), [source]);
  const marker = dragStart ?? (picking ? params.start : null);
  const drawResult = useCallback(
    (ctx: CanvasRenderingContext2D, size: Size) => {
      if (!line) return;
      drawLine(ctx, line, size, { progress, view: zoomView });
      if (view === 'route') drawRoute(ctx, line, size, progress, zoomView);
      if (showSpacing && lineGeometry?.samples) drawSpacingMap(ctx, size, line, lineGeometry.samples, zoomView);
      if (marker) drawStartMarker(ctx, size, marker.x, marker.y, zoomView);
    },
    [line, progress, view, zoomView, marker, showSpacing, lineGeometry],
  );
  const drawVariant = useCallback(
    (key: string) => (ctx: CanvasRenderingContext2D, size: Size) => {
      const o = variantLines?.get(key);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.width, size.height);
      if (o) drawLine(ctx, o.line, size, { view: zoomView });
    },
    [variantLines, zoomView],
  );
  const drawers = useMemo(() => new Map(compare.variants.map((v) => [v.key, drawVariant(v.key)])), [drawVariant, compare]);
  const drawOriginal = useCallback(
    (ctx: CanvasRenderingContext2D, size: Size) => {
      const px = source.processed.pixels;
      const { canvas, ctx: tmp } = canvasOf(px);
      tmp.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.imageSmoothingQuality = 'high';
      applyView(ctx, size, zoomView);
      ctx.drawImage(canvas, 0, 0, size.width, size.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
    [source, zoomView],
  );
  const drawProduction = useCallback(
    (style: ProductionStyle) => (ctx: CanvasRenderingContext2D, size: Size) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.width, size.height);
      const path = productionResults?.[style]?.path;
      if (path) drawOrganic(ctx, path, size, zoomView);
    },
    [productionResults, zoomView],
  );
  const productionDrawers = useMemo(() => new Map(PRODUCTION.map((p) => [p.value, drawProduction(p.value)])), [drawProduction]);

  const widthRange = useMemo(() => {
    if (!line) return null;
    let min = Infinity, max = 0;
    for (const w of line.widths) {
      min = Math.min(min, w);
      max = Math.max(max, w);
    }
    const k = line.parameters.spacing / line.spacing;
    return { min: min * k, max: max * k };
  }, [line]);

  const share = MAX_WIDTH_SHARES[params.widthMode];
  const widest = share * params.spacing;
  const startValue = START_PRESETS.find((s) => s.x === params.start.x && s.y === params.start.y)?.value ?? 'custom';

  // Tapping a picture: choose the start (drag to move it) or, otherwise, the centre of the magnified window.
  const pointer: PointerHandlers = picking
    ? {
        onDown: (x, y) => {
          const [px, py] = unzoom(zoomView, x, y);
          setDragStart({ x: px, y: py });
        },
        onMove: (x, y) => {
          const [px, py] = unzoom(zoomView, x, y);
          setDragStart({ x: px, y: py });
        },
        onUp: (x, y) => {
          const [px, py] = unzoom(zoomView, x, y);
          set('start', { x: Math.min(1, Math.max(0, px)), y: Math.min(1, Math.max(0, py)) });
          setDragStart(null);
          setPicking(false);
        },
      }
    : {
        onUp: (x, y) => {
          if (zoomView.zoom === 1) return;
          const [px, py] = unzoom(zoomView, x, y);
          setZoomView({ ...zoomView, cx: px, cy: py });
        },
      };

  const bendRoute = params.route === 'organic-meander' || params.route === 'flow';
  const columns = [
    ...compare.variants.map((v) => ({ key: v.key, label: v.short })),
    ...PRODUCTION.filter((p) => compare.production.includes(p.value)).map((p) => ({ key: p.value as string, label: p.label })),
  ];

  return (
    <div className="lab">
      <header className="lab__header">
        <div>
          <p className="lab__eyebrow">Experimenteller Prototyp · Phase 15.4 · nicht Teil der App</p>
          <h1 className="lab__title">Konstanter Linienabstand, variable Liniendicke</h1>
        </div>
        <div className="lab__sources">
          <label className="button button--primary lab__file">
            Bild laden
            <input type="file" accept="image/*" onChange={onFile} className="sr-only" />
          </label>
          {TEST_IMAGES.map((t, i) => (
            <Button
              key={t.id}
              variant="quiet"
              onClick={() => {
                setSource(testSource(i));
                setZoomView(FULL_VIEW);
              }}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </header>

      <div className="lab__body">
        <aside className="lab__panel" aria-label="Parameter">
          <div className="lab__field">
            <label className="lab__label" htmlFor="lab-route">
              Linienführung
            </label>
            <select id="lab-route" className="lab__select" value={params.route} onChange={(e) => set('route', e.target.value as VariableWidthRoute)}>
              {ROUTES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
              <optgroup label="Phase 15.1 (zum Vergleich)">
                {EXTRA_ROUTES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <span className="lab__hint">{ROUTE_HINTS[params.route]}</span>
          </div>
          {params.route === 'arc-spiral' && (
            <Slider label="Zentrum außerhalb der Ecke" value={params.arcCenter} min={0} max={2} step={0.05} format={fmt(2, ' × Diagonale')} onCommit={(v) => set('arcCenter', v)} hint="0 = Zentrum genau in der Ecke (stark gebogen), größer = flachere Bögen" />
          )}
          {params.route === 'free-orthogonal' && (
            <>
              <Slider label="Ordnung" value={params.mazeOrder} {...VARIABLE_WIDTH_LIMITS.mazeOrder} step={0.05} format={fmt(2)} onCommit={(v) => set('mazeOrder', v)} hint="1 = lange, fließende Korridore entlang eines langsamen Richtungsfelds · 0 = zufälliges Labyrinth" />
              <Slider label="Feldgröße" value={params.mazeScale} min={0.1} max={2} step={0.05} format={fmt(2, ' × Bildkante')} onCommit={(v) => set('mazeScale', v)} hint="Wellenlänge des Richtungsfelds: klein = unruhiger, groß = große ruhige Bereiche" />
              <div className="lab__field">
                <span className="lab__label">Labyrinth-Variante (Seed)</span>
                <div className="lab__row">
                  <Button variant="quiet" onClick={() => set('mazeSeed', Math.max(0, params.mazeSeed - 1))}>
                    −
                  </Button>
                  <span className="lab__status">{params.mazeSeed}</span>
                  <Button variant="quiet" onClick={() => set('mazeSeed', params.mazeSeed + 1)}>
                    +
                  </Button>
                </div>
                <span className="lab__hint">Derselbe Seed ergibt immer genau dasselbe Labyrinth – unabhängig vom Bild.</span>
              </div>
            </>
          )}
          {params.route === 'free-orthogonal-grown' && (
            <>
              <Slider label="Korridore" value={params.mazeRun} {...VARIABLE_WIDTH_LIMITS.mazeRun} step={0.05} format={fmt(2)} onCommit={(v) => set('mazeRun', v)} hint="1 = lange, verschlungene Wege mit wenigen Sackgassen · 0 = buschig verzweigt (viele kurze Sackgassen)" />
              <Slider label="Geradeaus" value={params.mazeStraight} {...VARIABLE_WIDTH_LIMITS.mazeStraight} step={0.05} format={fmt(2)} onCommit={(v) => set('mazeStraight', v)} hint="Vorliebe, geradeaus weiterzulaufen: längere gerade Stücke" />
              <Slider label="Treppen vermeiden" value={params.mazeStairs} {...VARIABLE_WIDTH_LIMITS.mazeStairs} step={0.05} format={fmt(2)} onCommit={(v) => set('mazeStairs', v)} hint="unterdrückt ┐└┐└-Stufen (Knick und sofort zurück)" />
              <Slider label="Haarnadeln vermeiden" value={params.mazeHairpins} {...VARIABLE_WIDTH_LIMITS.mazeHairpins} step={0.05} format={fmt(2)} onCommit={(v) => set('mazeHairpins', v)} hint="unterdrückt zwei gleichsinnige Knicke direkt hintereinander (enge U-Kehren mit kurzer Kappe)" />
              <Slider label="Räumliche Variation" value={params.mazeVariation} {...VARIABLE_WIDTH_LIMITS.mazeVariation} step={0.05} format={fmt(2)} onCommit={(v) => set('mazeVariation', v)} hint="0 = überall gleich · 1 = Korridore und Geradeaus schwanken über das Bild (langsames Feld, vom Seed)" />
              {params.mazeVariation > 0 && (
                <Slider label="Feldgröße" value={params.mazeScale} min={0.1} max={2} step={0.05} format={fmt(2, ' × Bildkante')} onCommit={(v) => set('mazeScale', v)} hint="Wellenlänge der Variation" />
              )}
            </>
          )}
          {params.route === 'free-orthogonal-grown' && (
            <div className="lab__field">
              <span className="lab__label">Labyrinth-Variante (Seed)</span>
              <div className="lab__row">
                <Button variant="quiet" onClick={() => set('mazeSeed', Math.max(0, params.mazeSeed - 1))}>
                  −
                </Button>
                <span className="lab__status">{params.mazeSeed}</span>
                <Button variant="quiet" onClick={() => set('mazeSeed', params.mazeSeed + 1)}>
                  +
                </Button>
              </div>
              <span className="lab__hint">Derselbe Seed ergibt immer genau dasselbe Labyrinth – unabhängig vom Bild.</span>
            </div>
          )}
          {bendRoute && <Slider label="Schwung" value={params.bend} {...VARIABLE_WIDTH_LIMITS.bend} step={0.05} format={fmt(2)} onCommit={(v) => set('bend', v)} hint={params.route === 'flow' ? 'Anteil der größten Krümmung, bei der der Abstand exakt bleibt' : 'Krümmung; bei 1 ändert sich der Abstand um höchstens ±12 %'} />}
          <div className="lab__field">
            <span className="lab__label">Linienabstand</span>
            <div className="lab__chips" role="group" aria-label="Abstand-Voreinstellungen">
              {SPACING_PRESETS.map((sp) => (
                <Button
                  key={sp}
                  variant={params.spacing === sp ? 'primary' : 'quiet'}
                  onClick={() => setParams((p) => ({ ...p, spacing: sp, minWidth: +(MIN_SHARE * sp).toFixed(3), maxWidth: +(MODE_MAX_SHARE[p.widthMode] * sp).toFixed(3) }))}
                >
                  {sp} px
                </Button>
              ))}
            </div>
            <span className="lab__hint">Voreinstellungen skalieren die Dicken mit (gleiche Deckung wie bei 4 px).</span>
          </div>
          <Slider label="Linienabstand (frei)" value={params.spacing} {...VARIABLE_WIDTH_LIMITS.spacing} max={16} step={0.5} format={fmt(1, ' px')} onCommit={(v) => set('spacing', v)} hint={`bei ${params.workingLongEdge} px Arbeitsauflösung ≙ ${Math.floor(params.workingLongEdge / params.spacing)} Linien auf der langen Seite`} />
          <Slider label="Minimale Liniendicke" value={params.minWidth} min={0.1} max={4} step={0.05} format={fmt(2, ' px')} onCommit={(v) => set('minWidth', v)} />
          <Slider label="Maximale Liniendicke" value={params.maxWidth} min={0.5} max={20} step={0.1} format={fmt(1, ' px')} onCommit={(v) => set('maxWidth', v)} hint={`höchstens ${widest.toFixed(2)} px (${Math.round(share * 100)} % des Abstands im Modus „${params.widthMode === 'safe' ? 'Sicher' : params.widthMode === 'controlled' ? 'Kontrolliert' : 'Frei'}“)`} />
          <div className="lab__field">
            <span className="lab__label">Dicke darf Abstand überschreiten</span>
            <SegmentedControl<VariableWidthMode>
              label="Dicke darf Abstand überschreiten"
              fill
              value={params.widthMode}
              onChange={(v) => setParams((p) => ({ ...p, widthMode: v, maxWidth: +(MODE_MAX_SHARE[v] * p.spacing).toFixed(3) }))}
              options={[
                { value: 'safe', label: 'Sicher' },
                { value: 'controlled', label: 'Kontrolliert' },
                { value: 'free', label: 'Frei' },
              ]}
            />
            <span className="lab__hint">Sicher: ≤ 90 % (Phase 15.1). Kontrolliert: bis 120 %. Frei: bis 200 %. Die Extra-Dicke geht nur in die dunkelsten Töne.</span>
          </div>
          <Slider label="Kontrast" value={params.contrast} {...VARIABLE_WIDTH_LIMITS.contrast} step={0.05} format={fmt(2)} onCommit={(v) => set('contrast', v)} hint="0 = neutral, + = S-Kurve, − = weicher" />
          <Slider label="Detailverstärkung" value={params.detail} {...VARIABLE_WIDTH_LIMITS.detail} step={0.05} format={fmt(2)} onCommit={(v) => set('detail', v)} hint="lokaler Kontrast, Rauschen wird ausgeblendet" />
          <Slider label="Glättung" value={params.smoothing} min={0} max={1.5} step={0.05} format={fmt(2, ' × Abstand')} onCommit={(v) => set('smoothing', v)} hint="richtungsunabhängig; unter 0,25 droht Moiré" />
          <div className="lab__field">
            <span className="lab__label">Startpunkt</span>
            <div className="lab__row">
              <SegmentedControl
                label="Startpunkt"
                value={startValue}
                onChange={(v) => {
                  const preset = START_PRESETS.find((s) => s.value === v);
                  if (preset) set('start', { x: preset.x, y: preset.y });
                }}
                options={START_PRESETS.map((s) => ({ value: s.value, label: s.label }))}
              />
              <Button variant={picking ? 'primary' : 'ghost'} onClick={() => setPicking((p) => !p)}>
                {picking ? 'Tippen oder ziehen …' : 'Im Bild setzen'}
              </Button>
            </div>
            <span className="lab__hint">
              Der Startpunkt bestimmt nur die Lage der Linie, nie die Tonwerte.{' '}
              {params.route === 'spiral'
                ? 'Spirale 15.1: genau am Punkt.'
                : isLatticeRoute(params.route)
                  ? 'Free Orthogonal: genau an der nächsten Gitterzelle – überall im Bild möglich.'
                  : 'Diese Linienführung beginnt an der Ecke, die dem Punkt am nächsten liegt.'}
            </span>
          </div>
          <SegmentedControl<VariableWidthCurve>
            label="Kennlinie"
            fill
            value={params.curve}
            onChange={(v) => set('curve', v)}
            options={[
              { value: 'perceptual', label: 'Wahrnehmungsgleich' },
              { value: 'linear', label: 'Linear' },
            ]}
          />
          <label className="lab__check">
            <input type="checkbox" checked={params.autoLevels} onChange={(e) => set('autoLevels', e.target.checked)} /> Tonwertumfang automatisch strecken
          </label>
          <Slider label="Arbeitsauflösung" value={params.workingLongEdge} min={300} max={1600} step={50} format={fmt(0, ' px')} onCommit={(v) => set('workingLongEdge', v)} />
          <Button variant="ghost" onClick={() => setParams(DEFAULT_VARIABLE_WIDTH_PARAMETERS)}>
            Standardwerte
          </Button>
        </aside>

        <main className="lab__main">
          <div className="lab__toolbar">
            <SegmentedControl<View>
              label="Ansicht"
              value={view}
              onChange={setView}
              options={[
                { value: 'result', label: 'Ergebnis' },
                { value: 'route', label: 'Linienverlauf' },
                { value: 'compare', label: 'Vergleich' },
              ]}
            />
            <span className="lab__status" role="status">
              {busy ? 'Berechne …' : shownError ? 'Fehler' : line ? `${Math.round(outcome!.durationMs)} ms (${outcome!.runner === 'worker' ? 'Worker' : 'Hauptthread'})` : ''}
            </span>
          </div>
          <div className="lab__row lab__zoom">
            <span className="lab__label">Ausschnitt</span>
            <SegmentedControl<string>
              label="Vergrößerung"
              value={String(zoomView.zoom)}
              onChange={(v) => setZoomView({ ...zoomView, zoom: Number(v) })}
              options={ZOOMS.map((z) => ({ value: String(z), label: `${z}×` }))}
            />
            <span className="lab__hint">{zoomView.zoom > 1 ? 'Ins Bild tippen verschiebt den Ausschnitt – in allen Ansichten gleich.' : 'Vergrößern, um überall dieselbe Stelle zu vergleichen.'}</span>
          </div>
          {shownError && <p className="lab__error">{shownError}</p>}

          {view !== 'compare' && (
            <>
              <div className="lab__row">
                <SegmentedControl<string>
                  label="Anzeige"
                  value={native ? 'native' : 'fit'}
                  onChange={(v) => setNative(v === 'native')}
                  options={[
                    { value: 'fit', label: 'Handy (verkleinert)' },
                    { value: 'native', label: 'Originalgröße 1:1' },
                  ]}
                />
                <label className="lab__check">
                  <input type="checkbox" checked={showSpacing} onChange={(e) => setShowSpacing(e.target.checked)} /> Abstand anzeigen
                </label>
              </div>
              {showSpacing && (
                <p className="lab__hint">
                  Punkte = gemessener Abstand zur Nachbarbahn: <span className="lab__key lab__key--ok">±1 %</span> <span className="lab__key lab__key--near">±1–5 %</span>{' '}
                  <span className="lab__key lab__key--wide">weiter</span> <span className="lab__key lab__key--tight">enger</span>
                </p>
              )}
              <div className={native ? 'lab__native' : undefined}>
                <ArtCanvas
                  bounds={bounds}
                  draw={drawResult}
                  label="Ergebnis des Prototyps"
                  pointer={pointer}
                  picking={picking}
                  {...(native && line ? { native: line.working } : {})}
                />
              </div>
              <Slider label="Zeichnung bis" value={progress} min={0.001} max={1} step={0.001} format={(v) => `${(v * 100).toFixed(1)} %`} onChange={setProgress} onCommit={setProgress} hint="zeigt, wie die eine Linie durch das Bild läuft (grün = Start, rot = Ende)" />
              <div className="lab__row">
                <Button variant={playing ? 'primary' : 'quiet'} disabled={!line} onClick={() => setPlaying((p) => !p)}>
                  {playing ? 'Anhalten' : 'Entstehung abspielen'}
                </Button>
                <div className="lab__chips" role="group" aria-label="Zeichnungsstand">
                  {STAGES.map((st) => (
                    <Button
                      key={st}
                      variant={!playing && Math.abs(progress - st) < 1e-6 ? 'primary' : 'quiet'}
                      onClick={() => {
                        setPlaying(false);
                        setProgress(st);
                      }}
                    >
                      {Math.round(st * 100)} %
                    </Button>
                  ))}
                </div>
              </div>
              {stage && (
                <p className="lab__hint" role="status">
                  Bei {(stage.progress * 100).toFixed(0)} %: Ausdehnung {pct(stage.boxShare)} der Bildfläche · Reichweite vom Start {pct(stage.reach)} der Diagonale · Verzweigung{' '}
                  {n1(stage.spread)} (1 = kompakter Fleck, größer = verästelt)
                </p>
              )}
            </>
          )}

          {view === 'compare' && (
            <>
              <SegmentedControl<CompareSet>
                label="Vergleichssatz"
                value={compareSet}
                onChange={setCompareSet}
                options={(Object.keys(COMPARE_SETS) as CompareSet[]).map((k) => ({ value: k, label: COMPARE_SETS[k].label }))}
              />
              <div className="lab__grid">
                <figure>
                  <ArtCanvas bounds={bounds} draw={drawOriginal} label="Original" pointer={pointer} />
                  <figcaption>Original</figcaption>
                </figure>
                {compare.variants.map((v) => (
                  <figure key={v.key}>
                    {variantLines?.get(v.key) && drawers.get(v.key) ? (
                      <ArtCanvas bounds={bounds} draw={drawers.get(v.key)!} label={v.label} pointer={pointer} />
                    ) : (
                      <div className="lab__placeholder" style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }} />
                    )}
                    <figcaption>
                      {v.label}
                      {variantLines?.get(v.key) ? ` · ${Math.round(variantLines.get(v.key)!.durationMs)} ms` : ' · wird berechnet …'}
                    </figcaption>
                  </figure>
                ))}
                {PRODUCTION.filter((p) => compare.production.includes(p.value)).map((p) => (
                  <figure key={p.value}>
                    {productionResults?.[p.value] ? (
                      <ArtCanvas bounds={bounds} draw={productionDrawers.get(p.value)!} label={p.label} pointer={pointer} />
                    ) : (
                      <div className="lab__placeholder" style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }} />
                    )}
                    <figcaption>
                      {p.label}, Ausgewogen, App-Renderer
                      {productionResults?.[p.value] && ` · ${(productionResults[p.value]!.durationMs / 1000).toFixed(1)} s`}
                    </figcaption>
                  </figure>
                ))}
              </div>
              <div className="lab__row">
                <Button variant="quiet" disabled={productionBusy} onClick={computeProduction}>
                  {productionBusy
                    ? 'Produktive Linien werden berechnet …'
                    : compare.production.every((st) => productionResults?.[st])
                      ? 'Produktive Linien neu berechnen'
                      : `Produktive Linien berechnen (${compare.production.map((st) => PRODUCTION.find((p) => p.value === st)!.label.replace(' (App)', '')).join(', ')})`}
                </Button>
                <Button variant="quiet" disabled={!variantLines || variantLines.size < compare.variants.length || measuring} onClick={runMeasure}>
                  {measuring ? 'Messe …' : 'Alle messen'}
                </Button>
              </div>
              {measurement && <MeasureTable columns={columns} data={measurement} />}
            </>
          )}

          <div className="lab__row">
            <Button disabled={!line} onClick={exportPng}>
              PNG exportieren
            </Button>
            <Button variant="quiet" disabled={!line} onClick={exportSvg}>
              SVG exportieren
            </Button>
          </div>
          {exported && (
            <figure className="lab__export">
              <img src={exported} alt="Exportiertes Bild (lange drücken zum Speichern)" />
              <figcaption>Export ({EXPORT_EDGE} px) – auf dem Handy lange drücken, um das Bild zu speichern.</figcaption>
            </figure>
          )}

          {line && (
            <dl className="lab__stats">
              <dt>Bild</dt>
              <dd>
                {source.name} · {bounds.width}×{bounds.height} px · Arbeitsraster {line.working.width}×{line.working.height}
              </dd>
              <dt>Linienführung</dt>
              <dd>
                {[...ROUTES, ...EXTRA_ROUTES].find((r) => r.value === line.parameters.route)?.label} · {line.diagnostics.lines} {line.parameters.route === 'spiral' ? 'Windungen' : isLatticeRoute(line.parameters.route) ? 'Labyrinth-Zellen' : 'Bahnen'}
                {line.diagnostics.curved && ` · geteilte Bahnen ${line.diagnostics.curved.splitRows}, Spitzen ${line.diagnostics.curved.cusps}, an den Rand gesetzt ${line.diagnostics.curved.clamped}`}
              </dd>
              <dt>Abstand</dt>
              <dd>
                {lineGeometry ? (
                  `Mittel ${lineGeometry.spacing.mean.toFixed(3)} · Min ${lineGeometry.spacing.min.toFixed(2)} · Max ${lineGeometry.spacing.max.toFixed(2)} · σ ${lineGeometry.spacing.std.toFixed(3)} · 5–95 % ${lineGeometry.spacing.p05.toFixed(2)}…${lineGeometry.spacing.p95.toFixed(2)} px · Überlappung ${pct(lineGeometry.overlapShare)}`
                ) : (
                  <Button variant="ghost" onClick={() => line && setGeometry({ line, geometry: measureLineGeometry(line, { samples: true }) })}>
                    Abstand messen
                  </Button>
                )}
              </dd>
              {segments && (
                <>
                  <dt>Segmente</dt>
                  <dd>
                    {segments.count.toLocaleString('de-DE')} gerade Stücke · Mittel {n1(segments.mean)} · Median {n1(segments.median, 1)} × Abstand · 1× {pct(segments.atMost1)} · ≤ 2× {pct(segments.atMost2)} · ≤ 3×{' '}
                    {pct(segments.atMost3)} · Treppenstufen {pct(segments.stairShare)} · {n1(segments.turnsPer100, 1)} Knicke je 100 Abstände
                  </dd>
                </>
              )}
              <dt>Liniendicke</dt>
              <dd>{widthRange && `${widthRange.min.toFixed(2)} … ${widthRange.max.toFixed(2)} px (erlaubt ${line.parameters.minWidth.toFixed(2)} … ${line.parameters.maxWidth.toFixed(2)})`}</dd>
              <dt>Punkte</dt>
              <dd>
                {line.diagnostics.points.toLocaleString('de-DE')} gespeichert (aus {line.diagnostics.routePoints.toLocaleString('de-DE')} Abtastpunkten)
              </dd>
              <dt>Linienlänge</dt>
              <dd>{Math.round(line.diagnostics.length).toLocaleString('de-DE')} px</dd>
              <dt>Tonwertumfang</dt>
              <dd>{line.diagnostics.levels ? `L* ${(line.diagnostics.levels.low * 100).toFixed(0)} … ${(line.diagnostics.levels.high * 100).toFixed(0)} gestreckt` : 'unverändert'} · Rauschen σ ≈ {(line.diagnostics.noiseSigma * 100).toFixed(2)} L*</dd>
              {line.issues.length > 0 && (
                <>
                  <dt>Angepasst</dt>
                  <dd>{line.issues.map((i) => i.message).join(' · ')}</dd>
                </>
              )}
            </dl>
          )}
        </main>
      </div>
    </div>
  );
}
