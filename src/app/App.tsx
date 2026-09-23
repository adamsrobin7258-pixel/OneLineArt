import { useState } from 'react';
import { DEFAULT_ANIMATION_SETTINGS, sanitizeAnimationSettings } from '../core';
import { StepIndicator } from '../ui/components/StepIndicator';
import { AVAILABLE_STEPS, FLOW_STEPS, type FlowStepId } from './flow';
import { AnimationScreen } from './screens/AnimationScreen';
import { ImportScreen } from './screens/ImportScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useImageImport } from './state/useImageImport';
import { useRenderSettings } from './state/useRenderSettings';

/** App shell: one image session shared by all steps. */
export function App() {
  const controller = useImageImport();
  const render = useRenderSettings();
  const [step, setStep] = useState<FlowStepId>('image');
  const [durationMs, setDurationMs] = useState(DEFAULT_ANIMATION_SETTINGS.durationMs);
  const { state } = controller;
  // Without an analysed image only the first step is reachable; the preview needs a finished drawing.
  const analysed = state.status === 'ready' && state.session.analysisStatus === 'ready';
  const hasDrawing = analysed && state.session.pathStatus === 'ready';
  const current: FlowStepId = !analysed ? 'image' : step === 'preview' && !hasDrawing ? 'settings' : step;

  return (
    <main className="screen">
      <header className="screen__header">
        <h1 className="wordmark">One Line</h1>
        <StepIndicator steps={FLOW_STEPS} current={current} available={AVAILABLE_STEPS} />
      </header>
      {current === 'preview' && state.status === 'ready' ? (
        <AnimationScreen
          session={state.session}
          render={render}
          durationMs={durationMs}
          onDurationChange={(ms) => setDurationMs(sanitizeAnimationSettings({ durationMs: ms }).value.durationMs)}
          onBack={() => setStep('settings')}
        />
      ) : current === 'settings' && state.status === 'ready' ? (
        <SettingsScreen session={state.session} controller={controller} render={render} onBack={() => setStep('image')} onContinue={() => setStep('preview')} />
      ) : (
        <ImportScreen controller={controller} onContinue={() => setStep('settings')} />
      )}
    </main>
  );
}
