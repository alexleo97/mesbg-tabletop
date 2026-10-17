import { basePerimeter, distanceToBase, halfExtents, type Point } from './geometry.ts';
import { fromMarker, inHalf, inZone, onTable, whollyIn, zonesOf } from './objects.ts';
import { scenarioById, vpTotal, type Scenario } from './scenarios.ts';
import { insidePolygon, outline } from './sight.ts';
import { armyStatus } from './status.ts';
import type { GameState, Model, Seat, Terrain } from './types.ts';

// Works out each scenario's victory points from the table, so players don't have to.
// Secret picks, carried markers, escapes and who killed whom are all tracked, so every line is worked out; a line
// with no scorer (a scenario added later) is left for the players to enter by hand.

const SEATS = ['p1', 'p2'] as const;
const other = (s: Seat): Seat => (s === 'p1' ? 'p2' : 'p1');

/** Everything a scoring line needs, worked out once. */
interface Facts {
  state: GameState;
  live: Record<Seat, Model[]>;
  all: Record<Seat, Model[]>;
  objectives: Terrain[];
  general: Record<Seat, Model | undefined>;
  /** Models that left the table over an edge. */
  escaped: Record<Seat, Model[]>;
}

const near = (f: Facts, seat: Seat, t: Terrain, r: number) => f.live[seat].filter(m => fromMarker(m, t) <= r).length;
const nearPoint = (f: Facts, seat: Seat, p: Point, r: number) => f.live[seat].filter(m => distanceToBase(m, p) <= r).length;

