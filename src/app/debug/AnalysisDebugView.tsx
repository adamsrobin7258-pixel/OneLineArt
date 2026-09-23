import { useMemo, useState } from 'react';
import { ANALYSIS_LAYERS, fieldStats, type AnalysisLayerName, type DebugColormap, type ImageSession } from '../../core';
import type { AnalysisOutcome } from '../../platform/browser/analysisRunner';
import { ImageViewer } from '../../ui/components/ImageViewer';
import { useFieldBitmap } from './useFieldBitmap';

type DebugLayer = 'original' | AnalysisLayerName;

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
};

interface AnalysisDebugViewProps {
  session: ImageSession<ImageBitmap>;
  run: Omit<AnalysisOutcome, 'analysis'> | null;
}

/**
 * Developer-only inspection of every analysis layer (enable with ?debug=analysis).
 * Deliberately technical; values shown are the stored numeric layers.
 */
export function AnalysisDebugView({ session, run }: AnalysisDebugViewProps) {
  const [layer, setLayer] = useState<DebugLayer>('importance');
  const [colormap, setColormap] = useState<DebugColormap>('grayscale');
  const analysis = session.analysis;
  const field = analysis && layer !== 'original' ? analysis[layer] : null;
  const bitmap = useFieldBitmap(field, colormap);
  const stats = useMemo(() => (field ? fieldStats(field) : null), [field]);
  const norm = analysis && layer !== 'original' ? analysis.meta.normalization[layer] : undefined;

  return (
    <div
      className="debug"
      data-testid="analysis-debug"
      data-layer={layer}
      data-analysis-size={analysis ? `${analysis.width}x${analysis.height}` : ''}
      data-analysis-source={analysis?.meta.sourceImageId ?? ''}
    >
      <div className="debug__bar">
        {(['original', ...ANALYSIS_LAYERS] as DebugLayer[]).map((name) => (
          <button
            key={name}
            type="button"
            className={`debug__tab${name === layer ? ' is-active' : ''}`}
            disabled={name !== 'original' && !analysis}
            onClick={() => setLayer(name)}
          >
            {LABELS[name]}
          </button>
        ))}
        <label className="debug__toggle">
          <input type="checkbox" checked={colormap === 'heatmap'} onChange={(e) => setColormap(e.target.checked ? 'heatmap' : 'grayscale')} />
          Heatmap
        </label>
      </div>
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
      <div className="debug__viewer">
        <ImageViewer image={layer === 'original' ? session.preview : (bitmap ?? session.preview)} label={LABELS[layer]} />
      </div>
    </div>
  );
}
