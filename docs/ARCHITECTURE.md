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
  platform/         Browser-Adapter (Bild-Decoder, Analyse- und Pfad-Worker, Artwork-Renderer, Animation, Export, IndexedDB)
  core/             UI- und plattformfreie Kernlogik
    models/           Datenmodelle
    utils/            Seeded RNG, Hashing, Mathe
    imageImport/      Formaterkennung, Header/EXIF, Import-Ablauf, Import-Status (Teil 2)
    imageProcessing/  ImageOperation, fitWithin/orientedSize
    imageAnalysis/    Bildanalyse: Luminanz, Kontrast, Kanten, Detail, Textur, Importance (Teil 3)
    engine/           OneLinePath-API, Pipeline, Validierung, Metriken
      oneLine/          One-Line-Engine (Teil 4), Parametergrenzen (Teil 5)
    drawing/          Detailstufen, Zeichenoptionen, effektive Einstellungen (Teil 5)
    rendering/        PathCursor, tracePath, SVG, Render-Einstellungen, Farb-Sampling, Renderer (Teil 6)
    animation/        AnimationTimeline (Zeit -> Position auf dem echten Pfad)
    export/           Export-Einstellungen, -Größen, -Status, Dateinamen, Video-Frameplan, Encoder-Port (Teil 8)
    storage/          Projektformat, Validierung/Migration, ProjectRepository über Storage-Port (Teil 8)
tests/
  core/             Unit-Tests der Kernlogik (Node, Vitest)
  ui/               Unit-Tests reiner UI-Logik (Zoom/Pan)
  fixtures/         Byte-genaue Bild-Header (JPEG+EXIF, PNG, WebP, HEIC …)
  architecture/     Prüft, dass core keine UI-/Browser-/Zufalls-Abhängigkeiten hat
e2e/                Playwright-Tests im echten Chromium (echte Dateien, Pixelprüfung)
```

Abhängigkeitsrichtung: `app → ui → platform → core`. **`core` importiert nichts
aus den anderen Schichten.** Das wird dreifach abgesichert:

1. `tsconfig.core.json` kompiliert `src/core` **ohne DOM-Typen** – jede Browser-API ist ein Compilerfehler.
2. ESLint `no-restricted-imports` für `src/core/**`.
3. `tests/architecture/coreIsolation.test.ts` (auch gegen `Math.random`, `Date.now`, `window`, `document`).

## Pipeline

```
ProcessedImage.pixels
  → preprocess (ImageOperation[])
  → ImageAnalyzer.analyze          → ImageAnalysis (alle Ebenen, siehe Teil 3)
  → generateOneLinePath            → OneLinePath   (Übergabepunkt an die Engine)
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

- `uniformAnalyzer` bleibt als Test-Stand-in; die echte Analyse ist `standardAnalyzer` (Teil 3)
- Der `placeholderGenerator` aus Teil 1 wurde in Teil 4 durch `oneLineGenerator` ersetzt
- Die Dev-Vorschau des Platzhalterpfads auf dem Startscreen wurde in Teil 2 durch den Bildimport ersetzt; `PathPreview`/`canvasRenderer` bleiben für Teil 4 erhalten.

## Bildimport (Teil 2)

```
File (unverändert, = OriginalImage.source)
  → Größenprüfung (Datei)                     core/imageImport/importImage.ts
  → Formaterkennung per Signatur              core/imageImport/formatDetection.ts
  → Header: Abmessungen + EXIF-Orientierung   core/imageImport/imageHeader.ts
  → Pixel-Limit (vor dem Dekodieren)
  → Content-Hash (in 4-MB-Blöcken)
  → EIN Decode, Orientierung angewendet       platform/browser/bitmapDecoder.ts
  → Vorschau-Bitmap (≤ 4096 px) + Verarbeitungskopie (≤ 2048 px, RGBA)
  → Voll-Decode sofort freigegeben
```

- **OriginalImage** hält nur eine Referenz auf die Originaldatei plus Metadaten
  (Format, Abmessungen aufrecht, Seitenverhältnis, Orientierung, Dateigröße, Hash).
  Es wird nie verändert und nie komplett in den Speicher kopiert.
- **ProcessedImage** ist die normalisierte Arbeitskopie: aufrecht, sRGB-RGBA,
  Seitenverhältnis erhalten, kein Hochskalieren, Farben unverändert.
  `processingMaxEdge = 2048` ist **vorläufig** und wird mit dem Algorithmus (Teil 4/5) festgelegt.
- **Vorschau** ist ein separates, bildschirmtaugliches Bitmap. Zoom/Pan ist reine Darstellung
  (`ui/viewport/viewTransform.ts`) und berührt die Verarbeitungsdaten nicht.
- **Status**: `importReducer` (EMPTY → LOADING → PROCESSING → READY | ERROR).
  Jeder Import hat eine `requestId`; Ergebnisse überholter Importe werden verworfen und freigegeben.
- **ImageSession** bündelt alles, was aus einem Bild entsteht (Original, Arbeitskopie, Vorschau,
  später Analyse und Pfad). Ein Bildwechsel ersetzt die Session komplett; `belongsToSession`
  ordnet spätere Ergebnisse über `original.id` eindeutig zu.
- **Speicher**: `useImageImport` gibt das Vorschau-Bitmap bei Wechsel, Entfernen und Unmount frei;
  temporäre Canvas-Flächen werden sofort auf 0×0 gesetzt (wichtig für iOS Safari).

### Grenzen / Plattform

| Thema | Verhalten |
|---|---|
| Formate | JPG, PNG, WebP; HEIC/HEIF, wenn der Browser es dekodiert (Safari ja, Chrome/Firefox nein → verständliche Meldung) |
| Dateigröße | max. 80 MB |
| Auflösung | max. 100 MP (Prüfung vor dem Dekodieren, sofern der Header es verrät) |
| EXIF | Vom Browser via `createImageBitmap(…, { imageOrientation: 'from-image' })` angewendet |
| Farben | Arbeitskopie in sRGB; Originaldatei (z. B. Display-P3) bleibt unverändert erhalten |
| Kamera | `capture`-Input, nur auf Touch-Geräten angeboten |

## Bildanalyse (Teil 3)

### Datenfluss

```
OriginalImage (Datei, unverändert)
  │ Teil 2: ein Decode
  ▼
ProcessedImage.pixels (≤ 2048 px, RGBA, unverändert)
  │ Kopie in einen Web Worker (platform/browser/analysisRunner.ts)
  ▼
analyzeProcessedImage (core/imageAnalysis/analyzeImage.ts, rein & deterministisch)
  1. Luminanz: CIE L* aus linearem sRGB, gleichzeitig Flächenmittelung auf das
     Analyseraster (≤ analysisMaxEdge = 1024 px, Seitenverhältnis exakt, kein Crop)
  2. Leichte Gauß-Glättung (σ = 1 px) nur für abgeleitete Ebenen
  3. contrast  = lokale Standardabweichung (Box-Fenster, Float64)
     edge      = Scharr-Gradientenbetrag
     detail    = Anteil „signifikanter“ Gradienten im Fenster (weiche Schwelle)
     texture   = Strukturtensor: Energie · (1 − Kohärenz)
  4. localImportance  = Σ wᵢ · Ebeneᵢ (Luminanz als Dunkelheit 1 − L)
  5. globalRelevance  = Regionsdichte (stark geglättete lokale Importance)
                        + Figur/Grund (Center-Surround der Luminanz)
  6. importance       = (1 − globalBlend) · lokal + globalBlend · global
  ▼
ImageAnalysis { width, height, luminance, contrast, edge, detail, texture,
                localImportance, globalRelevance, importance, meta }
  │ Übertragung der Ebenen-Puffer (transfer, keine Kopie)
  ▼
ImageSession.analysis  ──►  generateOneLinePath(config, { image, analysis }, settings)  (Teil 4)
```

### Normalisierung
Jede abgeleitete Ebene: `min(raw / max(p99(raw), floor), 1)`. Das Perzentil macht die
Karte robust gegen einzelne Ausreißer, die Untergrenze (`normalizationFloors`) verhindert,
dass Rauschen in flachen Bildern auf volle Skala verstärkt wird. Luminanz ist absolut
(L*/100), wird also nicht pro Bild gestreckt. Die verwendeten Referenzen stehen in
`meta.normalization`.

### Parameter und Version
`AnalysisParameters` (core/imageAnalysis/parameters.ts) enthält **alle** Stellschrauben:
Analyseauflösung, Glättung, Fenstergrößen (relativ zur Kantenlänge), Schwellen,
Normalisierung, lokale und globale Gewichte, Blend. `withAnalysisParameters` erzeugt
Varianten (Grundlage für die Detailstufen in Teil 5). Jede Analyse speichert
`meta.algorithmVersion` (`ANALYSIS_ALGORITHM_VERSION`) und die verwendeten Parameter.

### Kopplung an das Bild
- `ImageSession.analysisStatus`: pending → running → ready | failed (mit Retry).
- Ergebnisse werden nur akzeptiert, wenn `imageId` **und** `meta.sourceImageId` zur Session passen
  und `meta.sourceSize` der Arbeitskopie entspricht. Ein Bildwechsel ersetzt die Session
  und beendet den laufenden Worker.

### Developer-Ansicht
`?debug=analysis` zeigt alle Ebenen einzeln (Graustufen oder Heatmap) mit Zoom, Statistik,
Normalisierungsreferenz, Laufzeit und Runner. Nicht Teil der normalen Oberfläche.

### Bekannte Grenzen
| Thema | Stand |
|---|---|
| Laufzeit | ≈ 0,6–0,9 s für 1024×768 (Desktop-Chromium, im Worker); auf Smartphones voraussichtlich 2–4× länger |
| Speicher | 8 Float32-Ebenen ≈ 25 MB bei 1024×768 |
| Determinismus | Bit-identisch auf derselben JS-Engine; `Math.cbrt`/`Math.exp` können zwischen Engines im letzten Bit abweichen |
| Semantik | Keine Objekterkennung (z. B. Gesichter); „globale Relevanz“ ist rein bildstatistisch |
| Normalisierung | Relativ pro Bild (mit Untergrenzen) – Werte sind innerhalb eines Bildes vergleichbar, zwischen Bildern nur eingeschränkt |

## One-Line-Engine (Teil 4)

### Datenfluss

