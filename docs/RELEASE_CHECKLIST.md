# Release-Checkliste – One Line

Stand: Teil 10. ✅ = automatisiert oder im Browser geprüft · ⚠️ = eingeschränkt geprüft · ❌ = nicht geprüft (nicht verfügbar)

## Funktion
- [x] ✅ Bildimport (JPG/PNG/WebP, EXIF-Orientierung, Fehlerfälle) – `import.spec`, `qa.spec`
- [x] ✅ Analyse – `analysis.spec`, `realistic.spec` (10 Motive)
- [x] ✅ Minimal – `realistic.spec`, `detail.spec`
- [x] ✅ Balanced
- [x] ✅ Detail
- [x] ✅ Schwarz
- [x] ✅ Farbe
- [x] ✅ Vorschau (Zoom inkl. schärferem Nach-Rendern)
- [x] ✅ Animation (Abspielen, Pause, Fortsetzen, Von vorn, Hintergrund-Pause)
- [x] ✅ Endstand (2 s, Vorschau und Video, Endbild pixelidentisch)
- [x] ✅ PNG (Header, Größe, Seitenverhältnis)
- [x] ✅ JPEG (Header, ohne Transparenz)
- [x] ⚠️ Video – WebM/VP9 geprüft; MP4/H.264 nicht auf einem Gerät geprüft
- [x] ✅ Speichern
- [x] ✅ Galerie
- [x] ✅ Öffnen (ohne Analyse/Pfadberechnung)
- [x] ✅ Umbenennen
- [x] ✅ Löschen (inkl. gemeinsames Original)

## Qualität
- [x] ✅ Desktop (1920×1080, 1440×900, 1280×800)
- [x] ⚠️ Mobile – Viewports 390×844, 393×873, 430×932 in Chromium; keine echten Geräte
- [ ] ❌ Safari (nicht verfügbar)
- [ ] ❌ Firefox (nicht verfügbar)
- [x] ✅ Chromium
- [x] ✅ Accessibility (Tastatur, Fokus, Dialoge, Kontrast, Touch-Ziele)
- [x] ✅ Reduced Motion
- [x] ✅ IndexedDB (atomar, beschädigt, inkompatibel, leer, mehrere Projekte, gemeinsames Original)
- [x] ✅ große Bilder (6000×4000; iOS-Canvas-Grenze simuliert)
- [x] ✅ große Exporte (4096, Original, 4096-Video; kein Speicherleck)
- [x] ✅ Fehlerfälle (Datei, Encoder, WebCodecs, IndexedDB, Canvas-Grenze, Abbruch)

## Release
- [x] ✅ alle Unit-Tests (`npm run check`)
- [x] ✅ alle Browser-Tests (`npm run test:e2e`)
- [x] ✅ Production-Build (`npm run build`) und im Browser geprüft
- [x] ✅ keine Console-Errors im normalen Flow (`qa.spec`)
- [x] ✅ keine offenen kritischen TODOs
- [x] ✅ keine Debug-Ausgaben im normalen Flow (Debug nur mit `?debug=analysis`)
- [x] ✅ Dokumentation aktuell (`docs/ARCHITECTURE.md`)

## Vor einem öffentlichen Release noch offen
- [ ] Test auf Android + Chrome (H.264/MP4, Teilen, große Bilder)
- [ ] Test auf iPhone/iPad + Safari (Canvas-Grenzen, HEIC, Video, Teilen)
- [ ] Test in Firefox und Safari (Desktop)

## Phase 12 – Stand nach 12.4
- [x] ✅ Projekte: speichern, öffnen, umbenennen (keine leeren Namen), duplizieren, löschen (mit Bestätigung), Favorit, erneut exportieren
- [x] ✅ Alle Einstellungen werden wiederhergestellt (Bild-Bearbeitung, Zeichnung, Farbe, Animation) — Browser-Test des Gesamtablaufs
- [x] ✅ Keine unnötige Pfadberechnung, keine veralteten Ergebnisse (Worker-Zähler, Reducer-Tests)
- [x] ✅ Android-Zurück mit allen Panels (per Test-Hook im Dev-Build geprüft)
- [x] ✅ Responsive 360 / 390 / 430 / 768 / 1024 px (keine Überläufe, keine abgeschnittenen Knöpfe, keine Überlappungen im Kopf)
- [x] ✅ Speicher: 10 Projektwechsel ohne Heap-Zuwachs, 30 Löschungen ohne verwaiste Daten
- [ ] ⏳ Debug-APK (`cd android` → `.\gradlew.bat assembleDebug`) — in der Cloud-Umgebung gesperrt (dl.google.com)
- [ ] ⏳ Manueller Test auf dem Xiaomi 15 Ultra:
  - Bild: Import, Zuschneiden, Zoom, Verschieben, Drehen
  - Zeichnung: Organisch, Geometrisch, Detail, Glättung, Linienbreite, Hintergrund
  - Farbe: Einfarbig, Verlauf, Foto, eigene Farben, Palette, Hintergrundfarbe
  - Animation: eigene Dauer, Geschwindigkeit, vorwärts/rückwärts, Startpunkt setzen/zurücksetzen
  - Projekte: speichern, öffnen, umbenennen, duplizieren, löschen, Favorit, erneut exportieren
  - Export: Bild, Video, Teilen, Speichern in der Galerie
  - Zurück-Taste: Editor, Anpassen, Wiedergabe, Startpunkt-Auswahl, Dialog, laufender Export, jeder Schritt, „Meine Werke“

