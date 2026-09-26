# Prototyp: Konstanter Linienabstand, variable Liniendicke (Phase 15.1)

**Experimentell.** Nicht Teil der App, der Zeichenstile, der Projekte oder des
Produktionsbuilds. Die bestehenden Engines (Organisch, Geometrisch, Orthogonal),
ihre Golden-Referenzen und die Oberfläche sind unverändert. Der Produktionsbuild
ist bit-identisch zum Stand vor dem Prototyp.

## Öffnen

```
npm run dev
# → http://localhost:5173/prototype/variable-width.html
```

Eigene HTML-Seite, keine Route der App. `vite build` baut nur `index.html`,
die Seite gelangt daher nicht in `dist/` und nicht in die APK.

## Aufbau

```
src/core/experimental/variableWidth/     reiner Kern (kein React, kein DOM; Architekturtest gilt)
  parameters.ts   Parameter, Standardwerte, Grenzen, Validierung (jede Anpassung wird gemeldet)
  toneField.ts    Bild → Tonfeld: L* → Tonwertumfang → Detailverstärkung → Kontrast → Glättung
  transfer.ts     Helligkeit → Liniendicke (wahrnehmungsgleich | linear)
  routes.ts       Mittellinie: Mäander (Zeilen/Spalten) oder Spirale — als EIN Polylinienzug gebaut
  generate.ts     Orchestrierung → VariableWidthLine { path: OneLinePath, widths }
  outline.ts      Umriss als EINE geschlossene Fläche (Canvas, SVG)
  metrics.ts      Abstandsmessung, Vergleich mit dem Original (beschreibend)
src/prototype/variableWidth/             Testseite (React), Worker, Vergleich mit der organischen Linie
prototype/variable-width.html            Einstieg der Testseite
tests/core/experimental/variableWidth.test.ts
```

Bewusst **nicht** aus `src/core/index.ts` exportiert. Wiederverwendet (unverändert):
`luminanceField`, `gaussianBlur`, `percentile`, `mapField`, `resampleField`,
`fitWithin`, `validateOneLinePath`, auf der Testseite Bildimport, Analyse-/Pfad-Worker
und der Artwork-Renderer für den Vergleich.

Die Mittellinie ist ein normaler `OneLinePath` (ein Koordinatenpuffer). Die Dicke
ist ein paralleles `Float32Array` pro Punkt. Eine spätere Integration braucht
daher nur eine optionale Breitenspur im Pfadmodell, keinen neuen Pfadtyp.

## Algorithmus

1. **Arbeitsraster**: Bild auf `workingLongEdge` (Standard 800 px) skaliert, auch
   hochskaliert. Alle Längen (Abstand, Dicken) beziehen sich auf dieses Raster.
2. **Tonfeld** (L*, 0 = schwarz, 1 = weiß):
   - Luminanz: Flächenmittel im linearen Licht.
   - Tonwertumfang: 0,5 %–99,5 %-Perzentile → 0…1, nur ab einem Umfang von 0,1.
   - Detailverstärkung: `L += detail · gate(L − blur(L, 2·Abstand))`. Das Gate
     `h³/(h² + τ²)` mit τ = 3 × geschätztes Rauschen (MAD des Feinanteils) blendet
     Rauschen aus.
   - Kontrast: S-Kurve (> 0) oder Stauchung zur Mitte (< 0), monoton, f(0,5) = 0,5.
   - Glättung: isotroper Gauß, σ = `smoothing` × Abstand. Wirkt zugleich als
     Anti-Aliasing, denn quer zur Linie wird nur alle `spacing` Pixel abgetastet.
3. **Route** (hängt nur von Größe, Abstand und Start ab, nie vom Bild):
   - *Mäander*: Zeilen im Abstand `spacing`, vertikal zentriert. Die Wenden sind
     Halbkreise mit Radius `spacing/2`, die genau bis an den Rand reichen. Auch
     benachbarte Wenden haben so den Abstand `spacing`; es gibt keine Knicke.
     Der Mäander startet an der Ecke, die dem Startpunkt am nächsten liegt.
   - *Spirale*: archimedisch, r = spacing · θ / 2π um den Startpunkt. Windungen
     haben überall genau den Abstand `spacing`. Wo eine Windung das Bild verlässt,
     wird sie auf den Rand projiziert: stetig, mit minimaler Dicke, wirkt wie ein
     feiner Rahmen.
