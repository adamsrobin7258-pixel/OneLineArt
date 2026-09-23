import { useMemo, useState } from 'react';
import {
  ANALYSIS_LAYERS,
  DETAIL_LEVELS,
  measureImportanceRepresentation,
  resolveAllDetailLevels,
  fieldStats,
  hashBytes,
  validateOneLinePath,
  type AnalysisLayerName,
  type DebugColormap,
  type ImageSession,
} from '../../core';
import type { OverlayBackground } from '../../platform/browser/pathOverlay';
import { DETAIL_LEVEL_LABELS } from '../drawingLabels';
import type { ImageImportController } from '../state/useImageImport';
import { ImageViewer } from '../../ui/components/ImageViewer';
import { useFieldBitmap } from './useFieldBitmap';
import { usePathBitmap } from '../preview/usePathBitmap';

type PathLayer = 'pathOnOriginal' | 'pathOnImportance' | 'pathOnly';
type DebugLayer = 'original' | AnalysisLayerName | PathLayer;

const LABELS: Record<DebugLayer, string> = {
  original: 'Original',
  luminance: 'Luminanz',
  contrast: 'Kontrast',
  edge: 'Kanten',
  detail: 'Detaildichte',
  texture: 'Textur',
  localImportance: 'Lokal',
  globalRelevance: 'Global',
  importance: 'Importance',
  pathOnOriginal: 'Pfad + Original',
  pathOnImportance: 'Pfad + Importance',
  pathOnly: 'Pfad',
};

const PATH_LAYERS: readonly PathLayer[] = ['pathOnOriginal', 'pathOnImportance', 'pathOnly'];
const isPathLayer = (layer: DebugLayer): layer is PathLayer => (PATH_LAYERS as readonly string[]).includes(layer);

interface AnalysisDebugViewProps {
  session: ImageSession<ImageBitmap>;
  controller: ImageImportController;
}

const fmt = (v: number, digits = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits });

/**
 * Developer-only inspection of every analysis layer and of the One-Line path
 * (enable with ?debug=analysis). Deliberately technical.
 */
