import { activeSeat } from '../shared/flow.ts';
import { heroicTurn } from '../shared/heroics.ts';
import { reduce } from '../shared/reducer.ts';
import { DICE_REQUESTS, resolveRequest } from '../shared/resolve.ts';
import { loadCatalog, type Catalog } from '../shared/catalog.ts';
import { settleSpell } from '../shared/magic.ts';
import { recoveryDue, recoveryRolls } from '../shared/powers.ts';
import { riderTests, riderTestsDue } from '../shared/cavalry.ts';
import { cleanMark } from '../shared/marks.ts';
import type { Action, GameState, Mark, Role } from '../shared/types.ts';
import { showMark, turnMarks, type Connection, type Snapshot } from './net.ts';

const d6 = () => 1 + Math.floor(Math.random() * 6);
let n = 0;
const uid = () => `${Date.now().toString(36)}-${(n++).toString(36)}`;
let catalog: Catalog | null = null;
void loadCatalog().then(c => (catalog = c), () => {});

/**
 * A game played entirely in this browser, for the training. You play player 1; player 2 is a
 * quiet opponent that passes and finishes its turns straight away so the lesson keeps moving.
 */
export class PracticeGame implements Connection {
  readonly room = 'practice';
  private listeners = new Set<() => void>();
  private snap: Snapshot;

  constructor(state: GameState) {
    this.snap = { state, status: 'online', players: ['p1', 'p2'], undoDepth: 0 };
  }

  /** Starts a lesson from a fresh board. */
  load(state: GameState) {
    this.set(state);
  }

  dispatch(action: Action) {
    let state = this.snap.state;
    if (DICE_REQUESTS.has(action.type)) {
      const out = resolveRequest(state, 'p1', action, d6, uid, Date.now(), catalog);
      if (!out) return;
      for (const a of [...out.apply, ...(out.record ? [out.record] : [])]) state = reduce(state, a);
    } else if (action.type !== 'undo') state = reduce(state, action);
    // What the server would do by itself: put a lifted cast into play, roll Paralysed models' recovery and thrown riders' tests.
    for (const a of settleSpell(state, catalog, d6, uid)) state = reduce(state, a);
    if (recoveryDue(state)) for (const a of recoveryRolls(state, d6, uid)) state = reduce(state, a);
    if (riderTestsDue(state)) for (const a of riderTests(state, catalog, d6, uid)) state = reduce(state, a);
    this.set(this.opponent(state));
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