```
OriginalImage ─(Teil 2)─► ProcessedImage.pixels (≤ 2048 px)
  ─(Teil 3, Worker)─► ImageAnalysis { importance, globalRelevance, luminance, … }
  ─(Teil 4, Worker)─► generateOneLine(input, parameters, { rng: seed, shouldAbort })
       1. Nachfragefeld   demandField.ts        Importance + Tonwert + globale Relevanz → Liniendichte
       2. Nachfragepunkte stippling.ts          geschichtete Stichprobe (Seed) + gewichtete Lloyd-Relaxation
       3. Start           generateOneLine.ts    Punkt mit max. globaler Relevanz × Nachfrage
       4. Startroute      tour.ts               geschlossene Moore-Kurve, am Start geöffnet (keine Sprünge)
       5. Optimierung     tour.ts               2-opt: konturbewusste Länge + Krümmungsstrafe
                          orientationField.ts   Strukturtensor → Konturrichtung und -stärke
       6. Geometrie       geometry.ts           Bildkoordinaten, Chaikin-Glättung, Douglas–Peucker
       7. Validierung     ../validation.ts      ein Strich, endlich, im Bild, keine Sprünge, renderbar
  ─► OneLinePath (ein Koordinatenpuffer, Reihenfolge = Zeichenreihenfolge)
  ─► ImageSession.path  →  Rendering (Teil 6) und Animation (Teil 7)
```

### Warum dieser Ansatz
Jeder Nachfragepunkt wird **genau einmal** besucht. Dadurch kann die Linie nicht in
einem Bereich hängen bleiben, jede Region bekommt die ihr zustehende Linienmenge,
und die Verbindungen zwischen Regionen entstehen aus derselben Routenoptimierung
wie die Details. Kanten bestimmen die Geometrie nicht direkt: Sie erhöhen die
Dichte (über die Importance) und machen es teurer, eine Kontur zu **queren** als ihr
zu **folgen**. Konturen treten so als Linienzüge aus der Mäanderfläche hervor.

### Abdeckungsmodell
Nachfragepunkte sind die Einheiten der Linien-Nachfrage (unberührt → besucht).
Für Metriken misst `coverage.ts` pro Zelle abgegebene vs. benötigte Linienlänge
(unberührt / teilweise / ausreichend).

### Parameter (`engine/oneLine/parameters.ts`)
| Gruppe | Parameter |
|---|---|
| Arbeitsraster | `workingMaxEdge`, `minPixelsPerDensePoint`, `maxWorkingEdge` |
| Nachfrage | `toneWeight`, `globalModulation`, `demandGamma`, `demandFloor`, `importanceReferencePercentile` |
| Linienbudget | `pointBudget` (min/max, über `settings.detail`), `settings.maxPoints` |
| Stippling | `relaxationIterations` |
| Pfadoptimierung | `neighborCount`, `contourAlignment`, `contourScale`, `curvaturePenalty`, `maxMovesPerPoint` |
| Geometrie | `smoothingIterations`, `smoothingRatio`, `simplificationTolerance` (bei 2048 px, skaliert) |
| Sicherheit | `maxSegmentFraction`, `maxZeroLengthShare`, Zeitlimit im Worker (60 s) |

Version: `ONE_LINE_ENGINE_VERSION`; der Pfad speichert Generator, Version, Seed und `sourceImageId`.

### Validierung (`engine/validation.ts`)
1. ≥ 2 Punkte · 2. ein Koordinatenpuffer mit Herkunft · 3. alle Werte endlich ·
4. alle Punkte im Bild · 5. keine ungültigen Segmente · 6. Länge > 0 ·
7. keine Sprünge (Segment ≤ max(Anteil der Diagonale, 4 × Punktabstand im dünnsten Bereich)) ·
8. höchstens 1 % Null-Längen-Segmente · 9. renderbar als genau ein `moveTo` + n−1 `lineTo`.

### Debug
`?debug=analysis` → „Pfad berechnen“, Overlays (Pfad / Pfad + Original / Pfad + Importance)
und Metriken: Länge, Punkte, Segmente, Ø/max. Segmentlänge, Ø Krümmung, Selbstkreuzungen,
Bounding Box, Start/Ende, Importance-Abdeckung, Laufzeit, interne Zähler, Parameter, Version.

### Bekannte Grenzen
| Thema | Stand |
|---|---|
| Laufzeit | ≈ 1,2–1,6 s (Fotos) bis ≈ 2,6 s (stark konzentrierte Motive) im Desktop-Chromium-Worker; mobil voraussichtlich 2–4× |
| Stil | Der Charakter ist „Mäander/TSP-Art“: Ton entsteht über Liniendichte; feine Details < ~2 Punktabstände gehen verloren |
| Semantik | keine Gesichts-/Objekterkennung; Motivtreue hängt an Tonwert + Konturen |
| Kreuzungen | werden durch 2-opt meist aufgelöst (wenige verbleiben, wo Entwirren scharfe Knicke erzwänge) |
| Determinismus | bitgleich auf derselben JS-Engine (siehe Teil 3) |

## Detailstufen und Zeichenparameter (Teil 5)

### Datenfluss

```
OriginalImage
  → ImageAnalysis                      (einmal pro Bild, unabhängig vom Detailgrad)
  → DrawingSettings                    Detailstufe, Seed, [Liniencharakter, Kreuzungen, Startpunkt], Overrides
  → resolveOneLineSettings()           Engine-Defaults ← DetailProfile ← Optionen ← Overrides → Grenzen prüfen
  → EffectiveOneLineSettings           settings + parameters + Engine-Version + stabiler Schlüssel
  → generateOneLine(analysis, …)       Engine aus Teil 4, direkt aufrufbar wie bisher
  → OneLinePath                        im Session-Cache unter dem Schlüssel
```

Ein Wechsel der Detailstufe erzeugt nur einen neuen Schlüssel: Die Analyse wird wiederverwendet,
berechnete Pfade werden pro Schlüssel zwischengespeichert (Zurückwechseln ist sofort).
Ein Pfad gilt nur als aktuell, wenn sein Schlüssel der aktuellen Konfiguration entspricht.

### Profile (`drawing/detailLevels.ts`, einzige Definitionsstelle)
| | Minimal | Balanced (Standard) | Detail |
|---|---|---|---|
| Detailachse → Nachfragepunkte | 0,2 → 11 200 | 0,5 → 22 000 | 1,0 → 40 000 |
| `demandSmoothing` (kleine Strukturen) | 0,006 (unterdrückt) | 0 | 0 |
| `globalModulation` (große vs. kleine Formen) | 0,35 | 0,15 | 0,05 |
| `toneWeight` (Tonwert vs. Struktur) | 0,7 | 0,6 | 0,4 |
| `demandGamma` / `demandFloor` | 3,2 / 0,006 | 2,6 / 0,01 | 3,0 / 0,01 |
| `importanceReferencePercentile` | 0,995 | 0,995 | 0,98 |
| Konturführung (`contourAlignment`/`contourScale`) | 3 / 2 | 3 / 2 | 3,5 / 1,5 |
| `curvaturePenalty` | 0,6 (ruhiger) | 0,35 | 0,25 |
| Glättung / Vereinfachung | 3 / 0,6 | 2 / 0,3 | 2 / 0,15 |

Balanced entspricht exakt den in Teil 4 kalibrierten Engine-Defaults.

### Vorbereitete Optionen (noch ohne UI)
- `lineCharacter`: calm | balanced | organic | dynamic — nur `balanced` verfügbar; die anderen sind
  als `null` markiert, bis sie kalibriert sind (Hebel: curvaturePenalty, contourAlignment, Glättung, neighborCount).
- `crossingStyle`: minimize | allow | encourage — nur `minimize` (Verhalten aus Teil 4). Kreuzungen können
  die One-Line-Eigenschaft nie gefährden, da der Pfad immer eine Punktfolge bleibt.
- `startPoint`: auto | fixed (normierte Koordinaten) — in der Engine bereits umgesetzt, UI folgt.
- `overrides`: beliebige Engine-Parameter für spätere Experten-Einstellungen.

### Parametervalidierung (`engine/oneLine/parameterLimits.ts`)
Eine Tabelle mit min/max/ganzzahlig für jeden Parameter und für Seed, Detail, maxPoints, Startpunkt.
NaN/Infinity/Nicht-Zahlen → `EngineError('invalid-parameters')`; Bereichsverletzungen werden begrenzt und
gemeldet; unmögliche Kombinationen (Budget min > max, maxWorkingEdge < workingMaxEdge) werden korrigiert.
Die Engine validiert bei jedem Aufruf.

### Projekt
`ArtworkProject.oneLine` speichert die `EffectiveOneLineSettings` (Detailstufe, Seed, effektive Parameter,
Engine-ID und -Version, Schlüssel) — ausreichend, um ein Werk zu reproduzieren. Persistenz: Teil 8.

### Laufzeiten (Desktop-Chromium, Produktionsbuild, Worker)
| Foto | Minimal | Balanced | Detail |
|---|---|---|---|
| Astronautin 512² | 1,1 s | 1,6 s | 2,7 s |
| Kaffeetasse 600×400 | 1,0 s | 1,6 s | 2,7 s |
| Rakete 640×427 | 1,2 s | 1,7 s | 2,8 s |
| Kameramann 256² | 1,4 s | 1,5 s | 3,2 s |

## Farbe und Rendering (Teil 6)

### Datenfluss

```
ProcessedImage.pixels ─┐
OneLinePath ───────────┼─► [core] sampleLineColors   (nur 'sampled-color', einmal pro Pfad, gecacht)
RenderSettings ────────┘   [core] planArtwork        Zielgröße prüfen, Linienbreite normieren, Farbabschnitte
                           [core] drawArtworkBackground / drawArtworkLine  (gegen RenderContext2D)
                           [platform] renderArtwork  Canvas/OffscreenCanvas → NEUES ImageBitmap + RenderMetrics
                           ► RasterArtwork (Original unverändert)
```

Render-only-Änderungen (Schwarz ↔ Farbe, Hintergrund, Breite, Deckkraft) zeichnen denselben Pfad neu;
die Engine wird dafür nie gestartet. Eine neue Detailstufe erzeugt einen neuen Pfad (ohne neue Analyse)
und danach ein neues Rendering.

### Eine Linie
`drawArtworkLine` zeichnet ausschließlich die Punkte der `OneLinePath` (über `tracePath` bzw. dieselbe
Punktfolge). Monochrom: ein `moveTo`, n−1 `lineTo`, ein `stroke`. Farbe: Canvas kann die Farbe innerhalb
eines Strichs nicht ändern, daher wird dieselbe Punktfolge in aufeinanderfolgenden Farbabschnitten
gezeichnet; jeder Abschnitt beginnt am letzten Punkt des vorherigen — kein Punkt wird hinzugefügt,
verschoben oder ausgelassen. Deckkraft wird einmal auf die ganze Linie angewendet (eigene Linienebene).
Über `PathCursor` zeichnet dieselbe Funktion später die Animationsframes (Teil 7).

