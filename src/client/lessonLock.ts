import { createContext, useContext } from 'react';
import type { Action } from '../shared/types.ts';

/**
 * A Learn to play step's hold on the table: only what the step teaches can be done, and anything else is refused
 * with a word on the lesson card about what to do instead. Away from a lesson there is no lock.
 */
export interface LessonLock {
  /** Whether the step lets you do this. */
  can(a: Action): boolean;
  /** Whether the step uses this model of yours: the others only show their profile. */
  uses(id: string): boolean;
  /** Something the step doesn't teach was tried: the lesson card says what to do instead. */
  refuse(): void;
}

export const LessonLockContext = createContext<LessonLock | null>(null);

export const useLessonLock = () => useContext(LessonLockContext);

/**
 * For a button that does this: dimmed and marked as not part of the lesson when the step doesn't teach it. It still
 * takes a press, which the lesson refuses and answers with what to do instead.
 */
export function useLocked() {
  const lock = useLessonLock();
  return (a: Action) => (lock && !lock.can(a) ? { 'aria-disabled': true, 'data-locked': '', title: 'Not part of this lesson' } : {});
}
