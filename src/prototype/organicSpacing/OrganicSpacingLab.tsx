import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { DETAIL_LEVELS, importImage, resolveOneLineSettings, type ImageAnalysis, type OneLinePath, type ProcessedImage, type Size } from '../../core';
import { MEASURE_LONG_EDGE, RECOMMENDED_SPACING_VARIANT, SPACING_VARIANTS, measurePassSpacing, spacingPatch, type PassSpacing, type SpacingVariant } from '../../core/experimental/organicSpacing';
import { compareRendering, type RenderingComparison } from '../../core/experimental/variableWidth';
import { runAnalysis } from '../../platform/browser/analysisRunner';
import { bitmapDecoder } from '../../platform/browser/bitmapDecoder';
import { createId } from '../../platform/browser/ids';
import { runPathGeneration } from '../../platform/browser/pathRunner';
import { Button } from '../../ui/components/Button';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { drawOrganic, MEASURE_EDGE } from '../variableWidth/compare';
import { FULL_VIEW, canvasOf, lightnessOfCanvas, lightnessOfImage, sizeFor, type ViewWindow } from '../variableWidth/draw';
import { TEST_IMAGES } from '../variableWidth/testImages';

/**
 * Phase 15.5 experimental test page: the PRODUCTION Organic engine (app
 * worker, unchanged) with a smaller minimum spacing, passed in as a parameter
 * patch (see src/core/experimental/organicSpacing). Not part of the app.
 */

type DetailLevel = (typeof DETAIL_LEVELS)[number];
type View = 'ab' | 'toggle' | 'grid';
/** How large the drawing is shown: phone width, or true device pixels at a fixed long edge. */
type Display = 'phone' | 'e600' | 'e300' | 'native';

interface Source {
  readonly id: string;
  readonly name: string;
  readonly processed: ProcessedImage;
}

interface Computed {
  readonly path: OneLinePath;
  readonly durationMs: number;
  readonly factor: number;
  readonly points: number;
  readonly limited: boolean;
  readonly workingSize: Size;
  readonly demandPoints: number;
  readonly runner: 'worker' | 'main-thread';
}

interface Measured {
  readonly spacing: PassSpacing;
  readonly tone: RenderingComparison;
  readonly renderMs: number;
}

const START_PRESETS = [
  { value: 'auto', label: 'Auto' },
  { value: 'tl', label: '↖', x: 0, y: 0 },
  { value: 'tr', label: '↗', x: 1, y: 0 },
  { value: 'c', label: '•', x: 0.5, y: 0.5 },
  { value: 'bl', label: '↙', x: 0, y: 1 },
  { value: 'br', label: '↘', x: 1, y: 1 },
] as const;
type StartKey = (typeof START_PRESETS)[number]['value'];

const SPEEDS = { slow: 30000, normal: 12000, fast: 4000 } as const;
type Speed = keyof typeof SPEEDS;
const ZOOMS = [1, 2, 4] as const;
const REF = SPACING_VARIANTS[0]!;

function testSource(index: number): Source {
  const t = TEST_IMAGES[index]!;
  return { id: `test-${t.id}`, name: t.label, processed: { sourceImageId: `test-${t.id}`, pixels: t.create(), scale: 1 } };
}

/** Cumulative arc length per path (the app animates at constant speed along the line). */
const arcLengths = new WeakMap<OneLinePath, Float64Array>();

/** The line up to `progress` of its LENGTH, as the app's constant-speed animation draws it. */
function prefix(path: OneLinePath, progress: number): OneLinePath {
  if (progress >= 1) return path;
  const c = path.coords;
  const n = c.length >> 1;
  let along = arcLengths.get(path);
  if (!along) {
    along = new Float64Array(n);
    for (let i = 1; i < n; i++) along[i] = along[i - 1]! + Math.hypot(c[i * 2]! - c[i * 2 - 2]!, c[i * 2 + 1]! - c[i * 2 - 1]!);
    arcLengths.set(path, along);
  }
  const target = progress * along[n - 1]!;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (along[mid]! <= target) lo = mid;
    else hi = mid - 1;
  }
  const out = new Float32Array((lo + 2) * 2);
  out.set(c.subarray(0, (lo + 1) * 2));
  // Partial last segment up to the pen position.
  const next = Math.min(n - 1, lo + 1);
  const seg = along[next]! - along[lo]!;
  const t = seg > 0 ? (target - along[lo]!) / seg : 0;
  out[(lo + 1) * 2] = c[lo * 2]! + (c[next * 2]! - c[lo * 2]!) * t;
  out[(lo + 1) * 2 + 1] = c[lo * 2 + 1]! + (c[next * 2 + 1]! - c[lo * 2 + 1]!) * t;
  return { ...path, coords: out };
}

