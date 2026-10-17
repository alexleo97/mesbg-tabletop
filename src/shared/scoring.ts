import { distanceToBase, halfExtents, type Point } from './geometry.ts';
import { scenarioById, vpTotal, type Scenario } from './scenarios.ts';
import { armyStatus } from './status.ts';
import type { GameState, Model, Seat, Terrain } from './types.ts';

// Works out each scenario's victory points from the table, so players don't have to.
// A scoring line the game can't see (secret picks, carried artefacts, models that escaped) is left for the players
// to enter by hand, and shows as such.

const SEATS = ['p1', 'p2'] as const;
const other = (s: Seat): Seat => (s === 'p1' ? 'p2' : 'p1');

/** Everything a scoring line needs, worked out once. */
interface Facts {
  state: GameState;
  live: Record<Seat, Model[]>;
  all: Record<Seat, Model[]>;
  objectives: Terrain[];
  general: Record<Seat, Model | undefined>;
}

/** How far a model's base is from an objective marker's edge. */
const fromMarker = (m: Model, t: Terrain) => Math.max(0, distanceToBase(m, t) - Math.max(t.w, t.h) / 2);
const near = (f: Facts, seat: Seat, t: Terrain, r: number) => f.live[seat].filter(m => fromMarker(m, t) <= r).length;
const nearPoint = (f: Facts, seat: Seat, p: Point, r: number) => f.live[seat].filter(m => distanceToBase(m, p) <= r).length;

/** A side's General: the model marked as leader when the list was deployed, otherwise its strongest hero. */
function generalOf(models: Model[]): Model | undefined {
  const marked = models.find(m => m.general);
  if (marked) return marked;
  return [...models.filter(m => m.hero)].sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) || (b.points ?? 0) - (a.points ?? 0) || b.maxWounds + b.might - (a.maxWounds + a.might))[0];
}

const isBanner = (m: Model) => /banner/i.test(m.name) || !!m.options?.some(o => /banner/i.test(o));
const hurt = (m: Model) => m.dead || m.wounds < m.maxWounds;

/** Every Wound an army has suffered plus every Fate point it has spent (a slain hero's unspent Fate counts too). */
function woundTally(f: Facts, seat: Seat): number {
  const fate = f.state.flow.startFate ?? {};
  return f.all[seat].reduce((a, m) => a + (m.dead ? m.maxWounds + (fate[m.id] ?? 0) : m.maxWounds - m.wounds + Math.max(0, (fate[m.id] ?? m.fate) - m.fate)), 0);
}

/** 1 for more, 2 for at least double, 3 for at least triple (or the other side has none at all), when `tripleIfNone`. */
function margin(mine: number, theirs: number, tripleIfNone = true): number {
  if (mine <= theirs) return 0;
  if (mine >= theirs * 3 || (tripleIfNone && theirs === 0)) return 3;
  if (mine >= theirs * 2) return 2;
  return 1;
}

/** 1 for more, 2 for at least double, 3 for being the only side there. */
function share(mine: number, theirs: number): number {
  if (mine <= theirs) return 0;
  if (theirs === 0) return 3;
  return mine >= theirs * 2 ? 2 : 1;
}

/** A line's points as numbers: "1 / 3 if slain" is [1, 3]. */
const pointsOf = (line: Scenario['scoring'][number]) => (line.points.match(/\d+/g) ?? []).map(Number);
const pick = (pts: number[], level: number) => (level > 0 ? (pts[Math.min(level, pts.length) - 1] ?? 0) : 0);

type Scorer = (f: Facts, seat: Seat, pts: number[]) => number;

