# Phase 15.5: Organisch – Mindestabstand optimieren (experimentell)

Die Testseite ist `prototype/organic-spacing.html` (Dev-Server:
`npm run dev` → `/prototype/organic-spacing.html`; Pages: `npx vite build -c
vite.prototype.config.ts` baut sie zusammen mit der Variable-Width-Seite).
Sie ist nicht Teil der App.

Code: `src/core/experimental/organicSpacing/`. Der Ordner wird bewusst nicht aus
`src/core/index.ts` exportiert.

**Die Produktion ist unverändert.** Die Seite ruft die unveränderte
Organisch-Engine über den App-Worker auf und zeichnet mit dem App-Renderer. Sie
übergibt nur einen Parameter-Patch.

## Ausgangslage: Wie entsteht der Abstand bei Organisch?

Organisch hat **keinen expliziten Abstandsparameter**.

- Die Linie besucht Bedarfspunkte. Sie werden verteilt durch
  Stippling = gewichtete Voronoi-Relaxation mit Dichte ∝ Bedarf^γ.
- Die Punkte werden per Tour verbunden (Moore-Kurve + 2-opt).
- Der Abstand benachbarter Bahnen ≈ Punktabstand ∝ 1/√(Punktzahl).
- Am kleinsten ist er dort, wo der Bedarf am höchsten ist: dunkel, strukturreich.

Die heutigen Stellgrößen:

- Punktbudget 4 000 … 40 000. Ausgewogen = 22 000, Minimal = 11 200,
  Detail = 40 000.
- Adaptives Arbeitsraster: mindestens `minPixelsPerDensePoint` = 3 Pixel pro
  Punkt im dichtesten Bereich, Raster bis höchstens 1 600 px.
- Linienbreite beim Zeichnen: 1 px bei 1 000 px langer Kante (App-Standard).

**Heutiger Abstand** (Ausgewogen): Median 4,3–6,5 px. Einheit hier und
überall: px bei 800 px langer Kante, dieselbe Einheit wie die 3 px von Free
Orthogonal; die Linienbreite ist dort 0,8 px.

- In dunklen Bereichen liegt der Median je nach Motiv sehr unterschiedlich:
  - 1,6 px (Mond: kleine dunkle Flecken, höchster Bedarf auf kleiner Fläche)
  - 2,5 px (Katze)
  - 4,0–4,5 px (Porträt, Astronaut)
- Die Stufe **Detail** hat mit 40 000 Punkten schon heute einen Median von
  3,3–3,5 px. Bei der Katze berühren sich dort bereits 1,3 % der Linie.

## Umsetzung (reiner Parameter-Patch)

`organicSpacingParameters(base, f, detail)` für einen Abstandsfaktor f (< 1 =
enger):

- **Punktbudget × 1/f²:** Die Verteilung des Bedarfs, also wo die Linie
  hingeht, bleibt gleich.
- **`maxWorkingEdge` × 1/f** (höchstens 3 072, die Sicherheitsgrenze der
  Engine): Das Raster kann dem dichtesten Punkt weiterhin ≥ 3 Pixel geben.
  Stippling auf einem Raster kann nicht beliebig eng setzen.
- Über der Budget-Sicherheitsgrenze (120 000 Punkte) wird gekappt und das als
  „an der Budgetgrenze“ gemeldet.
- Alles andere bleibt unverändert: γ, Konturführung, Tour, Glättung, Seed und
  Startpunkt.
- f = 1 gibt exakt das Produktions-Parameterobjekt zurück (Golden-Hash getestet).

**Metrik** (`measurePassSpacing`): Für jeden Punkt der Linie (alle 0,5 px) wird
der Abstand zur nächsten *anderen* Bahn gemessen, also zu einem Stück, das
entlang der Linie weiter entfernt ist als 2 × Abstand + 1 px. Sie wird getrennt
nach der Helligkeit des Originals ausgewertet (dunkel L* < 0,35, mittel, hell
≥ 0,7).

- „Berühren“ = Abstand < Linienbreite.
- „Sehr dicht“ = Abstand < 2 Linienbreiten.

