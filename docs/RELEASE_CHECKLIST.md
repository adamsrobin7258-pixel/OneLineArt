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