/** Lines shared by many scenarios, recognised by their wording. */
const COMMON: [RegExp, Scorer][] = [
  [
    /^Enemy General wounded \/ on its last Wound \/ slain/,
    (f, s, pts) => {
      const g = f.general[other(s)];
      return !g ? 0 : g.dead ? pts[2] : g.wounds === 1 && g.maxWounds > 1 ? pts[1] : hurt(g) ? pts[0] : 0;
    },
  ],
  [
    /^Enemy General wounded \/ slain/,
    (f, s, pts) => {
      const g = f.general[other(s)];
      return !g ? 0 : g.dead ? pts[1] : hurt(g) ? pts[0] : 0;
    },
  ],
  [
    /^Enemy army Broken/,
    (f, s, pts) => {
      const them = armyStatus(f.state, other(s)).broken;
      return !them ? 0 : armyStatus(f.state, s).broken ? pts[0] : pts[1];
    },
  ],
  [/^Opponent has no banners left/, (f, s, pts) => (f.live[other(s)].some(isBanner) ? 0 : pts[0])],
  [
    /^You still have a banner/,
    (f, s, pts) => {
      const mine = f.live[s].filter(isBanner).length;
      return mine === 0 ? 0 : mine > f.live[other(s)].filter(isBanner).length ? pts[1] : pts[0];
    },
  ],
  [/^Enemy army reduced to 25%/, (f, s, pts) => (armyStatus(f.state, other(s)).quartered ? pts[0] : 0)],
  [
    /^Each enemy Hero slain \(max (\d+)\)/,
    (f, s, pts) => Math.min(pts[1] ?? 99, f.all[other(s)].filter(m => m.hero && m.dead).length * pts[0]),
  ],
  [
    /^Per objective: more models within 3"/,
    (f, s, pts) => f.objectives.reduce((a, t) => a + pick(pts, share(near(f, s, t, 3), near(f, other(s), t, 3))), 0),
  ],
  [
    /^Opponent's most expensive non-General model/,
    (f, s, pts) => {
      const g = f.general[other(s)];
      const rest = f.all[other(s)].filter(m => m !== g);
      const top = Math.max(0, ...rest.map(m => m.points ?? 0));
      const target = top > 0 ? rest.find(m => m.points === top) : undefined;
      return !target ? 0 : target.dead ? pts[1] : hurt(target) ? pts[0] : 0;
    },
  ],
];

const centre = (f: Facts): Point => ({ x: f.state.board.w / 2, y: f.state.board.h / 2 });
/** The marker nearest the middle of the table. */
const centreMarker = (f: Facts) => [...f.objectives].sort((a, b) => Math.hypot(a.x - centre(f).x, a.y - centre(f).y) - Math.hypot(b.x - centre(f).x, b.y - centre(f).y))[0];
/** Player 1 deploys at the bottom of the table, player 2 at the top. */
const inOwnHalf = (f: Facts, seat: Seat, p: Point) => (seat === 'p1' ? p.y > f.state.board.h / 2 : p.y < f.state.board.h / 2);