**Boden** (`limitedSpacingFactor`): Die Engine kann den Punktabstand im
dichtesten Bereich schon vor dem Lauf aus dem Bedarfsfeld berechnen:
√(Σ Bedarf / (Punkte · max Bedarf)). Das ist ihre eigene Größe
`pixelsPerDensePoint`, und sie trifft das gemessene 10-%-Quantil im Dunkeln gut:

| | Mond | Katze | Porträt | Ziegel |
|---|---|---|---|---|
| Vorhersage | 1,19 | 1,54 | 1,92 | 3,06 |
| gemessen (10 %-Quantil dunkel) | 1,05 | 1,51 | 2,78 | 2,55 |

Die Stufe „× f, Boden b“ verkleinert um f, aber nie so weit, dass dieser
dichteste Abstand unter b fällt. Bilder, die schon dicht sind, bekommen so
weniger oder keine Zusatzlinie. Das ist deterministisch, nutzt nur die
Bildanalyse, die die Engine ohnehin macht, und führt keine neue Bildabhängigkeit
in die Geometrie ein.

## Getestete Stufen

Alle Stufen wurden auf Ausgewogen, Seed 1 und Start „Auto“ gemessen. Minimal
und Detail wurden stichprobenhaft geprüft.

| Stufe | Definition |
|---|---|
| Referenz | f = 1 (Produktion) |
| −10 / −20 / −30 / −40 % | f = 0,9 / 0,8 / 0,7 / 0,6 |
| 3 / 2,5 / 2 px typisch | Median-Abstand = Ziel, f = Ziel / Median der Referenz (≤ 1) |
| −30 %, Boden 1 px | f = 0,7, dichtester Abstand ≥ 1 px |
| −40 %, Boden 1 px | f = 0,6, dichtester Abstand ≥ 1 px |
| −40 %, Boden 1,5 px | f = 0,6, dichtester Abstand ≥ 1,5 px |

„Typisch“ misst den Median über die ganze Linie. Das ist das Gegenstück zum
überall gleichen FO-Abstand. Die zuerst versuchte Definition über den Median im
Dunkeln scheitert an Bildern ohne dunkle Bereiche (High-Key).

Referenzbilder, lokal und nicht im Repository: Porträt (Grace Hopper), Katze
(Fell, Augen), Astronaut (Gesicht, Kleidung), Kaffee (Objekt, Schatten), Ziegel
(Architektur, Struktur), Gras (Feinstruktur), High-Key (hell), Mond (dunkle
Details auf Grau).

## Messwerte (Ausgewogen)

Abstand in px bei 800 px langer Kante.

### Porträt (512 × 600)

| Stufe | f | Punkte | Median | 10 % | dunkel Median | berühren | sehr dicht | Geometrie (Node) |
|---|---|---|---|---|---|---|---|---|
| Referenz | 1 | 22 000 | 4,79 | 2,88 | 4,45 | 0,2 % | 0,9 % | 1,5 s |
| −10 % | 0,9 | 27 161 | 4,34 | 2,60 | 4,01 | 0,3 % | 1,3 % | 1,6 s |
| −20 % | 0,8 | 34 375 | 3,90 | 2,32 | 3,60 | 0,3 % | 1,9 % | 2,3 s |
| −30 % | 0,7 | 44 898 | 3,42 | 2,04 | 3,13 | 0,3 % | 3,2 % | 3,0 s |
| −40 % | 0,6 | 61 111 | 2,95 | 1,77 | 2,70 | 0,4 % | 6,1 % | 4,3 s |
| 3 px | 0,63 | 56 195 | 3,08 | 1,85 | 2,81 | 0,3 % | 4,9 % | 3,9 s |
| 2,5 px | 0,52 | 80 921 | 2,58 | 1,55 | 2,35 | 0,5 % | 11,6 % | 5,7 s |
| 2 px | 0,42 | 120 000 (Grenze) | 2,13 | 1,29 | 1,95 | 1,0 % | 24,1 % | 8,0 s |

### Alle Bilder: berührende / sehr dichte Linie