### Render-Einstellungen (`rendering/renderSettings.ts`)
| Einstellung | Werte | UI in Teil 6 |
|---|---|---|
| `colorMode` | monochrome, sampled-color; vorbereitet: custom-color, gradient | Schwarz / Farbe |
| `lineColor` | beliebige #rgb/#rrggbb, Standard #000000 | – |
| `lineWidth` | px bei `REFERENCE_RENDER_EDGE` = 1000, skaliert mit der Renderkante | – |
| `lineOpacity` | 0…1, Standard 1 | – |
| `background` | white, black, original, transparent, custom | – (Standard white; original in der Entwickleransicht) |
| `sampling` | Stationsabstand, Radius, Ausreißer-Trim, Glättung, Stärke, Helligkeitsbereiche | – |

Validierung zentral (`sanitizeRenderSettings`): NaN/Infinity → `RenderError`, Bereiche begrenzt,
ungültige Farben/Modi → Standardwert (gemeldet). `RENDERER_VERSION` versioniert die Ausgabe.

### Farb-Sampling
1. Stationen in festem Abstand entlang der Bogenlänge (nicht an jedem Rohpunkt; nie dichter als die Glättung auflösen kann)
2. 5×5-Umgebung je Station (Radius ≥ 2 Bildpixel), über Weiß komponiert, in linearem Licht
3. getrimmter Mittelwert je Kanal (Ausreißer verworfen)
4. Gauß-Glättung des Farbverlaufs entlang der Linie
5. OKLab: Helligkeit auf lesbaren Bereich begrenzt (hell: 0,20–0,55; dunkler Hintergrund: 0,62–0,95), Chroma × Stärke
6. jeder Pfadpunkt erhält die Farbe seiner Station

### Auflösung
Processing (≤ 2048 px, Analyse/Engine) und Render-Auflösung sind getrennt: `renderArtwork({ path, settings,
longEdge })` rendert in jeder Größe bis 8192 px mit exakt erhaltenem Seitenverhältnis (verzerrende Zielgrößen
werden abgelehnt). Vorschau: `PREVIEW_RENDER_EDGE` = 2048.

### Laufzeiten (Desktop-Chromium, Pfad mit 51–120 Tsd. Punkten)
| | 1024 px | 2048 px | 4096 px |
|---|---|---|---|
| Rendering Balanced (Schwarz / Farbe) | 110 / 95–130 ms | 150–170 / 140–165 ms | 250–265 / 220–280 ms |
| Rendering Detail (Schwarz / Farbe) | 240–255 / 180–220 ms | 295–330 / 225–310 ms | 410–485 / 350–425 ms |
| Farb-Sampling (einmal pro Pfad) | 130 ms (Balanced), 180 ms (Detail) | | |
| Pfadberechnung (zum Vergleich) | 1,5–1,6 s (Balanced), 2,6–3,0 s (Detail) | | |

## Entstehungs-Animation (Teil 7)

### Datenfluss
```
OneLinePath (fertig, unverändert) ─┐
RenderSettings ────────────────────┼─► createArtworkAnimator (einmalig: Plan, Farben, Bogenlängen-Index, Hintergrund)
                                   │
requestAnimationFrame(now) ─► playback.tick (reiner Zustand, Uhr injiziert) ─► progress 0…1
                                                                              │
     cursorAtProgress (Binärsuche über kumulierte Längen) ◄───────────────────┘
                 │
     drawArtworkLineRange(vorheriger Cursor → neuer Cursor) auf persistente Linienebene
                 │
     Komposition: Hintergrund + Linienebene (Deckkraft) → Canvas
```
Während der Animation laufen weder Analyse noch Engine; es entstehen keine neuen Punkte.

### Kern (`core/animation`, ohne DOM)
- `pathProgress.ts`: `createPathProgress(path)` baut kumulierte Bogenlängen (Float64). `cursorAtProgress`
  findet per Binärsuche das Segment und interpoliert die Spitze; Positionen innerhalb von
  `SNAP_EPSILON` · Länge an einem Punkt rasten auf den Punkt ein (keine Mini-Segmente/Duplikate).
  NaN → `AnimationError`, ±Infinity/außerhalb → auf 0…1 begrenzt.
- `playback.ts`: Zustandsmaschine `ready → playing ⇄ paused → finished` (play nach finished = von vorn),
  zeitbasiert über Ankerzeit/Ankerfortschritt; Geschwindigkeit, seek, replay.
- `animationSettings.ts`: Dauer-Presets 5/10/15/30 s (Standard 10 s), Geschwindigkeiten 0,5/1/2/4×
  (vorbereitet), Easing `linear` (`ease-in-out` vorbereitet), `sanitizeAnimationSettings`,
  `progressAtTime`, `frameTimesMs` (für den späteren Export).
- `rendering/renderer.ts`: `drawArtworkLineRange(plan, path, ctx, from, to)` zeichnet genau das Stück
  zwischen zwei Cursorn mit denselben Strichen/Farbläufen wie `drawArtworkLine` (das intern dieselbe
  Funktion nutzt).

### Browser (`platform/browser/animation`)
- `artworkAnimator.ts`: `renderAt(ctx, p)` inkrementell, `renderFresh(ctx, p)` unabhängig von der Historie
  (für Export in Teil 8). Bei `p = 1` wird die ganze Linie in einem Zug gezeichnet – bei Deckkraft 1
  direkt auf den Hintergrund wie beim statischen Rendering: das letzte Frame ist pixelidentisch
  (Browser-Test, alle Modi, weißer und Original-Hintergrund).
- `animationLoop.ts`: rAF-Schleife, Metriken (Frames, fps, ausgelassene Frames, Renderzeit).

### Laufzeiten (Desktop-Chromium headless, 2048 px, 10 s)
| | Ø Frame | letzter (voller) Frame | fps | ausgelassen |
|---|---|---|---|---|
| Balanced Schwarz / Farbe | 0,4 / 0,5 ms | 5 / 15 ms | 60 | 0 |
| Detail Schwarz / Farbe | 0,5 / 0,6 ms | 13 / 25 ms | 60 | 0 |

### Bekannte Grenzen
- Zwischenframes entstehen aus aneinandergesetzten Teilstrichen; an den Stoßstellen kann die
  Kantenglättung minimal dunkler sein als im Endbild (nur während der Animation sichtbar).
- Geschwindigkeit und `ease-in-out` sind im Kern vorhanden, aber noch ohne UI.
- Der Animations-Canvas hat Vorschau-Auflösung (2048 px); Export-Auflösungen folgen in Teil 8.

## Export und Galerie (Teil 8)

### Trennung Export ↔ Speicherung
```
ArtworkProject / Sitzung ──► Renderer (neu, Zielauflösung) ──► Encoder ──► Datei (Download / Teilen)
ArtworkProject ──► ProjectRepository ──► StorageBackend (IndexedDB) ──► Galerie „Meine Werke“
```
Beide lesen dieselben Daten (OriginalImage, OneLinePath, EffectiveOneLineSettings, RenderSettings,
AnimationSettings). Export speichert nichts; Speichern exportiert nichts. Weder Export noch Galerie
analysieren oder berechnen Pfade.

### Bildexport
- `core/export`: `sanitizeImageExportSettings` (PNG Standard, JPEG optional), `imageExportSize`
  (lange Kante: Original / 2048 / 4096; Seitenverhältnis über `renderSize`, „Original“ auf
  `EXPORT_LIMITS` begrenzt und gemeldet), `exportFileName` (`OneLine JJJJ-MM-TT HHMM.ext` bzw.
  Projektname), `exportReducer` (idle → preparing → rendering → encoding → ready | failed | cancelled).
- `platform/browser/export/imageExporter.ts`: `renderArtworkSurface` (derselbe Renderer wie die
  Vorschau, normalisierte Linienbreite) → `convertToBlob`. Der tatsächliche Dateityp wird geprüft
  (keine PNG-Datei mit .jpg-Endung). JPEG/Video ohne Alpha: transparenter Hintergrund → weiß.
- Abbruch zwischen den Phasen; der Canvas-Encoder selbst ist nicht unterbrechbar, sein Ergebnis wird
  dann verworfen.

### Videoexport
- `planVideoFrames`: Zeiten k/fps (0 … Dauer, 301 Frames bei 10 s/30 fps), Fortschritt über dieselbe
  `progressAtTime` wie die Live-Animation.
- `runVideoExport` (Kern): Frame rendern → an Encoder → nächster Frame; nie mehr als ein Frame in
  Arbeit (Backpressure), Abbruch zwischen Frames.
- Frames: frischer `ArtworkAnimator`, `renderAt` in fester Reihenfolge (deterministisch), letzter Frame
  = statisches Artwork (Browser-Test: 0 Abweichung vor dem Encoding).
- Encoder-Port `VideoEncoderPort` (Kern) → `webCodecsEncoder` (Browser): WebCodecs + Muxer
  **mediabunny** (MPL-2.0, nur im Export-Chunk). Codec-Wahl per Gerätabfrage:
  H.264/MP4 → VP9/WebM → AV1/WebM → VP8/WebM. Kein MediaRecorder (Echtzeit, nicht deterministisch),
  keine Bildschirmaufnahme. Ohne WebCodecs: verständliche Meldung, Knopf deaktiviert.
- Auflösungen: 1080p (in 1920×1080 bzw. 1080×1920), 2048, 4096 lange Kante; gerade Kantenlängen.

### Speicherung (IndexedDB `one-line-art`, Version 1)
| Store | Schlüssel | Inhalt |
|---|---|---|
| `projects` | Projekt-ID | Formatversion, Name, Datum, Bildinfo, EffectiveOneLineSettings, RenderSettings, AnimationSettings, Pfad-Metadaten, Versionen (project/analysis/engine/renderer) |
| `paths` | Projekt-ID | `Float32Array` der Koordinaten |
| `images` | Content-Hash | Originaldatei als Blob (eine Kopie je Foto, gelöscht mit dem letzten Projekt) |
| `thumbnails` | Projekt-ID | Thumbnail (WebP, sonst PNG; 512 px, aus dem Artwork gerendert) |

Schreiben immer in **einer** Transaktion. Laden prüft alles (`parseProjectRecord`, `parsePathRecord`,
`parseImageRecord`): neuere Formatversion → „inkompatibel“, fehlerhafte Daten → „beschädigt“
(in der Galerie sichtbar und löschbar). Migrationen nur über `PROJECT_MIGRATIONS` (derzeit keine).
Abweichende Algorithmusversionen werden gemeldet, der gespeicherte Pfad wird unverändert verwendet.
Gerenderte Bilder/Videos werden nie gespeichert.

### Projekt öffnen
Original aus IndexedDB → derselbe Import-Decoder (gleiche Arbeitskopie; Hash und Größe werden geprüft)
→ Sitzung mit gespeichertem Pfad (`analysisStatus: 'deferred'`). Die Analyse startet erst, wenn eine
**neue** Zeichnung gebraucht wird (andere Detailstufe).

