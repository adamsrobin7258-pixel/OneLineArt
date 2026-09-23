import { describe, expect, it } from 'vitest';
import { backAction } from '../../src/app/backNavigation';
import { createBackStack } from '../../src/ui/backStack';

describe('system back', () => {
  it('flow: one step back; "Bild" is the root', () => {
    expect(backAction('flow', 'export')).toEqual({ type: 'step', step: 'preview' });
    expect(backAction('flow', 'preview')).toEqual({ type: 'step', step: 'settings' });
    expect(backAction('flow', 'settings')).toEqual({ type: 'step', step: 'image' });
    expect(backAction('flow', 'image')).toEqual({ type: 'exit' });
  });

  it('"Meine Werke" goes back to the flow, whatever step was open', () => {
    expect(backAction('gallery', 'export')).toEqual({ type: 'view', view: 'flow' });
    expect(backAction('gallery', 'image')).toEqual({ type: 'view', view: 'flow' });
  });

  it('back stack: the most recent overlay closes first; removed handlers are skipped', () => {
    const stack = createBackStack();
    const log: string[] = [];
    expect(stack.handle()).toBe(false);
    const removeExport = stack.push(() => log.push('cancel export'));
    const removeDialog = stack.push(() => log.push('close dialog'));
    expect(stack.handle()).toBe(true);
    removeDialog();
    expect(stack.handle()).toBe(true);
    removeExport();
    expect(stack.handle()).toBe(false);
    expect(log).toEqual(['close dialog', 'cancel export']);
  });
});