## Phase 13 – Stand nach 13.3 (Commit e5c3cde)
- [x] ✅ Detail in hellen, kontrastarmen Bereichen (nur Stufe Detail; Minimal/Balanced unverändert) — `lightDetail.test`, Organic-Golden
- [x] ✅ Stil „Orthogonal“: nur waagerechte und senkrechte Strecken (exakter Geometrietest, 8 Motive × 3 Stufen), gespeicherter Pfad per Browser-Test geprüft
- [x] ✅ Startpunkt: Auswahl auf dem Kunstwerk, Touch-Ziehen mit Vorschau-Marker, zyklische Reihenfolge, Video und erneuter Export beginnen am gespeicherten Punkt
- [x] ✅ Responsive 360 / 390 / 430 / 768 / 1024 / 1280 px mit drei Stil-Optionen
- [ ] ⏳ Debug-APK über GitHub Actions („Android debug APK“) für Commit e5c3cde
- [ ] ⏳ Manueller Test auf dem Xiaomi 15 Ultra (Orthogonal und Startpunkt):
  - [ ] Bild importieren
  - [ ] Orthogonal als Stil auswählen (Hinweis „Nur waagerechte und senkrechte Linien, rechte Winkel“)
  - [ ] Detailgrade Minimal, Balanced, Detail und „Eigene“ (Regler) — jeweils nur gerade Linien, sichtbar unterschiedlich dicht
  - [ ] Vorschau prüfen (Zoom: keine schrägen Linien, keine Streifenmuster)
  - [ ] Animation prüfen (Abspielen, Pause, Von vorn, Ende = fertiges Bild)
  - [ ] Manuellen Startpunkt setzen („Wiedergabe“ → „Startpunkt setzen“; die fertige Linie ist über dem Foto sichtbar)
  - [ ] Startpunkt per Touch verschieben (Finger gedrückt halten und ziehen: Marker folgt auf der Linie, Seite scrollt nicht, Loslassen setzt ihn)
  - [ ] Animation beginnt am gewählten Punkt
  - [ ] Startpunkt speichern (Projekt speichern)
  - [ ] Projekt schließen, App beenden, erneut öffnen: Stil Orthogonal und Startpunkt-Marker unverändert, keine Neuberechnung
  - [ ] Erneut exportieren („Meine Werke“ → „Erneut exportieren“)
  - [ ] Prüfen, dass der gespeicherte Startpunkt verwendet wird (Video beginnt dort)
  - [ ] Android-Zurück: Startpunkt-Auswahl → „Wiedergabe“ → Schritt zurück → „Meine Werke“
  - [ ] Export des Orthogonal-Stils: Bild und Video, Speichern in der Galerie, Teilen

## Phase 13.6–13.8 – Stand nach Commit a9168b2
- [x] ✅ Projektdatei `.onelineart`: Export/Import, Validierung, Versionsprüfung, Namenskonflikte, kein Überschreiben — `projectFile.test`, `phase13-6-8.spec`
- [x] ✅ Loop (Vorschau), Startpunkt, Richtung, Geschwindigkeit ohne Pfadberechnung — `playback.test`, `phase13-6-8.spec`
- [x] ✅ Einstellungen: Standardwerte für neue Werke, gespeicherte Werke unverändert, Neustart — `workDefaults.test`, `phase13-6-8.spec`
- [x] ✅ Responsive 360 / 390 / 430 / 768 / 1024 / 1280 px (Einstellungen, Importieren, Projektdatei, Wiederholen)
- [ ] ⏳ Debug-APK über GitHub Actions („Android debug APK“) für diesen Stand
- [ ] ⏳ Manueller Test auf dem Xiaomi 15 Ultra:

