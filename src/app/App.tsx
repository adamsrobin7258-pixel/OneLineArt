import { useState } from 'react';
import { StepIndicator } from '../ui/components/StepIndicator';
import { AVAILABLE_STEPS, FLOW_STEPS, type FlowStepId } from './flow';
import { ImportScreen } from './screens/ImportScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useImageImport } from './state/useImageImport';

/** App shell: one image session shared by all steps. */
export function App() {
  const controller = useImageImport();
  const [step, setStep] = useState<FlowStepId>('image');
  const { state } = controller;
  // Without an analysed image only the first step is reachable.
  const current: FlowStepId = state.status === 'ready' && state.session.analysisStatus === 'ready' ? step : 'image';

  return (
    <main className="screen">
      <header className="screen__header">
        <h1 className="wordmark">One Line</h1>
        <StepIndicator steps={FLOW_STEPS} current={current} available={AVAILABLE_STEPS} />
      </header>
      {current === 'settings' && state.status === 'ready' ? (
        <SettingsScreen session={state.session} controller={controller} onBack={() => setStep('image')} />
      ) : (
        <ImportScreen controller={controller} onContinue={() => setStep('settings')} />
      )}
    </main>
  );
}