4. **Dicke** je Abtastpunkt (1 px Abstand), bilinear aus dem Tonfeld:
   - *wahrnehmungsgleich* (Standard): L wird linear in L* auf den darstellbaren
     Bereich [L*(1 − max/s), L*(1 − min/s)] abgebildet, dann gilt Deckung
     = 1 − Y(L*), Dicke = Deckung × Abstand. Jede Helligkeitsstufe des Fotos wird
     zur gleichen wahrgenommenen Stufe. Helle Töne reagieren dadurch ≈ 1,5× steiler
     als linear (mehr Licht-Details), dunkle flacher.
   - *linear*: Dicke linear in der Dunkelheit (zum Vergleich).
5. **Punkte zusammenfassen**: Abtastpunkte auf gerader Linie mit linearem
   Dickenverlauf entfallen (Toleranz 0,02 px, höchstens 32 Punkte je Lauf).
   Ergebnis: etwa 25 % der Abtastpunkte.
6. **Zeichnen**: linke Kante vorwärts, runde Kappe, rechte Kante zurück, Kappe.
   Eine Fläche, gefüllt mit der Nonzero-Regel. Kein Strich pro Segment, keine Nähte.

Deterministisch: kein Zufall, identische Eingabe ⇒ bitgleiches Ergebnis.

## Standardwerte

| Parameter | Standard | Grenzen |
|---|---|---|
| Arbeitsauflösung | 800 px | 32…2048 |
| Linienabstand | 4 px (≙ 200 Linien auf der langen Seite) | 1,5…40 |
| Minimale Dicke | 0,45 px (11 % Deckung, nie 0) | ≥ 2 % des Abstands |
| Maximale Dicke | 3,3 px (82,5 % Deckung) | ≤ 90 % des Abstands |
| Kontrast | 0 | −1…1 |
| Detailverstärkung | 0,6 | 0…2 |
| Glättung | 0,35 × Abstand | 0…2 |
| Startpunkt | oben links | 0…1 normiert |
| Linienführung | Mäander (Zeilen) | Zeilen, Spalten, Spirale |
| Kennlinie | wahrnehmungsgleich | wahrnehmungsgleich, linear |
| Tonwertumfang strecken | an | – |

Zur Glättung wurden 0 / 0,2 / 0,35 / 0,6 / 1,0 geprüft. Detail-Stärke in hellen
Bereichen, Astronaut / Kameramann: 0,69 / 0,65 → 0,69 / 0,64 → 0,68 / 0,62 →
0,65 / 0,58 → 0,59 / 0,50. Bis 0,35 geht praktisch kein Detail verloren, darüber
deutlich. Unter ≈ 0,25 fehlt das Anti-Aliasing (Moiré bei feinen waagerechten
Strukturen, sichtbar am Ziegelmuster). Deshalb 0,35.

## Messungen (Node, 1000 px, Mischung im linearen Licht)

Detail-Stärke = Regressionssteigung des Bandpasses (1–4 Linienabstände) der
Zeichnung gegen das Original: 1 bedeutet voller lokaler Kontrast. Werte für
**helle** Bildbereiche (L* ≥ 70):

| Motiv | wahrnehmungsgleich | linear | ohne Detailverstärkung | Organisch |
|---|---|---|---|---|
| Astronaut | 0,68 | 0,61 | 0,59 | 0,08 |
| Kaffee | 0,61 | 0,50 | 0,54 | 0,08 |
| Kameramann | 0,62 | 0,54 | 0,56 | 0,07 |
| Grace Hopper | 0,66 | 0,62 | 0,60 | 0,08 |
| Katze | 0,69 | 0,48 | 0,65 | 0,17 |
| Testtafel | 0,69 | 0,57 | 0,57 | – |

Die organische Linie stellt Ton über die Liniendichte auf größerem Maßstab dar.
Ihr niedriger Wert bei diesem feinen Maßstab ist deshalb eine Beschreibung und
kein Urteil.

## Bekannte Grenzen

