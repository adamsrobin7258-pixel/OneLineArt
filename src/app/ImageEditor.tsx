import { useState } from 'react';
import {
  IDENTITY_EDIT,
  MAX_ZOOM,
  imageEditKey,
  rotateEdit,
  rotatedSize,
  withCropAspect,
  withZoom,
  zoomOf,
  type ImageEdit,
} from '../core';
import { Button } from '../ui/components/Button';
import { CropPreview, CropStage } from '../ui/components/CropStage';
import { Icon } from '../ui/components/Icon';
import { OptionGroup } from '../ui/components/OptionGroup';
import { SegmentedControl } from '../ui/components/SegmentedControl';
import { Slider } from '../ui/components/Slider';
import { useBackHandler } from '../ui/useBackHandler';

const ASPECTS = [
  { value: 'free', label: 'Frei', ratio: null },
  { value: 'original', label: 'Original', ratio: 'original' },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:5', label: '4:5', ratio: 4 / 5 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
] as const;
type AspectId = (typeof ASPECTS)[number]['value'];

interface ImageEditorProps {
  /** Unedited display copy. */
  image: ImageBitmap;
  /** Edit currently applied to the session. */
  edit: ImageEdit;
  /** Applies the edit (new analysis + drawing); resolves when done. */
  onApply: (edit: ImageEdit) => Promise<void>;
  onClose: () => void;
}

/**
 * "Bild bearbeiten": rotate, crop, zoom and pan the photo before drawing.
 * Works on a draft; only "Übernehmen" changes the input of the analysis.
 */
export function ImageEditor({ image, edit, onApply, onClose }: ImageEditorProps) {
  const [draft, setDraft] = useState<ImageEdit>(edit);
  const [aspectId, setAspectId] = useState<AspectId>('free');
  const [busy, setBusy] = useState(false);
  useBackHandler(!busy, onClose);

  const ratioOf = (id: AspectId, e: ImageEdit): number | null => {
    const ratio = ASPECTS.find((a) => a.value === id)!.ratio;
    if (ratio !== 'original') return ratio;
    const size = rotatedSize(image, e.rotation);
    return size.width / size.height;
  };
  const aspect = ratioOf(aspectId, draft);
  const zoom = zoomOf(draft, image);
  const changed = imageEditKey(draft) !== imageEditKey(edit);

  const chooseAspect = (id: AspectId) => {
    setAspectId(id);
    setDraft((d) => withCropAspect(d, ratioOf(id, d), image));
  };
  const rotate = (direction: 1 | -1) =>
    setDraft((d) => {
      const turned = rotateEdit(d, direction);
      // A fixed shape stays that shape on the turned image ("Original" follows the image).
      return aspectId === 'free' ? turned : withCropAspect(turned, ratioOf(aspectId, turned), image);
    });
  const apply = async () => {
    if (!changed) return onClose();
    setBusy(true);
    try {
      await onApply(draft);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="editor" data-testid="image-editor" data-edit={imageEditKey(draft)}>
      <div className="editor__stage">
        <CropStage image={image} edit={draft} aspect={aspect} onChange={setDraft} label="Bildausschnitt: ziehen zum Verschieben, Ecken zum Zuschneiden" />
      </div>
      <footer className="editor__bar">
        <div className="editor__tools">
          <div className="editor__rotate" role="group" aria-label="Drehen">
            <Button variant="quiet" onClick={() => rotate(-1)} aria-label="Nach links drehen" title="Nach links drehen">
              <Icon name="rotateLeft" size={20} />
            </Button>
            <Button variant="quiet" onClick={() => rotate(1)} aria-label="Nach rechts drehen" title="Nach rechts drehen">
              <Icon name="rotateRight" size={20} />
            </Button>
          </div>
          <OptionGroup label="Seitenverhältnis">
            <SegmentedControl label="Seitenverhältnis" options={ASPECTS} value={aspectId} onChange={chooseAspect} fill />
          </OptionGroup>
          <Slider
            label="Zoom"
            value={Math.round(zoom * 100) / 100}
            min={1}
            max={MAX_ZOOM}
            step={0.05}
            format={(v) => `${v.toFixed(1).replace('.', ',')}×`}
            onChange={(z) => setDraft((d) => withZoom(d, z, image))}
          />
          <div className="editor__preview">
            <span className="option__label" aria-hidden="true">
              Vorschau
            </span>
            <CropPreview image={image} edit={draft} size={96} />
          </div>
        </div>
        <div className="editor__actions">
          <Button
            variant="ghost"
            disabled={busy || imageEditKey(draft) === imageEditKey(IDENTITY_EDIT)}
            onClick={() => {
              setAspectId('free');
              setDraft(IDENTITY_EDIT);
            }}
          >
            Zurücksetzen
          </Button>
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={busy} onClick={() => void apply()}>
            {busy ? 'Wird übernommen …' : 'Übernehmen'}
          </Button>
        </div>
      </footer>
    </div>
  );
}
