import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { importImage, type ProcessedImage, type Size } from '../../core';
import {
  DEFAULT_VARIABLE_WIDTH_PARAMETERS,
  MAX_WIDTH_SHARE,
  VARIABLE_WIDTH_LIMITS,
  measureMeanderSpacing,
  variableWidthSvg,
  type RenderingComparison,
  type ToneBandComparison,
  type VariableWidthCurve,
  type VariableWidthParameters,
  type VariableWidthRoute,
} from '../../core/experimental/variableWidth';
import { bitmapDecoder } from '../../platform/browser/bitmapDecoder';
import { createId } from '../../platform/browser/ids';
import { Button } from '../../ui/components/Button';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { Slider } from '../../ui/components/Slider';
import { MEASURE_EDGE, drawOrganic, measure, runOrganic, type Comparison, type OrganicResult } from './compare';
import { canvasOf, download, drawLine, drawRoute, sizeFor } from './draw';
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

const START_PRESETS = [
  { value: 'tl', label: '↖', x: 0, y: 0 },
  { value: 'tr', label: '↗', x: 1, y: 0 },
  { value: 'c', label: '•', x: 0.5, y: 0.5 },
  { value: 'bl', label: '↙', x: 0, y: 1 },
  { value: 'br', label: '↘', x: 1, y: 1 },
] as const;

function testSource(index: number): Source {
  const t = TEST_IMAGES[index]!;
  return { id: `test-${t.id}`, name: t.label, processed: { sourceImageId: `test-${t.id}`, pixels: t.create(), scale: 1 } };
}

/** Canvas that re-draws whenever `draw` changes, at device resolution of its CSS width. */
function ArtCanvas({ bounds, draw, onPick, label }: { bounds: Size; draw: (ctx: CanvasRenderingContext2D, size: Size) => void; onPick?: (x: number, y: number) => void; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
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
    const longEdge = Math.min(EXPORT_EDGE, Math.round(cssWidth * (window.devicePixelRatio || 1) * (Math.max(bounds.width, bounds.height) / bounds.width)));
    const size = sizeFor(bounds, longEdge);
    el.width = size.width;
    el.height = size.height;
    const ctx = el.getContext('2d');
    if (ctx) draw(ctx, size);
  }, [bounds, draw, cssWidth]);
  const pick = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!onPick) return;
    const r = event.currentTarget.getBoundingClientRect();
    onPick(Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (event.clientY - r.top) / r.height)));
  };
  return <canvas ref={ref} className={`lab__canvas${onPick ? ' is-picking' : ''}`} style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }} aria-label={label} onPointerDown={pick} />;
}

function BandRow({ name, a, b }: { name: string; a: ToneBandComparison; b: ToneBandComparison | null }) {
  const cell = (v: number | undefined, digits = 2) => (v === undefined ? '–' : v.toFixed(digits));
  return (
    <tr>
      <th scope="row">
        {name} <span className="lab__muted">({(a.share * 100).toFixed(0)} %)</span>
      </th>
      <td>{cell(a.toneError * 100, 1)}</td>
      <td>{cell(b?.toneError !== undefined ? b.toneError * 100 : undefined, 1)}</td>
      <td>{cell(a.detailCorrelation)}</td>
      <td>{cell(b?.detailCorrelation)}</td>
      <td>{cell(a.detailGain)}</td>
      <td>{cell(b?.detailGain)}</td>
    </tr>
  );
}