/** Each scenario's own lines, by their position in its scoring list. */
const SPECIFIC: Record<string, Record<number, Scorer>> = {
  'capture-and-control': {
    0: (f, s, pts) => f.objectives.filter(t => f.state.flow.control?.[t.id] === s).length * pts[0],
  },
  breakthrough: {
    0: (f, s, pts) => f.objectives.filter(t => !onCentreLine(f, t) && inOwnHalf(f, s, t)).reduce((a, t) => a + (near(f, s, t, 3) > near(f, other(s), t, 3) ? pts[0] : 0), 0),
    1: (f, s, pts) => f.objectives.filter(t => onCentreLine(f, t)).reduce((a, t) => a + onlyOrMore(f, s, t, 3, pts), 0),
    2: (f, s, pts) => f.objectives.filter(t => !onCentreLine(f, t) && !inOwnHalf(f, s, t)).reduce((a, t) => a + onlyOrMore(f, s, t, 3, pts), 0),
  },
  'stake-a-claim': {
    0: (f, s, pts) => {
      const fort = f.state.flow.fort ?? { p1: 0, p2: 0 };
      return pick(pts, margin(fort[s], fort[other(s)], false));
    },
    3: (f, s, pts) => {
      const held = (x: Seat) => f.objectives.filter(t => near(f, x, t, 3) > near(f, other(x), t, 3)).length;
      return held(s) > held(other(s)) ? pts[0] : 0;
    },
  },
  'lords-of-battle': {
    0: (f, s, pts) => {
      const mine = woundTally(f, other(s));
      const theirs = woundTally(f, s);
      if (mine > 0 && f.live[other(s)].length === 0) return pts[2];
      return pick(pts, margin(mine, theirs, false));
    },
  },
  'contest-of-champions': {
    3: (f, s, pts) => {
      const g = f.general[s];
      return !g || g.dead ? 0 : hurt(g) ? pts[0] : pts[1];
    },
  },
  'hold-ground': {
    0: (f, s, pts) => {
      const t = centreMarker(f);
      return t ? pick(pts, margin(near(f, s, t, 6), near(f, other(s), t, 6))) : 0;
    },
  },
  'command-the-battlefield': {
    0: (f, s, pts) => {
      const c = centre(f);
      // Wholly within 12" of the centre counts as no quarter at all.
      const counted = (x: Seat) => f.live[x].filter(m => Math.hypot(m.x - c.x, m.y - c.y) + Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry) > 12);
      const quarter = (m: Model, q: number) => {
        const { rx, ry } = halfExtents(m.base);
        const left = m.x + rx <= c.x;
        const right = m.x - rx >= c.x;
        const top = m.y + ry <= c.y;
        const bottom = m.y - ry >= c.y;
        return [left && top, right && top, left && bottom, right && bottom][q];
      };
      let total = 0;
      for (let q = 0; q < 4; q++) total += pick(pts, share(counted(s).filter(m => quarter(m, q)).length, counted(other(s)).filter(m => quarter(m, q)).length));
      return total;
    },
  },
  'treasure-hoard': {
    3: (f, s, pts) => {
      // Wholly within 12" of the enemy's edge: the top for player 1, the bottom for player 2.
      const n = f.live[s].filter(m => {
        const ry = halfExtents(m.base).ry;
        return s === 'p1' ? m.y + ry <= 12 : m.y - ry >= f.state.board.h - 12;
      }).length;
      return n >= 3 ? pts[1] : n >= 1 ? pts[0] : 0;
    },
  },
  'divide-and-conquer': {
    0: (f, s, pts) => {
      const t = centreMarker(f);
      return t ? onlyOrMore(f, s, t, 3, pts) : 0;
    },
    1: (f, s, pts) => f.objectives.filter(t => t !== centreMarker(f)).reduce((a, t) => a + onlyOrMore(f, s, t, 3, pts), 0),
    4: (f, s, pts) => {
      const t = centreMarker(f);
      const g = f.general[s];
      return t && g && !g.dead && fromMarker(g, t) <= 3 ? pts[0] : 0;
    },
  },
  'clash-by-moonlight': {
    5: (f, s, pts) => {
      const t = centreMarker(f);
      if (!t) return 0;
      const m = margin(near(f, s, t, 3), near(f, other(s), t, 3));
      return m >= 2 ? pts[1] : m === 1 ? pts[0] : 0;
    },
  },
  'lead-from-the-front': {
    0: (f, s, pts) =>
      f.objectives.reduce((a, t) => {
        const tier = (x: Seat) => Math.max(-1, ...f.live[x].filter(m => m.hero && fromMarker(m, t) <= 3).map(m => m.tier ?? 0));
        const [mine, theirs] = [tier(s), tier(other(s))];
        return a + (mine >= 0 && theirs >= 0 && mine > theirs ? pts[0] : 0);
      }, 0),
    1: (f, s, pts) =>
      f.objectives.reduce((a, t) => {
        const heroes = (x: Seat) => f.live[x].some(m => m.hero && fromMarker(m, t) <= 3);
        return a + (heroes(s) && !heroes(other(s)) ? pts[0] : 0);
      }, 0),
  },
  convergence: {
    1: (f, s, pts) => (nearPoint(f, s, centre(f), 6) > nearPoint(f, other(s), centre(f), 6) ? pts[0] : 0),
  },
};

