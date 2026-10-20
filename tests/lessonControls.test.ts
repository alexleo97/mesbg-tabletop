// Learn to play keeps to each lesson: its table refuses set-up, editing and the choices no lesson teaches, and the
// screen doesn't offer them. Each lesson's table is rendered as it first opens, and each of your models' cards on it.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Action, GameState } from '../src/shared/types.ts';
import { catalog } from './botsim.ts';

const store = new Map<string, string>();
beforeAll(() => {
  Object.assign(globalThis, {
    location: { search: '?learn', href: 'http://localhost/?learn' },
    // The table's ground is drawn on a canvas, which isn't here: it is just left plain.
    document: { createElement: () => ({ getContext: () => null }), documentElement: { style: { setProperty: () => {} }, classList: { toggle: () => {} } }, querySelector: () => null },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  });
});

/** What a lesson must never show: set-up, seats and game settings, saving or ending the game, and manual tests. */
const NEVER = ['1 · Table', '2 · Scenario', '3 · Armies', 'Leave game', 'Save game', 'Finish the game early', 'Let the Palantír', 'Moving on', 'No scenario', 'Lie down', 'Dismount', 'Deploy', 'Starter boards'];

const load = async () => {
  const { CHAPTERS } = await import('../src/client/lessons.tsx');
  const { Game } = await import('../src/client/App.tsx');
  const { ModelCard } = await import('../src/client/ModelCard.tsx');
  const { PracticeGame } = await import('../src/client/practice.ts');
  const { DEFAULTS: DEFAULT_SETTINGS } = await import('../src/client/settings.ts');
  return { CHAPTERS, Game, ModelCard, PracticeGame, DEFAULT_SETTINGS };
};

describe('Learn to play', () => {
  it('shows no control a lesson does not need', async () => {
    const { CHAPTERS, Game, ModelCard, PracticeGame, DEFAULT_SETTINGS } = await load();
    for (const ch of CHAPTERS)
      for (const lesson of ch.lessons) {
        const where = `${ch.id}: ${lesson.title}`;
        const state = lesson.setup();
        const game = new PracticeGame(state);
        const html = renderToStaticMarkup(createElement(Game, { room: 'practice', settings: DEFAULT_SETTINGS, updateSettings: () => {}, practice: game, setupCard: lesson.setupCard }));
        for (const bad of NEVER) expect(html.includes(bad), `${where} shows "${bad}"`).toBe(false);
        // Before the battle, only a lesson that starts it offers Start the battle.
        if (!state.flow.started) expect(html.includes('Start the battle'), `${where} and Start the battle`).toBe(!!lesson.setupCard);
        for (const m of Object.values(state.models).filter(m => m.owner === 'p1' && !m.dead)) {
          const card = renderToStaticMarkup(createElement(ModelCard, { state, dispatch: () => {}, role: 'p1', model: m, catalog, target: undefined, clearTarget: () => {}, combat: undefined, openFight: () => {}, close: () => {}, lesson: true }));
          for (const bad of [...NEVER, '>Courage<']) expect(card.includes(bad), `${where}: ${m.name}'s card shows "${bad}"`).toBe(false);
        }
      }
  });

  it('refuses set-up, editing and ending the game on a lesson table', async () => {
    const { CHAPTERS, PracticeGame } = await load();
    const tries = (s: GameState): Action[] => {
      const m = Object.values(s.models).find(x => x.owner === 'p1')!;
      const t = Object.values(s.terrain)[0];
      return [
        { type: 'addModels', models: [{ ...m, id: 'extra' }] },
        { type: 'removeModels', ids: [m.id] },
        { type: 'updateModel', id: m.id, patch: { wounds: 9 } },
        { type: 'setScenario', id: 'domination' },
        { type: 'setBot', seat: 'p2' },
        { type: 'setName', seat: 'p1', name: 'X' },
        { type: 'concede', seat: 'p1' },
        { type: 'lieDown', id: m.id },
        { type: 'dismount', id: m.id },
        ...(t ? [{ type: 'removeTerrain', id: t.id } as Action] : []),
      ] as Action[];
    };
    for (const ch of CHAPTERS)
      for (const lesson of ch.lessons) {
        const state = lesson.setup();
        if (!Object.values(state.models).some(x => x.owner === 'p1')) continue;
        const game = new PracticeGame(state);
        for (const a of tries(state)) {
          game.dispatch(a);
          expect(game.getSnapshot().state, `${ch.id}: ${lesson.title} let ${a.type} through`).toBe(state);
        }
        // Before the battle starts, models and terrain stay where the lesson put them.
        if (!state.flow.started) {
          const m = Object.values(state.models).find(x => x.owner === 'p1')!;
          game.dispatch({ type: 'moveModels', moves: [{ id: m.id, x: m.x + 2, y: m.y }] });
          expect(game.getSnapshot().state, `${ch.id}: ${lesson.title} moved a model before the battle`).toBe(state);
        }
      }
  });
});