### Laufzeiten (Desktop-Chromium headless, Produktionscode; Pfad Balanced 51 Tsd., Detail 113 Tsd. Punkte)
| Bild (PNG) | Rendern | Encoding | Gesamt |
|---|---|---|---|
| Balanced 2048 (Schwarz / Farbe) | 18 / 42 ms | 175 ms | 0,2 s |
| Balanced 4096 | 33 / 56 ms | 330–350 ms | 0,4 s |
| Detail 2048 | 23 / 66 ms | 300–380 ms | 0,4 s |
| Detail 4096 | 37 / 83 ms | 490–550 ms | 0,6 s |
| Detail Original 6000×4500 | 75 / 121 ms | 730–810 ms | 0,9 s |

| Video (10 s, 30 fps, 301 Frames, VP9/WebM) | Ø Frame | Frames gesamt | Encoding | Gesamt | Datei |
|---|---|---|---|---|---|
| Balanced 1080p | 0,5–0,6 ms | 0,14–0,18 s | 2,7 s | 2,9 s | 1,6–1,8 MB |
| Balanced 2048 | 0,6 ms | 0,17 s | 4,7 s | 5,0 s | 2,7 MB |
| Detail 1080p | 0,7–0,9 ms | 0,2–0,3 s | 2,6–2,8 s | 2,9–3,0 s | 2,0–2,2 MB |
| Detail 2048 Farbe | 1,0 ms | 0,3 s | 4,8 s | 5,1 s | 3,2 MB |
| Detail 4096 Farbe | 48 ms | 14,6 s | 4,9 s | 19,9 s | 8,3 MB |
| Detail 1080p 30 s Farbe | 0,4 ms | 0,3 s | 7,7 s | 8,1 s | 4,5 MB |

### Speicher
Bild: eine Render-Fläche in Zielgröße (4096×3072 ≈ 50 MB RGBA), direkt kodiert (keine zusätzliche
Bitmap-Kopie), danach sofort freigegeben. Video: seit Teil 10 nur noch die Encoder-Fläche
(4096×3072 ≈ 50 MB; vorher drei Flächen ≈ 150 MB), Frames werden einzeln kodiert; im RAM wächst nur die
komprimierte Datei (MB-Bereich). JS-Heap blieb in allen Messungen unter 20 MB.

## UI/UX (Teil 9)

### Ablauf und Navigation
`Bild → Zeichnung → Vorschau → Export` (`app/flow.ts`); die Platzhalter „Generieren“/„Ergebnis“ sind
entfernt. Die Schrittleiste zeigt Erreichbarkeit (`reachableSteps`): erledigte Schritte mit Häkchen und
anklickbar, kommende zurückhaltend, nicht erreichbare inert. Mobil: „Schritt n von 4“ mit Segmentleiste.
Speichern und „Meine Werke“ stehen in der Kopfzeile (Status: Speichern → Wird gespeichert … → Gespeichert).

### Visuelles System (`ui/theme.css`)
Tokens für Farbe (Kontrast ≥ 4,5:1 für Text), Typo-Skala (12/13/15/17/22/28 px), Abstände (4–64 px),
Radien und Steuerhöhe 44 px (Touch). Buttons: primary / quiet / ghost / danger. Auswahl als
Segmented Control mit Erklärzeile (`OptionGroup`); Bestätigungen über native `<dialog>`
(`ui/components/Dialog.tsx`, Fokus bleibt im Dialog, Escape bricht ab). Icons als Inline-SVG.
`prefers-reduced-motion` schaltet Animationen/Übergänge ab. Debug-Ansichten nur mit `?debug=analysis`.

### Endstand (fertiges Bild bleibt stehen)
`FINAL_HOLD_MS` = 2000 (`core/animation/animationSettings.ts`, einzige Definition). Die gewählte Dauer
(5/10/15/30 s) bleibt die **Zeichenzeit**; die Timeline ist `timelineDurationMs = Zeichenzeit + Endstand`.
- Vorschau: `createPlayback(dauer, speed, holdMs)` – `progress` = Zeichenfortschritt (1 während des
  Endstands), `positionMs` = Position auf der Timeline, `finished` erst nach dem Endstand.
- Video: `planVideoFrames` hängt die Endstand-Frames an (10 s → 361 Frames, 12 s Video). Unveränderte
  Frames werden nicht neu gezeichnet (`runVideoExport`), der Animator zeichnet das fertige Bild nur einmal.
- Das Endbild ist weiterhin pixelidentisch mit dem statischen Artwork (Browser-Test).

### Bekannte Grenzen
- (behoben in Teil 10) Zoom: ab 1,5× wird die Vorschau einmalig in 4096 px neu gerendert.
- Die Vorschau-Leinwand ist beim Start leer (Fortschritt 0) mit Abspiel-Knopf; ein Vorschaubild des
  fertigen Werks davor wäre denkbar.

## QA, Performance und Release (Teil 10)

### Technische Änderungen
- **Animator ohne Zwischenflächen** (`artworkAnimator.ts`): bei deckender Linie (Normalfall) werden Frames
  direkt auf die Zielfläche gezeichnet – Hintergrund einmal, dann nur das neue Linienstück. Keine
  Hintergrund-/Linienebene, kein Compositing pro Frame. Nur eine halbtransparente Linie nutzt noch die
  Ebenen. Das Endbild entsteht mit denselben Operationen wie das statische Artwork (pixelidentisch).
- **Bildexport im Web Worker** (`export/imageExport.worker.ts`, `imageExportRunner.ts`): derselbe Renderer
  auf einer `OffscreenCanvas`, Kodierung im Worker, zurück kommt nur die Datei. Die Linienfarben werden
  vorher auf dem Main-Thread gesampelt (gecacht), die Arbeitskopie des Fotos wird nicht kopiert. Abbrechen
  beendet den Worker. Fallback Main-Thread: ohne `OffscreenCanvas`/`convertToBlob`, wenn der Worker nicht
  startet oder keinen 2D-Kontext hat, und für den Foto-Hintergrund `original` (sonst große Bitmap-Kopie).
- **Schärfere Zoom-Vorschau** (`useZoomResolution`): ab Zoom 1,5 wird derselbe Pfad in 4096 px gerendert
  (nur Renderer; Analyse und Pfad unberührt).
- **Vorschau pausiert im Hintergrund** (`visibilitychange`), statt unbemerkt abzulaufen.
- **SVG-Ausgabe** escaped Attributwerte (`renderSvg`).
- **Tests**: 10 realistische Motive (`e2e/realistic.spec.ts`), QA-Abläufe (`e2e/qa.spec.ts`: Gesamtablauf ohne
  Console-Fehler, Speicherstatus, Pfad-Invarianz, gemeinsames Original, EXIF, Encoder-Fehler, Abbruch durch
  Navigation, Worker/Fallback/Abbruch, Zoom, Hintergrund, 60 fps, iOS-Canvas-Grenze), 1024×768.
- **Benchmark** reproduzierbar: `npm run bench` (optional `BENCH_OUT=datei.md`), feste Motive/Seeds, Median.

### Browser-Kompatibilität
Automatisch getestet wurde nur **Chromium** (Playwright, headless, Linux). Firefox, Safari und echte
Mobilgeräte standen in der Entwicklungsumgebung nicht zur Verfügung.

| Funktion | Chromium (getestet) | Firefox (nicht getestet) | Safari/iOS (nicht getestet) | Verhalten ohne Unterstützung |
|---|---|---|---|---|
| Canvas 2D / OffscreenCanvas | ja | ≥ 105 | 2D-OffscreenCanvas ≥ 16.4 | Export auf dem Main-Thread (HTMLCanvas) |
| Web Worker (Module) | ja | ja | ja | Analyse/Pfad laufen auf dem Main-Thread |
| IndexedDB (Blobs) | ja | ja (nicht im privaten Modus älterer Versionen) | ja | Meldung „Speichern ist hier nicht möglich“ |
| WebCodecs `VideoEncoder` | ja (hier ohne H.264) | ≥ 130 | ≥ 16.4 (H.264) | Video-Knopf gesperrt, verständliche Meldung |
| Web Share (Dateien) | nein (Desktop headless) | nein | ja | nur „Herunterladen“ |
| Container Queries (Vorschau) | ja | ≥ 110 | ≥ 16 | – |
| `<dialog>` | ja | ≥ 98 | ≥ 15.4 | – |

### Video-Codecs
Reihenfolge per Geräteabfrage (`getFirstEncodableVideoCodec`): H.264/MP4 → VP9/WebM → AV1/WebM → VP8/WebM.
In der Testumgebung (Open-Source-Chromium) ist kein H.264-Encoder vorhanden: **MP4 wurde nicht auf einem
Gerät erzeugt**; getestet sind WebM/VP9 (Container per Demuxer geprüft, 30 und 60 fps, 5/10/15/30 s + 2 s
Endstand). Ein Encoder-Absturz mitten im Export wird als Fehler mit „Erneut versuchen“ angezeigt.

### Plattformgrenzen
- `EXPORT_LIMITS` unverändert (8192 px, 40 MP Bild; 4096 px Video). iOS Safari erlaubt Canvas-Flächen nur bis
  ≈ 16,7 MP: „Originalgröße“ großer Fotos scheitert dort voraussichtlich – das ist simuliert getestet und
  führt zur Meldung „Nicht genug Speicher für diese Größe“; 4096 px funktioniert. Eine plattformspezifische
  Grenze wurde mangels Gerätetest nicht eingeführt.
- 4096-px-Video mit H.264 übersteigt Level 5.2; Geräte melden das per `isConfigSupported` → Knopf gesperrt
  mit Hinweis auf kleinere Auflösung.
- Kein Service Worker / Manifest: die App ist keine installierbare PWA. Nach dem Laden läuft alles lokal
  (keine Netzwerkaufrufe); nachgeladene Chunks (Export, Worker) brauchen beim ersten Gebrauch das Netz.

### Performance (`npm run bench`, Chromium headless, Software-Rendering, Detail-Pfad 113 Tsd. Punkte)
| Messung | Ergebnis | Teil 5–9 |
|---|---|---|
| Analyse 1024 / 2048 | 850 / 860 ms | – |
| One-Line Minimal / Balanced / Detail | 1,2 / 2,8 / 3,5 s | 1,5–1,6 s (Balanced), 2,6–3,0 s (Detail) |
| Rendering Detail 1024 / 2048 / 4096 | 185–233 / 236–304 / 373–394 ms | 180–255 / 225–330 / 350–485 ms |
| Bildexport PNG 2048 / 4096 / Original 6000×4500 (Worker) | 0,5 / 0,7 / 1,0 s | 0,4 / 0,6 / 0,9 s (Main-Thread) |
| Video 1080p / 2048 / 4096, 10 s + 2 s | 3,5 / 5,8 / 21,0 s | 2,9 / 5,1 / 19,9 s (10 s ohne Endstand) |
| Video 4096: Rendern pro Frame | 0,24 ms | 48 ms |

