/** Touch-first devices get a direct "take photo" action (camera via file input). */
export function supportsCameraCapture(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}
