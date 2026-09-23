import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

/**
 * Regression over ten realistic motifs (drawn in the browser, not stored in
 * the repo): analysis → Minimal/Balanced/Detail → determinism → black/colour
 * → animation → export → save/load. Checks invariants, not artistic taste;
 * profiles are never tuned from here. Set QA_SHEET_DIR to also write contact
 * sheets (Minimal | Balanced | Detail) for visual review.
 */
const MOTIFS = [
  ['portrait', 900, 1200, true],
  ['landscape', 1600, 900, true],
  ['high-contrast', 1200, 900, false],
  ['dark', 1200, 800, false], // dim, nearly neutral colours: the line takes little colour by nature
  ['bright', 1200, 800, true],
  ['complex', 1400, 1000, true],
  ['low-structure', 1000, 800, true],
  ['square', 1000, 1000, true],
  ['tall', 800, 1400, true],
  ['panorama', 2000, 800, true],
] as const;

for (const [motif, width, height, colourful] of MOTIFS) {
  test(`realistic motif: ${motif} ${width}×${height}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    const r = await page.evaluate(
      async ({ motif, width, height }) => {
        const core = await import('/src/core/index.ts' as string);
        const { bitmapDecoder } = await import('/src/platform/browser/bitmapDecoder.ts' as string);
        const { runAnalysis } = await import('/src/platform/browser/analysisRunner.ts' as string);
        const { runPathGeneration } = await import('/src/platform/browser/pathRunner.ts' as string);
        const { renderArtworkSurface, freeSurface } = await import('/src/platform/browser/artworkRenderer.ts' as string);
        const { createArtworkAnimator } = await import('/src/platform/browser/animation/artworkAnimator.ts' as string);
        const { exportArtworkImage } = await import('/src/platform/browser/export/imageExporter.ts' as string);
        const { createIndexedDbBackend } = await import('/src/platform/browser/storage/indexedDbBackend.ts' as string);

        // ---- draw the motif --------------------------------------------------
        const c = new OffscreenCanvas(width, height);
        const x = c.getContext('2d')!;
        let seed = 11;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const grad = (a: string, b: string, vertical = true) => {
          const g = vertical ? x.createLinearGradient(0, 0, 0, height) : x.createLinearGradient(0, 0, width, 0);
          g.addColorStop(0, a);
          g.addColorStop(1, b);
          x.fillStyle = g;
          x.fillRect(0, 0, width, height);
        };
        const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string) => {
          x.fillStyle = fill;
          x.beginPath();
          x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          x.fill();
        };
        const W = width, H = height;
        switch (motif) {
          case 'portrait':
            grad('#9fb4c8', '#46566b');
            ellipse(W / 2, H * 0.42, W * 0.3, H * 0.3, '#2b1d14'); // hair
            ellipse(W / 2, H * 0.47, W * 0.23, H * 0.25, '#e2b797'); // face
            ellipse(W * 0.41, H * 0.42, W * 0.035, H * 0.018, '#1f1a17');
            ellipse(W * 0.59, H * 0.42, W * 0.035, H * 0.018, '#1f1a17');
            ellipse(W / 2, H * 0.6, W * 0.07, H * 0.015, '#9c4a45');
            x.fillStyle = '#35465e';
            x.fillRect(W * 0.2, H * 0.78, W * 0.6, H * 0.22);
            break;
          case 'landscape':
            grad('#8cc2ec', '#f2d9b0');
            x.fillStyle = '#5d6b7a';
            x.beginPath();
            x.moveTo(0, H * 0.65);
            for (let i = 0; i <= 12; i++) x.lineTo((W * i) / 12, H * (0.35 + 0.25 * rnd()));
            x.lineTo(W, H);
            x.lineTo(0, H);
            x.fill();
            x.fillStyle = '#3f7d4d';
            x.fillRect(0, H * 0.72, W, H * 0.28);
            for (let i = 0; i < 40; i++) ellipse(rnd() * W, H * (0.7 + rnd() * 0.25), 12 + rnd() * 18, 30 + rnd() * 40, '#23452b');
            break;
          case 'high-contrast':
            x.fillStyle = '#fff';
            x.fillRect(0, 0, W, H);
            x.fillStyle = '#000';
            for (let i = 0; i < 14; i++) x.fillRect(rnd() * W, rnd() * H, 40 + rnd() * 260, 10 + rnd() * 90);
            ellipse(W * 0.5, H * 0.5, W * 0.18, W * 0.18, '#000');
            ellipse(W * 0.5, H * 0.5, W * 0.1, W * 0.1, '#fff');
            break;
          case 'dark':
            grad('#0d0f14', '#1d2129');
            ellipse(W * 0.35, H * 0.55, W * 0.14, H * 0.25, '#3b3024');
            ellipse(W * 0.7, H * 0.4, W * 0.08, W * 0.08, '#6b5a33');
            x.fillStyle = '#2a2f3a';
            x.fillRect(W * 0.1, H * 0.8, W * 0.8, H * 0.05);
            break;
          case 'bright':
            grad('#fbfbf8', '#eceee9');
            ellipse(W * 0.4, H * 0.5, W * 0.16, H * 0.22, '#dcd3c3');
            ellipse(W * 0.66, H * 0.45, W * 0.1, W * 0.1, '#d6dde6');
            x.strokeStyle = '#c9c4ba';
            x.lineWidth = 6;
            x.strokeRect(W * 0.15, H * 0.2, W * 0.7, H * 0.6);
            break;
          case 'complex':
            grad('#c9c1b3', '#5a5147');
            for (let i = 0; i < 180; i++) ellipse(rnd() * W, rnd() * H, 4 + rnd() * 60, 4 + rnd() * 60, `hsl(${rnd() * 360},${30 + rnd() * 50}%,${15 + rnd() * 70}%)`);
            x.strokeStyle = '#111';
            for (let i = 0; i < 60; i++) {
              x.lineWidth = 1 + rnd() * 4;
              x.beginPath();
              x.moveTo(rnd() * W, rnd() * H);
              x.lineTo(rnd() * W, rnd() * H);
              x.stroke();
            }
            break;
          case 'low-structure': {
            grad('#b8c4cf', '#c7cfd6', false);
            const img = x.getImageData(0, 0, W, H);
            for (let i = 0; i < img.data.length; i += 4) {
              const n = (rnd() - 0.5) * 6;
              for (let k = 0; k < 3; k++) img.data[i + k] = img.data[i + k]! + n;
            }
            x.putImageData(img, 0, 0);
            break;
          }
          case 'square':
            grad('#e8efe0', '#b9cfa7');
            for (let i = 0; i < 12; i++) {
              const a = (i / 12) * Math.PI * 2;
              ellipse(W / 2 + Math.cos(a) * W * 0.18, H / 2 + Math.sin(a) * H * 0.18, W * 0.1, W * 0.1, '#d9485f');
            }
            ellipse(W / 2, H / 2, W * 0.12, W * 0.12, '#f2c14e');
            break;
          case 'tall':
            grad('#9ec7e8', '#e9eef2');
            x.fillStyle = '#6f6a64';
            x.fillRect(W * 0.25, H * 0.15, W * 0.5, H * 0.85);
            x.fillStyle = '#2d3640';
            for (let r = 0; r < 14; r++) for (let col = 0; col < 4; col++) x.fillRect(W * (0.3 + col * 0.11), H * (0.2 + r * 0.055), W * 0.06, H * 0.03);
            break;
          case 'panorama':
            grad('#ffcf9a', '#6d8fb3');
            x.fillStyle = '#1e2733';
            x.beginPath();
            x.moveTo(0, H);
            for (let i = 0; i <= 40; i++) x.lineTo((W * i) / 40, H * (0.55 + 0.3 * rnd()));
            x.lineTo(W, H);
            x.fill();
            break;
        }
        const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
        const fileBytes = new Uint8Array(await blob.arrayBuffer());

        // ---- import + analysis ----------------------------------------------
        const imported = await core.importImage(blob, { decoder: bitmapDecoder, createId: () => `qa-${motif}` });
        const { analysis } = await runAnalysis(imported.processed).promise;
        const pixelsBefore: Uint8ClampedArray = imported.processed.pixels.data.slice();

        // ---- three levels ----------------------------------------------------
        const hash = (a: Float32Array) => {
          let h = 2166136261;
          const u = new Uint32Array(a.buffer, a.byteOffset, a.length);
          for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i]!, 16777619);
          return h >>> 0;
        };
        const levels: Record<string, { points: number; length: number; valid: boolean; high: number; other: number; hash: number; ms: number }> = {};
        const paths: Record<string, import('../src/core').OneLinePath> = {};
        for (const level of ['minimal', 'balanced', 'detail'] as const) {
          const eff = core.resolveOneLineSettings({ detailLevel: level });
          const out = await runPathGeneration(imported.processed, analysis, eff.settings, eff.parameters).promise;
          paths[level] = out.path;
          const rep = out.metrics.representation;
          levels[level] = {
            points: out.metrics.pointCount,
            length: out.metrics.length,
            valid: core.validateOneLinePath(out.path).valid,
            high: rep?.highImportanceDensity ?? 0,
            other: rep?.otherDensity ?? 0,
            hash: hash(out.path.coords),
            ms: Math.round(out.durationMs),
          };
        }
        // Determinism: same image + settings + seed ⇒ identical path.
        const eff = core.resolveOneLineSettings({ detailLevel: 'balanced' });
        const again = (await runPathGeneration(imported.processed, analysis, eff.settings, eff.parameters).promise).path;
        const deterministic = hash(again.coords) === levels.balanced!.hash;

        // ---- rendering, animation, export (the path must not change) ---------
        const path = paths.balanced!;
        const black = core.sanitizeRenderSettings({}).value;
        const colour = core.sanitizeRenderSettings({ colorMode: 'sampled-color' }).value;
        const chroma = (settings: typeof black) => {
          const r = renderArtworkSurface({ path, settings, longEdge: 1024, image: imported.processed.pixels });
          const { data } = r.surface.ctx.getImageData(0, 0, r.size.width, r.size.height);
          let line = 0, coloured = 0;
          for (let i = 0; i < data.length; i += 4 * 3) {
            const [rr, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
            if (rr + g + b > 600) continue;
            line++;
            if (Math.max(rr, g, b) - Math.min(rr, g, b) > 30) coloured++;
          }
          freeSurface(r.surface);
          return line ? coloured / line : 0;
        };
        const chromaBlack = chroma(black);
        const chromaColour = chroma(colour);

        const animator = createArtworkAnimator({ path, settings: colour, longEdge: 1024, image: imported.processed.pixels });
        const target = new OffscreenCanvas(animator.size.width, animator.size.height).getContext('2d')! as unknown as CanvasRenderingContext2D;
        for (let k = 0; k <= 30; k++) animator.renderAt(target, k / 30);
        const frame = target.getImageData(0, 0, animator.size.width, animator.size.height).data;
        const still = renderArtworkSurface({ path, settings: colour, longEdge: 1024, image: imported.processed.pixels });
        const ref = still.surface.ctx.getImageData(0, 0, animator.size.width, animator.size.height).data;
        let finalDiff = 0;
        for (let i = 0; i < ref.length; i++) finalDiff = Math.max(finalDiff, Math.abs(ref[i]! - frame[i]!));
        animator.dispose();
        freeSurface(still.surface);

        const source = { path, render: colour, image: imported.processed.pixels, backgroundImage: null, originalSize: { width: imported.original.metadata.width, height: imported.original.metadata.height }, projectName: motif };
        const png = await exportArtworkImage({ source, settings: { format: 'png', resolution: '2048' } });
        const pngBitmap = await createImageBitmap(png.data);

        // ---- save + load ------------------------------------------------------
        const repo = core.createProjectRepository(createIndexedDbBackend());
        const project = core.assembleProject({
          id: `qa-project-${motif}`,
          name: motif,
          createdAt: null,
          now: new Date(),
          image: imported.original,
          oneLine: eff,
          path,
          render: colour,
          animation: core.DEFAULT_ANIMATION_SETTINGS,
        });
        await repo.save(project, null);
        const loaded = await repo.load(project.id);
        const originalBytes = new Uint8Array(await loaded.project.image.source.slice(0).arrayBuffer());

        // ---- optional contact sheet ------------------------------------------
        const sheet = new OffscreenCanvas(3 * 400, Math.round((400 * path.bounds.height) / path.bounds.width));
        const sctx = sheet.getContext('2d')!;
        (['minimal', 'balanced', 'detail'] as const).forEach((level, i) => {
          const rr = renderArtworkSurface({ path: paths[level]!, settings: black, longEdge: 800, image: imported.processed.pixels });
          sctx.drawImage(rr.surface.canvas as OffscreenCanvas, i * 400, 0, 400, sheet.height);
          freeSurface(rr.surface);
        });
        const sheetBytes = new Uint8Array(await (await sheet.convertToBlob({ type: 'image/png' })).arrayBuffer());
        let sheetBinary = '';
        for (let i = 0; i < sheetBytes.length; i += 0x8000) sheetBinary += String.fromCharCode(...sheetBytes.subarray(i, i + 0x8000));

        return {
          levels,
          deterministic,
          chromaBlack,
          chromaColour,
          finalDiff,
          exportSize: [pngBitmap.width, pngBitmap.height, png.timings.thread],
          pathAfter: hash(path.coords) === levels.balanced!.hash,
          loadedSame: hash(loaded.project.path.coords) === levels.balanced!.hash,
          originalSame: originalBytes.length === fileBytes.length && originalBytes.every((v, i) => v === fileBytes[i]),
          pixelsSame: pixelsBefore.every((v: number, i: number) => v === imported.processed.pixels.data[i]),
          processed: [imported.processed.pixels.width, imported.processed.pixels.height],
          sheet: btoa(sheetBinary),
        };
      },
      { motif, width, height },
    );
    if (process.env.QA_SHEET_DIR) await writeFile(`${process.env.QA_SHEET_DIR}/${motif}.png`, Buffer.from(r.sheet, 'base64'));
    console.log(motif, JSON.stringify(r.levels));

    const { minimal, balanced, detail } = r.levels as Record<'minimal' | 'balanced' | 'detail', { points: number; length: number; valid: boolean; high: number; other: number }>;
    for (const l of [minimal, balanced, detail]) expect(l.valid).toBe(true);
    // Detail levels: clearly ordered amount of line.
    expect(minimal.length).toBeLessThan(balanced.length);
    expect(balanced.length).toBeLessThan(detail.length);
    expect(minimal.points).toBeLessThan(detail.points);
    // Important areas get more line than the rest (not for a motif without structure).
    if (motif !== 'low-structure') for (const l of [minimal, balanced, detail]) expect(l.high).toBeGreaterThan(l.other);
    expect(r.deterministic).toBe(true);
    // Black stays black; colour takes colours where the photo has them.
    expect(r.chromaBlack).toBeLessThan(0.01);
    if (colourful && motif !== 'low-structure' && motif !== 'bright') expect(r.chromaColour).toBeGreaterThan(0.05);
    // Animation ends exactly on the static artwork.
    expect(r.finalDiff).toBe(0);
    // Export: exact long edge + aspect ratio, rendered in the worker.
    const [ew, eh, thread] = r.exportSize as [number, number, string];
    expect(Math.max(ew, eh)).toBe(2048);
    expect(Math.abs(ew / eh - width / height)).toBeLessThan(0.01);
    expect(thread).toBe('worker');
    // Nothing touched the path, the working copy or the stored original.
    expect(r.pathAfter).toBe(true);
    expect(r.loadedSame).toBe(true);
    expect(r.originalSame).toBe(true);
    expect(r.pixelsSame).toBe(true);
  });
}
