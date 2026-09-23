# Architektur – One Line

## Ausgangslage (Analyse Teil 1)

Das Repository war vollständig leer (keine Commits, keine Dateien). Es gab kein
bestehendes Framework, keine Assets, keine Tests. Die Grundlage wurde daher neu
aufgesetzt.

## Technische Entscheidungen

| Thema | Entscheidung | Begründung |
|---|---|---|
| Plattform | Web-App / PWA (später optional Capacitor für iOS/Android) | Schnelle Iteration, Canvas/WebCodecs für Rendering und Video, voll testbar in CI |
| Sprache | TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) | Typsichere Modelle für die Kernlogik |
| Build | Vite | Schnell, Standard für React/TS |
| UI | React 19 | Verbreitet, gute Komponentenbasis |
| Tests | Vitest (Node-Umgebung) | Kernlogik ohne Browser testbar |
| Lint | ESLint + typescript-eslint | inkl. Import-Sperre für `src/core` |
| Engine-Trennung | Ordner `src/core`, kein separates Paket | Einfacher; später extrahierbar |

## Schichten

```
src/
  app/              Screens, App-Shell                    (React)
  ui/               Wiederverwendbare Komponenten, Theme  (React)
  platform/         Browser-Adapter (Canvas; später Datei-Import, IndexedDB, Video)
  core/             UI- und plattformfreie Kernlogik
    models/           Datenmodelle
    utils/            Seeded RNG, Hashing, Mathe
    imageImport/      Schnittstelle ImageImporter             (Impl. Teil 2, in platform/)
    imageProcessing/  ImageOperation + applyOperations        (Operationen ab Teil 2)
    imageAnalysis/    ImageAnalyzer, ImageAnalysis/Importance (Impl. Teil 3)
    engine/           OneLinePath-API, Generator-/Optimizer-Schnittstellen, Pipeline
    rendering/        PathCursor, tracePath, SVG-Rendering
    animation/        AnimationTimeline (Zeit -> Position auf dem echten Pfad)
    export/           Exporter-Schnittstellen                 (Impl. Teil 8)
    storage/          ProjectRepository + In-Memory-Impl.     (IndexedDB Teil 8)
tests/
  core/             Unit-Tests der Kernlogik
  architecture/     Prüft, dass core keine UI-/Browser-/Zufalls-Abhängigkeiten hat
```

Abhängigkeitsrichtung: `app → ui → platform → core`. **`core` importiert nichts
aus den anderen Schichten.** Das wird dreifach abgesichert:

1. `tsconfig.core.json` kompiliert `src/core` **ohne DOM-Typen** – jede Browser-API ist ein Compilerfehler.
2. ESLint `no-restricted-imports` für `src/core/**`.
3. `tests/architecture/coreIsolation.test.ts` (auch gegen `Math.random`, `Date.now`, `window`, `document`).

## Pipeline

```
OriginalImage.pixels
  → preprocess (ImageOperation[])
  → ImageAnalyzer.analyze          → ImageAnalysis { importance }
  → OneLinePathGenerator.generate  → OneLinePath
  → PathOptimizer[]
  → validatePath
  → Rendering (SVG / Canvas)  und  Animation (Timeline)
```

`runOneLinePipeline` (`src/core/engine/pipeline.ts`) orchestriert das. Jede Stufe
erhält einen eigenen, per Label abgeleiteten RNG-Strom (`rng.fork('generate')` …),
damit eine Änderung in einer Stufe die Zufallsfolge anderer Stufen nicht verschiebt.

## Kernmodell OneLinePath

- Genau **ein** Koordinatenpuffer `Float32Array [x0,y0,x1,y1,…]` → per Konstruktion
  eine zusammenhängende Linie, Teilstücke sind im Modell nicht darstellbar.
- Index-Reihenfolge = Zeichenreihenfolge.
- Kompakt für sehr viele Punkte (500 000 Punkte ≈ 4 MB).
- `meta` enthält Generator-ID, Generator-Version und Seed (Reproduzierbarkeit).

## Rendering = Animation

Finales Bild und jedes Animationsframe laufen durch **dieselbe** Funktion
(`tracePath` mit einem `PathCursor`). Das finale Bild ist der Cursor am Pfadende;
ein Frame ist ein Präfix des Pfads plus Teilsegment. Eine „Fake-Animation“ ist damit
architektonisch ausgeschlossen. Getestet: letztes Frame == finales Bild.

## Determinismus

Gleiches Bild + gleiche `OneLineSettings` (inkl. `seed`) + gleiche Generator-Version
⇒ identischer Pfad. Sämtlicher Zufall kommt aus `createRandom(seed)` (mulberry32).
`OriginalImage.contentHash` ist für Cache-/Reproduktionsschlüssel vorgesehen.

## Platzhalter (werden ersetzt)

- `uniformAnalyzer` → echte Bildanalyse in Teil 3
- `placeholderGenerator` (Random Walk, ignoriert den Bildinhalt) → One-Line-Algorithmus in Teil 4
- Die Pfad-Vorschau auf dem Startscreen erscheint nur im Dev-Modus.