| Thema | Stand |
|---|---|
| Tonumfang | Mit sichtbarem Spalt (≤ 90 % Deckung) wird keine Fläche dunkler als ≈ L* 38 (Standard 82,5 %: ≈ L* 50). Tiefschwarz verlangt ineinanderlaufende Linien. Aus Betrachtungsabstand wirken die Bilder daher heller und flacher als das Foto. |
| Anmutung | Der Mäander ist technisch ein Linienraster (wie ein Kupferstich oder eine Linien-Rasterung). Die Spirale wirkt künstlerischer, zeigt aber am Startpunkt ein „Zielscheiben“-Zentrum. |
| Auflösung quer zur Linie | Details feiner als ≈ 1 Linienabstand quer zur Linie gehen verloren. Längs der Linie ist die Auflösung viel höher (Anisotropie des Linienrasters). |
| Spirale am Rand | Außerhalb liegende Windungsteile laufen als feiner Rahmen am Rand entlang: bis ≈ 50 % der Routenlänge, relevant für eine spätere Animation. |
| Canvas-Antialiasing | Browser mischen Kantenpixel in sRGB statt linear. Sehr dünne Linien wirken am Bildschirm etwas dunkler als berechnet. |
| Mäander-Start | Nur an einer Ecke möglich, ohne Teile doppelt zu zeichnen. |

## Performance (2048 px Arbeitskopie)

| Fall | Desktop Node | Chromium | Chromium 4× gedrosselt (≈ Mittelklasse-Handy) |
|---|---|---|---|
| Mäander, 800 px | 150 ms | 200 ms | 760 ms |
| Spirale, 800 px | 270 ms | 240 ms | 940 ms |
| Mäander, 1600 px | 420 ms | – | – |
| Spirale, 1600 px | 1340 ms | – | – |
| Zeichnen 2048 px (Mäander / Spirale) | – | 41 / 83 ms | 168 / 408 ms |

Speicher: 0,3–1,6 MB pro Linie. Mögliche Optimierungen, falls nötig:
- Außenteile der Spirale analytisch überspringen (die Hälfte der Abtastpunkte).
- Tonfeld einmal berechnen und bei reinen Dicken- oder Routenänderungen wiederverwenden.
- Abtastschritt 1,5 px statt 1 px.

---

# Phase 15.2: Pfadgeometrien bei konstantem Abstand

Unverändert bleibt der Grundsatz: **Das Bild bestimmt nie die Lage der Linie, nur ihre Dicke.**
Die Mittellinie hängt nur von Arbeitsraster, Abstand, Startpunkt und den
Geometrie-Parametern ab. Tonfeld, Kennlinie, Detailverstärkung und Glättung sind
unverändert. Die Phase-15.1-Routen sind bitgleich; ein Test vergleicht Hashes mit
dem Commit `7ff48fd`.

## Neue Dateien und Änderungen

| Datei | Inhalt |
|---|---|
| `curvedRoutes.ts` (neu) | Spirale (Bögen), Organischer Mäander, Fließende Kurve; gemeinsame Halbkreis-Wenden |
| `spacing.ts` (neu) | Abstands- und Dickenstatistik für jede Linienform |
| `parameters.ts` | Neue Routen, `arcCenter`, `bend`, `widthMode` (Sicher/Kontrolliert/Frei) |
| `transfer.ts` | Nur für Dicken über 90 % des Abstands: Zusatzdicke in den dunkelsten Tönen (im Modus „Sicher“ unverändert) |
| `generate.ts` | Auswahl der neuen Routen, Diagnose `curved`, Version 0.2.0 |
| Testseite | Auswahl der vier Linienführungen, Sechsfach-Vergleich, gemeinsamer Ausschnitt-Zoom (1–8×), Startpunkt antippen und ziehen, Abstands-Presets 3–10 px, Dicken-Modi, erweiterte Messtabelle |

## Geometrische Grundlage und Grenzen

1. **Exakt konstanter Abstand verlangt Parallelkurven.** Alle Bahnen müssen Offsets
   einer einzigen Grundkurve sein. Ein Offset bleibt nur glatt, solange der Abstand
   zur Grundkurve kleiner ist als deren Krümmungsradius. Über ein ganzes Bild sind
   deshalb nur sanfte Krümmungen möglich.
2. **Gekrümmte Zeilen über die volle Breite können den Abstand nicht exakt halten.**
   Wenn die Zeilen das Rechteck lückenlos füllen und links und rechts enden, ist der
   obere Bildrand selbst eine Zeile. Alle Offsets eines Geraden sind gerade. Der
   organische Mäander ist deshalb bewusst eine gemessene Näherung.
