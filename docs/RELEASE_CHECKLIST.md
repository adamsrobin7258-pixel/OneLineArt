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
