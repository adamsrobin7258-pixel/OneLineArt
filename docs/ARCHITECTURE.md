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
  `EXPORT_LIMITS` begrenzt und gemeldet), `exportFileName` (`OneLine_JJJJ-MM-TT_HHMM.ext` bzw.
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
Bitmap-Kopie), danach sofort freigegeben. Video: drei Flächen in Videogröße (Hintergrund, Linienebene,
Encoder-Canvas; bei 4096×3072 ≈ 150 MB), Frames werden einzeln kodiert; im RAM wächst nur die
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

### Bekannte Grenzen (→ Teil 10)
- Zoom in der Vorschau vergrößert die 2048-px-Vorschau-Bitmap; bei starkem Zoom auf hochauflösenden
  Displays wird sie weich. Schärfer ginge es mit einem Nach-Rendern in höherer Auflösung beim Zoomen
  (nur Renderer, kein neuer Pfad).
- Die Vorschau-Leinwand ist beim Start leer (Fortschritt 0) mit Abspiel-Knopf; ein Vorschaubild des
  fertigen Werks davor wäre denkbar.