3. **Eine einzige Linie ohne Rahmen braucht Bahnen, die das Bild in einem Stück
   durchqueren.** Das ist garantiert, wenn jede Bahn in x und in y monoton verläuft.
   Spirale und Fließende Kurve sind so gebaut.
4. **Konzentrische Kreise um einen Punkt im Bild zerfallen zu den Ecken hin in
   mehrere Bögen**, bei einem Punkt im Inneren bis zu vier. Eine einzige Linie
   bräuchte dann Sprünge, Überlappungen oder einen Rahmen; genau das war das
   Randproblem der 15.1-Spirale. Ohne diese Probleme geht es nur, wenn das Zentrum
   an oder außerhalb einer Ecke liegt. Ein frei im Bild gewählter Mittelpunkt ist
   deshalb mit „eine Linie, konstanter Abstand, kein Rand“ nicht vereinbar. Das gilt
   für jede Kreis- oder Ringfamilie. Einzige Ausnahme ist die eckige
   Rechteckspirale, deren Zentrum durch das Bild festgelegt ist (die Mittelachse).

## Die Varianten

| | Mäander – Referenz | Spirale (Bögen) | Organischer Mäander | Fließende Kurve |
|---|---|---|---|---|
| Prinzip | gerade Zeilen, Halbkreis-Wenden (15.1) | konzentrische Kreisbögen um ein Zentrum an/außerhalb der Start-Ecke | volle Zeilen, verschoben um `A·sin(πY/H)·h(x,Y)` aus zwei langen Wellen | exakte Parallelkurven einer „Flusskurve“ (Sinus im Tangentenwinkel), schräg |
| Abstand (6 Fotos, 800 px) | 4,00 (5–95 %: 4,00…4,00) | 4,03 (3,98…4,01) | 4,00 (3,69…4,34) | 4,03 (3,99…4,00) |
| Standardabweichung | 0,15 | 0,26 | 0,25 | 0,28 |
| Exakt? | ja | ja, außer an schrägen Wenden | Näherung, max. ±12 % × Schwung | ja, außer an schrägen Wenden |
| Startpunkt | nächste Ecke | nächste Ecke (Zentrum dahinter) | nächste Ecke | nächste Ecke |
| Rand | Wenden berühren den Rand | keine Rahmenlinie; kleine Keillücken an schrägen Wenden | wie Referenz | wie Spirale |
| Zentrum/Zielscheibe | – | keins im Bild (nur Viertelringe in der Ecke bei Zentrum 0) | – | – |
| Detail-Stärke hell / mittel / dunkel | 0,71 / 0,86 / 0,46 | 0,72 / 0,85 / 0,46 | 0,71 / 0,85 / 0,46 | 0,73 / 0,85 / 0,46 |
| Berechnung (Node, 800 px) | ≈ 175–215 ms | ≈ 180–200 ms | ≈ 180–190 ms | ≈ 280–300 ms |

Die Abstandswerte stammen aus `measureLineGeometry`. Gemessen wird der Abstand jedes
Linienpunkts (alle halben Abstände, inklusive Wenden) zur nächsten anderen Bahn. Die
Maxima von 8–9 px entstehen an Wenden und Ecken. Die Detail-Stärke ist mit
Mischung im linearen Licht gemessen. Im Browser-Canvas, dessen Kantenglättung in
sRGB arbeitet, zeigen schräge und gekrümmte Linien rund 10 % weniger Detail-Stärke
als waagerechte (0,70–0,73 statt 0,81 bei Grace Hopper). Das ist ein
Darstellungseffekt und keiner der Geometrie.

**Beobachtungen:**
- **In Originalgröße** wirken Spirale und Fließende Kurve deutlich mehr wie eine
  gezeichnete Linie (Stich, Handschraffur) als die waagerechten Zeilen. Der
  organische Mäander wirkt wie die Referenz mit leichtem Schwung.
- **Verkleinert** (Übersicht, Handy-Ansicht): Alle Varianten wirken wie ein
  Graustufenfoto. Der organische Mäander erzeugt in ruhigen Flächen sichtbare
  Moiré-Ringe; die Wellen der Zeilen interferieren mit dem Pixelraster der Anzeige.
  In Originalgröße gibt es dieses Moiré nicht.
- **Größere Abstände** (6–8 px) machen die Linie als Linie sichtbar. Feine Details
  (Falten, Brillengestell) werden entsprechend gröber.

