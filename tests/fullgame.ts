// Plays one whole game through a running server (npx tsx tests/fullgame.ts <scenario id|none> <seed> [army] [army]):
// this script is player 1, played by the computer player's logic as a stand-in for a person, and the Palantír is
// player 2. It reports where the game got stuck and any roll made twice.
import { STARTER_BOARDS, starterTerrain } from '../src/shared/boards.ts';
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { botStep, newMemo } from '../src/shared/bot.ts';
import { combats } from '../src/shared/flow.ts';
import { fightDone } from '../src/shared/movement.ts';
import { endCheck, endRollLabel } from '../src/shared/status.ts';
import { botRoster } from '../src/shared/botList.ts';
import { deployList } from '../src/shared/importList.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { scenarioById, scenarioMarkers } from '../src/shared/scenarios.ts';
import { deployReady, procedureOf, rollDue } from '../src/shared/deploy.ts';
import { listEntries } from '../src/shared/warbands.ts';
import type { Action, GameState } from '../src/shared/types.ts';
import { catalog, seeded } from './botsim.ts';

const [scenario, seedArg, armyA = 'Minas Tirith', armyB = 'Legions of Mordor'] = process.argv.slice(2);
const rand = seeded(Number(seedArg ?? 1));
const room = `FG${Date.now() % 100000}${seedArg ?? ''}`;
const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8789}/ws?room=${room}`);
let state: GameState = initialState();
let changed = Date.now();
const issues: string[] = [];
const turnOf = new Map<string, string>();
const allRolls: GameState['log'] = [];
ws.on('message', d => {
  const m = JSON.parse(String(d));
  if (m.type === 'snapshot') state = m.state;
  else if (m.type === 'action') state = reduce(state, m.action);
  else return;
  for (const r of state.log) if (!turnOf.has(r.id)) {
    turnOf.set(r.id, `${state.turn}${state.phase}`);
    allRolls.push(r);
  }
  changed = Date.now();
});
const send = (action: Action) => ws.send(JSON.stringify({ type: 'action', action }));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const where = () => `turn ${state.turn} ${state.phase} done=${state.flow.done.join(',')}`;

ws.on('open', async () => {
  ws.send(JSON.stringify({ type: 'hello', role: 'p1' }));
  await sleep(300);
  send({ type: 'setBot', seat: 'p2' });
  send({ type: 'setBotSpeed', speed: 'instant' } as Action);
  const sc = scenario === 'none' ? null : scenarioById(scenario) ?? null;
  if (sc) {
    send({ type: 'setScenario', id: sc.id });
    await sleep(200);
    let n = 0;
    for (const t of scenarioMarkers(sc, state.board.w, state.board.h, p => `${p}${n++}`, rand, !procedureOf(state)?.markers)) send({ type: 'addTerrain', terrain: t });
  }
  // BOARD=farmstead (or another starter board's id) plays over that board's terrain.
  const board = STARTER_BOARDS.find(b => b.id === process.env.BOARD);
  if (board) {
    let n = 0;
    for (const t of starterTerrain(board, p => `${p}${n++}`)) send({ type: 'addTerrain', terrain: t });
  }
  await sleep(300);
  for (const [seat, army] of [['p1', armyA], ['p2', armyB]] as const) {
    // FORCE=unit-id,unit-id adds those units (where the army has them) to the computer's list, to try them out.
    const roster = botRoster(catalog, army, 500, rand);
    const force = (process.env.FORCE ?? '').split(',').filter(id => catalog.armies[army]?.units.includes(id));
    roster.entries.push(...force.map((unitId, i) => ({ key: `f${i}`, unitId, count: unitId.includes('chariot') || unitId.includes('charioteer') ? 2 : 1, optionIds: [] })));
    const entries = listEntries(roster, catalog).flatMap(g => g.entries);
    send({ type: 'addModels', models: deployList(entries, seat, state, sc ?? undefined) });
    await sleep(400);
  }
  // Set up in turn as the scenario says: this side by the computer's logic, the Palantír its own.
  const setupMemo = newMemo();
  for (const t = Date.now(); !deployReady(state) && Date.now() - t < 60_000; ) {
    if (rollDue(state)) send({ type: 'rollDeploy' });
    const step = botStep(state, 'p1', catalog, setupMemo, Date.now(), false);
    if (step?.action) send(step.action);
    await sleep(150);
  }
  if (!deployReady(state)) issues.push(`set-up stuck at ${JSON.stringify(state.flow.deploy)}`);
  send({ type: 'startGame' });
  await sleep(500);
  const memo = newMemo();
  const nudges: Record<string, number> = {};
  // What a person clicks when both sides are waiting: the next phase, or the end-of-game roll.
  const personStep = () => {
    let a: Action | null = null;
    if (state.phase === 'fight' && !combats(state).some(c => !fightDone(state, c))) a = { type: 'nextPhase' } as Action;
    else if (state.phase === 'end') {
      const check = endCheck(state, { p1: 'a', p2: 'b' });
      if (check?.rollNeeded && !state.log.some(r => r.label === endRollLabel(state.turn))) a = { type: 'roll', count: 1, label: endRollLabel(state.turn) } as Action;
      else a = { type: 'nextPhase' } as Action;
    }
    if (!a) return false;
    const k = `${state.phase}:${a.type}`;
    nudges[k] = (nudges[k] ?? 0) + 1;
    changed = Date.now();
    send(a);
    return true;
  };
  const t0 = Date.now();
  let lastStuck = '';
  while (!state.result?.agreed && Date.now() - t0 < 15 * 60_000) {
    const step = botStep(state, 'p1', catalog, memo, Date.now(), false);
    if (step?.action) {
      const before = state;
      send(step.action);
      // Wait for the server to answer before thinking again.
      const sent = Date.now();
      while (state === before && Date.now() - sent < 1500) await sleep(10);
      if (state === before && !step.action.type.startsWith('set')) issues.push(`ignored ${step.action.type} at ${where()}`);
      continue;
    }
    await sleep(step?.delay ? Math.min(step.delay, 200) : 50);
    if (Date.now() - changed > 4000 && personStep()) continue;
    if (Date.now() - changed > 10_000) {
      const k = where();
      if (k !== lastStuck) issues.push(`stuck at ${k} flow=${JSON.stringify({ ...state.flow, moved: undefined, shot: undefined })}`);
      lastStuck = k;
      if (Date.now() - changed > 30_000) break;
    }
  }
  // Rolls with the same label twice in one turn.
  const seen = new Map<string, number>();
  for (const r of allRolls) {
    const k = `${turnOf.get(r.id)}|${r.label}|${r.model ?? ''}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const twice = [...seen].filter(([, n]) => n > 1);
  const alive = (s: string) => Object.values(state.models).filter(m => m.owner === s && !m.dead).length;
  console.log(JSON.stringify({ scenario, room, turn: state.turn, phase: state.phase, result: state.result, alive: { p1: alive('p1'), p2: alive('p2') }, waiting: Object.values(state.models).filter(m => m.waiting).length, log: state.log.length, issues, nudges, twice: twice.length, secs: Math.round((Date.now() - t0) / 1000) }, null, 1));
  writeFileSync(`${process.env.OUT ?? '/tmp'}/${room}.json`, JSON.stringify({ log: allRolls.map(r => ({ ...r, at: turnOf.get(r.id) })) }));
  process.exit(0);
});