Der Bildexport im Worker ist in Summe minimal langsamer (Nachrichten, eigener Kontext), blockiert aber die
Oberfläche nicht mehr (Test: > 20 fps während zweier Exporte). Beim 4096-Video bestimmt jetzt allein der
Encoder die Dauer (hier Software-VP9). Speicher: nach drei 4096-Video- + Original-Bildexporten bleibt der
JS-Heap konstant (11,2 MB) – kein Leck.

### Spätere native Umsetzung (Capacitor) – zu ersetzende Teile
| Schnittstelle | Heute (Browser) | Nativ |
|---|---|---|
| `ImageDecoder` (core/imageImport) | `bitmapDecoder` (createImageBitmap, Canvas) | Plattform-Decoder inkl. HEIC |
| `StorageBackend` (core/storage) | `indexedDbBackend` | SQLite/Dateisystem (Repository-Logik bleibt) |
| `VideoEncoderPort` (core/export) | `webCodecsEncoder` (WebCodecs + mediabunny) | AVAssetWriter (iOS) / MediaCodec+MediaMuxer (Android) |
| Datei teilen/sichern | `share.ts` (Download, Web Share) | System-Share-Sheet / Fotomediathek |
| Rendering | Canvas 2D (`artworkRenderer`, Kern liefert `ArtworkPlan` + Zeichenbefehle über `RenderContext2D`) | bleibt im WebView oder nativer 2D-Kontext mit gleicher Schnittstelle |
| Worker | Web Worker | bleibt im WebView |

Der Kern (`src/core`) hat keine DOM-/Browser-Abhängigkeit (tsconfig.core ohne DOM-Lib, ESLint-Regel,
Architekturtest pro Datei).

### Future Improvements (nicht umgesetzt)
- Dunkle, kontrastarme Fotos ergeben schwache Formen (Algorithmus-Eigenschaft, keine Regression).
- Service Worker für echten Offline-Betrieb/Installation.
- Plattformabhängige Exportgrenzen nach Tests auf echten iOS-Geräten.
- Vorschaubild statt leerer Leinwand vor dem Abspielen.

## Android mit Capacitor (Phase 11, Teil 1)

### Aufbau
```
Web-App (unverändert) → npm run build → dist/ → npx cap sync android → android/app/src/main/assets/public → Gradle → APK
```
- Capacitor **8.5.2** (`@capacitor/core`, `@capacitor/android`; CLI als devDependency), `capacitor.config.ts`:
  App-ID **`com.onelineart.app`** (dauerhaft), Name **One Line Art**, `webDir: 'dist'`.
- Die gebaute Web-App liegt im APK und wird von Capacitor lokal unter `https://localhost` ausgeliefert
  (sicherer Kontext → WebCodecs, IndexedDB, Worker wie im Browser). Keine Dev-Server-URL.
- Android-Projekt `android/` (Capacitor-Vorlage): minSdk 24 (Android 7.0), compileSdk/targetSdk 36,
  Android Gradle Plugin 8.13.0, Gradle 8.14.3, Java 21. `versionName` = `package.json`-Version,
  `versionCode` 1. Berechtigungen: `INTERNET` (Capacitor-Standard) und `WRITE_EXTERNAL_STORAGE` nur bis
  Android 9 (`maxSdkVersion="28"`, zum Speichern exportierter Dateien).
- Release-Signierung vorbereitet: `android/keystore.properties` (Vorlage `keystore.properties.example`,
  git-ignoriert zusammen mit `*.jks`/`*.keystore`); ohne Datei bleibt der Release-Build unsigniert.

### Befehle
| Zweck | Befehl |
|---|---|
| Web bauen + in Android kopieren | `npm run android:sync` |
| Debug-APK bauen | `npm run android:build` → `android/app/build/outputs/apk/debug/app-debug.apk` |
| Android Studio öffnen | `npm run android:open` |
| Gebündelte Assets testen (Pixel-7-Emulation) | `npm run test:android-bundle` |

Voraussetzung für den Gradle-Build: Android SDK (Plattform 36, Build-Tools) und Zugriff auf das
Google-Maven-Repository (`dl.google.com`).

### Verhalten in der Android-WebView (erwartet, noch nicht auf einem Gerät geprüft)
- Bildauswahl: `<input type="file">` öffnet über Capacitors WebChromeClient den System-Dateiauswähler.
  „Foto aufnehmen“ fällt ohne Kamera-Berechtigung auf den Dateiauswähler zurück (Kamera → Teil 2).
- Worker, Canvas, IndexedDB, dynamische Imports: Standard der Chromium-WebView.
- WebCodecs: in der Android-WebView verfügbar (Chromium ≥ 94); H.264 hängt vom Gerät ab, sonst WebM-Fallback.
- Zurück-Taste: siehe „Android-Geräteintegration“.
- Lifecycle: Hintergrund → `visibilitychange` pausiert die Vorschau; Drehen erzeugt die Activity dank
  `configChanges` nicht neu; gespeicherte Werke bleiben in IndexedDB.

## Android-Geräteintegration (Phase 11, Teil 2)

### Speichern und Teilen exportierter Dateien
```
Export (unverändert: Bild-/Videoexporter) → ExportFile<Blob>
  → ExportFileActions (core/export, Schnittstelle)
      ├─ Browser: browserFileActions   → Download-Link / Web Share
      └─ Android: androidFileActions   → Plugin „MediaExport“ (nativ, im App-Modul)
```
- Auswahl zur Laufzeit: `platform/fileActions.ts` (`Capacitor.isNativePlatform()` + Plattform `android`).
- Übertragung: die Datei geht in Stücken zu 1,5 MB (Base64) in den App-Cache
  (`cache/exports/<id>/<Dateiname>`); nie als ein einziger String, auch nicht bei 4K-Videos. Speichern und
  Teilen derselben Datei übertragen sie nur einmal. Cache-Dateien werden nach 24 h entfernt.
- **Speichern** (`MediaExportPlugin.saveToGallery`): Android 10+ über MediaStore (Scoped Storage, keine
  Berechtigung) nach `Pictures/One Line Art` (Bilder) bzw. `Movies/One Line Art` (Videos); die Datei ist bis
  zum vollständigen Schreiben unsichtbar (`IS_PENDING`). Android 7–9: öffentlicher Ordner + Media-Scanner,
  dafür `WRITE_EXTERNAL_STORAGE` (nur ≤ API 28, Laufzeitabfrage beim ersten Speichern).
- **Teilen** (`MediaExportPlugin.share`): `content://`-URI über den vorhandenen `FileProvider`
  (`${applicationId}.fileprovider`), `ACTION_SEND` mit Lese-Freigabe im System-Teilen-Dialog.
- **Speichern unter** (`MediaExportPlugin.saveAs`, nur Projektdatei `.onelineart`): System-Dateidialog
  (`ACTION_CREATE_DOCUMENT`, keine Berechtigung), Vorschlag = sicherer Dateiname; kopiert dieselbe
  Cache-Datei an den gewählten Ort. Abbrechen → `saved: false` (kein Fehler).
- Warum kein fertiges Plugin: die offiziellen Plugins schreiben nicht in MediaStore (Galerie) und übertragen
  Dateien als ein Base64-String; das eigene Plugin ist eine Java-Klasse ohne weitere Abhängigkeiten.

### Zurück-Taste (`@capacitor/app` 8.1.1)
Reihenfolge: offener Dialog schließen → laufenden Export abbrechen → „Meine Werke“ → zurück zum Ablauf →
Export → Vorschau → Zeichnung → Bild. Auf „Bild“ (Startebene) geht die App in den Hintergrund
(`App.minimizeApp()`, wie andere Android-Apps; die aktuelle Arbeit bleibt im Speicher). Umsetzung:
`ui/backStack.ts` (Overlays), `app/backNavigation.ts` (Schritte), `platform/capacitor/backButton.ts`.
Im Browser bleibt alles unverändert.

### Bekannte Android-Einschränkungen
- Während die App im Hintergrund oder der Bildschirm gesperrt ist, drosselt/pausiert die WebView JavaScript:
  ein laufender Export wird langsamer oder hält an und läuft beim Zurückkehren weiter.
- Ob die Teilen-Ziel-App die Datei tatsächlich verschickt hat, meldet Android nicht zurück.
- „Foto aufnehmen“ öffnet weiterhin den Dateiauswähler (keine Kamera-Berechtigung).

## Zeichen-Engine und kreative Kontrolle (Phase 12.1)

### Pfad-Parameter vs. Render-Parameter
| Regler | wirkt auf | Umsetzung | Neuberechnung |
|---|---|---|---|
| Stil (Organisch/Geometrisch/Orthogonal) | Pfad | `DrawingSettings.style` → Engine-ID | neuer Pfad (einmal je Konfiguration, danach Cache) |
| Detailgrad (stufenlos) | Pfad | `DrawingSettings.detail` → `settings.detail` + interpolierte Profile | neuer Pfad beim Loslassen |
| Linienglättung | Pfad | `DrawingSettings.smoothing` → vorhandenes `smoothingIterations` (Chaikin) | neuer Pfad beim Loslassen |
| Linienbreite | Rendering | `RenderSettings.lineWidth` | nur Neuzeichnen |
| Zeichenstärke | Rendering | `RenderSettings.lineOpacity` | nur Neuzeichnen |
| Hintergrund (Helligkeit) | Rendering | `background: 'custom'` + Grauwert, Linie auf dunklem Grund hell | nur Neuzeichnen |
| Farbintensität | Rendering | `RenderSettings.sampling.strength` (nur „Farbe“) | nur Neuzeichnen |

Render-Parameter erreichen nie `resolveOneLineSettings`: Analyse und Pfad bleiben unberührt (per Test über
Worker-Zähler abgesichert). Das Originalfoto wird nie verändert.

### Stufenloser Detailgrad (`drawing/detailLevels.ts`)
- Die Presets sind Ankerpunkte auf der vorhandenen Detail-Achse: Minimal 0,2 · Balanced 0,5 · Detail 1,0.
- Zwischenwerte interpolieren die vollständigen Parametersätze der beiden Nachbar-Presets linear
  (Ganzzahl-Parameter gerundet); das Linienbudget folgt `pointBudgetFor(detail)` wie bisher.
- Ein Wert genau auf einem Anker **ist** dieses Preset (gleicher Schlüssel, gleicher Cache-Eintrag).
- „Eigene“ (`isCustomDrawing`): Detail oder Glättung weichen vom Preset ab; Schlüssel-Präfix `custom-`.
  Ein Klick auf ein Preset setzt Detail und Glättung zurück (Presets bilden alle Pfad-Parameter ab).