## Dicke darf Abstand überschreiten (Experiment)

| Modus | Grenze | Voreinstellung der Testseite | Wirkung (Porträt, 6 px) |
|---|---|---|---|
| Sicher | ≤ 90 % | 82,5 % | Tonabweichung dunkel 42,6 L*, Detail dunkel 0,26, Überlappung 0 % |
| Kontrolliert | ≤ 120 % | 115 % | Tonabweichung dunkel 6,8 L*, Detail dunkel 0,86, 40 % der Linie berührt die Nachbarbahn |
| Frei | ≤ 200 % | 180 % | Tonabweichung dunkel 5,8 L*, 53 % Berührung |

Die Zusatzdicke über 90 % hinaus fließt nur in Töne unter L* 35 (quadratischer
Anstieg), hellere Töne bleiben exakt wie im Modus „Sicher“. Dunkle Töne werden damit
darstellbar. In großen dunklen Flächen (Haare, Jacke) verschmelzen die Linien aber zu
geschlossenem Schwarz; die Linienstruktur ist dort weg.

## Performance (Arbeitskopie 2048 px)

| | Node 800 / 1200 / 1600 px | Chromium | Chromium 4× gedrosselt |
|---|---|---|---|
| Mäander – Referenz | 174 / 284 / 437 ms | 173 ms | 726 ms (+ 177 ms Zeichnen) |
| Spirale (Bögen) | 182 / 306 / 486 ms | 193 ms | 909 ms (+ 394 ms) |
| Organischer Mäander | 177 / 327 / 539 ms | 235 ms | 844 ms (+ 178 ms) |
| Fließende Kurve | 295 / 520 / 965 ms | 296 ms | 1255 ms (+ 311 ms) |
| Spirale 15.1 | 336 / 738 / 1316 ms | – | – |

Die Fließende Kurve ist langsamer, weil jede Bahn aus der gesamten Grundkurve
versetzt und dann zugeschnitten wird (2,4× mehr Abtastpunkte). Mögliche
Optimierungen: nur den sichtbaren Teil der Grundkurve je Bahn versetzen und die
Grundkurve gröber abtasten (0,55 statt 0,4 px). Die Abstandsmessung dauert
0,1–0,2 s auf dem Desktop und läuft nur auf Knopfdruck.

## Offene Punkte vor einer Integration

- Die schrägen Wenden lassen kleine Keillücken am Rand. Wenden mit variablem Radius
  würden das verbessern.
- Moiré bei verkleinerter Darstellung, besonders beim organischen Mäander. Nötig
  wären eine Vorschau mit echter Flächenmittelung oder ein Mindestabstand relativ
  zur Anzeigegröße.
- Canvas-Kantenglättung in sRGB lässt dünne schräge Linien anders wirken als
  waagerechte. Das Rendering sollte in linearem Licht oder mit Supersampling
  kalibriert werden.
- Der Startpunkt ist für alle rahmenfreien Varianten an eine Ecke gebunden (siehe
  Grundlage, Punkt 4).
- Die Modi „Kontrolliert“ und „Frei“ bringen dunkle Töne zurück, erzeugen aber
  geschlossene Flächen.

---

# Phase 15.3: Free Orthogonal (freie orthogonale Linienführung)

Weiterhin gilt: **Das Bild bestimmt nur die Dicke, nie die Lage der Linie.** Die
Routen aus 15.1 und 15.2 sind bitgleich (Hash-Tests gegen `7ff48fd` und `34c32c0`).

## Konstruktion (`orthogonalMaze.ts`)

Spannbaum-Umrundung (Spanning Tree Coverage):

1. Das Bild wird in Grobzellen von 2 × Abstand eingeteilt; jede enthält 2 × 2
   Feinzellen von 1 × Abstand.
2. Ein Spannbaum verbindet alle Grobzellen (Kruskal). Die Kantengewichte mischen ein
   langsames Richtungsfeld mit einem Zufallsanteil pro Kante (Seed). Das Feld besteht
   aus drei langen Wellen mit Seed-Phasen und ergibt die bevorzugte
   Korridorrichtung. Die Ordnung steuert den Anteil des Felds: 1 ergibt lange
   Korridore, die dem Feld folgen, 0 ein Zufallslabyrinth.
