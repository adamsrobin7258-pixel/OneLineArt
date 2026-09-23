import { writeFile } from 'node:fs/promises';
import { test } from '@playwright/test';

/**
 * Performance benchmark (`npm run bench`, optional BENCH_OUT=file.md).
 * Fixed synthetic photo, fixed seeds: the workload is identical on every run;
 * each measurement is the median of RUNS repetitions after one warm-up.
 */
const RUNS = 3;

test('benchmark', async ({ page }) => {
  await page.goto('/');
  const rows = await page.evaluate(async (RUNS) => {
    const core = await import('/src/core/index.ts' as string);
    const { runAnalysis } = await import('/src/platform/browser/analysisRunner.ts' as string);
    const { runPathGeneration } = await import('/src/platform/browser/pathRunner.ts' as string);
    const { renderArtworkSurface, freeSurface } = await import('/src/platform/browser/artworkRenderer.ts' as string);
    const { exportArtworkImage } = await import('/src/platform/browser/export/imageExporter.ts' as string);
    const { exportCreationVideo } = await import('/src/platform/browser/export/videoExporter.ts' as string);

    const photo = (edge: number) => {
      const w = edge, h = Math.round(edge * 0.75);
      const c = new OffscreenCanvas(w, h);
      const x = c.getContext('2d')!;
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#c8d8e8');
      g.addColorStop(1, '#40506a');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      let s = 3;
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 60; i++) {
        x.fillStyle = `hsl(${r() * 360},60%,${20 + r() * 60}%)`;
        x.beginPath();
        x.arc(r() * w, r() * h, (20 + r() * 150) * (edge / 1600), 0, 7);
        x.fill();
      }
      x.fillStyle = '#e8c0a0';
      x.beginPath();
      x.ellipse(w / 2, h / 2, w * 0.13, h * 0.22, 0, 0, 7);
      x.fill();
      return { width: w, height: h, data: x.getImageData(0, 0, w, h).data };
    };
    const median = async (fn: () => Promise<number>) => {
      await fn();
      const t: number[] = [];
      for (let i = 0; i < RUNS; i++) t.push(await fn());
      return t.sort((a, b) => a - b)[RUNS >> 1]!;
    };
    const out: [string, string][] = [];
    const ms = (v: number) => `${Math.round(v)} ms`;

    // Analysis (worker) at 1024 and 2048 working size.
    const processed = (edge: number) => ({ sourceImageId: `bench-${edge}`, pixels: photo(edge), scale: 1 });
    const p1024 = processed(1024);
    const p2048 = processed(2048);
    out.push(['Analyse 1024', ms(await median(async () => (await runAnalysis(p1024).promise).durationMs))]);
    out.push(['Analyse 2048', ms(await median(async () => (await runAnalysis(p2048).promise).durationMs))]);

    // One-line paths (worker), 2048 working size.
    const analysis = (await runAnalysis(p2048).promise).analysis;
    const paths: Record<string, import('../../src/core').OneLinePath> = {};
    for (const level of ['minimal', 'balanced', 'detail']) {
      const eff = core.resolveOneLineSettings({ detailLevel: level });
      let points = 0;
      const t = await median(async () => {
        const o = await runPathGeneration(p2048, analysis, eff.settings, eff.parameters).promise;
        paths[level] = o.path;
        points = o.metrics.pointCount;
        return o.durationMs;
      });
      out.push([`One-Line ${level} (${Math.round(points / 1000)} Tsd. Punkte)`, ms(t)]);
    }

    // Rendering (main thread), Detail path.
    const black = core.sanitizeRenderSettings({}).value;
    const colour = core.sanitizeRenderSettings({ colorMode: 'sampled-color' }).value;
    for (const edge of [1024, 2048, 4096]) {
      for (const [name, settings] of [['Schwarz', black], ['Farbe', colour]] as const) {
        const t = await median(async () => {
          const start = performance.now();
          const r = renderArtworkSurface({ path: paths.detail!, settings, longEdge: edge, image: p2048.pixels });
          r.surface.ctx.getImageData(0, 0, 1, 1); // flush
          freeSurface(r.surface);
          return performance.now() - start;
        });
        out.push([`Rendering Detail ${edge} ${name}`, ms(t)]);
      }
    }

    // Image export (worker), Detail colour.
    const source = { path: paths.detail!, render: colour, image: p2048.pixels, backgroundImage: null, originalSize: { width: 6000, height: 4500 } };
    for (const resolution of ['2048', '4096', 'original'] as const) {
      let detail = '';
      const t = await median(async () => {
        const f = await exportArtworkImage({ source, settings: { resolution } });
        detail = `Rendern ${Math.round(f.timings.renderMs)} · Kodieren ${Math.round(f.timings.encodeMs)} · ${f.timings.thread} · ${(f.sizeBytes / 1e6).toFixed(1)} MB`;
        return f.timings.totalMs;
      });
      out.push([`Bildexport PNG ${resolution} (${detail})`, ms(t)]);
    }

    // Video export 10 s (+2 s hold), Detail colour; single run each (long).
    for (const resolution of ['1080p', '2048', '4096'] as const) {
      const f = await exportCreationVideo({ source, settings: { resolution, durationMs: 10_000, fps: 30 } });
      out.push([
        `Video ${resolution} ${f.size.width}×${f.size.height}, ${f.timings.frameCount} Frames, ${f.mimeType}`,
        `${ms(f.timings.totalMs)} (Frames ${ms(f.timings.frameRenderMs)}, Ø ${f.timings.averageFrameMs.toFixed(2)} ms/Frame, Encoding ${ms(f.timings.encodeMs)}, ${(f.sizeBytes / 1e6).toFixed(1)} MB)`,
      ]);
    }
    return out;
  }, RUNS);
  const table = ['| Messung | Ergebnis |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
  console.log(`\n${table}\n`);
  if (process.env.BENCH_OUT) await writeFile(process.env.BENCH_OUT, `${table}\n`);
});