### 13.6 Projektdatei
  - [ ] Projekt öffnen (vorher: Orthogonal, Detailgrad ≠ Balanced, gedreht/zugeschnitten, Linienbreite geändert, Verlauf oder eigene Farben, Hintergrund Schwarz oder eigene Farbe, Dauer/Geschwindigkeit/Rückwärts/„Endlos“, Startpunkt gesetzt, gespeichert, als Favorit markiert)
  - [ ] Export-Schritt → „Projektdatei exportieren“ → Meldung „Fertig: <Name> <Datum> <Uhrzeit>.onelineart“
  - [ ] Auf Android nur „Teilen“ (kein „In Galerie speichern“) → Teilen-Menü → „In Dateien speichern“ (bzw. Dateien/Drive) → Datei liegt dort mit Endung `.onelineart`
  - [ ] „Meine Werke“ → „Importieren“ (auf dem Handy Symbol mit Pfeil nach oben) → gespeicherte `.onelineart` wählen → Meldung „„<Name> – Import“ wurde importiert.“
  - [ ] Das importierte Werk öffnen: Originalfoto korrekt (auch in „Bearbeiten“ drehbar/zuschneidbar), fertige Zeichnung erscheint sofort, ohne „Zeichnung wird berechnet“
  - [ ] Stil, Detailgrad, Bearbeitung (Drehung/Zuschnitt), Linienbreite, Zeichenstärke, Hintergrund, Farben (Einfarbig/Verlauf/Foto, eigene Farben) sind gleich
  - [ ] Animation: Dauer, Geschwindigkeit, Richtung, „Wiederholen“ sind gleich
  - [ ] Startpunkt-Marker an derselben Stelle; die Animation beginnt dort
  - [ ] „Meine Werke“ → Sortierung „Erstellt“: das importierte Werk zeigt das ursprüngliche Erstelldatum
  - [ ] Das importierte Werk ist KEIN Favorit (Stern leer), auch wenn das Original einer ist
  - [ ] Dieselbe Datei noch einmal importieren → „<Name> – Import 2“; ein drittes Mal → „– Import 3“
  - [ ] Eigene ID: importiertes Werk umbenennen, ändern, speichern, löschen → das Original bleibt unverändert und öffnet weiterhin
  - [ ] Das ursprüngliche Projekt ist nach Export und Import unverändert (Name, Favorit, Einstellungen, Zeichnung)
  - [ ] Importiertes Werk erneut als Projektdatei exportieren und wieder importieren
  - [ ] Eine beliebige andere Datei (z. B. ein Foto oder PDF) importieren → Meldung „Keine gültige Projektdatei“, nichts ändert sich
  - [ ] Touch: „Importieren“ und „Projektdatei exportieren“ gut treffbar; nichts abgeschnitten bei Hoch- und Querformat

### 13.7 Animation
  - [ ] Play, Pause (Position bleibt stehen), Fortsetzen, „Von vorn“ (beginnt am Startpunkt)
  - [ ] Vorwärts / Rückwärts
  - [ ] Geschwindigkeit 0,5× / 1× / 2× / 4×
  - [ ] Dauer 5 / 10 / 15 / 30 s und „Eigene“
  - [ ] Wiederholen „Einmal“: endet mit dem fertigen Bild
  - [ ] Wiederholen „Endlos“: nach ca. 2 s Standbild beginnt die Zeichnung wieder
  - [ ] „Endlos“ beginnt jede Runde wieder am gespeicherten Startpunkt (auch rückwärts)
  - [ ] „Endlos“ + Pause / Fortsetzen / „Von vorn“ funktionieren
  - [ ] Alles einmal mit Organisch, Geometrisch und Orthogonal (auch bei Detail)
  - [ ] Während „Startpunkt setzen“ zeigt „Wiedergabe“ nur den Startpunkt; das Bild ist groß genug zum Tippen
  - [ ] Werk mit „Endlos“ speichern, App beenden, wieder öffnen → „Endlos“ und Startpunkt sind erhalten
  - [ ] Video exportieren mit „Endlos“: das Video enthält die Zeichnung genau einmal (Länge = Dauer ÷ Geschwindigkeit + 2 s)
  - [ ] App in den Hintergrund und zurück während „Endlos“: Vorschau pausiert, Fortsetzen möglich

### 13.8 Einstellungen
  - [ ] Zahnrad oben rechts öffnet „Einstellungen“ (bei 360 px passen Speichern, Meine Werke und Zahnrad in die Kopfzeile)
  - [ ] Alle Standardwerte ändern: Stil, Detailgrad, Hintergrund Schwarz, Linienbreite, Dauer (auch „Eigene“), Geschwindigkeit, Richtung, Wiederholen
  - [ ] App vollständig beenden und neu starten → alle Werte sind erhalten
  - [ ] Neues Foto importieren → Stil, Detailgrad, Hintergrund, Linienbreite und Animation entsprechen den Standardwerten
  - [ ] Ein vorher gespeichertes Werk öffnen → es hat seine eigenen Werte, nicht die Standardwerte
  - [ ] Standardwerte erneut ändern → das gespeicherte Werk bleibt unverändert („Gespeichert“ bleibt stehen)
  - [ ] „Auf Standard zurücksetzen“ → Organisch, Balanced, Weiß, 1,00, 10 s, 1×, Vorwärts, Einmal
  - [ ] Android-Zurück in „Einstellungen“ → zurück zur Zeichnung, App bleibt offen
  - [ ] Touch/Responsive: alle Auswahlfelder vollständig lesbar und treffbar, Linienbreite per Finger verstellbar, Hoch- und Querformat
