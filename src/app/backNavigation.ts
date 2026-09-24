import type { FlowStepId } from './flow';

export type BackAction =
  | { readonly type: 'view'; readonly view: 'flow' }
  | { readonly type: 'step'; readonly step: FlowStepId }
  /** At the root: let the platform leave the app. */
  | { readonly type: 'exit' };

const PREVIOUS: Readonly<Record<FlowStepId, FlowStepId | null>> = {
  image: null,
  settings: 'image',
  preview: 'settings',
  export: 'preview',
};

/**
 * What the system back action does on the current screen: "Meine Werke" and
 * "Einstellungen" → back to the flow; a flow step → the previous step; "Bild" is the root.
 * (Open dialogs and a running export are handled before, via the back stack.)
 */
export function backAction(view: 'flow' | 'gallery' | 'preferences', step: FlowStepId): BackAction {
  if (view !== 'flow') return { type: 'view', view: 'flow' };
  const previous = PREVIOUS[step];
  return previous ? { type: 'step', step: previous } : { type: 'exit' };
}
