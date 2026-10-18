import { describe, expect, it } from 'vitest';
import { botStep, newMemo } from '../src/shared/bot.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog } from './botsim.ts';

const mk = (id: string, owner: Seat, x: number, y: number, profileId: string, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, profileId, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const game = (models: Model[]) =>
  run(initialState(), { type: 'addModels', models }, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });

describe('the computer casting', () => {
  it('casts a power at a worthwhile enemy as its side starts to move', () => {
    const s = game([
      mk('shaman', 'p2', 24, 20, '[legions-of-mordor] mordor-orc-shaman', { hero: true, will: 3, points: 40 }),
      mk('cap', 'p1', 24, 28, '[minas-tirith] captain-of-minas-tirith', { hero: true, might: 2, will: 1, fate: 1, wounds: 2, maxWounds: 2, points: 50 }),
    ]);
    const step = botStep(s, 'p2', catalog, newMemo(), 5000);
    expect(step?.action).toMatchObject({ type: 'cast', model: 'shaman', target: 'cap' });
  });

  it('keeps its Will when nothing is worth a cast', () => {
    const s = game([
      mk('shaman', 'p2', 24, 4, '[legions-of-mordor] mordor-orc-shaman', { hero: true, will: 3, points: 40 }),
      mk('w', 'p1', 24, 44, '[minas-tirith] warrior-of-minas-tirith'),
    ]);
    const step = botStep(s, 'p2', catalog, newMemo(), 5000);
    expect(step?.action?.type).not.toBe('cast');
  });
});