| Bild | Referenz | −30 % | −40 % | 3 px (f) | 2,5 px (f) | −30 %, Boden 1 (f) | −40 %, Boden 1 (f) |
|---|---|---|---|---|---|---|---|
| Porträt | 0,2 / 0,9 % | 0,3 / 3,2 % | 0,4 / 6,1 % | 0,3 / 4,9 % (0,63) | 0,5 / 11,6 % (0,52) | 0,3 / 3,2 % (0,70) | 0,4 / 6,1 % (0,60) |
| Katze | 0,4 / 3,3 % | 0,8 / 11,3 % | 1,3 / 16,7 % | 0,9 / 12,4 % (0,67) | 1,8 / 19,8 % (0,56) | 0,8 / 11,3 % (0,70) | 1,1 / 13,8 % (0,65) |
| Mond | 0,3 / 4,4 % | 1,3 / 7,7 % | 2,4 / 9,6 % | 4,8 / 14,1 % (0,46) | 5,5 / 15,7 % (Grenze) | 0,5 / 5,7 % (0,84) | 0,5 / 5,7 % (0,84) |
| Astronaut | 0,2 / 0,9 % | 0,4 / 3,2 % | 0,4 / 6,4 % | 0,4 / 4,9 % (0,64) | 0,6 / 11,6 % (0,53) | wie −30 % | wie −40 % |
| Kaffee | 0,2 / 1,4 % | 0,3 / 5,7 % | 0,5 / 11,8 % | 0,3 / 6,0 % (0,70) | 0,5 / 13,6 % (0,58) | wie −30 % | wie −40 % |
| Ziegel | 0,4 / 1,2 % | 0,6 / 2,8 % | 0,8 / 4,0 % | 0,8 / 4,6 % (0,58) | 0,9 / 8,3 % (0,49) | wie −30 % | wie −40 % |
| Gras | 0,2 / 0,6 % | 0,3 / 1,2 % | 0,3 / 2,1 % | 0,3 / 2,7 % (0,56) | 0,5 / 6,8 % (0,47) | wie −30 % | wie −40 % |
| High-Key | 0,2 / 1,1 % | 0,3 / 3,0 % | 0,5 / 5,7 % | 0,7 / 7,7 % (0,56) | 0,9 / 14,3 % (0,47) | wie −30 % | wie −40 % |

Weitere Befunde:

- **Ton:** Die Tonabweichung sinkt mit jeder Stufe, Organisch ist heute deutlich
  zu hell.
  - Porträt dunkel: 84,6 → 81,6 (−30 %) → 80,0 L* (−40 %).
  - Mond dunkel: 55,9 → 44,9 → 37,6 L*.
- **Detail-Stärke:** Sie steigt ebenso.
  - Katze mittel: 0,14 → 0,22 (−30 %) → 0,27 (−40 %).
  - Mond dunkel: 0,22 → 0,34 → 0,49.
- **Geschlossene Fläche:** Sie ist in jeder Stufe 0 %. Kein Bereich wird zur
  schwarzen Fläche; zugelaufene Stellen sind lokale Knäuel, siehe unten.
- **Gleiches Motiv, verschiedener Faktor:** Ein absolutes Ziel („3 px“) trifft
  je Motiv sehr verschiedene Faktoren, von 0,46 (Mond) bis 0,70 (Kaffee).
  Beim Mond verschmelzen damit 4,8 % der Linie.

## Visuelle Ergebnisse

Verglichen wurde bei 1 000 px, im 4×-Ausschnitt, bei 420 px, bei 300 px und auf
der Testseite im Handy-Viewport (412 × 915, dpr 3,5).

- **Referenz:** Sie ist sehr luftig. Gesichter lesen sich in Handygröße schwach;
  Augen, Mund und Mütze des Porträts kaum.
- **−20 %:** klarer Gewinn, noch sehr ruhig.
- **−30 %:** Gesichter, Augen (Katze) und Kleidung (Astronaut) lesen sich
  deutlich. Die Linien bleiben auch im 4×-Ausschnitt getrennt, der organische
  Schwung bleibt erhalten. Die hellen Bereiche bleiben licht (Himmel, Haut),
  und die Tasse behält ihre helle Innenfläche.
- **−40 %:** In Handygröße noch etwas plastischer. An kontrastreichen Kanten
  (Augenrand der Katze, Brille) bilden sich im 4×-Ausschnitt erste dichte
  Knäuel. Beim Mond wird der dunkle Fleck kräftig, bleibt aber Linie.
