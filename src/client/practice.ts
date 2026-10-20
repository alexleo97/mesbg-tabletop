import { activeSeat } from '../shared/flow.ts';
import { heroicTurn } from '../shared/heroics.ts';
import { reduce } from '../shared/reducer.ts';
import { DICE_REQUESTS, resolveRequest } from '../shared/resolve.ts';
import { loadCatalog, type Catalog } from '../shared/catalog.ts';
import { settleSpell } from '../shared/magic.ts';
import { recoveryDue, recoveryRolls } from '../shared/powers.ts';
import { riderTests, riderTestsDue } from '../shared/cavalry.ts';
import { beastTests, beastTestsDue } from '../shared/warBeasts.ts';
import { sabotageActions } from '../shared/siege.ts';
import { chargeSabotage } from '../shared/helms.ts';
import { brokenSideToTest, brokenTests, terrorAhead, terrorTest } from '../shared/courage.ts';
import { cleanMark } from '../shared/marks.ts';
import type { Action, GameState, Mark, Phase, Role } from '../shared/types.ts';
import { showMark, turnMarks, type Connection, type Snapshot } from './net.ts';

const d6 = () => 1 + Math.floor(Math.random() * 6);
let n = 0;
const uid = () => `${Date.now().toString(36)}-${(n++).toString(36)}`;
let catalog: Catalog | null = null;
void loadCatalog().then(c => (catalog = c), () => {});

/**
 * What a lesson's table refuses: setting up armies, terrain, the scenario or the seats, editing models, ending the game,
 * and the free choices no lesson teaches (lying down, dismounting). The lesson sets its own table, and the game rolls
 * and tests for itself.
 */
const NOT_IN_LESSONS = new Set<Action['type']>([
  'addModels', 'removeModels', 'updateModel', 'addTerrain', 'updateTerrain', 'removeTerrain', 'setScenery', 'setBoard', 'setScenario', 'setNarrative',
  'startNarrative', 'setPick', 'setVP', 'setName', 'setBot', 'setBotSpeed', 'setBotInstantMoves', 'setListed', 'setPrivate', 'setAdvance', 'setPhase', 'setPriority', 'loadState',
  'concede', 'proposeResult', 'answerResult', 'lieDown', 'dismount',
]);

/** Whether a lesson lets the player do this: before the battle starts, only start it. */
export function lessonAllows(state: GameState, action: Action): boolean {
  if (!state.flow.started) return action.type === 'startGame';
  return !NOT_IN_LESSONS.has(action.type);
}

/** What one step of a lesson lets you do on its table. Everything else is refused. */
export interface LessonRule {
  /** The kinds of action the step teaches. */
  actions: Action['type'][];
  /** The only models of yours the step uses, when it isn't all of them. */
  models?: string[];
  /** The only phases these are done in, when it isn't any. */
  phases?: Phase[];
  /** Actions the step only takes once the table is ready for them, such as Done moving once the charge is in. */
  only?: Partial<Record<Action['type'], (s: GameState) => boolean>>;
}

/** Your models an action moves or acts with, for a step that only uses some of them. */
function actorsOf(state: GameState, action: Action): string[] {
  switch (action.type) {
    case 'moveModels':
      // A model your caster has Compelled is moved by you, whoever it belongs to.
      return action.moves.map(mv => mv.id).filter(id => id !== state.flow.compel?.model);
    case 'shoot':
      return [action.shot.shooter.id];
    case 'cast':
    case 'declareHeroic':
      return [action.model];
    case 'cross':
    case 'crossed':
    case 'crawl':
    case 'climb':
    case 'rollFate':
    case 'takeWound':
    case 'fightChoice':
      return [action.id];
    case 'useMight': {
      const by = state.log.find(r => r.id === action.roll)?.model;
      return by ? [by] : [];
    }
    default:
      return [];
  }
}

/** Whether this step of a lesson lets the player do this. A step without a rule is only read. */
export function stepAllows(state: GameState, action: Action, rule: LessonRule | undefined): boolean {
  if (!lessonAllows(state, action) || !rule) return false;
  if (rule.phases && !rule.phases.includes(state.phase)) return false;
  if (!rule.actions.includes(action.type)) return false;
  if (rule.only?.[action.type] && !rule.only[action.type]!(state)) return false;
  const models = rule.models;
  return !models || actorsOf(state, action).every(id => models.includes(id));
}

/**
 * A game played entirely in this browser, for the training. You play player 1; player 2 is a
 * quiet opponent that passes and finishes its turns straight away so the lesson keeps moving.
 */
export class PracticeGame implements Connection {
  readonly room = 'practice';
  private listeners = new Set<() => void>();
  private snap: Snapshot;
  /** On a Learn to play table, what the step on it lets you do (a step without a rule is only read). Without one, as in the map editor, the table is free. */
  private lesson: { rule?: LessonRule } | undefined;
  /** How many times something the step doesn't teach was tried, so the lesson card can say what to do instead. */
  refused = 0;

