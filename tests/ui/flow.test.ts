import { describe, expect, it } from 'vitest';
import { FLOW_STEPS, reachableSteps } from '../../src/app/flow';

describe('user flow', () => {
  it('shows exactly the real steps, in order (no placeholder steps)', () => {
    expect(FLOW_STEPS.map((s) => s.label)).toEqual(['Bild', 'Zeichnung', 'Vorschau', 'Export']);
    expect(FLOW_STEPS.map((s) => s.label)).not.toContain('Generieren');
    expect(FLOW_STEPS.map((s) => s.label)).not.toContain('Ergebnis');
  });

  it('a step is reachable once its prerequisites exist', () => {
    expect([...reachableSteps({ hasImage: false, hasDrawing: false })]).toEqual(['image']);
    expect([...reachableSteps({ hasImage: true, hasDrawing: false })]).toEqual(['image', 'settings']);
    expect([...reachableSteps({ hasImage: true, hasDrawing: true })]).toEqual(['image', 'settings', 'preview', 'export']);
  });
});
