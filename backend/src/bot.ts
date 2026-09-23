/**
 * A bot that works in every mode.
 *
 * It never talks to a mode engine directly: the server hands it a `BotEnv` that
 * can list legal moves, play one, undo, and score material. That is enough for a
 * search, and it means lootbox buffs, fog, spells and the 20x20 expansion board
 * all get the same opponent for free.
 */
import { Color, MoveOption } from './modes/types';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface BotEnv {
  legalMoves(color: Color): MoveOption[];
  /** Play a move on the real state, no logging and no broadcast. */
  play(color: Color, move: { from: string; to: string }): boolean;
  snapshot(): unknown;
  restore(snap: unknown): void;
  /** Material of one side, in pawns. */
  material(color: Color): number;
  /** How tempting a move looks before it is played (victim value + mode flavour). */
  lure(color: Color, move: MoveOption): number;
  inCheck(color: Color): boolean;
}

export const BOT_NAMES: Record<Difficulty, string> = {
  easy: 'Бот · легкий',
  medium: 'Бот · середній',
  hard: 'Бот · складний',
};

/** How long the bot "thinks" before its move lands, so the board is readable. */
export const BOT_DELAY_MS: Record<Difficulty, number> = { easy: 400, medium: 650, hard: 850 };

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
export const isDifficulty = (v: unknown): v is Difficulty =>
  typeof v === 'string' && (DIFFICULTIES as string[]).includes(v);

const MATE = 1000;
/**
 * Search width. A 20x20 board with 90 pieces can offer 150+ legal moves, and the
 * search blocks the event loop for every room on the box, so the width shrinks as
 * positions get big and a wall clock stops it dead if the machine is slow.
 */
const THINK_BUDGET_MS = 250;

function budget(level: Difficulty, moveCount: number): { candidates: number; replies: number } {
  if (level === 'easy') return { candidates: 3, replies: 0 };
  const heavy = moveCount > 90;
  if (level === 'medium') return { candidates: heavy ? 12 : 16, replies: 0 };
  return heavy ? { candidates: 12, replies: 8 } : { candidates: 20, replies: 12 };
}

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/** Material balance from `me`'s point of view. */
function balance(env: BotEnv, me: Color): number {
  return env.material(me) - env.material(other(me));
}

function shortlist(env: BotEnv, color: Color, moves: MoveOption[], n: number): MoveOption[] {
  if (moves.length <= n) return moves;
  return [...moves]
    .map(m => ({ m, s: env.lure(color, m) + Math.random() * 0.3 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map(x => x.m);
}

/** Best balance `who` can reach in one ply, from `who`'s point of view. */
function bestReply(env: BotEnv, who: Color, snap: unknown, width: number): number {
  const moves = env.legalMoves(who);
  if (moves.length === 0) return env.inCheck(who) ? -MATE : 0;

  let best = -Infinity;
  for (const m of shortlist(env, who, moves, width)) {
    if (!env.play(who, m)) { env.restore(snap); continue; }
    best = Math.max(best, balance(env, who));
    env.restore(snap);
  }
  return best === -Infinity ? 0 : best;
}

export function chooseBotMove(env: BotEnv, me: Color, level: Difficulty): MoveOption | null {
  const moves = env.legalMoves(me);
  if (moves.length === 0) return null;

  const width = budget(level, moves.length);

  // Easy plays on instinct: mostly whatever, with the odd eye for a free piece.
  if (level === 'easy') {
    if (Math.random() < 0.3) {
      const top = shortlist(env, me, moves, width.candidates);
      return top[Math.floor(Math.random() * top.length)];
    }
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const snap = env.snapshot();
  const deadline = Date.now() + THINK_BUDGET_MS;
  let best: { move: MoveOption; score: number } | null = null;
  let searched = 0;

  for (const move of shortlist(env, me, moves, width.candidates)) {
    // always look at a few, then stop as soon as the clock says so
    if (searched >= 3 && Date.now() > deadline) break;
    searched++;
    if (!env.play(me, move)) { env.restore(snap); continue; }

    let score: number;
    const replies = env.legalMoves(other(me));
    if (replies.length === 0) {
      // nothing left for them: mate if they are in check, otherwise a dead draw
      score = env.inCheck(other(me)) ? MATE : 0;
    } else if (level === 'hard') {
      // Hard looks one move further, so it stops leaving pieces hanging.
      const inner = env.snapshot();
      score = -bestReply(env, other(me), inner, width.replies);
      env.restore(inner);
    } else {
      // Medium grabs what it can see and finds out about the answer later.
      score = balance(env, me);
    }

    score += Math.random() * 0.2;   // so repeat games do not play out identically
    env.restore(snap);

    if (!best || score > best.score) best = { move, score };
  }

  return best?.move ?? moves[0];
}
