import data from '../data/bases.json';
import type { Base } from './types.ts';

// Base sizes from the army books. Every model is on a round base, apart from a few the books list as ovals
// (the Mûmak, Smaug, chariots and some war machines). A mounted model uses its mount's base.

type Size = number | number[];

const key = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');

const UNITS = new Map(Object.entries(data.units as Record<string, Size>).map(([n, s]) => [key(n), s]));
const MOUNTS = (data.mounts as [string, Size][]).map(([re, s]) => [new RegExp(re, 'i'), s] as const);

export const round = (mm: number): Base => ({ shape: 'round', w: mm, h: mm });
const toBase = (s: Size): Base => (typeof s === 'number' ? round(s) : { shape: 'oval', w: s[0], h: s[1] });

/** A profile's base from the books, if it's one we know. */
export function bookBase(name: string): Base | undefined {
  const s = UNITS.get(key(name));
  return s === undefined ? undefined : toBase(s);
}

/** The base of a mount (a horse, Warg, Fell Beast, chariot...), from its name; 40mm for any other steed. */
export function mountBase(name: string): Base {
  const hit = MOUNTS.find(([re]) => re.test(name));
  return toBase(hit ? hit[1] : 40);
}

/** Standard sizes offered when changing a model's base by hand. */
export const BASE_SIZES: Base[] = [25, 32, 40, 50, 60, 80, 100, 130, 160].map(round).concat(
  [[70, 105], [92, 120], [109, 170], [140, 180]].map(s => toBase(s)),
);