const onCentreLine = (f: Facts, t: Terrain) => Math.abs(t.y - f.state.board.h / 2) <= 3;
/** First points for more models in range, second for being the only side there. */
function onlyOrMore(f: Facts, s: Seat, t: Terrain, r: number, pts: number[]) {
  const [mine, theirs] = [near(f, s, t, r), near(f, other(s), t, r)];
  return mine > 0 && theirs === 0 ? pts[1] : mine > theirs ? pts[0] : 0;
}

function facts(state: GameState): Facts {
  const all = { p1: [] as Model[], p2: [] as Model[] };
  for (const m of Object.values(state.models)) all[m.owner].push(m);
  const live = { p1: all.p1.filter(m => !m.dead), p2: all.p2.filter(m => !m.dead) };
  return {
    state,
    all,
    live,
    objectives: Object.values(state.terrain).filter(t => t.kind === 'objective'),
    general: { p1: generalOf(all.p1), p2: generalOf(all.p2) },
  };
}

export interface ScoreLine {
  label: string;
  points: string;
  /** Worked out by the game; otherwise the players enter it. */
  auto: boolean;
  vp: Record<Seat, number>;
}

/** Every scoring line of the scenario with what each side has right now, as if the game ended this moment. */
export function scoreLines(state: GameState): ScoreLine[] {
  const s = scenarioById(state.scenario);
  if (!s) return [];
  const f = facts(state);
  return s.scoring.map((line, i) => {
    const pts = pointsOf(line);
    const scorer = SPECIFIC[s.id]?.[i] ?? COMMON.find(([re]) => re.test(line.label))?.[1];
    if (!scorer) return { label: line.label, points: line.points, auto: false, vp: { p1: state.vp.p1[String(i)] ?? 0, p2: state.vp.p2[String(i)] ?? 0 } };
    const vp = { p1: scorer(f, 'p1', pts) || 0, p2: scorer(f, 'p2', pts) || 0 };
    return { label: line.label, points: line.points, auto: true, vp };
  });
}

/** Each side's victory points: the game's own count plus anything entered by hand. */
export function vpTotals(state: GameState): Record<Seat, number> {
  const lines = scoreLines(state);
  if (!lines.length) return { p1: vpTotal(state.vp.p1), p2: vpTotal(state.vp.p2) };
  return { p1: lines.reduce((a, l) => a + l.vp.p1, 0), p2: lines.reduce((a, l) => a + l.vp.p2, 0) };
}

/**
 * The End phase bookkeeping some scenarios need: objectives touched by only one side become theirs (and go back to
 * neutral when both touch them), and each side earns Fortification Points for objectives they hold.
 */
export function endPhaseUpkeep(state: GameState): Pick<GameState['flow'], 'control' | 'fort'> {
  const f = facts(state);
  const out: Pick<GameState['flow'], 'control' | 'fort'> = {};
  if (state.scenario === 'capture-and-control') {
    const control = { ...(state.flow.control ?? {}) };
    for (const t of f.objectives) {
      const touching = SEATS.filter(x => f.live[x].some(m => fromMarker(m, t) <= 0.05));
      if (touching.length === 2) control[t.id] = null;
      else if (touching.length === 1) control[t.id] = touching[0];
    }
    out.control = control;
  }
  if (state.scenario === 'stake-a-claim') {
    const fort = { ...(state.flow.fort ?? { p1: 0, p2: 0 }) };
    for (const t of f.objectives) {
      for (const x of SEATS) {
        const [mine, theirs] = [near(f, x, t, 3), near(f, other(x), t, 3)];
        if (mine > 0 && theirs === 0) fort[x] += 2;
        else if (mine > theirs) fort[x] += 1;
      }
    }
    out.fort = fort;
  }
  return out;
}