### Stil-System (ohne Fallunterscheidung in der Engine)
```
DrawingStyle ──DRAWING_STYLE_PROFILES──▶ engineId ──oneLineEngine(id)──▶ OneLineEngine.run
                                                        │
                    runOneLineEngine(shape, …): Schritte 1–5 und 7 gemeinsam
                                                        │
                                   LineShape (Schritt 6): prepare + finish
                                     ├─ ORGANIC_LINE_SHAPE:   Chaikin → Douglas–Peucker   (unverändert)
                                     ├─ GEOMETRIC_LINE_SHAPE: Douglas–Peucker → oktilineares Routing
                                     │                        (0°/45°/90°) → gerade Läufe zusammenfassen
                                     └─ ORTHOGONAL_LINE_SHAPE: eigene Punktwahl + Tour-Kosten + L-Routing
                                                               (Phase 13.3, s. unten)
```
- Alle Engines liefern denselben `OneLinePath`; Rendering, Animation, Export, Galerie und Projekte
  bleiben unverändert. `path.meta.generatorId` nennt die Engine.
- Geometrisch: jeder Abschnitt wird zu höchstens zwei Teilstücken (gerade + diagonal); der Knick liegt im
  Rechteck des Abschnitts, also nie außerhalb der Leinwand und ohne Sprünge. Weiterhin genau eine Linie.
- Neuer Stil = neue `LineShape` im Registry-Eintrag (`engine/oneLine/lineStyles.ts`) + ein Eintrag in
  `DRAWING_STYLE_PROFILES`. Glättung gilt nur für Stile mit `smoothing: true`.
- Organic ist bitgenau unverändert: `tests/core/engine/organicGolden.test.ts` friert Pfad-Hashes und
  Schlüssel aller drei Presets auf drei Motiven ein (vor dem Umbau aufgenommen).

### Projekte
Ältere Projekte (ohne `style`/`detail`/`smoothing`) werden beim Laden als Organic-Preset ergänzt; ihr
Schlüssel bleibt gleich. Kein neues Speicherformat nötig. Die Galerie zeigt Stil und „Eigene“.

### Oberfläche
Schritt „Zeichnung“: Stil · Detailgrad · Darstellung wie bisher als Auswahl; alle Regler liegen hinter
„Anpassen“ (zwei Gruppen: Linie, Darstellung; „Zurücksetzen“). Auf Telefonen ersetzt das Panel solange die
drei Auswahlfelder, damit die Zeichnung sichtbar bleibt.

### Bekannte Grenzen
- Der geometrische Stil nutzt dieselbe Route wie Organic; er ist eine eigene Linienform, keine eigene
  Routenplanung. Sehr dichte Bereiche wirken dadurch eher „labyrinthartig“ als flächig-geometrisch.
- Glättung ist in 6 Stufen (0–5 Chaikin-Durchläufe), weil das die vorhandene Engine-Grenze ist.
- Die Hintergrundhelligkeit gilt für den einfarbigen Papierhintergrund; die Einstellung „Originalfoto als
  Hintergrund“ bleibt Entwickleransicht.

## Bildbearbeitung und erweitertes Farbsystem (Phase 12.2)

### Bild-Edit-State (`core/imageEdit`)
```
Original (Datei, unverändert, gespeichert) ──Import──▶ Anzeige-Kopie ≤ 4096 px (sourcePreview, bleibt erhalten)
                                                          │  ImageEdit { rotation: 0|90|180|270, crop: Rechteck 0..1 }
                                                          ▼  applyImageEdit (platform/browser/bitmapDecoder.ts)
                                        bearbeitete Anzeige-Kopie (preview) + Arbeitskopie (processed)
                                                          ▼
                                   bestehende Bildanalyse → bestehende One-Line-Engine → OneLinePath
```
- **Ein Rechteck statt vier Werte:** Zoom = Größe des Ausschnitts (`zoomOf`/`withZoom`, 1–10×), Pan =
  Lage (`panOf`/`withPan`), Seitenverhältnis = Form (`withCropAspect`). Keine widersprüchlichen Werte;
  dasselbe Rechteck ergibt immer dieselben Pixel (`cropPixelRect` rundet einmal, für alle gleich).
- **Nicht destruktiv, speicherschonend:** Das Original wird weder verändert noch neu dekodiert. Drehen
  (Vierteldrehungen) und Zuschneiden sind EIN Zeichenvorgang auf der Anzeige-Kopie (exakte Pixelkopie),
  danach entsteht die Arbeitskopie wie beim Import. Der Identitäts-Edit ergibt bitgenau die Arbeitskopie
  des Imports (Browser-Test) → alte Projekte und Organic-Pfade bleiben unverändert.
- **Neuberechnung:** Ein angewendeter Edit ist eine neue Eingabe. Der Reducer (`edit-applied`) verwirft
  Analyse und Pfade, `revision` zählt hoch, `sessionKeyOf(session)` (= Bild-ID bzw. `id@revision`)
  adressiert alle Worker-Ergebnisse — verspätete Ergebnisse eines früheren Edits werden nie übernommen.
  Die Worker-/Cache-Logik ist unverändert; sie arbeitet nur mit dem neuen Schlüssel.
- **Editor (Schritt „Bild“ → „Bearbeiten“):** `ui/components/CropStage` (fester Rahmen, Bild darunter:
  Ziehen = verschieben, Mausrad/Pinch/Regler = Zoom, Ecken = Ausschnitt ändern, Pfeiltasten/+/− per
  Tastatur), Drehen links/rechts, Seitenverhältnis Frei/Original/1:1/4:5/16:9, Live-Vorschau. Gearbeitet
  wird an einem Entwurf; erst „Übernehmen“ ändert die Eingabe. Zurück-Taste = Abbrechen.
- **Export „Original“** = der Ausschnitt in Originalpixeln (`editedSize`).

### Farbsystem (reines Rendering)
| Einstellung | Feld in `RenderSettings` | Umsetzung |
|---|---|---|
| Einfarbig + Linienfarbe | `colorMode: 'monochrome'`, `lineColor` | Farbwähler + Hex-Feld |
| Verlauf (Start/Ende) | `colorMode: 'gradient'`, `gradient.colors` | Farbe je Punkt nach Bogenlänge, OKLab-Interpolation (`gradientLineColors`) |
| Farbpalette | `gradient.colors` = Palette (5 Paletten, `COLOR_PALETTES`) | mehrstufiger Verlauf |
| Foto | `colorMode: 'sampled-color'` | unverändert |
| Hintergrundfarbe | `backgroundBase` (Weiß/Schwarz/eigene) → `backgroundColor` | |
| Hintergrundhelligkeit | wirkt auf `backgroundBase` (`colorAtLightness`) | Weiß als Basis = exakt die Grautöne aus 12.1 |
| Farbintensität | `sampling.strength` (EIN Wert) | skaliert die OKLab-Buntheit in allen Modi; 1 = Farbe wie gewählt |

- Verläufe nutzen dieselben `LineColors` und denselben Lauf-Renderer wie die Fotofarben; `usesLineColors`
  entscheidet an allen Stellen (Vorschau, Animation, Bild-/Videoexport, Vorschaubild). Farben werden je
  Pfad und Farbeinstellung gecacht (`lineColorsFor`).
- Schwarze/weiße Linien wechseln auf dunklem Grund automatisch; eine selbst gewählte Linienfarbe bleibt.
- Nichts davon erreicht `resolveOneLineSettings`, Analyse oder Worker (per Browser-Test über Worker-Zähler
  abgesichert).

### Kompatibilität
- Projekte: neues Feld `edit` (fehlt bei alten Projekten → unbearbeitet). Render-Einstellungen: neue Felder
  `gradient`, `backgroundBase` (fehlen → Standard; Weiß als Basis reproduziert alte Grautöne exakt).
  Kein neues Speicherformat, keine Migration.
- Oberfläche: „Darstellung“ heißt jetzt Einfarbig | Verlauf | Foto (vorher Schwarz | Farbe); das
  Anpassen-Panel hat die Bereiche Linie | Darstellung | Farbe.

### Bekannte Grenzen
- Zuschnitte werden aus der Anzeige-Kopie (≤ 4096 px) berechnet: bei sehr großen Fotos und kleinen
  Ausschnitten hat die Arbeitskopie weniger als 2048 px (z. B. 30 % eines 48-MP-Fotos → ~1230 px). Für die
  Linienzeichnung reicht das; ein erneutes Dekodieren des Originals wäre speicherintensiv.
- Nur Vierteldrehungen; freie Rotation ist über den Typ `ImageRotation` vorbereitet, nicht umgesetzt.
- Messwerte (Desktop-Chromium, 8000×6000 px): Import 0,55 s, Drehen 0,47 s, Zuschnitt 0,01–0,4 s.

## Erweiterte Animation (Phase 12.3)

### Grundsatz
Dauer, Geschwindigkeit, Richtung und Startpunkt sind **reiner Wiedergabezustand**. Sie erreichen weder
`resolveOneLineSettings` noch Analyse oder Worker; der `OneLinePath` bleibt unverändert (Browser-Tests über
Worker-Zähler). Vorschau und Videoexport nutzen denselben `ArtworkAnimator`.

### Dauer und Geschwindigkeit (`core/animation/animationSettings.ts`)
- Presets 5/10/15/30 s bleiben; „Eigene“: 2–60 s in 0,5-s-Schritten (`DURATION_RANGE_MS`, `clampDurationMs`).
- Geschwindigkeit ist ein Faktor (0,5×/1×/2×/4×): Zeichenzeit = Dauer ÷ Geschwindigkeit
  (`drawingDurationMs`). Weiterhin rein zeitbasiert (Fortschritt = verstrichene Zeit / Zeichenzeit, nach
  Bogenlänge), unabhängig von Bildrate und Gerät. Der End-Hold (2 s) kommt immer danach, unverändert.
- Video: `VideoExportSettings.durationMs` = Zeichenzeit, zulässig 0,5–120 s (`VIDEO_DRAWING_RANGE_MS`,
  höchstens ≈ 3700 Frames bei 30 fps).

### Richtung und Startpunkt (`core/animation/animationRoute.ts`)
Der Pfad ist offen, stammt aber aus einer geschlossenen Raumfüllkurve: Ende und Anfang liegen nah
beieinander (gemessen an echten Fotos: 0,2–2,8 % der Bilddiagonale, stets kürzer als das längste Segment
des Pfades selbst). Deshalb wird er für die Wiedergabe als Zyklus behandelt, **ohne** die Verbindung
Ende→Anfang je zu zeichnen:

| | ohne Startpunkt | Startpunkt S |
|---|---|---|
| Vorwärts | 0 → L | S → L, dann 0 → S |
| Rückwärts | L → 0 | S → 0, dann L → S |

- Eine Route besteht aus gerichteten Bogenlängen-Stücken; `routeIntervals(route, p0, p1)` liefert die
  zwischen zwei Fortschritten neu sichtbaren Abschnitte. Jeder Abschnitt wird mit der vorhandenen
  `drawArtworkLineRange` (PathCursor) gezeichnet — keine zweite Animationsimplementierung, jedes Segment
  genau einmal (Unit-Test), Zeichnen weiterhin inkrementell.