/** A side's General: the model marked as leader when the list was deployed, otherwise its strongest hero. */
export function generalOf(models: Model[]): Model | undefined {
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

/** A player's secret pick, as the model or terrain piece it names. */
const picked = (f: Facts, s: Seat, key: 'target' | 'assassin' | 'champion' | 'protect' | 'hunt') => {
  const id = f.state.flow.picks?.[s]?.[key];
  return id ? f.state.models[id] : undefined;
};
/** Your Champion: the one you picked, otherwise your General. */
const championOf = (f: Facts, s: Seat) => picked(f, s, 'champion') ?? f.general[s];
const killedBy = (v: Model | undefined, killer: Model | undefined, how?: 'fight' | 'shoot') =>
  !!v?.dead && !!killer && !!v.killedBy?.ids.includes(killer.id) && (!how || v.killedBy.how === how);
/** Enemies a model killed in combat. */
const fightKills = (f: Facts, s: Seat, m: Model | undefined) => (m ? f.all[other(s)].filter(v => killedBy(v, m, 'fight')).length : 0);
/** 1 for more, 2 for at least 2 and double, 3 for at least 3 and triple. */
function lead(mine: number, theirs: number): number {
  if (mine <= theirs) return 0;
  if (mine >= 3 && mine >= theirs * 3) return 3;
  if (mine >= 2 && mine >= theirs * 2) return 2;
  return 1;
}
const objectsOf = (f: Facts, kind: string) => Object.values(f.state.terrain).filter(t => t.object === kind);
/** The model carrying a marker, if it's on the table and carried by one of this side's models. */
const heldBy = (f: Facts, s: Seat, t: Terrain) => {
  const m = !t.gone && t.carrier ? f.state.models[t.carrier] : undefined;
  return m && m.owner === s && !m.dead && !m.escaped ? m : undefined;
};
const loose = (t: Terrain) => !t.gone && !t.carrier;
/** Models standing on or touching a terrain piece. */
function onTerrain(f: Facts, s: Seat, t: Terrain): number {
  const poly = outline(t);
  return f.live[s].filter(m => insidePolygon(poly, m) || basePerimeter(m, 24).some(p => insidePolygon(poly, p)) || poly.some(p => distanceToBase(m, p) <= 0.2)).length;
}
const inCamp = (f: Facts, s: Seat) => {
  const camp = zonesOf(f.state, other(s));
  return f.live[s].filter(m => whollyIn(camp, m));
};

const MARKER_LINES: Record<string, Record<number, Scorer>> = {
  assassination: {
    0: (f, s, pts) => {
      const target = picked(f, s, 'target');
      const assassin = picked(f, s, 'assassin');
      if (!target || target.owner === s) return 0;
      if (target.dead) return killedBy(target, assassin) ? pts[3] : pts[2];
      if (!hurt(target)) return 0;
      return assassin && target.hurtBy?.includes(assassin.id) ? pts[1] : pts[0];
    },
    3: (f, s, pts) => {
      const assassin = picked(f, s, 'assassin');
      return assassin && assassin.owner === s && !assassin.dead ? pts[0] : 0;
    },
    4: (f, s, pts) => {
      const theirs = picked(f, other(s), 'target');
      return theirs && theirs.owner === s && !theirs.dead ? pts[0] : 0;
    },
  },
  'contest-of-champions': {
    0: (f, s, pts) => pick(pts, lead(fightKills(f, s, championOf(f, s)), fightKills(f, other(s), championOf(f, other(s))))),
    1: (f, s, pts) => (killedBy(championOf(f, other(s)), championOf(f, s), 'fight') ? pts[0] : 0),
  },
  'heirloom-of-ages-past': {
    0: (f, s, pts) => {
      const t = objectsOf(f, 'heirloom').find(x => !x.gone);
      if (!t) return 0;
      if (heldBy(f, s, t)) return pts[0];
      return loose(t) && near(f, s, t, 3) > near(f, other(s), t, 3) ? pts[1] : 0;
    },
    1: (f, s, pts) => objectsOf(f, 'decoy').filter(t => t.gone === 'revealed' && t.by === s).length * pts[0],
  },
  'destroy-the-supplies': {
    0: (f, s, pts) => objectsOf(f, 'supply').filter(t => t.side === other(s) && t.gone === 'destroyed').length * pts[0],
    1: (f, s, pts) => objectsOf(f, 'supply').filter(t => t.side === other(s) && !t.gone && near(f, s, t, 3) > near(f, other(s), t, 3)).length * pts[0],
    2: (f, s, pts) => {
      const wrecked = (x: Seat) => objectsOf(f, 'supply').filter(t => t.side === other(x) && t.gone === 'destroyed').length;
      return wrecked(s) > wrecked(other(s)) ? pts[0] : 0;
    },
  },
  retrieval: {
    0: (f, s, pts) => {
      const t = objectsOf(f, 'relic').find(x => x.side === other(s));
      if (!t) return 0;
      if (t.gone === 'off') return t.by === s ? pts[3] : 0;
      const m = heldBy(f, s, t);
      if (m) return zonesOf(f.state, s).some(z => inZone(z, m)) ? pts[2] : pts[1];
      return t.home && Math.hypot(t.x - t.home[0], t.y - t.home[1]) > 0.1 ? pts[0] : 0;
    },
  },
  'seize-the-prizes': {
    0: (f, s, pts) =>
      objectsOf(f, 'artefact').reduce((a, t) => {
        if (t.gone === 'off') return a + (t.by === s ? pts[2] : 0);
        const m = heldBy(f, s, t);
        return a + (!m ? 0 : inHalf(f.state, s, m) ? pts[0] : pts[1]);
      }, 0),
    1: (f, s, pts) => objectsOf(f, 'artefact').filter(t => loose(t) && near(f, s, t, 3) > near(f, other(s), t, 3)).length * pts[0],
  },
  'treasure-hoard': {
    0: (f, s, pts) => objectsOf(f, 'artefact').filter(t => heldBy(f, s, t)).length * pts[0],
  },
  reconnoitre: {
    0: (f, s, pts) => pick(pts, lead(f.escaped[s].length, f.escaped[other(s)].length)),
    1: (f, s, pts) => Math.min(pts[1] ?? 3, f.escaped[s].filter(m => m.hero).length * pts[0]),
  },
  'storm-the-camp': {
    0: (f, s, pts) => {
      const mine = inCamp(f, s);
      if (mine.length <= inCamp(f, other(s)).length) return 0;
      const hero = mine.some(m => m.hero);
      return hero && mine.some(isBanner) ? pts[2] : hero ? pts[1] : pts[0];
    },
    3: (f, s, pts) => Math.min(pts[1] ?? 5, inCamp(f, s).length * pts[0]),
  },
  'escort-the-wounded': {
    0: (f, s, pts) =>
      objectsOf(f, 'ally')
        .filter(t => t.side === s)
        .reduce((a, t) => {
          if (t.gone === 'rescued') return a + pts[1];
          const m = heldBy(f, s, t);
          return a + (m && !inHalf(f.state, s, m) ? pts[0] : 0);
        }, 0),
  },
  'fog-of-war': {
    0: (f, s, pts) => {
      const m = picked(f, s, 'protect');
      if (!m || m.owner !== s || m.dead) return 0;
      if (hurt(m)) return pts[0];
      const spent = (f.state.flow.startFate?.[m.id] ?? m.fate) > m.fate;
      return spent ? pts[1] : pts[2];
    },
    1: (f, s, pts) => {
      const m = picked(f, s, 'hunt');
      if (!m || m.owner === s) return 0;
      if (m.dead) return m.killedBy?.how === 'fight' && m.killedBy.ids.some(i => f.state.models[i]?.owner === s) ? pts[2] : pts[1];
      return hurt(m) ? pts[0] : 0;
    },
    2: (f, s, pts) => {
      const t = f.state.terrain[f.state.flow.picks?.[s]?.terrain ?? ''];
      if (!t) return 0;
      const [mine, theirs] = [onTerrain(f, s, t), onTerrain(f, other(s), t)];
      if (mine <= theirs) return 0;
      if (mine >= 2 && theirs === 0) return pts[2];
      if (mine >= 2 && mine >= theirs * 2) return pts[1];
      return pts[0];
    },
  },
  convergence: {
    0: (f, s, pts) =>
      objectsOf(f, 'heirloom').reduce((a, t) => {
        const m = heldBy(f, s, t);
        return a + (!m ? 0 : distanceToBase(m, centre(f)) <= 6 ? pts[1] : pts[0]);
      }, 0),
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
  const live = { p1: all.p1.filter(m => !m.dead && !m.escaped), p2: all.p2.filter(m => !m.dead && !m.escaped) };
  return {
    state,
    all,
    live,
    escaped: { p1: all.p1.filter(m => m.escaped && !m.dead), p2: all.p2.filter(m => m.escaped && !m.dead) },
    // Plain objectives only: markers that are carried or gone are scored by their own lines.
    objectives: onTable(state).filter(t => !t.object),
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
    const scorer = SPECIFIC[s.id]?.[i] ?? MARKER_LINES[s.id]?.[i] ?? COMMON.find(([re]) => re.test(line.label))?.[1];
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
