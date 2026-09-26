import { generateVariableWidthLine } from '../../core/experimental/variableWidth';
import type { VariableWidthRequest, VariableWidthResponse } from './protocol';

/** Runs the experimental generator off the main thread. */
self.addEventListener('message', (event: MessageEvent<VariableWidthRequest>) => {
  const started = performance.now();
  let response: VariableWidthResponse;
  let transfer: Transferable[] = [];
  try {
    const line = generateVariableWidthLine(event.data.image, event.data.parameters);
    response = { ok: true, line, durationMs: performance.now() - started };
    transfer = [line.path.coords.buffer, line.widths.buffer];
  } catch (error) {
    response = { ok: false, detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
  (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(response, transfer);
});
