import { useEffect, useRef, useState } from 'react';
import { strikeWounds } from '../shared/fight.ts';
import { halfExtents } from '../shared/geometry.ts';
import type { GameState, Model } from '../shared/types.ts';

// Short animations on the table that show what just happened: wounds, models falling, and shots flying.
// Each lasts about a second, then goes; none of them change the game.

type Effect =
  | { id: string; kind: 'hit'; x: number; y: number; n: number; owner: string }
  | { id: string; kind: 'slain'; model: Model }
  | { id: string; kind: 'shot'; from: { x: number; y: number }; to: { x: number; y: number }; result: string; hit: boolean };

const LIFE_MS = 1600;
let seq = 0;

/** What a shot did, in a word or two, from its rolls. */
function shotResult(state: GameState, group: string): { result: string; hit: boolean } {
  const rolls = state.log.filter(r => r.group === group);
  const wounds = strikeWounds(rolls);
  if (wounds > 0) return { result: wounds === 1 ? 'Wound!' : `${wounds} wounds!`, hit: true };
  const toHit = rolls[0];
  if (toHit?.target && !toHit.dice.some(d => d >= toHit.target!)) return { result: 'Miss', hit: false };
  if (rolls.some(r => r.label.startsWith('In the Way') && r.target && !r.dice.some(d => d >= r.target!))) return { result: 'In the Way', hit: false };
  return { result: 'No wound', hit: false };
}

/** The effects layer, drawn over the models. */
export function Effects({ state, fontSize, turn = 0 }: { state: GameState; fontSize: number; /** How far the table is turned, so the writing stays upright. */ turn?: number }) {
  const [effects, setEffects] = useState<Effect[]>([]);
  const prev = useRef<Record<string, Model> | null>(null);
  const seenLog = useRef<Set<string> | null>(null);

  const add = (list: Effect[]) => {
    if (!list.length) return;
    setEffects(e => [...e, ...list]);
    const ids = new Set(list.map(x => x.id));
    setTimeout(() => setEffects(e => e.filter(x => !ids.has(x.id))), LIFE_MS);
  };

  // Wounds taken and models slain since the last update. The first look at a game shows nothing.
  useEffect(() => {
    const before = prev.current;
    prev.current = state.models;
    if (!before) return;
    const out: Effect[] = [];
    for (const m of Object.values(state.models)) {
      const was = before[m.id];
      if (!was || was === m) continue;
      if (m.dead && !was.dead) out.push({ id: `e${seq++}`, kind: 'slain', model: was });
      else if (!m.dead && m.wounds < was.wounds) out.push({ id: `e${seq++}`, kind: 'hit', x: m.x, y: m.y - halfExtents(m.base).ry, n: was.wounds - m.wounds, owner: m.owner });
    }
    add(out);
  }, [state.models]);

  // New shots: a streak from shooter to target, then what it did.
  useEffect(() => {
    if (!seenLog.current) {
      seenLog.current = new Set(state.log.map(r => r.id));
      return;
    }
    const out: Effect[] = [];
    for (const r of state.log) {
      if (seenLog.current.has(r.id)) continue;
      seenLog.current.add(r.id);
      if (!r.group?.startsWith('s-') || !r.model || r.id !== `${r.group}-0`) continue;
      const shooter = state.models[r.model];
      const named = r.label.match(/ shoots (.+?) \(/)?.[1];
      const wounded = state.log.find(x => x.group === r.group && x.against)?.against;
      // The target is the model the shot was rolled against, or the nearest enemy with the name in the label.
      const target = (r.aim && state.models[r.aim]) || (wounded && state.models[wounded]) ||
        Object.values(state.models)
          .filter(m => shooter && m.owner !== shooter.owner && m.name === named)
          .sort((a, b) => Math.hypot(a.x - shooter!.x, a.y - shooter!.y) - Math.hypot(b.x - shooter!.x, b.y - shooter!.y))[0];
      if (!shooter || !target) continue;
      out.push({ id: `e${seq++}`, kind: 'shot', from: { x: shooter.x, y: shooter.y }, to: { x: target.x, y: target.y }, ...shotResult(state, r.group) });
    }
    add(out);
  }, [state.log]);

  return (
    <g className="effects" pointerEvents="none">
      {effects.map(e => {
        if (e.kind === 'hit')
          return (
            <g key={e.id} className={`fx-hit ${e.owner}`} transform={`translate(${e.x} ${e.y})`}>
              <circle className="fx-flash" r={0.6} />
              {/* The writing floats up the screen, so it sits in a group turned upright. */}
              <g transform={`rotate(${-turn})`}>
                <text className="fx-float" textAnchor="middle" style={{ fontSize: fontSize * 1.4 }}>
                  −{e.n}
                </text>
              </g>
            </g>
          );
        if (e.kind === 'slain') {
          const { rx, ry } = halfExtents(e.model.base);
          return (
            <g key={e.id} className={`fx-slain ${e.model.owner}`} transform={`translate(${e.model.x} ${e.model.y})`}>
              <g className="fx-fall">
                <ellipse rx={rx} ry={ry} />
              </g>
              <g transform={`rotate(${-turn})`}>
                <text className="fx-float" textAnchor="middle" y={-Math.max(rx, ry)} style={{ fontSize: fontSize * 1.2 }}>
                  ✝ Slain
                </text>
              </g>
            </g>
          );
        }
        const len = Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y);
        return (
          <g key={e.id} className={`fx-shot ${e.hit ? 'hit' : 'miss'}`}>
            <line x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y} style={{ strokeDasharray: `1.2 ${len + 2}`, ['--len' as string]: `${-(len + 1.2)}` }} />
            <g transform={turn ? `rotate(${-turn} ${e.to.x} ${e.to.y})` : undefined}>
              <text className="fx-result" x={e.to.x} y={e.to.y - 0.8} textAnchor="middle" style={{ fontSize: fontSize * 1.2 }}>
                {e.result}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}
