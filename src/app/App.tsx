import { useState } from 'react';
import { DEFAULT_ANIMATION_SETTINGS, sanitizeAnimationSettings, storageErrorCode, StorageError } from '../core';
import { Button } from '../ui/components/Button';
import { StepIndicator } from '../ui/components/StepIndicator';
import { STORAGE_ERROR_MESSAGES } from './exportMessages';
import { AVAILABLE_STEPS, FLOW_STEPS, type FlowStepId } from './flow';
import { AnimationScreen } from './screens/AnimationScreen';
import { ExportScreen } from './screens/ExportScreen';
import { GalleryScreen } from './screens/GalleryScreen';
import { ImportScreen } from './screens/ImportScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useImageImport } from './state/useImageImport';
import { useProjects } from './state/useProjects';
import { useRenderSettings } from './state/useRenderSettings';

/** App shell: one image session shared by all steps; the gallery works on the same projects. */
export function App() {
  const controller = useImageImport();
  const render = useRenderSettings();
  const projects = useProjects();
  const [step, setStep] = useState<FlowStepId>('image');
  const [view, setView] = useState<'flow' | 'gallery'>('flow');
  const [durationMs, setDurationMs] = useState(DEFAULT_ANIMATION_SETTINGS.durationMs);
  const { state } = controller;
  const session = state.status === 'ready' ? state.session : null;
  // Without an analysed image (or a reopened drawing) only the first step is reachable; later steps need a finished drawing.
  const usable = !!session && (session.analysisStatus === 'ready' || Object.keys(session.paths).length > 0);
  const hasDrawing = usable && session.pathStatus === 'ready';
  const current: FlowStepId = !usable ? 'image' : (step === 'preview' || step === 'export') && !hasDrawing ? 'settings' : step;
  const changeDuration = (ms: number) => setDurationMs(sanitizeAnimationSettings({ durationMs: ms }).value.durationMs);

  const openProject = async (id: string) => {
    const loaded = await projects.load(id);
    await controller.openProject(loaded.project);
    render.updateRenderSettings(loaded.project.render);
    changeDuration(loaded.project.animation.durationMs);
    projects.link(loaded);
    if (loaded.outdated.length > 0) console.info('Project made with other algorithm versions:', loaded.outdated, loaded.project.versions);
    setStep('settings');
    setView('flow');
  };

  const saved = session ? projects.isSaved(session, render.renderSettings, durationMs) : false;

  return (
    <main className="screen">
      <header className="screen__header">
        <h1 className="wordmark">One Line</h1>
        {view === 'flow' && <StepIndicator steps={FLOW_STEPS} current={current} available={AVAILABLE_STEPS} />}
        <div className="screen__actions">
          {view === 'flow' && projects.saveStatus === 'failed' && projects.saveError && (
            <p className="screen__error" role="alert" data-testid="save-error" title={STORAGE_ERROR_MESSAGES[projects.saveError].detail}>
              {STORAGE_ERROR_MESSAGES[projects.saveError].title}
            </p>
          )}
          {view === 'flow' && hasDrawing && session && (
            <Button
              variant="quiet"
              data-testid="save-project"
              data-save-status={saved ? 'saved' : projects.saveStatus}
              disabled={projects.saveStatus === 'saving' || saved}
              onClick={() => void projects.save(session, render.renderSettings, durationMs)}
            >
              {projects.saveStatus === 'saving' ? 'Wird gespeichert …' : saved ? 'Gespeichert' : 'Speichern'}
            </Button>
          )}
          {view === 'flow' && (
            <Button variant="quiet" onClick={() => setView('gallery')}>
              Meine Werke
            </Button>
          )}
        </div>
      </header>
      {view === 'gallery' ? (
        <GalleryScreen
          projects={projects}
          onOpen={(id) =>
            openProject(id).catch((error: unknown) => {
              throw error instanceof StorageError ? error : new StorageError(storageErrorCode(error), undefined, { cause: error });
            })
          }
          onCreate={() => {
            setView('flow');
            setStep('image');
          }}
          onBack={() => setView('flow')}
        />
      ) : current === 'export' && session ? (
        <ExportScreen
          session={session}
          render={render}
          durationMs={durationMs}
          onDurationChange={changeDuration}
          projectName={projects.linked?.imageId === session.original.id ? projects.linked.name : null}
          onBack={() => setStep('preview')}
        />
      ) : current === 'preview' && session ? (
        <AnimationScreen
          session={session}
          render={render}
          durationMs={durationMs}
          onDurationChange={changeDuration}
          onBack={() => setStep('settings')}
          onContinue={() => setStep('export')}
        />
      ) : current === 'settings' && session ? (
        <SettingsScreen session={session} controller={controller} render={render} onBack={() => setStep('image')} onContinue={() => setStep('preview')} />
      ) : (
        <ImportScreen controller={controller} onContinue={() => setStep('settings')} />
      )}
    </main>
  );
}
