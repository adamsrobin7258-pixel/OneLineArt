import { useRef, type ChangeEvent, type ReactNode } from 'react';
import { ACCEPTED_FILE_TYPES } from '../importMessages';

export interface FilePicker {
  readonly chooseFile: () => void;
  readonly takePhoto: () => void;
  /** Hidden inputs; must be rendered once. */
  readonly inputs: ReactNode;
}

/** System file/photo picker via hidden inputs. Cancelling the picker yields no call. */
export function useFilePicker(onFile: (file: File) => void): FilePicker {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    // Reset so choosing the same file again still triggers a change.
    event.target.value = '';
    if (file) onFile(file);
  };

  return {
    chooseFile: () => fileInput.current?.click(),
    takePhoto: () => cameraInput.current?.click(),
    inputs: (
      <>
        <input ref={fileInput} type="file" accept={ACCEPTED_FILE_TYPES} hidden onChange={onChange} data-testid="file-input" />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onChange} />
      </>
    ),
  };
}