3. Jede Grobzelle ist zunächst eine kleine Quadratschleife durch ihre vier
   Feinzellmitten. Jede Baumkante verschmilzt zwei Schleifen: Die gegenüberliegenden
   Seiten werden durch zwei Brücken ersetzt. Nach N − 1 Baumkanten bleibt genau eine
   Schleife durch alle Feinzellen. Die Linie läuft um den Baum herum wie eine Hand an
   den Wänden eines Labyrinths.
4. Die Schleife wird an der Feinzelle geöffnet, die dem Startpunkt am nächsten liegt.
   Die Linie beginnt dort und endet einen Abstand daneben.

**Eigenschaften (konstruktiv garantiert, per Test geprüft):**
- nur waagerechte und senkrechte Segmente, jede Richtungsänderung genau 90°
- keine Kehrtwende auf der Stelle; eine U-Wende besteht aus zwei 90°-Ecken im Abstand
- keine Selbstkreuzung: jede Feinzelle wird genau einmal besucht
- benachbarte Bahnen haben exakt den Abstand
- Rand kleiner als ein Abstand je Seite
- Startpunkt überall im Bild wählbar

**Kreuzungen – Entscheidung:** Es gibt keine. Die Konstruktion ergibt eine einfache
geschlossene Gitterschleife. Echte Kreuzungen würden den Abstand an der
Kreuzungsstelle auf 0 setzen und die Dicke dort verdoppeln. Zum Labyrinth-Charakter
braucht es sie nicht.

## Abstand (Porträt, 800 px Arbeitsauflösung, Messung aller halben Abstände inklusive Wenden)

| Abstand | Mäander – Ref. (Mittel / σ / Min / 5–95 %) | Spirale | Organischer Mäander | Fließende Kurve | Free Orthogonal |
|---|---|---|---|---|---|
| 3 px | 3,011 / 0,109 / 3,00 / 3,00–3,00 | 3,018 / 0,189 / 2,62 / 2,99–3,00 | 2,995 / 0,184 / 2,72 / 2,76–3,25 | 3,023 / 0,212 / 2,98 / 2,99–3,00 | **3,004 / 0,062 / 3,00 / 3,00–3,00** |
| 4 px | 4,019 / 0,168 / 4,00 / 4,00–4,00 | 4,034 / 0,283 / 3,98 / 3,98–4,00 | 3,999 / 0,257 / 3,63 / 3,69–4,34 | 4,037 / 0,303 / 3,67 / 3,99–4,00 | **4,006 / 0,093 / 4,00 / 4,00–4,00** |
| 5 px | 5,027 / 0,223 / 5,00 / 5,00–5,00 | 5,051 / 0,369 / 4,98 / 4,98–5,00 | 5,002 / 0,334 / 4,54 / 4,61–5,43 | 5,057 / 0,402 / 4,64 / 4,99–5,00 | **5,009 / 0,127 / 5,00 / 5,00–5,00** |
| 6 px | 6,043 / 0,298 / 6,00 / 6,00–6,00 | 6,081 / 0,501 / 5,98 / 5,98–6,01 | 6,017 / 0,429 / 5,45 / 5,53–6,53 | 6,088 / 0,537 / 5,66 / 5,99–6,00 | **6,012 / 0,160 / 6,00 / 6,00–6,00** |
| 8 px | 8,087 / 0,493 / 8,00 / 8,00–8,00 | 8,155 / 0,756 / 7,98 / 7,98–8,85 | 8,049 / 0,623 / 7,28 / 7,38–8,73 | 8,168 / 0,808 / 7,22 / 7,99–8,53 | **8,019 / 0,229 / 8,00 / 8,00–8,00** |
| 10 px | 10,146 / 0,708 / 10,00 / 10,00–10,52 | 10,258 / 1,039 / 9,98 / 9,98–12,28 | 10,103 / 0,860 / 9,10 / 9,22–10,94 | 10,281 / 1,128 / 9,12 / 9,99–12,34 | **10,028 / 0,309 / 10,00 / 10,00–10,00** |

Das Maximum ist bei Free Orthogonal immer 2 × Abstand. Es entsteht an Sackgassen des
Baums (dem Ende einer U-Wende) und an Punkten, deren nächste Nachbarbahn diagonal
liegt.

## Bild und Detail