  constructor(state: GameState, lesson?: { rule?: LessonRule }) {
    this.snap = { state, status: 'online', players: ['p1', 'p2'], undoDepth: 0 };
    this.lesson = lesson;
  }

  /** Starts a lesson from a fresh board, with what its step lets you do. */
  load(state: GameState, rule?: LessonRule) {
    this.lesson = { rule };
    this.refused = 0;
    this.set(state);
  }

  /** Whether the table lets you do this: anything on a free table, only what the step teaches in a lesson. */
  allows(action: Action): boolean {
    return !this.lesson || stepAllows(this.snap.state, action, this.lesson.rule);
  }

  /** Whether the step uses this model of yours: any, on a free table or a step that names none. */
  uses(id: string): boolean {
    if (!this.lesson) return true;
    const rule = this.lesson.rule;
    return !!rule && (!rule.models || rule.models.includes(id));
  }

  /** Something the step doesn't teach was tried. */
  refuse() {
    this.refused++;
    this.patch({});
  }

  dispatch(action: Action) {
    let state = this.snap.state;
    if (!this.allows(action)) return this.refuse();
    // As the server does: a model about to charge something terrifying tests its Courage first, and stays put if it fails.
    if (action.type === 'moveModels' && Array.isArray(action.moves)) {
      const moves = action.moves.filter(mv => {
        const m = state.models[mv.id];
        const to = m && reduce(state, { type: 'moveModels', moves: [mv] }).models[m.id];
        const enemy = m && to && terrorAhead(state, m, to, catalog);
        if (!m || !enemy) return true;
        const test = terrorTest(m, enemy, catalog, d6, uid, Date.now(), state);
        for (const a of test.actions) state = reduce(state, a);
        return test.pass;
      });
      if (!moves.length) return this.set(state);
      action = { ...action, moves };
    }
    if (DICE_REQUESTS.has(action.type)) {
      const out = resolveRequest(state, 'p1', action, d6, uid, Date.now(), catalog);
      if (!out) return;
      for (const a of [...out.apply, ...(out.record ? [out.record] : [])]) state = reduce(state, a);
    } else if (action.type !== 'undo') state = reduce(state, action);
    // What the server would do by itself: put a lifted cast into play, roll Paralysed models' recovery and thrown riders' tests.
    for (const a of settleSpell(state, catalog, d6, uid)) state = reduce(state, a);
    if (recoveryDue(state)) for (const a of recoveryRolls(state, d6, uid)) state = reduce(state, a);
    if (riderTestsDue(state)) for (const a of riderTests(state, catalog, d6, uid)) state = reduce(state, a);
    if (beastTestsDue(state)) for (const a of beastTests(state, catalog, d6, uid)) state = reduce(state, a);
    for (const a of [...sabotageActions(state, uid), ...chargeSabotage(state, uid)]) state = reduce(state, a);
    this.set(this.upkeep(this.opponent(state)));
  }

  /** And a Broken side's Courage tests as it starts to move. */
  private upkeep(state: GameState): GameState {
    const seat = brokenSideToTest(state);
    if (seat) for (const a of brokenTests(state, seat, catalog, d6, uid)) state = reduce(state, a);
    return state;
  }

  /** Player 2 never declares heroics, gives Priority away and ends its activations at once. */
  private opponent(state: GameState): GameState {
    for (let i = 0; i < 6; i++) {
      const next =
        state.phase === 'priority' && state.flow.chooser === 'p2' && state.flow.chooserTurn === state.turn && !state.priority
          ? reduce(state, { type: 'choosePriority', seat: 'p1' })
          : heroicTurn(state) === 'p2'
            ? reduce(state, { type: 'passHeroic', seat: 'p2' })
            : activeSeat(state) === 'p2'
              ? reduce(state, { type: 'endActivation', seat: 'p2' })
              : state;
      if (next === state) break;
      state = next;
    }
    return state;
  }

  private set(state: GameState) {
    this.patch({ state, ...turnMarks(this.snap.state, state, this.snap.marks) });
  }

  private patch(p: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...p };
    for (const l of this.listeners) l();
  }

  mark(raw: Pick<Mark, 'kind' | 'x' | 'y' | 'x2' | 'y2'>) {
    const mark = cleanMark(raw, 'p1', uid());
    if (mark) showMark(this.getSnapshot, p => this.patch(p), mark);
  }

  clearMarks() {
    this.patch({ marks: (this.snap.marks ?? []).filter(m => m.by !== 'p1') });
  }

  setRole(_role: Role) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  getSnapshot = () => this.snap;

  close() {}
}
