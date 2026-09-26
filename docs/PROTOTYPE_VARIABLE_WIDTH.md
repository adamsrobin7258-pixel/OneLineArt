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