**Detail-Stärke (9 Testbilder, Mittelwerte):**
Free Orthogonal erreicht hell / mittel / dunkel 0,69 / 0,75 / 0,41. Die anderen Varianten
liegen bei 0,69–0,70 / 0,76 / 0,43. Der Detailvorteil bleibt also erhalten.

**Dicken-Modi (Porträt, Free Orthogonal):**

| | Sicher | Kontrolliert (115 %) | Frei (180 %) |
|---|---|---|---|
| 4 px: Tonabweichung dunkel / geschlossene Fläche | 42,9 L* / 0 % | 6,6 L* / 41,7 % | 6,3 L* / 45,6 % |
| 6 px | 43,7 L* / 0 % | 9,3 L* / 37,1 % | 8,7 L* / 41,2 % |
| 8 px | 42,7 L* / 0 % | 7,4 L* / 36,3 % | 7,1 L* / 40,5 % |

Beim Mond (wenige Tiefen) bleibt die geschlossene Fläche auch in „Frei“ unter 0,5 %.

## Beobachtungen

- **Die Korridorstruktur ist unabhängig vom Bild sichtbar.** Wo das Richtungsfeld
  wechselt (waagerechte zu senkrechten Korridoren), entstehen Flecken mit anderer
  Schraffurrichtung. Sie haben nichts mit dem Motiv zu tun und fallen in ruhigen
  Flächen auf.
- **Die Ordnung prägt die Wirkung:**
  - 0,8: lange Korridore, große gleichgerichtete Felder; ähnelt einem Mäander mit
    Richtungswechseln.
  - 0,5: sichtbar labyrinthartig, noch ruhig.
  - 0,3: dicht verwinkelt; die Ecken wirken im Bild wie Körnung.
- **Helle Flächen zeigen das Labyrinth am deutlichsten** (dünne Linie). In dunklen
  Flächen dominiert die Dicke, und das Muster tritt zurück.
- **Die Ecken** sind echte 90°-Ecken; der Umriss wird dort mit Gehrung gefüllt, dicke
  Ecken wirken dadurch etwas kräftiger.
- **Verkleinert** (Handy) liest sich die Struktur als feine Textur. In Originalgröße
  1:1 (neue Anzeige auf der Testseite) ist der Labyrinth-Charakter klar erkennbar.

## Performance (2048 px Arbeitskopie)

| | Node 800 / 1200 / 1600 px | Chromium | Chromium 4× gedrosselt |
|---|---|---|---|
| Mäander – Referenz | 152 / 276 / 459 ms | 171 ms | 675 ms (+ 139 ms Zeichnen) |
| Spirale | 144 / 302 / 501 ms | 238 ms | 816 ms (+ 383 ms) |
| Fließende Kurve | 228 / 537 / 945 ms | 380 ms | 1279 ms (+ 339 ms) |
| Free Orthogonal | 157 / 312 / 493 ms | 212 ms | 702 ms (+ 194 ms) |

Die Route selbst (Baum + Schleife) braucht 17 / 55 / 88 ms. Der Speicher liegt bei
0,34–1,1 MB pro Linie plus 1,7–6,8 MB vorübergehend.

## Testseite

- Linienführung „Free Orthogonal“ mit den Reglern Ordnung, Feldgröße und Seed
  (− / +)
- freier Startpunkt (antippen oder ziehen)
- Vergleich mit allen Varianten sowie der produktiven Orthogonal- und
  Organisch-Linie
- „Abstand anzeigen“: jeder Messpunkt farbig nach Abweichung (±1 %, ±1–5 %,
  weiter, enger)
- Anzeige „Handy (verkleinert)“ oder „Originalgröße 1:1“ (ein Arbeitsraster-Pixel
  pro CSS-Pixel, scrollbar)

## Grenzen

- Die Labyrinth-Felder entstehen aus dem Richtungsfeld, nicht aus dem Motiv.
  Richtungswechsel können deshalb mitten durch ein Gesicht laufen.
- Rand bis knapp 1 Abstand je Seite (das Gitter braucht gerade Zellzahlen).
- Mindestlänge je Korridorstück ist 1 Abstand. Bei kleiner Ordnung entstehen viele
  kurze Stücke, die wie Körnung wirken.
- Die 90°-Ecken bleiben bei jeder Dicke echte Ecken. Abgerundete Ecken wären eine
  spätere Option, verletzen aber die Vorgabe „keine Rundungen“.