- Bei Fortschritt 1 zeichnet der Animator wie bisher das statische Bild in einem Durchgang → der letzte Frame
  ist in allen Richtungen/Startpunkten/Farbmodi pixelidentisch (Browser-Test, maxDiff 0).
- Startpunkt: Tippen auf das (bearbeitete) Foto → normalisierter Punkt (0..1) des bearbeiteten Bildes →
  Pfadkoordinaten (`toPathPoint`, Pfadgrenzen = Arbeitsbild) → nächster Punkt auf dem Pfad
  (`nearestPathPoint`, Projektion auf alle Segmente). Unabhängig von der Bildschirmgröße.
- Bildbearbeitung: `originalToEdited` / `editedToOriginal` bilden Punkte zwischen Original und
  bearbeitetem Bild ab (Rotation, dann Ausschnitt; gegen echte Pixel von `applyImageEdit` getestet). Ein
  gewählter Startpunkt gehört zu genau einem Bild-/Bearbeitungszustand (`sessionKeyOf`); nach einer neuen
  Bearbeitung wird er nicht mehr verwendet (Standardstart), statt blind übernommen zu werden.
- Der Marker ist ein DOM-Element über der Zeichenfläche und nie Teil von Frames, Bildern oder Videos.

### Speicherung
`AnimationSettings` hat die optionalen Felder `speed`, `direction`, `startPoint`. Ältere Projekte: 1×,
vorwärts, Pfadanfang. Kein neues Speicherformat, keine Migration.

### Bekannte Grenzen
- Geschwindigkeit und Dauer wirken beide auf die Zeichenzeit (Dauer ÷ Geschwindigkeit); die Beschriftung
  nennt die tatsächliche Zeit.
- Liegt der Startpunkt sehr nah am Pfadende, springt der Stift früh zum Pfadanfang (kurzer Sprung, s. oben).
- Die Startpunktwahl erfolgt per Zeiger/Touch; eine reine Tastaturbedienung zum Setzen gibt es nicht.

## Projekte und Abschluss von Phase 12 (Phase 12.4)

### Projektverwaltung („Meine Werke“)
Eine Speicherung (`ProjectRepository` auf IndexedDB), keine zweite Datenhaltung:
- **Speichern/Öffnen:** Projekt = Original (einmal je Inhalt, per Hash) + Bearbeitung + effektive
  Zeichen-Einstellungen + Pfad + Render-Einstellungen + Animationswahl + Thumbnail. Öffnen stellt alles
  wieder her, ohne Analyse oder Pfadberechnung; die Bearbeitung wird auf die frische Anzeige-Kopie
  angewandt (Original bleibt unverändert).
- **Umbenennen:** leere Namen werden nicht gespeichert (UI und Repository); unbenannte Werke zeigen ihr Datum.
- **Duplizieren** (`repository.duplicate`): neuer Datensatz mit eigener ID, eigenem Namen („… – Kopie“),
  neuen Daten, eigener Pfad- und Thumbnail-Kopie; das Original-Foto wird über den Hash geteilt. Änderungen
  an der Kopie berühren das Original nicht (Unit- und Browser-Test).
- **Favoriten** (`repository.setFavorite`): Feld `favorite` im Projekt-Datensatz (fehlt bei alten = nein),
  bleibt beim erneuten Speichern erhalten, ändert das Änderungsdatum nicht. Seit 13.4 filterbar statt immer oben.
- **Löschen:** mit Bestätigung; entfernt Datensatz, Pfad, Thumbnail und das Foto, sobald es kein anderes
  Projekt mehr nutzt.
- **Erneut exportieren:** öffnet das Werk direkt im Export-Schritt mit seinen gespeicherten Einstellungen
  (Farbe, Hintergrund, Linienbreite, Bearbeitung, Dauer, Geschwindigkeit, Richtung, Startpunkt).
- **Thumbnails** werden vom Renderer aus dem Pfad gezeichnet (512 px) — nie ein Screenshot, daher ohne
  Marker, Rahmen oder Editor-Overlays.

### Zusammenspiel (Gesamtsystem)
```
Original ─▶ Bearbeitung (Drehen/Zuschneiden) ─▶ Arbeitsbild ─▶ Analyse ─▶ Engine (Stil, Detail, Glättung) ─▶ OneLinePath
                                                                                                                 │
               Rendering (Linienbreite, Stärke, Hintergrund, Farbe/Verlauf/Foto, Intensität) ◀────────────────────┤
               Animation (Route: Dauer ÷ Geschwindigkeit, Richtung, Startpunkt) ◀─────────────────────────────────┤
               Projekt (alles oben) ◀────────────────────────────────────────────────────────────────────────────┤
               Export (Bild = Rendering; Video = Animation + Rendering) ◀─────────────────────────────────────────┘
```
Neu berechnet wird nur, was sich ändert: neues Bild / neue Bearbeitung → Analyse + Pfad; Stil, Detail,
Glättung → Pfad (Cache je Schlüssel); alles Übrige → nur Neuzeichnen. Veraltete Ergebnisse werden über
`sessionKeyOf` (Bild + Bearbeitungsrevision) verworfen.

### Android-Zurück
Reihenfolge wie in Phase 11, erweitert um die neuen Ebenen: Bild-Editor, „Anpassen“, „Wiedergabe“ und die
Startpunkt-Auswahl registrieren sich im Back-Stack und schließen zuerst. Für Browser-Tests stellt nur der
Dev-Build `window.__systemBack` bereit (nicht im Produktions-/Android-Bundle).

### Messwerte (Desktop-Chromium, Dev-Server)
| Vorgang | Zeit |
|---|---|
| Import + Analyse 8000×6000 JPEG | 2,3 s |
| Drehen + neue Analyse | 1,9 s |
| Pfadberechnung (Balanced) | 2,1 s |
| Galerie mit 31 Werken inkl. Thumbnails | 0,17 s |
| Werk öffnen (48-MP-Original dekodieren, keine Berechnung) | 1,4–1,6 s |
| Videoexport 1080p, 5 s + 2 s | 3,3 s |
| JS-Heap nach GC: Start / nach 10 Öffnungen / nach 30 Löschungen | 9 / 11 / 10 MB |

## Kernfunktion erweitern (Phase 13)

### 13.1 Detail in hellen, kontrastarmen Bereichen
Ursache (gemessen): Die Nachfrage `s = (1 − toneWeight)·importance/ref + toneWeight·(1 − L)` ist für feine
helle Strukturen klein (≈ 0,1–0,15), weil die Importance auf die stärksten Kanten des Bildes normiert ist
und der Tonwert helle Flächen abwertet. `demandGamma` 3 der Detailstufe drückt das auf ≈ 0,002, also unter
den Boden von 0,01 — die Struktur verschwindet. Die Kantenschicht hilft nicht: dünne Kanten werden beim
Mitteln auf das Arbeitsraster verdünnt.

Lösung: optionaler Parameter `lightDetail` (0..1, fehlt = aus = bisheriges Verhalten), **nur** im Preset
Detail (0,8; stufenlos zwischen Balanced und Detail eingeblendet). In `buildDemandField`:
`s = max(s, lightDetail · light(L) · structure)` mit
- `light(L)`: smoothstep über `LIGHT_AREA_LUMINANCE` (0,55–0,85) — nur helle Bereiche,
- `structure`: smoothstep über den **absoluten** lokalen Kontrast (Rohwert der `contrast`-Schicht,
  `LIGHT_STRUCTURE_CONTRAST` 0,008–0,035) — unabhängig von den stärksten Kanten, auf glatten Flächen
  (auch mit Sensorrauschen) 0, nicht verdünnt.
Das max() hebt nur helle strukturierte Pixel an; dunkle und glatte Bereiche behalten ihre Nachfrage.
Minimal und Balanced sind unverändert (gleiche Schlüssel und Pfade). Organic-Golden: die Detail-Zeilen sind
neu eingefroren (`GOLDEN_13_1`); ein Test beweist, dass Detail **ohne** `lightDetail` exakt den Phase-12-Pfad
liefert. Tests: `tests/core/engine/lightDetail.test.ts` (deterministische Szene: helle Streifen ≈ 5 %,
verrauschtes Papier, dunkle Scheibe).

### 13.2 Animationsstart auf dem Kunstwerk
Vorhanden seit 12.3/12.4 (nicht dupliziert): zyklische Route (`createAnimationRoute`), Marker, Speicherung,
Wiederöffnen, Re-Export. Für „A→…→F, Start D“ ergibt sich D→E→F, A→B→C→D; die Verbindung F→A wird nicht
gezeichnet (sie ist nicht Teil des Kunstwerks; gemessen 0,3–2,8 % der Bilddiagonale). Repariert/erweitert:
- **Auswahl auf dem Kunstwerk:** der Picker zeigt die fertige Linie über dem aufgehellten Foto.
- **Touch:** `touch-action: none` auf dem Picker — vorher brach ein leichtes Wischen die Auswahl per
  `pointercancel` ab (per Test reproduziert). Pointer-Capture, Vorschau-Marker am **eingerasteten**
  Linienpunkt während des Ziehens (Finger verdeckt die Stelle), gesetzt beim Loslassen.
- Tests: Reihenfolge A…F mit Start D (vorwärts/rückwärts, Pfad unverändert), Touch-Ziehen per CDP,
  erstes Tintenpixel des exportierten **und** des aus der Galerie erneut exportierten Videos liegt am
  Startpunkt (Decodierung per WebCodecs).

### 13.3 Stil „Orthogonal“
Eigene Pfadberechnung über zwei neue, optionale `LineShape`-Haken (Organic/Geometric nutzen sie nicht und
sind bitgenau unverändert):
1. `placePoints` → `latticePoints`: Nachfragepunkte **auf einem Raster**, gewählt per Fehlerdiffusion
   (Floyd–Steinberg, Serpentine). Rasterabstand = Punktabstand im dichtesten Bereich (dort jeder Knoten
   belegt → saubere Parallelen, nie enger als ein Rasterabstand). Gegen Artefakte: bilineare Abtastung,
   Randanteile zurückgefaltet, Vorlaufzeilen, Schwellenrauschen und leicht unregelmäßige Rasterzeilen
   (Integer-Hash, deterministisch, kein Seed) — sonst Moiré-Bänder in skalierten Ansichten.
2. `connectionLength`: Tour-Kosten ½ Manhattan + ½ gerade Distanz. Reines Manhattan hält Kreuzungen, weil
   eine Kreuzung und ihre 2-opt-Alternative dort oft exakt gleich lang sind (gemessen: 32 → 20 Kreuzungen
   je 1000 Punkte).
