# One Line

Erzeugt aus einem Foto eine künstlerische Zeichnung aus **einer einzigen,
zusammenhängenden Linie** – algorithmisch, ohne generative Bild-KI – und daraus ein
Entstehungsvideo auf Basis desselben Pfads.

## Entwicklung

```bash
npm install
npm run dev        # Dev-Server
npm run check      # Typecheck + Lint + Unit-Tests
npm run test:e2e   # Browser-Tests (Playwright/Chromium; lokal einmalig: npx playwright install chromium)
npm run build      # Produktionsbuild
npm run bench      # Performance-Messung (optional BENCH_OUT=datei.md)
```

### Android (Capacitor)

```bash
npm run android:sync   # Web-Build nach android/ kopieren
npm run android:build  # Debug-APK: android/app/build/outputs/apk/debug/app-debug.apk
npm run android:open   # in Android Studio öffnen
```

Benötigt Android SDK (Plattform 36) und JDK 21.

Architektur und Entscheidungen: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Release-Stand: [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