- **2,5 px / 2 px:** Augen laufen zu schwarzen Knäueln zu, das Gras wird
  fleckig-unruhig. Die Linie verliert im Ausschnitt ihren Charakter und wird
  zur Schraffur.
- **Moiré:** Auch bei 300 px ist in keiner Stufe Moiré oder ein
  Parallelmuster zu sehen. Die organische Textur ist unregelmäßig; anders als
  bei Free Orthogonal gibt es keine parallelen Bündel, die aliasen könnten.
- **Boden 1,5 px:** zu streng. Katze (×0,98) und Mond (×1,0) bleiben praktisch
  unverändert.
- **Boden 1 px:** Er greift genau bei den Bildern, die schon dicht sind: Mond
  ×0,84 statt ×0,7, bei −40 % die Katze ×0,65 statt ×0,6. Alle anderen Bilder
  bekommen die volle Stufe.

## Animation

Die App zeichnet mit **konstanter Geschwindigkeit entlang der Linienlänge** in
fester Dauer. Die Testseite macht es genauso: mit Bogenlänge, langsam 30 s,
normal 12 s, schnell 4 s.

- **Reihenfolge:** Der Aufbau (Ausdehnung und Verzweigung des gezeichneten Teils
  bei 5–100 %; Porträt und Katze, Start Auto, oben links und Mitte) verändert
  sich über die Stufen nicht systematisch. Er hängt vom Startpunkt und von der
  Tour ab, nicht vom Abstand. Die Linie wächst wie heute in Regionen.
- **Früher erkennbar:** Zwischenstände bei 20 % und 50 % (Katze) zeigen:
  - Mit −30 % / −40 % sind Auge und Nase schon bei 20 % als Form erkennbar.
  - Bei der Referenz ist es zu diesem Zeitpunkt nur locker gefülltes Gewirr.
  - Dunkle Stellen wie das Auge entstehen in einem Zug, nicht in mehreren
    Durchgängen.
- **Tempo:** Die Linie wird länger, Porträt 92 700 → 131 900 px (−30 %) →
  153 100 px (−40 %). **Bei gleicher Dauer zeichnet der Stift deshalb um
  +42 % bzw. +65 % schneller.**
  - Das ist gemessen, nicht angesehen: Wie sich das bei „schnell“ (4 s)
    anfühlt, muss auf dem Gerät beurteilt werden.
  - Die Testseite bietet dafür langsam, normal und schnell.
- **Zusammengefasst:** Der geringere Abstand verbessert das Standbild und
  macht die Form während der Entstehung früher erkennbar. Die Art des Aufbaus
  bleibt gleich.

## Performance (Porträt, Ausgewogen, Chromium)

| | Referenz | −20 % | −30 % | −40 % | 2,5 px |
|---|---|---|---|---|---|
| Geometrie | 1,7 s | 2,3 s | 3,1 s | 3,8 s | 5,2 s |
| Geometrie, 4× gedrosselt (Handy) | 6,8 s | 9,5 s | 13,0 s | 17,1 s | 22,4 s |
| Zeichnen 2048 px | 0,15 s | 0,20 s | 0,24 s | 0,30 s | 0,37 s |
| Zeichnen 2048 px, gedrosselt | 0,75 s | 0,98 s | 1,18 s | 1,58 s | 1,77 s |
| Linienpunkte / Speicher | 56 127 / 0,45 MB | 76 831 / 0,61 MB | 92 302 / 0,74 MB | 113 415 / 0,91 MB | 137 841 / 1,10 MB |
| Arbeitsraster | 640 × 750 | 771 × 903 | 881 × 1032 | 1027 × 1204 | 1183 × 1386 |

- Die Geometriezeit wächst etwa linear mit den Punkten (×1,75 bei −30 %).
- Der Speicher wird vom Arbeitsraster bestimmt: ×1,9 Pixel bei −30 %, bei
  einigen MB Float-Feldern. Die Linie selbst bleibt unter 1 MB.
- Auf einem Oberklasse-Handy wie dem Xiaomi 15 Ultra ist eher mit etwa der
  ungedrosselten Desktop-Zeit bis zum Doppelten zu rechnen: −30 % ≈ 3–6 s statt
  heute 2–3,5 s.