export function AnalysisDebugView({ session, controller }: AnalysisDebugViewProps) {
  const { analysisRun: run, pathRun, pathRuns, setDrawing, generatePath, generateAllLevels } = controller;
  const onGeneratePath = () => void generatePath();
  const levels = useMemo(() => resolveAllDetailLevels(session.oneLine.drawing), [session.oneLine.drawing]);
  const fineRepresentation = useMemo(
    () =>
      Object.fromEntries(
        DETAIL_LEVELS.map((level) => {
          const p = session.paths[levels[level].key];
          return [level, p && session.analysis ? measureImportanceRepresentation(p, session.analysis.importance, 192) : null];
        }),
      ),
    [session.paths, session.analysis, levels],
  );
  const [layer, setLayer] = useState<DebugLayer>('importance');
  const [colormap, setColormap] = useState<DebugColormap>('grayscale');
  const { analysis, path } = session;
  const field = analysis && !isPathLayer(layer) && layer !== 'original' ? analysis[layer] : null;
  const fieldBitmap = useFieldBitmap(field, colormap);
  const stats = useMemo(() => (field ? fieldStats(field) : null), [field]);
  const norm = field && analysis && !isPathLayer(layer) && layer !== 'original' ? analysis.meta.normalization[layer] : undefined;

  const background: OverlayBackground | null = !path || !isPathLayer(layer)
    ? null
    : layer === 'pathOnOriginal'
      ? { kind: 'image', source: session.preview }
      : layer === 'pathOnImportance' && analysis
        ? { kind: 'field', field: analysis.importance }
        : { kind: 'blank' };
  const pathHash = useMemo(() => (path ? hashBytes(new Uint8Array(path.coords.buffer, path.coords.byteOffset, path.coords.byteLength)) : ''), [path]);
  const overlay = usePathBitmap(path, background, `${pathHash}:${layer}`);
  const validation = useMemo(() => (path ? validateOneLinePath(path) : null), [path]);

  const shown = layer === 'original' ? session.preview : isPathLayer(layer) ? (overlay ?? session.preview) : (fieldBitmap ?? session.preview);
  const m = pathRun?.metrics;

  return (
    <div
      className="debug"
      data-testid="analysis-debug"
      data-layer={layer}
      data-analysis-size={analysis ? `${analysis.width}x${analysis.height}` : ''}
      data-analysis-source={analysis?.meta.sourceImageId ?? ''}
      data-path-status={session.pathStatus}
      data-path-hash={pathHash}
      data-path-valid={validation ? String(validation.valid) : ''}
      data-path-source={path?.meta.sourceImageId ?? ''}
      data-detail-level={session.oneLine.drawing.detailLevel}
      data-config-key={session.oneLine.key}
    >
      <div className="debug__bar">
        {(['original', ...ANALYSIS_LAYERS] as DebugLayer[]).map((name) => (
          <button key={name} type="button" className={`debug__tab${name === layer ? ' is-active' : ''}`} disabled={name !== 'original' && !analysis} onClick={() => setLayer(name)}>
            {LABELS[name]}
          </button>
        ))}
        <label className="debug__toggle">
          <input type="checkbox" checked={colormap === 'heatmap'} onChange={(e) => setColormap(e.target.checked ? 'heatmap' : 'grayscale')} />
          Heatmap
        </label>
      </div>
      <div className="debug__bar">
        <button
          type="button"
          className="debug__tab debug__tab--action"
          disabled={session.analysisStatus !== 'ready' || session.pathStatus === 'running'}
          onClick={() => {
            onGeneratePath();
            setLayer('pathOnly');
          }}
        >
          {session.pathStatus === 'running' ? 'Pfad wird berechnet …' : path ? 'Pfad neu berechnen' : 'Pfad berechnen'}
        </button>
        {PATH_LAYERS.map((name) => (
          <button key={name} type="button" className={`debug__tab${name === layer ? ' is-active' : ''}`} disabled={!path} onClick={() => setLayer(name)}>
            {LABELS[name]}
          </button>
        ))}
        {session.pathStatus === 'failed' && <span className="debug__error">Pfad fehlgeschlagen: {session.pathError}</span>}
      </div>
      <div className="debug__bar">
        <span>Detailstufe:</span>
        {DETAIL_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={`debug__tab${level === session.oneLine.drawing.detailLevel ? ' is-active' : ''}`}
            onClick={() => setDrawing({ detailLevel: level })}
          >
            {DETAIL_LEVEL_LABELS[level].label}
          </button>
        ))}
        <label className="debug__toggle">
          Seed
          <input
            type="number"
            className="debug__seed"
            value={session.oneLine.drawing.seed}
            min={0}
            onChange={(e) => {
              const seed = Number(e.target.value);
              if (Number.isFinite(seed)) setDrawing({ seed });
            }}
          />
        </label>
        <button type="button" className="debug__tab debug__tab--action" disabled={session.analysisStatus !== 'ready'} onClick={() => void generateAllLevels()}>
          Alle drei Stufen berechnen
        </button>
      </div>
      <table className="debug__compare" data-testid="level-comparison">
        <thead>
          <tr>
            <th>Stufe</th>
            <th>Punkte</th>
            <th>Nachfragepkt.</th>
            <th>Länge px</th>
            <th>Abdeckung</th>
            <th>Top-Importance erreicht (192)</th>
            <th>Dichte hoch/übrig</th>
            <th>Kreuzungen</th>
            <th>Laufzeit</th>
          </tr>
        </thead>
        <tbody>
          {DETAIL_LEVELS.map((level) => {
            const r = pathRuns[levels[level].key];
            const rep = fineRepresentation[level];
            return (
              <tr key={level} data-level={level} data-computed={r ? 'true' : 'false'} className={level === session.oneLine.drawing.detailLevel ? 'is-active' : ''} onClick={() => setDrawing({ detailLevel: level })}>
                <td>{DETAIL_LEVEL_LABELS[level].label}</td>
                <td data-metric="points">{r ? r.metrics.pointCount : '–'}</td>
                <td>{r ? r.diagnostics.demandPoints : '–'}</td>
                <td data-metric="length">{r ? Math.round(r.metrics.length) : '–'}</td>
                <td>{r?.metrics.coverage ? `${(r.metrics.coverage.demandCovered * 100).toFixed(1)} %` : '–'}</td>
                <td data-metric="touched">{rep ? `${(rep.highImportanceTouched * 100).toFixed(1)} %` : '–'}</td>
                <td>{rep ? (rep.highImportanceDensity / Math.max(1e-9, rep.otherDensity)).toFixed(2) : '–'}</td>
                <td>{r ? (r.metrics.selfIntersections ?? '–') : '–'}</td>
                <td data-metric="ms">{r ? `${Math.round(r.durationMs)} ms` : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="debug__stats" data-testid="analysis-stats">
        {analysis
          ? [
              `Analyse ${analysis.width}×${analysis.height} (Quelle ${analysis.meta.sourceSize.width}×${analysis.meta.sourceSize.height})`,
              `v${analysis.meta.algorithmVersion}`,
              run ? `${Math.round(run.durationMs)} ms · ${run.runner}` : null,
              stats ? `min ${stats.min.toFixed(3)} · Ø ${stats.mean.toFixed(3)} · max ${stats.max.toFixed(3)}` : null,
              norm ? `Referenz ${norm.reference.toFixed(4)} (p ${norm.robustMax.toFixed(4)})` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : `Analyse: ${session.analysisStatus}`}
      </p>
      {m && pathRun && path && (
        <dl className="debug__metrics" data-testid="path-metrics">
          <dt>Detailstufe</dt>
          <dd>
            {DETAIL_LEVEL_LABELS[pathRun.effective.drawing.detailLevel].label} · Schlüssel {pathRun.effective.key}
            {pathRun.effective.issues.length ? ` · Anpassungen: ${pathRun.effective.issues.map((i) => i.message).join('; ')}` : ''}
          </dd>
          <dt>Engine</dt>
          <dd>
            {path.meta.generatorId} v{path.meta.generatorVersion} · Seed {path.meta.seed} · {Math.round(pathRun.durationMs)} ms · {pathRun.runner}
          </dd>
          <dt>Gültig</dt>
          <dd>{validation?.valid ? 'ja' : `nein – ${validation?.errors.join(' ')}`}</dd>
          <dt>Länge</dt>
          <dd>{fmt(m.length, 0)} px</dd>
          <dt>Punkte / Segmente</dt>
          <dd>
            {m.pointCount.toLocaleString('de-DE')} / {m.segmentCount.toLocaleString('de-DE')}
          </dd>
          <dt>Segmentlänge Ø / max</dt>
          <dd>
            {fmt(m.meanSegmentLength, 2)} / {fmt(m.maxSegmentLength, 1)} px
          </dd>
          <dt>Krümmung Ø</dt>
          <dd>
            {fmt((m.meanTurnAngle * 180) / Math.PI)}° pro Punkt · {fmt(m.curvaturePerLength, 3)} rad/px
          </dd>
          <dt>Selbstkreuzungen</dt>
          <dd>{m.selfIntersections ?? 'nicht berechnet'}</dd>
          <dt>Bounding Box</dt>
          <dd>
            {fmt(m.boundingBox.minX, 0)},{fmt(m.boundingBox.minY, 0)} – {fmt(m.boundingBox.maxX, 0)},{fmt(m.boundingBox.maxY, 0)}
          </dd>
          <dt>Start / Ende</dt>
          <dd>
            ({fmt(m.start.x, 0)}, {fmt(m.start.y, 0)}) → ({fmt(m.end.x, 0)}, {fmt(m.end.y, 0)})
          </dd>
          {m.coverage && (
            <>
              <dt>Importance-Abdeckung</dt>
              <dd>
                {fmt(m.coverage.demandCovered * 100)} % der Nachfrage ausreichend · Korrelation {fmt(m.coverage.correlation, 3)} · Zellen{' '}
                {m.coverage.counts.sufficient}/{m.coverage.counts.partial}/{m.coverage.counts.untouched} (ausreichend/teilweise/unberührt)
              </dd>
            </>
          )}
          <dt>Intern</dt>
          <dd>
            Raster {pathRun.diagnostics.workingSize.width}×{pathRun.diagnostics.workingSize.height} · {pathRun.diagnostics.demandPoints} Nachfragepunkte · {pathRun.diagnostics.optimizationMoves}{' '}
            2-opt-Züge · {pathRun.diagnostics.rawPoints} → {pathRun.diagnostics.smoothedPoints} → {pathRun.diagnostics.finalPoints} Punkte (roh → geglättet → vereinfacht)
          </dd>
          <dt>Parameter</dt>
          <dd className="debug__params">{JSON.stringify({ settings: pathRun.effective.settings, parameters: pathRun.effective.parameters })}</dd>
        </dl>
      )}
      <div className="debug__viewer">
        <ImageViewer image={shown} label={LABELS[layer]} />
      </div>
    </div>
  );
}
