// Learn to play keeps to each lesson: its table refuses set-up, editing and anything the step on it doesn't teach, and the
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
    let seen = 0;
    for (const ch of CHAPTERS)
      for (const lesson of ch.lessons) {
        const where = `${ch.id}: ${lesson.title}`;
        const state = lesson.setup();
        const game = new PracticeGame(state, { rule: lesson.allow });
        const html = renderToStaticMarkup(createElement(Game, { room: 'practice', settings: DEFAULT_SETTINGS, updateSettings: () => {}, practice: game, setupCard: lesson.setupCard }));
        for (const bad of NEVER) expect(html.includes(bad), `${where} shows "${bad}"`).toBe(false);
        // Before the battle, only a lesson that starts it offers Start the battle.
        if (!state.flow.started) expect(html.includes('Start the battle'), `${where} and Start the battle`).toBe(!!lesson.setupCard);
        // Moving on is greyed out in the turn guide unless it is what the lesson is about.
        for (const [, attrs, label] of html.matchAll(/<button([^>]*)>(Done moving|Done shooting|End fights[^<]*|End the Fight phase|Roll for priority)<\/button>/g)) {
          const open = label === 'Roll for priority' ? !!lesson.allow?.actions.includes('rollPriority') : !!lesson.allow?.actions.includes('endActivation') && !lesson.allow.only?.endActivation;
          seen++;
          expect(attrs.includes('data-locked'), `${where}: ${label} ${open ? 'is greyed out' : 'is offered'}`).toBe(!open);
        }
        for (const m of Object.values(state.models).filter(m => m.owner === 'p1' && !m.dead)) {
          const card = renderToStaticMarkup(createElement(ModelCard, { state, dispatch: () => {}, role: 'p1', model: m, catalog, target: undefined, clearTarget: () => {}, combat: undefined, openFight: () => {}, close: () => {}, lesson: true }));
          for (const bad of [...NEVER, '>Courage<']) expect(card.includes(bad), `${where}: ${m.name}'s card shows "${bad}"`).toBe(false);
        }
      }
    expect(seen, 'no turn guide button was checked').toBeGreaterThan(20);
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
        const game = new PracticeGame(state, { rule: lesson.allow });
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