function ComparisonTable({ c }: { c: Comparison }) {
  const o: RenderingComparison | null = c.organic;
  const p = c.prototype;
  const share = (v: number | undefined) => (v === undefined ? '–' : `${(v * 100).toFixed(1)} %`);
  return (
    <div className="lab__tablewrap">
      <table className="lab__table">
        <thead>
          <tr>
            <th scope="col" rowSpan={2}>
              Tonbereich (Original)
            </th>
            <th scope="colgroup" colSpan={2}>
              Tonabweichung (L*)
            </th>
            <th scope="colgroup" colSpan={2}>
              Detail-Korrelation
            </th>
            <th scope="colgroup" colSpan={2}>
              Detail-Stärke
            </th>
          </tr>
          <tr>
            <th scope="col">Prototyp</th>
            <th scope="col">Organisch</th>
            <th scope="col">Prototyp</th>
            <th scope="col">Organisch</th>
            <th scope="col">Prototyp</th>
            <th scope="col">Organisch</th>
          </tr>
        </thead>
        <tbody>
          <BandRow name="Hell" a={p.light} b={o?.light ?? null} />
          <BandRow name="Mittel" a={p.mid} b={o?.mid ?? null} />
          <BandRow name="Dunkel" a={p.dark} b={o?.dark ?? null} />
          <tr>
            <th scope="row">Geschlossene Farbfläche</th>
            <td colSpan={2}>
              {share(p.closedInkShare)} / {share(o?.closedInkShare)}
            </td>
            <th scope="row">Leere Fläche</th>
            <td colSpan={3}>
              {share(p.emptyShare)} / {share(o?.emptyShare)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="lab__hint">
        Gemessen bei {MEASURE_EDGE} px. Original und Zeichnungen werden im linearen Licht mit dem Linienabstand weichgezeichnet (so mischt das Auge die
        Linien aus Betrachtungsabstand). Tonabweichung: mittlerer Helligkeitsunterschied in L*-Punkten. Detail-Korrelation: wie ähnlich die lokalen
        Strukturen (1–4 Linienabstände) sind, 1 = gleich. Detail-Stärke: wie kräftig sie ankommen, 1 = voller Kontrast. Hinweis: Mit sichtbarem Spalt
        zwischen den Linien kann der Prototyp nicht dunkler als etwa L* 50 werden; die organische Linie stellt Ton über die Liniendichte auf größerem
        Maßstab dar. Die Zahlen beschreiben Unterschiede, sie sind keine Wertung.
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
  const [organic, setOrganic] = useState<{ id: string; result: OrganicResult } | null>(null);
  const [organicBusy, setOrganicBusy] = useState(false);
  const [measured, setMeasured] = useState<{ key: unknown[]; comparison: Comparison } | null>(null);
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

  const busy = result?.request !== request;
  // Keep showing the last line while a new one is computed.
  const [shown, setShown] = useState<VariableWidthOutcome | null>(null);
  const outcome = result?.outcome ?? shown;
  if (result?.outcome && result.outcome !== shown) setShown(result.outcome);
  const line = outcome?.line ?? null;
  const organicPath = organic?.id === source.id ? organic.result.path : null;
  const comparison = measured && measured.key[0] === line && measured.key[1] === organicPath ? measured.comparison : null;
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
    } catch (e) {
      setError(`Bild konnte nicht geladen werden: ${String(e)}`);
    }
  };

  const computeOrganic = async () => {
    setOrganicBusy(true);
    setError(null);
    const id = source.id;
    try {
      const result = await runOrganic(source.processed);
      setOrganic({ id, result });
    } catch (e) {
      setError(`Organische Linie fehlgeschlagen: ${String(e)}`);
    } finally {
      setOrganicBusy(false);
    }
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
  const drawResult = useCallback(
    (ctx: CanvasRenderingContext2D, size: Size) => {
      if (!line) return;
      drawLine(ctx, line, size, { progress });
      if (view === 'route') drawRoute(ctx, line, size, progress);
    },
    [line, progress, view],
  );
  const drawFull = useCallback((ctx: CanvasRenderingContext2D, size: Size) => line && drawLine(ctx, line, size), [line]);
  const drawOriginal = useCallback(
    (ctx: CanvasRenderingContext2D, size: Size) => {
      const px = source.processed.pixels;
      const { canvas, ctx: tmp } = canvasOf(px);
      tmp.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, size.width, size.height);
    },
    [source],
  );
  const drawOrganicPanel = useCallback(
    (ctx: CanvasRenderingContext2D, size: Size) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.width, size.height);
      if (organicPath) drawOrganic(ctx, organicPath, Math.max(size.width, size.height));
    },
    [organicPath],
  );

  const spacingCheck = useMemo(() => (line && line.parameters.route !== 'spiral' ? measureMeanderSpacing(line) : null), [line]);
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

  const widest = MAX_WIDTH_SHARE * params.spacing;
  const startValue = START_PRESETS.find((s) => s.x === params.start.x && s.y === params.start.y)?.value ?? 'custom';

  return (
    <div className="lab">
      <header className="lab__header">
        <div>
          <p className="lab__eyebrow">Experimenteller Prototyp · Phase 15.1 · nicht Teil der App</p>
          <h1 className="lab__title">Konstanter Linienabstand, variable Liniendicke</h1>
        </div>
        <div className="lab__sources">
          <label className="button button--primary lab__file">
            Bild laden
            <input type="file" accept="image/*" onChange={onFile} className="sr-only" />
          </label>
          {TEST_IMAGES.map((t, i) => (
            <Button key={t.id} variant="quiet" onClick={() => setSource(testSource(i))}>
              {t.label}
            </Button>
          ))}
        </div>
      </header>

      <div className="lab__body">
        <aside className="lab__panel" aria-label="Parameter">
          <SegmentedControl<VariableWidthRoute>
            label="Linienführung"
            fill
            value={params.route}
            onChange={(v) => set('route', v)}
            options={[
              { value: 'meander-rows', label: 'Mäander ≡' },
              { value: 'meander-columns', label: 'Mäander ‖' },
              { value: 'spiral', label: 'Spirale' },
            ]}
          />
          <Slider label="Linienabstand" value={params.spacing} {...VARIABLE_WIDTH_LIMITS.spacing} max={16} step={0.5} format={fmt(1, ' px')} onCommit={(v) => set('spacing', v)} hint={`bei ${params.workingLongEdge} px Arbeitsauflösung ≙ ${Math.floor(params.workingLongEdge / params.spacing)} Linien auf der langen Seite`} />
          <Slider label="Minimale Liniendicke" value={params.minWidth} min={0.1} max={4} step={0.05} format={fmt(2, ' px')} onCommit={(v) => set('minWidth', v)} />
          <Slider label="Maximale Liniendicke" value={params.maxWidth} min={0.5} max={14} step={0.1} format={fmt(1, ' px')} onCommit={(v) => set('maxWidth', v)} hint={`wird auf ${widest.toFixed(2)} px begrenzt (${MAX_WIDTH_SHARE * 100} % des Abstands), damit Linien nie ineinanderlaufen`} />
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
                {picking ? 'Ins Bild tippen …' : 'Im Bild wählen'}
              </Button>
            </div>
            <span className="lab__hint">Mäander: beginnt an der nächstgelegenen Ecke. Spirale: genau am Punkt.</span>
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
          {shownError && <p className="lab__error">{shownError}</p>}

          {view !== 'compare' && (
            <>
              <ArtCanvas
                bounds={bounds}
                draw={drawResult}
                label="Ergebnis des Prototyps"
                {...(picking
                  ? {
                      onPick: (x: number, y: number) => {
                        set('start', { x, y });
                        setPicking(false);
                      },
                    }
                  : {})}
              />
              <Slider label="Zeichnung bis" value={progress} min={0.001} max={1} step={0.001} format={(v) => `${(v * 100).toFixed(1)} %`} onChange={setProgress} onCommit={setProgress} hint="zeigt, wie die eine Linie durch das Bild läuft (grün = Start, rot = Ende)" />
            </>
          )}

          {view === 'compare' && (
            <>
              <div className="lab__grid">
                <figure>
                  <ArtCanvas bounds={bounds} draw={drawOriginal} label="Original" />
                  <figcaption>Original</figcaption>
                </figure>
                <figure>
                  <ArtCanvas bounds={bounds} draw={drawFull} label="Prototyp" />
                  <figcaption>Prototyp (variable Dicke)</figcaption>
                </figure>
                <figure>
                  {organicPath ? <ArtCanvas bounds={bounds} draw={drawOrganicPanel} label="Organisch" /> : <div className="lab__placeholder" style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }} />}
                  <figcaption>
                    Organisch (Ausgewogen, App-Renderer)
                    {organic?.id === source.id && ` · ${(organic.result.durationMs / 1000).toFixed(1)} s`}
                  </figcaption>
                </figure>
              </div>
              <div className="lab__row">
                <Button variant="quiet" disabled={organicBusy} onClick={computeOrganic}>
                  {organicBusy ? 'Organisch wird berechnet …' : organicPath ? 'Organisch neu berechnen' : 'Organische Linie berechnen'}
                </Button>
                <Button variant="quiet" disabled={!line} onClick={() => line && setMeasured({ key: [line, organicPath], comparison: measure(source.processed, line, organicPath) })}>
                  Messen
                </Button>
              </div>
              {comparison && <ComparisonTable c={comparison} />}
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
              <dt>{line.parameters.route === 'spiral' ? 'Windungen' : 'Zeilen'}</dt>
              <dd>{line.diagnostics.lines}</dd>
              <dt>Gemessener Abstand</dt>
              <dd>
                {spacingCheck
                  ? `${(spacingCheck.min * (line.parameters.spacing / line.spacing)).toFixed(3)} … ${(spacingCheck.max * (line.parameters.spacing / line.spacing)).toFixed(3)} px`
                  : `konstant ${line.parameters.spacing} px (Spirale, Rand: ${(line.diagnostics.frameShare * 100).toFixed(1)} % der Route)`}
              </dd>
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
