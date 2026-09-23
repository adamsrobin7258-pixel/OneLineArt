import { useEffect, useRef, useState } from 'react';
import { DEFAULT_ANIMATION_SETTINGS, sanitizeAnimationSettings, sessionKeyOf, storageErrorCode, StorageError } from '../core';
import { onSystemBack } from '../platform/capacitor/backButton';
import { backStack } from '../ui/backStack';
import { Button } from '../ui/components/Button';
import { Icon } from '../ui/components/Icon';
import { StepIndicator } from '../ui/components/StepIndicator';
import { backAction } from './backNavigation';
import { STORAGE_ERROR_MESSAGES } from './exportMessages';
import { FLOW_STEPS, reachableSteps, type FlowStepId } from './flow';
import { AnimationScreen } from './screens/AnimationScreen';
import { ExportScreen } from './screens/ExportScreen';
import { GalleryScreen } from './screens/GalleryScreen';
import { ImportScreen } from './screens/ImportScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useImageImport } from './state/useImageImport';
import { useProjects, type AnimationChoice } from './state/useProjects';
import { useRenderSettings } from './state/useRenderSettings';

/** App shell: one image session shared by all steps; the gallery works on the same projects. */
export function App() {
  const controller = useImageImport();
  const render = useRenderSettings();
  const projects = useProjects();
  const [step, setStep] = useState<FlowStepId>('image');
  const [view, setView] = useState<'flow' | 'gallery'>('flow');
  const [choice, setChoice] = useState<Required<AnimationChoice>>(choiceOf(DEFAULT_ANIMATION_SETTINGS));
  /**
   * The start point belongs to the image AND edit it was chosen on (sessionKeyOf):
   * after an edit or with another image it is simply not used — never mapped blindly.
   */
  const [startPointOwner, setStartPointOwner] = useState<string | null>(null);
  const { state } = controller;
  const session = state.status === 'ready' ? state.session : null;
  const sessionKey = session ? sessionKeyOf(session) : null;
  const animation: Required<AnimationChoice> = { ...choice, startPoint: startPointOwner === sessionKey ? choice.startPoint : null };
  // Without an analysed image (or a reopened drawing) only the first step is reachable; later steps need a finished drawing.
  const usable = !!session && (session.analysisStatus === 'ready' || Object.keys(session.paths).length > 0);
  const hasDrawing = usable && session.pathStatus === 'ready';
  const current: FlowStepId = !usable ? 'image' : (step === 'preview' || step === 'export') && !hasDrawing ? 'settings' : step;
  // Animation choices are playback state only: they never touch the drawing settings or the path.
  const changeAnimation = (patch: Partial<AnimationChoice>) => {
    if ('startPoint' in patch) setStartPointOwner(sessionKey);
    setChoice((current) => choiceOf(sanitizeAnimationSettings({ ...current, ...patch }).value));
  };

  const openProject = async (id: string) => {
    const loaded = await projects.load(id);
    await controller.openProject(loaded.project);
    render.updateRenderSettings(loaded.project.render);
    // Older projects have only a duration: speed 1, forward, the path's own start.
    setChoice(choiceOf(sanitizeAnimationSettings(loaded.project.animation).value));
    setStartPointOwner(loaded.project.image.id);
    projects.link(loaded);
    if (loaded.outdated.length > 0) console.info('Project made with other algorithm versions:', loaded.outdated, loaded.project.versions);
    setStep('settings');
    setView('flow');
  };

  const saved = session ? projects.isSaved(session, render.renderSettings, animation) : false;

  const reachable = reachableSteps({ hasImage: usable, hasDrawing });

  // Android back button: close what is open (dialog, running export), else one step back.
  const position = useRef({ view, current });
  useEffect(() => {
    position.current = { view, current };
  }, [view, current]);
  useEffect(
    () =>
      onSystemBack(() => {
        if (backStack.handle()) return true;
        const action = backAction(position.current.view, position.current.current);
        if (action.type === 'view') setView(action.view);
        else if (action.type === 'step') setStep(action.step);
        return action.type !== 'exit';
      }),
    [],
  );

  return (
    <main className="screen" data-view={view}>
      <header className="appbar">
        <button type="button" className="brand" onClick={() => setView('flow')} aria-label="One Line – zur Zeichnung">
          <svg className="brand__mark" viewBox="0 0 40 20" aria-hidden="true">
            <path d="M2 15c5-1 6-10 11-10s3 10 8 10 4-11 9-11 5 8 8 7" />
          </svg>
          <span className="brand__name">One Line</span>
        </button>
        {view === 'flow' && <StepIndicator steps={FLOW_STEPS} current={current} reachable={reachable} onSelect={setStep} />}
        <div className="appbar__actions">
          {view === 'flow' && projects.saveStatus === 'failed' && projects.saveError && (
            <p className="appbar__error" role="alert" data-testid="save-error" title={STORAGE_ERROR_MESSAGES[projects.saveError].detail}>
              <Icon name="alert" size={16} />
              {STORAGE_ERROR_MESSAGES[projects.saveError].title}
            </p>
          )}
          {view === 'flow' && hasDrawing && session && (
            <Button
              variant={saved ? 'ghost' : 'quiet'}
              className={`save-button${saved ? ' is-saved' : ''}`}
              data-testid="save-project"
              data-save-status={saved ? 'saved' : projects.saveStatus}
              disabled={projects.saveStatus === 'saving' || saved}
              onClick={() => void projects.save(session, render.renderSettings, animation)}
            >
              {saved && <Icon name="check" size={16} />}
              {projects.saveStatus === 'saving' ? 'Wird gespeichert …' : saved ? 'Gespeichert' : 'Speichern'}
            </Button>
          )}
          {view === 'flow' && (
            <Button variant="quiet" className="button--icon-mobile" aria-label="Meine Werke" onClick={() => setView('gallery')}>
              <Icon name="gallery" size={18} />
              <span className="button__text">Meine Werke</span>
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
          animation={animation}
          onAnimationChange={changeAnimation}
          projectName={projects.linked?.imageId === session.original.id ? projects.linked.name : null}
          onBack={() => setStep('preview')}
        />
      ) : current === 'preview' && session ? (
        <AnimationScreen
          session={session}
          render={render}
          animation={animation}
          onAnimationChange={changeAnimation}
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

const choiceOf = (a: AnimationChoice): Required<AnimationChoice> => ({
  durationMs: a.durationMs,
  speed: a.speed ?? 1,
  direction: a.direction ?? 'forward',
  startPoint: a.startPoint ?? null,
});
