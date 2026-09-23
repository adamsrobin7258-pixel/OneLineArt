/** The user flow. Only steps listed as available are reachable in the current build. */
export const FLOW_STEPS = [
  { id: 'image', label: 'Bild' },
  { id: 'settings', label: 'Einstellungen' },
  { id: 'preview', label: 'Vorschau' },
  { id: 'generate', label: 'Generieren' },
  { id: 'result', label: 'Ergebnis' },
  { id: 'export', label: 'Export' },
] as const;

export type FlowStepId = (typeof FLOW_STEPS)[number]['id'];

export const AVAILABLE_STEPS: ReadonlySet<FlowStepId> = new Set(['image', 'settings']);
