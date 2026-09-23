import { useMemo } from 'react';
import {
  DEFAULT_ONE_LINE_SETTINGS,
  DEFAULT_RENDER_STYLE,
  placeholderGenerator,
  runOneLinePipeline,
  uniformAnalyzer,
} from '../../core';
import { Button } from '../../ui/components/Button';
import { PathPreview } from '../../ui/components/PathPreview';

const DEV_CANVAS = { width: 800, height: 1000, data: new Uint8ClampedArray(800 * 1000 * 4) };

export function HomeScreen() {
  // Dev-only wiring check: runs the full core pipeline with placeholder stages.
  const devPath = useMemo(
    () =>
      import.meta.env.DEV
        ? runOneLinePipeline({ analyzer: uniformAnalyzer, generator: placeholderGenerator }, DEV_CANVAS, DEFAULT_ONE_LINE_SETTINGS)
        : null,
    [],
  );

  return (
    <main className="screen">
      <header className="screen__header">
        <h1 className="wordmark">One Line</h1>
      </header>
      <section className="stage">
        {devPath ? (
          <PathPreview path={devPath} style={DEFAULT_RENDER_STYLE} caption="Platzhalter-Pfad · Architekturtest" />
        ) : (
          <div className="stage__empty">Ein Foto. Eine Linie.</div>
        )}
      </section>
      <footer className="screen__actions">
        <Button disabled title="Folgt in Teil 2">
          Foto wählen
        </Button>
      </footer>
    </main>
  );
}