describe('Each Learn to play step', () => {
  /** Every lesson, with where it is for messages. */
  const everyLesson = async () => {
    const { CHAPTERS } = await load();
    return CHAPTERS.flatMap(ch => ch.lessons.map(lesson => ({ lesson, where: `${ch.id}: ${lesson.title}` })));
  };

  it('refuses moving on, and moving the models it doesn’t use, and says so', async () => {
    const { PracticeGame } = await load();
    for (const { lesson, where } of await everyLesson()) {
      const state = lesson.setup();
      const game = new PracticeGame(state, { rule: lesson.allow });
      const refuse = (a: Action, why: string) => {
        const before = game.refused;
        game.dispatch(a);
        expect(game.getSnapshot().state, `${where} let ${why} through`).toBe(state);
        expect(game.refused, `${where} refused ${why} without saying so`).toBe(before + 1);
      };
      const rule = lesson.allow;
      // Moving on to the next phase is never what a lesson is about, unless it is the end of its task (and not yet).
      if (state.flow.started) {
        if (!rule?.actions.includes('endActivation') || rule.only?.endActivation) refuse({ type: 'endActivation', seat: 'p1' }, 'Done moving');
        refuse({ type: 'nextPhase' }, 'the next phase');
      }
      for (const m of Object.values(state.models).filter(x => x.owner === 'p1' && !x.dead)) {
        const moves = rule?.actions.includes('moveModels') && (!rule.models || rule.models.includes(m.id)) && !rule.only?.moveModels;
        if (!moves) refuse({ type: 'moveModels', moves: [{ id: m.id, x: m.x, y: m.y - 1 }] }, `moving ${m.name}`);
      }
      // The enemy is never yours to move.
      const foe = Object.values(state.models).find(x => x.owner === 'p2' && !x.dead);
      if (foe) refuse({ type: 'moveModels', moves: [{ id: foe.id, x: foe.x, y: foe.y + 1 }] }, `moving the enemy ${foe.name}`);
    }
  });

  it('can be done the way it says, and only then ticks', async () => {
    const { CHAPTERS, PracticeGame } = await load();
    const { loadCatalog } = await import('../src/shared/catalog.ts');
    await loadCatalog();
    const { botStep, newMemo } = await import('../src/shared/bot.ts');
    const lessons = new Map<string, (typeof CHAPTERS)[number]['lessons'][number]>(CHAPTERS.flatMap(ch => ch.lessons.map(l => [`${ch.id}: ${l.title}`, l] as const)));
    const open = (key: string) => {
      const lesson = lessons.get(key)!;
      const start = lesson.setup();
      const game = new PracticeGame(start, { rule: lesson.allow });
      const done = (picked: string[] = []) => !!lesson.done?.(game.getSnapshot().state, start, new Set(picked));
      expect(done(), `${key} ticks before anything is done`).toBe(false);
      return { game, done, start, s: () => game.getSnapshot().state };
    };
    /** Plays your side as the computer would, for the dice-rolling lessons, until the task ticks. */
    const play = (key: string) => {
      const { game, done, s } = open(key);
      const memo = newMemo();
      for (let i = 0; i < 12 && !done(); i++) {
        // (The computer would spend Might on its duel dice, which these lessons leave to the Might lesson.)
        const view = { ...s(), models: Object.fromEntries(Object.entries(s().models).map(([id, m]) => [id, { ...m, might: 0 }])) };
        const step = botStep(view, 'p1', catalog, memo, Date.now() + i * 10_000, false);
        if (!step?.action) break;
        const before = game.refused;
        game.dispatch(step.action);
        expect(game.refused, `${key} refused the ${step.action.type} it teaches`).toBe(before);
      }
      expect(done(), `${key} couldn't be done`).toBe(true);
    };
    const contact = (a: { x: number; y: number }, b: { x: number; y: number }, gap: number) => {
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      return { x: b.x + ((a.x - b.x) / d) * gap, y: b.y + ((a.y - b.y) / d) * gap };
    };

    {
      const { game, done, s } = open('basics: Who goes first');
      game.dispatch({ type: 'startGame' });
      game.dispatch({ type: 'rollPriority' });
      if (s().phase === 'priority') game.dispatch({ type: 'choosePriority', seat: 'p1' });
      expect(done()).toBe(true);
    }
    for (const [key, id] of [['basics: Reading a profile', 'captain'], ['moving: Control zones', 'warrior'], ['cavalry: Monsters', 'troll']] as const) {
      const { done } = open(key);
      expect(done(['orc2']), `${key} ticked for the wrong model`).toBe(false);
      expect(done([id]), `${key} didn't tick for ${id}`).toBe(true);
    }
    {
      const { done } = open('shooting: Shooting into a fight');
      expect(done(['ranger', 'orc1'])).toBe(true);
    }
    {
      const { game, done, s } = open('moving: Moving a model');
      game.dispatch({ type: 'moveModels', moves: [{ id: 'ranger', x: s().models.ranger.x, y: s().models.ranger.y - 3 }] });
      expect(done()).toBe(true);
    }
    {
      const { game, done } = open('moving: Difficult terrain');
      game.dispatch({ type: 'moveModels', moves: [{ id: 'warrior', x: 17.4, y: 16.6 }] });
      expect(done()).toBe(true);
    }
    {
      // Dragged at the wall, he is held there, and his card's Jump rolls the test.
      const { game, done, s } = open('moving: Jumping and climbing');
      game.dispatch({ type: 'moveModels', moves: [{ id: 'warrior', x: 13.5, y: 15.5 }] });
      expect(s().models.warrior.y, 'the Warrior got past the wall without a test').toBeGreaterThan(16);
      game.dispatch({ type: 'cross', id: 'warrior' });
      expect(done()).toBe(true);
    }
    for (const [key, id] of [['moving: Charging', 'warrior'], ['cavalry: Cavalry', 'knight']] as const) {
      const { game, done, s } = open(key);
      const before = game.refused;
      game.dispatch({ type: 'endActivation', seat: 'p1' });
      expect(game.refused, `${key} let Done moving through before the charge`).toBe(before + 1);
      const m = s().models[id];
      const at = contact(m, s().models.orc1, (m.base.w + s().models.orc1.base.w) / 2 / 25.4);
      game.dispatch({ type: 'moveModels', moves: [{ id, ...at }] });
      game.dispatch({ type: 'endActivation', seat: 'p1' });
      expect(done(), `${key} couldn't be done`).toBe(true);
    }
    {
      const { game, done } = open('heroes: Heroic actions');
      game.dispatch({ type: 'passHeroic', seat: 'p1' });
      expect(done()).toBe(true);
    }
    {
      const { game, done } = open('heroes: Fate');
      game.dispatch({ type: 'takeWound', id: 'captain' });
      expect(done()).toBe(true);
    }
    {
      const { game, done } = open('courage: Broken');
      game.dispatch({ type: 'passHeroic', seat: 'p1' });
      expect(done()).toBe(true);
    }
    {
      const { game, done, s } = open('courage: Terror');
      const at = contact(s().models.warrior, s().models.troll, (25 + 40) / 2 / 25.4);
      game.dispatch({ type: 'moveModels', moves: [{ id: 'warrior', ...at }] });
      expect(done()).toBe(true);
    }
    {
      const { game, done } = open('magic: Resisting');
      game.dispatch({ type: 'resist', will: 1 });
      expect(done()).toBe(true);
    }
    for (const key of ['shooting: Who can shoot', 'shooting: Rolling to wound', 'fighting: The duel', 'fighting: Ties and backing away', 'fighting: Trapped', 'fighting: Spears and pikes']) play(key);
  });

  it('leaves the map editor’s table free to lay out', async () => {
    const { PracticeGame } = await load();
    const { initialState } = await import('../src/shared/reducer.ts');
    const game = new PracticeGame(initialState());
    game.dispatch({ type: 'setScenery', w: 24, h: 24, mat: 'grass', terrain: [] });
    game.dispatch({ type: 'addTerrain', terrain: { id: 't1', kind: 'wood', shape: 'circle', x: 5, y: 5, w: 4, h: 4, rot: 0, locked: true } });
    expect(Object.keys(game.getSnapshot().state.terrain)).toEqual(['t1']);
    expect(game.refused).toBe(0);
  });
});
