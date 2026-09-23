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
  platform/         Browser-Adapter (Bild-Decoder, Analyse-Worker, Canvas; später IndexedDB, Video)
  core/             UI- und plattformfreie Kernlogik
    models/           Datenmodelle
    utils/            Seeded RNG, Hashing, Mathe
    imageImport/      Formaterkennung, Header/EXIF, Import-Ablauf, Import-Status (Teil 2)
    imageProcessing/  ImageOperation, fitWithin/orientedSize
    imageAnalysis/    Bildanalyse: Luminanz, Kontrast, Kanten, Detail, Textur, Importance (Teil 3)
    engine/           OneLinePath-API, Generator-/Optimizer-Schnittstellen, Pipeline
    rendering/        PathCursor, tracePath, SVG-Rendering
    animation/        AnimationTimeline (Zeit -> Position auf dem echten Pfad)
    export/           Exporter-Schnittstellen                 (Impl. Teil 8)
    storage/          ProjectRepository + In-Memory-Impl.     (IndexedDB Teil 8)
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
- `placeholderGenerator` (Random Walk, ignoriert den Bildinhalt) → One-Line-Algorithmus in Teil 4
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