- Die Sicherheitsgrenze des Path-Workers (60 s) ist weit entfernt.
- **Detail** mit −30 % hätte 81 600 Punkte (5–6 s Desktop) und wäre zu dicht,
  siehe unten.

## Minimal und Detail

- **Minimal −30 %** (22 857 Punkte ≈ heutiges Ausgewogen): unkritisch, maximal
  0,8 % berührend.
- **Detail** ist schon heute so dicht wie Ausgewogen −30 %.
  - Mit −30 % steigt „sehr dicht“ beim Porträt auf 20 % und bei der Katze auf
    29 %, berührend bis 4,2 %.
  - Der Boden 1 px mildert das nur zum Teil: Katze ×0,87, Mond ×1,0, Porträt
    und Kaffee ×0,7.
  - **Detail sollte daher nicht weiter verdichtet werden.**

## Empfehlung

**„−30 %, Boden 1 px“ für Ausgewogen** (und gleich für Minimal); Detail bleibt
wie heute.

- Deutlich mehr Detail und Lesbarkeit:
  - Detail-Stärke +25–60 %.
  - Tonfehler in dunklen Bereichen −3 bis −6 L*.
- Die Linien bleiben getrennt; berührend ≤ 0,8 % in allen Testbildern.
- Kein Moiré, auch nicht bei 300 px.
- Der organische Charakter bleibt erhalten, im 4×-Ausschnitt keine Knäuel.
- Der Boden schützt Motive, die schon dicht sind (Mond), automatisch.
- Rechenzeit ×1,75 (Desktop 3 s): tragbar.
- Die Animation baut sich gleich auf, die Form wird früher erkennbar. Stift +42 % bei gleicher Dauer.

**Zweiter Kandidat für den Gerätetest:** „−40 %, Boden 1 px“. Er ist im Standbild
auf Handygröße noch plastischer, zeigt aber im Ausschnitt erste Knäuel, macht
den Stift um 65 % schneller und braucht ×2,2 Rechenzeit.

**Nicht empfohlen:**

- **2,5 px und 2 px:** Knäuel, Kritzel-Charakter, Budgetgrenze, bis 8 s.
- **Absolute „px“-Ziele allgemein:** Sie treffen je Motiv sehr verschiedene
  Faktoren und überladen gerade dichte Motive.

**Folge für eine spätere Integration:** Ausgewogen −30 % hat etwa so viele
Punkte wie das heutige Detail. Die drei Detailstufen rücken dadurch näher
zusammen und müssten neu abgestimmt werden. Dazu gehört auch die Frage, ob die
Animationsdauer mit der Linienlänge wachsen sollte. Nichts davon ist in dieser
Phase umgesetzt.

## Testseite

- Abstandsstufe (B) wählen, die Empfehlung ist mit ★ markiert.
- Referenzbild: laden oder Testtafel.
- Detailstufe, Seed (−/+), Startpunkt (Auto, 4 Ecken, Mitte).
- Ansichten: A | B nebeneinander, A/B umschalten (ein Bild, Umschalt-Knopf),
  alle Stufen.
- Darstellung:
  - Handy: volle Breite.
  - 600 px, 300 px und 1:1: echte Gerätepixel, keine Browser-Skalierung.
  - Dazu Vergrößerung 1× / 2× / 4×.
- „Entstehung abspielen“: langsam, normal oder schnell, mit Schieber.
- „Messwerte berechnen“:
  - Faktor, Punkte, Arbeitsraster, Rechenzeit, Speicher.
  - Abstand (Median, 5 %, 10 %, dunkel/mittel/hell), berührend, sehr dicht.
  - Tonabweichung, Detail-Stärke, geschlossene Fläche, Zeichenzeit.

## Grenzen

- Die Metrik misst den Abstand zur nächsten anderen Bahn. Kreuzungen der Tour
  zählen als Abstand ≈ 0 und damit als „berührend“.
- Die Detail-Stärke hängt am Blur-Maßstab von 5 px; sie dient nur dem Vergleich
  der Stufen untereinander.
- Die Zahlen für das Handy sind mit gedrosseltem Chromium geschätzt. Die echte
  Messung auf dem Xiaomi steht aus.
