import { StepIndicator } from '../ui/components/StepIndicator';
import { AVAILABLE_STEPS, FLOW_STEPS } from './flow';
import { ImportScreen } from './screens/ImportScreen';

/** App shell. Further steps become available in later parts. */
export function App() {
  return (
    <main className="screen">
      <header className="screen__header">
        <h1 className="wordmark">One Line</h1>
        <StepIndicator steps={FLOW_STEPS} current="image" available={AVAILABLE_STEPS} />
      </header>
      <ImportScreen />
    </main>
  );
}
