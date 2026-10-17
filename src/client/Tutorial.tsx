import { useMemo, useState } from 'react';
import type { GameState } from '../shared/types.ts';
import { Game } from './App.tsx';
import { SitePage } from './Home.tsx';
import { CHAPTERS } from './lessons.tsx';
import { PracticeGame } from './practice.ts';
import { useRoom } from './net.ts';
import { useDraggable } from './useDraggable.tsx';
import type { Settings } from './settings.ts';

const PROGRESS_KEY = 'mesbg-tabletop:learn';

function readProgress(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveProgress(done: string[]) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(done));
  } catch {
    // Storage blocked: progress just isn't remembered.
  }
}

/** The chapter in the address (?learn=moving), so a chapter can be linked to and survives a reload. */
function chapterFromUrl(): number | null {
  const id = new URLSearchParams(location.search).get('learn');
  const i = CHAPTERS.findIndex(c => c.id === id);
  return i >= 0 ? i : null;
}

function showChapter(i: number | null) {
  const url = new URL(location.href);
  url.searchParams.set('learn', i === null ? '' : CHAPTERS[i].id);
  history.replaceState(null, '', url.toString().replace('learn=&', 'learn&').replace(/learn=$/, 'learn'));
}

/** Learn to play: a list of chapters, each a run of short lessons on a practice table. */
export function Tutorial({ settings, updateSettings, onExit, onPlay }: { settings: Settings; updateSettings: (p: Partial<Settings>) => void; onExit: () => void; onPlay: () => void }) {
  const [chapter, setChapter] = useState<number | null>(chapterFromUrl);
  const [finished, setFinished] = useState<string[]>(readProgress);
  const open = (i: number | null) => {
    showChapter(i);
    setChapter(i);
  };
  const finish = (id: string) => {
    const next = finished.includes(id) ? finished : [...finished, id];
    saveProgress(next);
    setFinished(next);
  };

  if (chapter === null) {
    const nextUp = CHAPTERS.findIndex(c => !finished.includes(c.id));
    return (
      <SitePage page="play">
        <div className="page-intro">
          <h1>Learn to play</h1>
          <button className="primary" onClick={() => open(nextUp >= 0 ? nextUp : 0)}>
            {finished.length === 0 ? 'Start from the beginning' : nextUp >= 0 ? `Continue: ${CHAPTERS[nextUp].title}` : 'Start again'}
          </button>
        </div>
        <p className="muted">Nine short chapters take you through the whole game, each on a practice table where you try things for yourself. Jump to any chapter.</p>
        <ol className="chapters">
          {CHAPTERS.map((c, i) => {
            const done = finished.includes(c.id);
            return (
              <li key={c.id}>
                <button className={`chapter ${done ? 'done' : ''}`} onClick={() => open(i)}>
                  <span className="chapter-num" aria-hidden>
                    {done ? '✓' : i + 1}
                  </span>
                  <span className="chapter-text">
                    <b>{c.title}</b>
                    <small>{c.blurb}</small>
                  </span>
                  <small className="chapter-count">
                    {c.lessons.length} lessons{done ? ' · done' : ''}
                  </small>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="row wrap">
          <button onClick={onPlay}>Start a real game</button>
          <button onClick={onExit}>Home</button>
        </div>
      </SitePage>
    );
  }
  return (
    <ChapterRun
      key={chapter}
      chapter={chapter}
      settings={settings}
      updateSettings={updateSettings}
      onMenu={() => open(null)}
      onNext={() => {
        finish(CHAPTERS[chapter].id);
        open(chapter + 1 < CHAPTERS.length ? chapter + 1 : null);
      }}
      onPlay={() => {
        finish(CHAPTERS[chapter].id);
        onPlay();
      }}
    />
  );
}

/** One chapter: a practice game with the lesson card over it, one lesson at a time. */
function ChapterRun({
  chapter,
  settings,
  updateSettings,
  onMenu,
  onNext,
  onPlay,
}: {
  chapter: number;
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => void;
  onMenu: () => void;
  onNext: () => void;
  onPlay: () => void;
}) {
  const LESSONS = CHAPTERS[chapter].lessons;
  const lastChapter = chapter === CHAPTERS.length - 1;
  const drag = useDraggable('lesson');
  const game = useMemo(() => new PracticeGame(LESSONS[0].setup()), []);
  const { state } = useRoom(game);
  const [step, setStep] = useState(0);
  const [start, setStart] = useState<GameState>(() => game.getSnapshot().state);
  const [small, setSmall] = useState(false);
  // On a phone the card would cover the table, so the explanation folds away behind a button.
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 800px)').matches;
  const [more, setMore] = useState(!narrow);
  const lesson = LESSONS[step];
  const checked = lesson.done ? lesson.done(state, start) : false;
  // A lesson without a check never holds you up.
  const done = !lesson.done || checked;

  const go = (next: number, keep = false) => {
    const s = keep ? state : LESSONS[next].setup();
    if (!keep) game.load(s);
    setStart(s);
    setStep(next);
    setSmall(false);
    setMore(!narrow);
  };
  const last = step === LESSONS.length - 1;

  const card = (
    <section ref={drag.ref} style={drag.style} className={`lesson ${small ? 'small' : ''}`} aria-label="Lesson">
      <div className={`lesson-head ${drag.draggable ? 'grab' : ''}`} onPointerDown={drag.onPointerDown}>
        <small>
          {CHAPTERS[chapter].title} · {step + 1} of {LESSONS.length}
        </small>
        <h3>{lesson.title}</h3>
        {drag.controls}
        <button className="lesson-toggle" onClick={() => setSmall(v => !v)} aria-label={small ? 'Show lesson' : 'Hide lesson'}>
          {small ? '▾' : '▴'}
        </button>
        <button className="lesson-exit" onClick={onMenu} aria-label="Back to the chapters" title="Back to the chapters">
          ✕
        </button>
      </div>
      {!small && (
        <>
          {(more || !lesson.task) && <div className="lesson-body">{lesson.body}</div>}
          {lesson.task && <p className={`lesson-task ${checked ? 'done' : ''}`}>{checked ? `✓ ${lesson.task}` : lesson.task}</p>}
          {lesson.task && !more && (
            <button className="link lesson-more" onClick={() => setMore(true)}>
              Why?
            </button>
          )}
          <div className="row wrap lesson-nav">
            {step > 0 && <button onClick={() => go(step - 1)}>Back</button>}
            {lesson.done && <button onClick={() => go(step)}>Restart</button>}
            {last && lastChapter ? (
              <>
                <button className="primary" onClick={onPlay}>
                  Start a real game
                </button>
                <button onClick={onNext}>Chapters</button>
              </>
            ) : last ? (
              <button className="primary" onClick={onNext}>
                Next chapter
              </button>
            ) : (
              <button className={done ? 'primary' : ''} onClick={() => go(step + 1, done && !!LESSONS[step + 1].continues)}>
                {done ? 'Next' : 'Skip'}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );

  // A fresh game screen per lesson clears selections and fits the table again.
  return <Game key={step} room="practice" settings={settings} updateSettings={updateSettings} practice={game} overlay={card} />;
}