3. `finish`: `orthogonalRoute` (jede Verbindung als „L“, Ecken global per Viterbi: wenigste Wendungen,
   180°-Umkehr vermieden) → `removeOrthogonalJogs` (Stufen unter der Toleranz) → Läufe zusammenfassen,
   aber nie über `maxSegmentLength` hinaus (lange gerade Züge sind kein Sprung). Koordinaten werden nur
   kopiert, nie neu berechnet → jede Strecke exakt waagerecht oder senkrecht (auch als float32).
Der Motor übergibt dafür die Validierungsgrenze an `finish` (dritter Parameter).

Integration ohne Sonderfälle: Eintrag in `DRAWING_STYLE_PROFILES` (`smoothing: false`) und im Registry.
Stilwechsel → neuer Schlüssel → neuer Pfad; Wiedergabe-Änderungen berechnen nichts. Projekte speichern
`style: 'orthogonal'` im vorhandenen Format. Tests: exakter Geometrietest (keine Strecke mit dx ≠ 0 und
dy ≠ 0) auf 8 Motiven × 3 Stufen, Routing-/Raster-Einheitstests, E2E vom bearbeiteten Bild bis zum
gespeicherten Pfad in IndexedDB.

Oberfläche: drei Stil-Optionen. Die Leiste im Schritt „Zeichnung“ steht zwischen 1101 und 1535 px wie auf
Tablets über der Navigation (vorher überdeckten sich Stil und Detailgrad dort); drei Spalten nebeneinander
ab 960 px, darunter gestapelt.

### Bekannte Grenzen
- Orthogonal ist stilbedingt gröber als Organisch; in sehr hellen Flächen entstehen lange gerade Züge.
- Einzelne 180°-Umkehrungen bleiben, wo die Tour sie erzwingt (≈ 1–2 % der Ecken), ebenso ≈ 2 % Überlappung.
- Der Seed wirkt im orthogonalen Stil nicht (Punktwahl ist deterministisch ohne Zufall); er ist nur in der
  Entwickleransicht sichtbar.

## Galerie und Export (Phase 13.4–13.5)

### 13.4 Suche, Sortierung, Favoritenfilter
- `core/storage/projectQuery.ts`: `queryProjects(items, { text, sort, favoritesOnly }, titleOf)` — rein,
  deterministisch, verändert nichts. Suche: jedes Wort muss im **angezeigten** Titel vorkommen (unbenannte
  Werke zeigen ihr Datum), Groß-/Kleinschreibung egal, NFKC (zerlegte Umlaute, Vollbreite). Sortierung:
  zuletzt geändert / zuletzt erstellt (neueste zuerst) / Name A–Z (`Intl.Collator('de')`, Zahlen numerisch);
  Gleichstände über das andere Datum und die ID; ungültige Daten zuletzt. Die Sortierung gilt strikt —
  Favoriten findet man über den Filter „Favoriten“ (Entscheidung Phase 13.4).
- Oberfläche (`GalleryScreen`): Suchfeld (filtert beim Tippen; `useDeferredValue` hält die Eingabe flüssig),
  „Sortierung: Geändert | Erstellt | A–Z“, „Anzeigen: Alle | Favoriten“; Zähler „3 von 12 Werken“; leeres
  Ergebnis mit „Alle Werke anzeigen“. Die Karte zeigt das Datum der gewählten Sortierung.
- Sortierung und Filter werden je Gerät gemerkt (`platform/browser/storage/galleryView.ts`, localStorage,
  abgesichert); die Suche startet immer leer. **Kein** Feld im Projekt-Datensatz, keine Migration.
- Viele Werke: Karten außerhalb der Ansicht werden per `content-visibility: auto` erst bei Bedarf
  gezeichnet, Thumbnails `loading="lazy"`. Gemessen (Chromium, 150 Werke): Laden 0,3 s, Suche 0,2 s,
  Sortieren + Filtern 0,15 s; 5000 Einträge filtern und sortieren im Core < 0,3 s (Unit-Test).

### 13.5 Export
- Dateinamen: `<Projektname> JJJJ-MM-TT HHMM.<ext>`, z. B. `Oma am Meer 2026-09-24 1430.png`.
  `sanitizeFileBaseName`: für kein Dateisystem gültige Zeichen (`\ / : * ? " < > |`, Steuerzeichen) → Leerzeichen,
  unsichtbare Formatzeichen (Zero-Width, Bidi-Overrides, BOM) entfernt, Leerraum zusammengefasst, keine
  führenden/abschließenden Punkte, Leerzeichen, `_`/`-` (keine versteckten Dateien), höchstens 40 Zeichen
  ohne ein Zeichen zu zerteilen; leer/unbrauchbar → `OneLine`. Der Zeitstempel hält mehrere Exporte eines
  Werks auseinander.
- Geprüft, unverändert gut: Bild und Video werden aus dem **aktuellen** Pfad und den **aktuellen**
  Render-/Animationseinstellungen erzeugt (auch nicht gespeicherte Änderungen); „Erneut exportieren“ aus der
  Galerie nutzt die gespeicherten Werte; Video mit Richtung, Geschwindigkeit/Dauer und gespeichertem
  Startpunkt (Test des ersten Tintenpixels seit 13.2); kein Export berechnet einen Pfad oder eine Analyse
  (Worker-Zähler). Teilen auf Android über das vorhandene native `MediaExport`-Plugin (Datei an das System-
  Teilen-Menü), im Browser über die Web Share API. Fehler: verständliche Meldung + „Erneut versuchen“,
  App bleibt bedienbar (vorhandene Tests für Encoder- und Canvas-Fehler).
- Eine Loop-Einstellung gab es nicht und wurde in 13.5 nicht eingeführt (seit 13.7: Loop nur für die Vorschau).

## Projektdatei, Loop, Einstellungen (Phase 13.6–13.8)

### 13.6 Projektdatei „.onelineart“
Zusätzliches Austauschformat; die interne Speicherung (IndexedDB) bleibt unverändert.
```
"ONELINEART" | Version (1 Byte) | 0 | Manifest-Länge (uint32 LE) | Manifest (UTF-8-JSON)
| Originalbild (unverändert, genau einmal) | Pfad (float32 x/y, LE) | Thumbnail (optional)
```
- Manifest: `{ kind, formatVersion, project, sections }`; `project` hat die Form des gespeicherten
  Projekt-Datensatzes (Name, Datum, Bild-Metadaten + Inhalts-Hash, Bearbeitung, Stil/Detail/Parameter,
  Darstellung, Animation inkl. Startpunkt/Richtung/Loop, Pfad-Infos, Versionen). Kein Favorit (gehört zur
  eigenen Galerie).
- Das Original ist eingebettet, weil ein Projekt ohne es nicht geöffnet werden kann (Vorschau,
  Foto-Farben, Bearbeitung, neue Zeichnungen). Der fertige Pfad reist mit → keine Neuberechnung.
- Import (`decodeProjectFile` + `repository.importProject`): Kennung, Version (neuer →
  `incompatible-version`), exakte Größen (nichts fehlt, nichts angehängt), Manifest über die **gleiche
  strenge Prüfung** wie gespeicherte Projekte (`parseProjectRecord`, nur bekannte Felder), Inhalts-Hash des
  Originals, Pfadwerte endlich; Zeichen-Einstellungen werden neu abgeleitet bzw. ihre Engine-Parameter
  müssen die Sicherheitsgrenzen unverändert erfüllen. Neue Projekt- und Bild-ID, eindeutiger Name
  („Name – Import“, „– Import 2“ …), Erstelldatum bleibt, Änderungsdatum = jetzt, nie überschrieben.
  Ein gleiches Foto wird über den Hash geteilt, nicht doppelt gespeichert.
- UI: Export-Schritt → Abschnitt „Projektdatei“ (aktueller Stand, wie Bild/Video); „Meine Werke“ →
  „Importieren“. Android: „Speichern“ (System-Dateidialog, Ort und Name frei wählbar) und „Teilen“, da die
  Galerie nur Bilder/Videos aufnimmt; im Browser Download. Messung: 20-MB-Foto + 200 000 Punkte → 21,5 MB, Export
  49 ms, Import inkl. Prüfung 100 ms.

### 13.7 Animation: Loop
Play/Pause, Von vorn, Richtung, Geschwindigkeit und Dauer bestanden schon. Neu: `AnimationSettings.loop`
(optional, alte Projekte = aus). `tick` lässt die Zeitachse nach dem Standbild umlaufen (Modulo, ohne
Drift); die Zeichnung beginnt wieder am Startpunkt in der gewählten Richtung. Nur Vorschau — exportierte
Videos enthalten die Zeichnung einmal (Entscheidung 13.7). Keine Pfadberechnung. Während der
Startpunkt-Wahl zeigt „Wiedergabe“ nur die Startpunkt-Gruppe (mehr Platz für das Bild auf Telefonen).

### 13.8 Einstellungen (Standardwerte für neue Werke)
- `core/preferences/workDefaults.ts`: `WorkDefaults` (Stil, Detailgrad, Hintergrund Weiß/Schwarz,
  Linienbreite, Dauer, Geschwindigkeit, Richtung, Loop), `parseWorkDefaults` (robust, nie ein Fehler),
  `drawingForNewWork` / `renderForNewWork` / `animationForNewWork`. Werkseinstellungen = das bisherige
  Verhalten (Test).
- Gespeichert je Gerät (`platform/browser/storage/workDefaults.ts`, localStorage).
- Regel: **jedes neu importierte Foto** startet mit den Standardwerten (auch Darstellung und Animation);
  ein geöffnetes Werk bringt immer seine gespeicherten Werte mit — die Standards werden dort nie
  angewandt. Ein Startpunkt wird nie übernommen (gehört zu einem Bild).
- Globale Export-Voreinstellungen gab es nicht; sie wurden nicht eingeführt.
- UI: Zahnrad in der Kopfzeile → „Einstellungen“ (Android-Zurück führt zurück).

## Abschluss Phase 13 (13.9)
Reiner Regressions- und Release-Test, keine neuen Funktionen. `e2e/phase13-release.spec.ts` prüft 13.1–13.8
im Zusammenhang: ein Werk durch den ganzen Ablauf (Foto → Drehen → Orthogonal/Detail → Startpunkt →
Animation mit Richtung, Geschwindigkeit, Dauer, Loop → Speichern → Neustart → Öffnen → Bild, Video,
Projektdatei → Import → importiertes Werk inkl. Video ab dem Startpunkt), den zweiten Loop-Durchlauf
(beginnt auf geleerter Fläche wieder am Startpunkt) und die Phase-13-Bedienelemente bei 360–1280 px
(erreichbar, nicht verdeckt). Pfad- und Analyse-Worker werden dabei gezählt: nur Stil/Detail/Bearbeitung
berechnen neu. Realgerätetest (Xiaomi 15 Ultra) für 13.1–13.8 bestanden, s. `RELEASE_CHECKLIST.md`.
