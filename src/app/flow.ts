/**
 * The user flow as it really is: choose a photo → choose detail and look →
 * watch it being drawn → export. Saving and "Meine Werke" are available
 * from the header at any time once there is a drawing.
 */
export const FLOW_STEPS = [
  { id: 'image', label: 'Bild' },
  { id: 'settings', label: 'Zeichnung' },
  { id: 'preview', label: 'Vorschau' },
  { id: 'export', label: 'Export' },
] as const;

export type FlowStepId = (typeof FLOW_STEPS)[number]['id'];

/** Steps the user can go to right now (all earlier steps plus those whose prerequisites exist). */
export function reachableSteps(state: { readonly hasImage: boolean; readonly hasDrawing: boolean }): ReadonlySet<FlowStepId> {
  const steps = new Set<FlowStepId>(['image']);
  if (state.hasImage) steps.add('settings');
  if (state.hasDrawing) {
    steps.add('preview');
    steps.add('export');
  }
  return steps;
}