function PathCanvas({ bounds, path, progress, display, view, label }: { bounds: Size; path: OneLinePath | null; progress: number; display: Display; view: ViewWindow; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [cssWidth, setCssWidth] = useState(0);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setCssWidth(Math.round(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const edge =
    display === 'e600' ? 600 : display === 'e300' ? 300 : display === 'native' ? Math.max(bounds.width, bounds.height) : Math.min(4096, Math.round(cssWidth * dpr * (Math.max(bounds.width, bounds.height) / bounds.width)));
  const { width: sw, height: sh } = sizeFor(bounds, Math.max(16, edge));
  useEffect(() => {
    const el = ref.current;
    if (!el || edge < 16) return;
    el.width = sw;
    el.height = sh;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sw, sh);
    if (path) drawOrganic(ctx, prefix(path, progress), { width: sw, height: sh }, view);
  }, [path, progress, view, edge, sw, sh]);
  // Fixed long edges are shown in TRUE device pixels (no browser rescaling).
  const style = display === 'phone' ? { width: '100%' } : { width: `${sw / dpr}px`, maxWidth: 'none' };
  return <canvas ref={ref} className="lab__canvas" style={{ aspectRatio: `${bounds.width} / ${bounds.height}`, ...style }} aria-label={label} />;
}

const f2 = (v: number | undefined, d = 2) => (v === undefined ? '–' : v.toFixed(d));
const pct = (v: number | undefined) => (v === undefined ? '–' : `${(v * 100).toFixed(1)} %`);

export function OrganicSpacingLab() {
  const [source, setSource] = useState<Source>(() => testSource(0));
  const [analysis, setAnalysis] = useState<{ id: string; analysis: ImageAnalysis } | null>(null);
  const [level, setLevel] = useState<DetailLevel>('balanced');
  const [seed, setSeed] = useState(1);
  const [start, setStart] = useState<StartKey>('auto');
  const [selected, setSelected] = useState<string>(RECOMMENDED_SPACING_VARIANT);
  const [view, setView] = useState<View>('ab');
  const [showB, setShowB] = useState(true);
  const [display, setDisplay] = useState<Display>('phone');
  const [zoom, setZoom] = useState<number>(1);
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>('normal');
  const [results, setResults] = useState<{ context: string; map: Map<string, Computed> } | null>(null);
  const [measured, setMeasured] = useState<{ context: string; map: Map<string, Measured> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startPreset = START_PRESETS.find((s) => s.value === start)!;
  const effective = useMemo(
    () =>
      resolveOneLineSettings({
        style: 'organic',
        detailLevel: level,
        seed,
        ...('x' in startPreset ? { startPoint: { mode: 'fixed' as const, x: startPreset.x, y: startPreset.y } } : {}),
      }),
    [level, seed, startPreset],
  );
  const context = `${source.id}|${level}|${seed}|${start}`;
  const current = results?.context === context ? results.map : null;
  const currentMeasures = measured?.context === context ? measured.map : null;
  const bounds = useMemo(() => ({ width: source.processed.pixels.width, height: source.processed.pixels.height }), [source]);
  const imageAnalysis = analysis?.id === source.id ? analysis.analysis : null;

  useEffect(() => {
    const job = runAnalysis(source.processed);
    job.promise.then(
      (o) => setAnalysis({ id: source.id, analysis: o.analysis }),
      (e: unknown) => setError(`Analyse fehlgeschlagen: ${String(e)}`),
    );
    return job.cancel;
  }, [source]);

  // Computes the stages in order (the baseline first: 'typical' stages need its median spacing).
  const queue = useRef<{ cancel: () => void } | null>(null);
  const compute = useCallback(
    (keys: readonly string[]) => {
      if (!imageAnalysis) return;
      queue.current?.cancel();
      let cancelled = false;
      let job: ReturnType<typeof runPathGeneration> | null = null;
      queue.current = {
        cancel: () => {
          cancelled = true;
          job?.cancel();
        },
      };
      const map = new Map(current ?? []);
      let baselineMedian = 0;
      (async () => {
        const wanted = [REF.key, ...keys.filter((k) => k !== REF.key)];
        for (const key of wanted) {
          if (cancelled) return;
          const variant = SPACING_VARIANTS.find((v) => v.key === key)!;
          if (!map.has(key)) {
            setBusy(variant.label);
            const patch = spacingPatch(variant.spec, { analysis: imageAnalysis, base: effective.parameters, detail: effective.settings.detail, baselineMedian });
            job = runPathGeneration(source.processed, imageAnalysis, effective.settings, patch.parameters, effective.engineId);
            try {
              const o = await job.promise;
              map.set(key, {
                path: o.path,
                durationMs: o.durationMs,
                factor: patch.factor,
                points: patch.points,
                limited: patch.limited,
                workingSize: o.diagnostics.workingSize,
                demandPoints: o.diagnostics.demandPoints,
                runner: o.runner,
              });
            } catch (e) {
              if (!cancelled) setError(`${variant.label}: ${String(e)}`);
              setBusy(null);
              return;
            }
            if (!cancelled) setResults({ context, map: new Map(map) });
          }
          if (key === REF.key) baselineMedian = measurePassSpacing(map.get(key)!.path).all.median;
        }
        if (!cancelled) setBusy(null);
      })();
    },
    [imageAnalysis, current, effective, source, context],
  );

  // Baseline and the chosen stage are computed automatically.
  const selectedReady = current?.has(selected) && current.has(REF.key);
  useEffect(() => {
    if (imageAnalysis && !selectedReady && !busy) compute([selected]);
  }, [imageAnalysis, selectedReady, selected, compute, busy]);
  useEffect(() => () => queue.current?.cancel(), []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / SPEEDS[speed]);
      setProgress(Math.max(0.001, t));
      if (t < 1) frame = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  const measureAll = () => {
    if (!current) return;
    setBusy('Messung');
    setTimeout(() => {
      const size = sizeFor(bounds, MEASURE_EDGE);
      const original = lightnessOfImage(source.processed.pixels, size);
      const lightness = lightnessOfImage(source.processed.pixels, sizeFor(bounds, MEASURE_LONG_EDGE));
      const map = new Map<string, Measured>();
      for (const [key, c] of current) {
        const { ctx } = canvasOf(size);
        const t = performance.now();
        drawOrganic(ctx, c.path, size);
        const renderMs = performance.now() - t;
        map.set(key, { spacing: measurePassSpacing(c.path, { lightness }), tone: compareRendering(original, lightnessOfCanvas(ctx, size), 5), renderMs });
      }
      setMeasured({ context, map });
      setBusy(null);
    }, 30);
  };

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

  const zoomView: ViewWindow = zoom === 1 ? FULL_VIEW : { cx: 0.5, cy: 0.4, zoom };
  const variant = SPACING_VARIANTS.find((v) => v.key === selected)!;
  const panel = (v: SpacingVariant) => {
    const c = current?.get(v.key);
    return (
      <figure key={v.key}>
        {c ? (
          <PathCanvas bounds={bounds} path={c.path} progress={progress} display={display} view={zoomView} label={v.label} />
        ) : (
          <div className="lab__placeholder" style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }} />
        )}
        <figcaption>
          {v.label}
          {c ? ` · ×${c.factor.toFixed(2)} · ${c.demandPoints.toLocaleString('de-DE')} Punkte · ${(c.durationMs / 1000).toFixed(1)} s${c.limited ? ' · an der Budgetgrenze' : ''}` : ' · wird berechnet …'}
        </figcaption>
      </figure>
    );
  };

  const computedVariants = SPACING_VARIANTS.filter((v) => current?.has(v.key));
  return (
    <div className="lab">
      <header className="lab__header">
        <div>
          <p className="lab__eyebrow">Experimenteller Prototyp · Phase 15.5 · nicht Teil der App</p>
          <h1 className="lab__title">Organisch: Mindestabstand</h1>
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
          <div className="lab__field">
            <span className="lab__label">Abstandsstufe (B)</span>
            <div className="lab__chips" role="group" aria-label="Abstandsstufe">
              {SPACING_VARIANTS.slice(1).map((v) => (
                <Button key={v.key} variant={selected === v.key ? 'primary' : 'quiet'} onClick={() => setSelected(v.key)}>
                  {v.label}
                  {v.key === RECOMMENDED_SPACING_VARIANT ? ' ★' : ''}
                </Button>
              ))}
            </div>
            <span className="lab__hint">
              A ist immer die unveränderte Referenz. Prozent-Stufen verkleinern jeden Abstand (mehr Punkte, gleiche Verteilung). „px typisch“: mittlerer Abstand
              in px bei 800 px langer Kante (wie der Free-Orthogonal-Abstand), nie weiter als heute. „Boden“: nie dichter als 1 bzw. 1,5 px im dichtesten Bereich (schont Bilder, die schon dicht sind). ★ = Empfehlung für Ausgewogen.
            </span>
          </div>
          <div className="lab__field">
            <span className="lab__label">Detailstufe</span>
            <SegmentedControl<DetailLevel>
              label="Detailstufe"
              fill
              value={level}
              onChange={setLevel}
              options={[
                { value: 'minimal', label: 'Minimal' },
                { value: 'balanced', label: 'Ausgewogen' },
                { value: 'detail', label: 'Detail' },
              ]}
            />
          </div>
          <div className="lab__field">
            <span className="lab__label">Seed</span>
            <div className="lab__row">
              <Button variant="quiet" onClick={() => setSeed((s) => Math.max(0, s - 1))}>
                −
              </Button>
              <span className="lab__status">{seed}</span>
              <Button variant="quiet" onClick={() => setSeed((s) => s + 1)}>
                +
              </Button>
            </div>
          </div>
          <div className="lab__field">
            <span className="lab__label">Startpunkt</span>
            <SegmentedControl<StartKey> label="Startpunkt" value={start} onChange={setStart} options={START_PRESETS.map((s) => ({ value: s.value, label: s.label }))} />
          </div>
          <Button variant="ghost" disabled={!imageAnalysis || busy !== null} onClick={() => compute(SPACING_VARIANTS.map((v) => v.key))}>
            Alle Stufen berechnen
          </Button>
          <span className="lab__hint">Engine, Worker und Renderer der App, unverändert; nur Punktbudget und maximales Arbeitsraster sind angepasst.</span>
        </aside>

        <main className="lab__main">
          <div className="lab__toolbar">
            <SegmentedControl<View>
              label="Ansicht"
              value={view}
              onChange={setView}
              options={[
                { value: 'ab', label: 'A | B' },
                { value: 'toggle', label: 'A/B umschalten' },
                { value: 'grid', label: 'Alle Stufen' },
              ]}
            />
            <span className="lab__status" role="status">
              {busy ? `Berechne ${busy} …` : !imageAnalysis ? 'Analysiere …' : ''}
            </span>
          </div>
          <div className="lab__row">
            <SegmentedControl<Display>
              label="Darstellung"
              value={display}
              onChange={setDisplay}
              options={[
                { value: 'phone', label: 'Handy' },
                { value: 'e600', label: '600 px' },
                { value: 'e300', label: '300 px' },
                { value: 'native', label: '1:1' },
              ]}
            />
            <SegmentedControl<string> label="Vergrößerung" value={String(zoom)} onChange={(v) => setZoom(Number(v))} options={ZOOMS.map((z) => ({ value: String(z), label: `${z}×` }))} />
          </div>
          <p className="lab__hint">
            Handy: volle Breite in Gerätepixeln. 600 px / 300 px / 1:1: genau so viele Gerätepixel wie angegeben (kleine Vorschau, Galerie-Kachel, Bildgröße) –
            dort zeigen sich Moiré und zulaufende Flächen.
          </p>
          {error && <p className="lab__error">{error}</p>}

          {view === 'ab' && <div className="lab__grid">{[REF, variant].map(panel)}</div>}
          {view === 'toggle' && (
            <>
              <Button variant="primary" onClick={() => setShowB((b) => !b)}>
                Zeigt {showB ? `B: ${variant.label}` : 'A: Referenz'} – umschalten
              </Button>
              <div className="lab__grid">{panel(showB ? variant : REF)}</div>
            </>
          )}
          {view === 'grid' && <div className="lab__grid">{SPACING_VARIANTS.map(panel)}</div>}

          <div className="lab__row">
            <Button variant={playing ? 'primary' : 'quiet'} disabled={!current} onClick={() => setPlaying((p) => !p)}>
              {playing ? 'Anhalten' : 'Entstehung abspielen'}
            </Button>
            <SegmentedControl<Speed>
              label="Geschwindigkeit"
              value={speed}
              onChange={setSpeed}
              options={[
                { value: 'slow', label: 'Langsam' },
                { value: 'normal', label: 'Normal' },
                { value: 'fast', label: 'Schnell' },
              ]}
            />
            <Button variant="ghost" onClick={() => (setPlaying(false), setProgress(1))}>
              Ganz
            </Button>
          </div>
          <input
            type="range"
            aria-label="Zeichnung bis"
            min={0.001}
            max={1}
            step={0.001}
            value={progress}
            onChange={(e) => {
              setPlaying(false);
              setProgress(Number(e.target.value));
            }}
          />

          <div className="lab__row">
            <Button variant="quiet" disabled={!current || busy !== null} onClick={measureAll}>
              Messwerte berechnen
            </Button>
          </div>
          {currentMeasures && (
            <div className="lab__tablewrap">
              <table className="lab__table">
                <thead>
                  <tr>
                    <th scope="col">Messwert</th>
                    {computedVariants.map((v) => (
                      <th key={v.key} scope="col">
                        {v.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['Abstandsfaktor', (c: Computed) => `×${c.factor.toFixed(2)}`],
                      ['Punkte (Bedarf / Linie)', (c: Computed) => `${c.demandPoints.toLocaleString('de-DE')} / ${(c.path.coords.length / 2).toLocaleString('de-DE')}`],
                      ['Arbeitsraster', (c: Computed) => `${c.workingSize.width}×${c.workingSize.height}`],
                      ['Berechnung', (c: Computed) => `${(c.durationMs / 1000).toFixed(2)} s (${c.runner === 'worker' ? 'Worker' : 'Hauptthread'})`],
                      ['Speicher Linie', (c: Computed) => `${(c.path.coords.byteLength / 1e6).toFixed(2)} MB`],
                    ] as const
                  ).map(([label, get]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {computedVariants.map((v) => (
                        <td key={v.key}>{get(current!.get(v.key)!)}</td>
                      ))}
                    </tr>
                  ))}
                  {(
                    [
                      ['Abstand Median (px @ 800)', (m: Measured) => f2(m.spacing.all.median)],
                      ['Abstand 5 % / 10 %', (m: Measured) => `${f2(m.spacing.all.p05)} / ${f2(m.spacing.all.p10)}`],
                      ['Abstand dunkel / mittel / hell (Median)', (m: Measured) => `${f2(m.spacing.dark?.median)} / ${f2(m.spacing.mid?.median)} / ${f2(m.spacing.light?.median)}`],
                      ['Abstand dunkel 10 %', (m: Measured) => f2(m.spacing.dark?.p10)],
                      ['Linien berühren sich', (m: Measured) => pct(m.spacing.touchingShare)],
                      ['Sehr dicht (< 2 Linienbreiten)', (m: Measured) => pct(m.spacing.denseShare)],
                      ['Tonabweichung hell / mittel / dunkel (L*)', (m: Measured) => `${f2(m.tone.light.toneError * 100, 1)} / ${f2(m.tone.mid.toneError * 100, 1)} / ${f2(m.tone.dark.toneError * 100, 1)}`],
                      ['Detail-Stärke hell / mittel / dunkel', (m: Measured) => `${f2(m.tone.light.detailGain)} / ${f2(m.tone.mid.detailGain)} / ${f2(m.tone.dark.detailGain)}`],
                      ['Geschlossene Fläche', (m: Measured) => pct(m.tone.closedInkShare)],
                      ['Zeichnen (1000 px)', (m: Measured) => `${Math.round(m.renderMs)} ms`],
                    ] as const
                  ).map(([label, get]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {computedVariants.map((v) => {
                        const m = currentMeasures.get(v.key);
                        return <td key={v.key}>{m ? get(m) : '–'}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="lab__hint">
                Abstand: Entfernung jedes Linienpunkts zur nächsten anderen Bahn, in px bei 800 px langer Kante (Linienbreite dort 0,8 px). Dunkel/mittel/hell nach
                der Helligkeit des Originals. Tonwerte bei {MEASURE_EDGE} px aus Betrachtungsabstand. Die Zahlen beschreiben Unterschiede, sie ersetzen nicht den
                Blick auf das Bild.
              </p>
            </div>
          )}
          <p className="lab__hint">
            {source.name} · {bounds.width}×{bounds.height} px
          </p>
        </main>
      </div>
    </div>
  );
}
