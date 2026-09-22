import { Chess } from 'chess.js';
import { v4 as uuid } from 'uuid';
import {
  LootboxData, PieceEffect, EffectType, BuffType, Color, MoveOption, GameEvent,
} from './types';
import {
  mirrorSquare, sqToCoords, coordsToSq, getAdjacentSquares, placeCustomMove, customMoveIsSafe,
  pickRandom, weightedPick, knightSquares, materialOf, setTurn, flipTurn, otherColor,
} from './helpers';

const MAX_BOXES = 8;
const SPAWN_EVERY_HALF_MOVES = 2;
const KING_ALLOWED: EffectType[] = ['extra_move', 'teleport', 'knight'];

const CENTER = new Set(['d4','d5','e4','e5','c4','c5','f4','f5','d3','d6','e3','e6','c3','c6','f3','f6']);

export function initLootboxData(): LootboxData {
  return { lootboxes: [], effects: {}, halfMoves: 0, pending: null, effectsSuspended: null };
}

// ─── Spawning ──────────────────────────────────────────────────────────────

function weightedRandomSquare(taken: Set<string>): string | null {
  const candidates: { sq: string; weight: number }[] = [];
  for (let f = 0; f < 8; f++) {
    // never on the back ranks: nobody would walk there for a box
    for (let r = 1; r < 7; r++) {
      const sq = coordsToSq(f, r)!;
      if (taken.has(sq)) continue;
      candidates.push({ sq, weight: CENTER.has(sq) ? 4 : 1 });
    }
  }
  if (!candidates.length) return null;
  const total = candidates.reduce((s, c) => s + c.weight, 0);
  let rand = Math.random() * total;
  for (const c of candidates) {
    rand -= c.weight;
    if (rand <= 0) return c.sq;
  }
  return candidates[candidates.length - 1].sq;
}

export function spawnLootboxes(chess: Chess, data: LootboxData): void {
  if (data.lootboxes.length >= MAX_BOXES) return;
  const taken = new Set<string>(data.lootboxes.map(l => l.sq));
  for (const row of chess.board()) for (const sq of row) if (sq) taken.add(sq.square);

  const sq1 = weightedRandomSquare(taken);
  if (!sq1) return;
  data.lootboxes.push({ sq: sq1, id: uuid().slice(0, 6) });
  taken.add(sq1);

  const mirror = mirrorSquare(sq1);
  if (!taken.has(mirror) && data.lootboxes.length < MAX_BOXES) {
    data.lootboxes.push({ sq: mirror, id: uuid().slice(0, 6) });
  }
}

// ─── Loot table ────────────────────────────────────────────────────────────

/** Luck leans a little towards whoever is behind on material. */
function rollEffect(chess: Chess, color: Color, data?: LootboxData): EffectType {
  if (data?.forceNext) { const t = data.forceNext; data.forceNext = null; return t; }
  const diff = materialOf(chess, color) - materialOf(chess, otherColor(color));
  const debuffChance = Math.min(0.3, Math.max(0.08, 0.2 + diff * 0.02));
  if (Math.random() < debuffChance) return Math.random() < 0.5 ? 'stun' : 'pacifist';

  const w: Record<BuffType, number> = { extra_move: 1, shield: 1, teleport: 1, rage: 1, knight: 1, bomb: 1 };
  if (diff < 0) { w.extra_move *= 1.3; w.bomb *= 1.3; w.teleport *= 1.3; }
  if (diff > 0) { w.shield *= 1.15; w.knight *= 1.15; }
  return weightedPick(w);
}

function generateRageCells(sq: string, color: Color): string[] {
  const [file, rank] = sqToCoords(sq);
  const dir = color === 'w' ? 1 : -1;
  const zone: string[] = [];
  for (let df = -1; df <= 1; df++)
    for (let dr = 1; dr <= 3; dr++) {
      const s = coordsToSq(file + df, rank + dir * dr);
      if (s) zone.push(s);
    }
  return pickRandom(zone, 5);
}

function makeEffect(type: EffectType, sq: string, color: Color): PieceEffect {
  switch (type) {
    case 'stun':     return { type, movesLeft: 1, fresh: true };
    case 'pacifist': return { type, movesLeft: 2, fresh: true };
    case 'rage':     return { type, movesLeft: 2, fresh: true, rageCells: generateRageCells(sq, color) };
    case 'knight':   return { type, movesLeft: 2, fresh: true };
    default:         return { type, movesLeft: 0, fresh: true };
  }
}

function isForward(from: string, to: string, color: Color): boolean {
  const [, fr] = sqToCoords(from);
  const [, tr] = sqToCoords(to);
  return color === 'w' ? tr > fr : tr < fr;
}

/** Taking a bomb burns the taker too: that must not leave the taker's king en prise. */
function bombCaptureIsSafe(chess: Chess, from: string, to: string, color: Color): boolean {
  const probe = new Chess(chess.fen());
  probe.remove(from as any);
  probe.remove(to as any);
  setTurn(probe, color);
  return !probe.inCheck();
}

function moveEffect(data: LootboxData, from: string, to: string): void {
  const e = data.effects[from];
  delete data.effects[to];
  delete data.effects[from];
  if (e) data.effects[to] = e;
}

// ─── Legal moves ───────────────────────────────────────────────────────────

/**
 * Everything `color` may do right now. Assumes chess.turn() === color.
 * If the effects leave no move at all, they are ignored (suspended) so the
 * game can never get stuck.
 */
export function computeLootboxMoves(
  chess: Chess,
  data: LootboxData,
  color: Color,
): { options: MoveOption[]; suspended: boolean } {
  const pending = data.pending;
  if (pending?.kind === 'shield_break') {
    return {
      options: pending.candidates.map(to => ({ from: pending.attackerSq, to, kind: 'normal' as const, capture: false })),
      suspended: false,
    };
  }
  const restrictFrom = pending?.kind === 'extra_move' ? pending.sq : null;

  const base = chess.moves({ verbose: true }).filter(m => {
    if (restrictFrom && m.from !== restrictFrom) return false;
    if (chess.get(m.to as any)?.type === 'k') return false; // extra move while the enemy is in check
    return true;
  });

  const build = (restricted: boolean): MoveOption[] => {
    const out: MoveOption[] = [];
    const seen = new Set<string>();
    const push = (o: MoveOption) => {
      const key = o.from + o.to;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(o);
    };

    for (const m of base) {
      const eff = data.effects[m.from];
      if (restricted && eff && !eff.fresh) {
        if (eff.type === 'stun') continue;
        if (eff.type === 'pacifist' && m.captured) continue;
        if (eff.type === 'rage' && !isForward(m.from, m.to, color)) continue;
      }
      if (m.captured && data.effects[m.to]?.type === 'bomb') {
        if (m.piece === 'k' || !bombCaptureIsSafe(chess, m.from, m.to, color)) continue;
      }
      push({ from: m.from, to: m.to, kind: 'normal', capture: !!m.captured });
    }

    for (const [sq, eff] of Object.entries(data.effects)) {
      if (eff.fresh) continue;
      if (restrictFrom && sq !== restrictFrom) continue;
      const piece = chess.get(sq as any);
      if (!piece || piece.color !== color) continue;
      // a pawn may never end up on its own first rank: chess.js rejects the position
      const homeRank = color === 'w' ? '1' : '8';
      const pawnOk = (to: string) => piece.type !== 'p' || to[1] !== homeRank;

      const jumpTargets =
        eff.type === 'rage' ? (eff.rageCells ?? []) :
        eff.type === 'knight' ? knightSquares(sq) : [];
      for (const to of jumpTargets) {
        if (!pawnOk(to)) continue;
        const target = chess.get(to as any);
        if (target && (target.color === color || target.type === 'k')) continue;
        if (target && data.effects[to]?.type === 'bomb') {
          if (piece.type === 'k' || !bombCaptureIsSafe(chess, sq, to, color)) continue;
        }
        if (!customMoveIsSafe(chess, sq, to, color)) continue;
        push({ from: sq, to, kind: eff.type as 'rage' | 'knight', capture: !!target });
      }

      if (eff.type === 'teleport') {
        for (let f = 0; f < 8; f++)
          for (let r = 0; r < 8; r++) {
            const to = coordsToSq(f, r)!;
            if (chess.get(to as any) || to === sq || !pawnOk(to)) continue;
            if (!customMoveIsSafe(chess, sq, to, color)) continue;
            push({ from: sq, to, kind: 'teleport', capture: false });
          }
      }
    }
    return out;
  };

  let options = build(true);
  let suspended = false;
  if (options.length === 0) {
    const free = build(false);
    if (free.length) { options = free; suspended = true; }
  }
  return { options, suspended };
}

// ─── Applying a move ───────────────────────────────────────────────────────

export type ApplyResult =
  | { ok: true; events: GameEvent[]; lastMove: { from: string; to: string } | null }
  | { ok: false; reason: string };

export function applyLootboxMove(
  chess: Chess,
  data: LootboxData,
  move: { from: string; to: string; promotion?: string },
  color: Color,
): ApplyResult {
  const { options } = computeLootboxMoves(chess, data, color);
  const opt = options.find(o => o.from === move.from && o.to === move.to);
  if (!opt) return { ok: false, reason: 'Недозволений хід' };

  const events: GameEvent[] = [];
  const pending = data.pending;
  const isExtra = pending?.kind === 'extra_move';

  // Landing after a shield absorbed the attack
  if (pending?.kind === 'shield_break') {
    placeCustomMove(chess, pending.attackerSq, move.to);
    moveEffect(data, pending.attackerSq, move.to);
    data.pending = null;
    flipTurn(chess);
    return finishTurn(chess, data, move.to, color, events, isExtra, { from: pending.attackerSq, to: move.to });
  }
  data.pending = null;

  const target = chess.get(move.to as any);
  const targetEff = target ? data.effects[move.to] : undefined;

  // Shield: absorbs the capture. Not while the attacker is in check - the
  // check must stay resolvable, otherwise the game could lock up.
  if (target && targetEff?.type === 'shield' && !chess.inCheck()) {
    delete data.effects[move.to];
    const candidates = getAdjacentSquares(move.to)
      .filter(s => !chess.get(s as any))
      .filter(s => customMoveIsSafe(chess, move.from, s, color));
    if (candidates.length === 0) {
      events.push({ type: 'shield_absorb', at: move.to, attackerSq: move.from, color, stayed: true });
      flipTurn(chess);
      return finishTurn(chess, data, null, color, events, isExtra, null);
    }
    data.pending = { kind: 'shield_break', attackerSq: move.from, targetSq: move.to, candidates, color };
    events.push({ type: 'shield_absorb', at: move.to, attackerSq: move.from, color, stayed: false });
    return { ok: true, events, lastMove: null };
  }

  const bomb = !!target && targetEff?.type === 'bomb';

  if (opt.kind === 'normal') {
    let res;
    try { res = chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' }); }
    catch { res = null; }
    if (!res) return { ok: false, reason: 'Недозволений хід' };
  } else {
    placeCustomMove(chess, move.from, move.to);
    flipTurn(chess);
  }

  if (bomb) {
    chess.remove(move.to as any);
    delete data.effects[move.from];
    delete data.effects[move.to];
    events.push({ type: 'bomb', at: move.to, victimSq: move.from, color });
    return finishTurn(chess, data, null, color, events, isExtra, { from: move.from, to: move.to });
  }

  moveEffect(data, move.from, move.to);
  const eff = data.effects[move.to];
  if (opt.kind === 'teleport') {
    delete data.effects[move.to];
    events.push({ type: 'teleport', from: move.from, to: move.to, color });
  } else if (eff && (eff.type === 'rage' || eff.type === 'knight') && !eff.fresh) {
    eff.movesLeft--;
    if (eff.movesLeft <= 0) delete data.effects[move.to];
    else if (eff.type === 'rage') eff.rageCells = generateRageCells(move.to, color);
  }

  return finishTurn(chess, data, move.to, color, events, isExtra, { from: move.from, to: move.to });
}

/** Pick up a box on the landing square, then hand the turn over (or keep it for an extra move). */
function finishTurn(
  chess: Chess,
  data: LootboxData,
  landedSq: string | null,
  color: Color,
  events: GameEvent[],
  isExtra: boolean,
  lastMove: { from: string; to: string } | null,
): ApplyResult {
  if (landedSq) {
    const idx = data.lootboxes.findIndex(l => l.sq === landedSq);
    const piece = chess.get(landedSq as any);
    if (idx !== -1 && piece) {
      data.lootboxes.splice(idx, 1);
      let type = rollEffect(chess, color, data);
      if (piece.type === 'k' && !KING_ALLOWED.includes(type)) type = pickRandom(KING_ALLOWED, 1)[0];
      events.push({ type: 'pickup', sq: landedSq, color, effect: type });

      if (type === 'extra_move') {
        delete data.effects[landedSq];
        if (!isExtra) {
          setTurn(chess, color);
          data.pending = { kind: 'extra_move', sq: landedSq, color };
          if (computeLootboxMoves(chess, data, color).options.length > 0) {
            return { ok: true, events, lastMove };
          }
          data.pending = null;
          setTurn(chess, otherColor(color));
        }
        events.push({ type: 'extra_move_lost', sq: landedSq, color });
      } else {
        data.effects[landedSq] = makeEffect(type, landedSq, color);
      }
    }
  }

  endOfTurn(chess, data, color);
  return { ok: true, events, lastMove };
}

function endOfTurn(chess: Chess, data: LootboxData, color: Color): void {
  for (const [sq, eff] of Object.entries(data.effects)) {
    const p = chess.get(sq as any);
    if (!p) { delete data.effects[sq]; continue; } // piece is gone (en passant, castling rook)
    if (p.color !== color) continue;
    if (eff.fresh) { eff.fresh = false; continue; }
    if (eff.type === 'stun' || eff.type === 'pacifist') {
      eff.movesLeft--;
      if (eff.movesLeft <= 0) delete data.effects[sq];
    }
  }
  data.effectsSuspended = null;
  data.halfMoves++;
  if (data.halfMoves % SPAWN_EVERY_HALF_MOVES === 0) spawnLootboxes(chess, data);
}

/** Skip a pending extra move: the turn simply passes. */
export function skipExtraMove(chess: Chess, data: LootboxData, color: Color): boolean {
  if (data.pending?.kind !== 'extra_move' || data.pending.color !== color) return false;
  data.pending = null;
  setTurn(chess, otherColor(color));
  endOfTurn(chess, data, color);
  return true;
}

export function serializeLootboxData(data: LootboxData) {
  return {
    lootboxes: data.lootboxes,
    effects: data.effects,
    halfMoves: data.halfMoves,
    pending: data.pending,
    effectsSuspended: data.effectsSuspended,
  };
}

/** Dev-only knobs for testing the UI without waiting for luck. */
export function debugLootbox(
  chess: Chess,
  data: LootboxData,
  cmd: { box?: string; effect?: { sq: string; type: EffectType }; forceNext?: EffectType },
): void {
  if (cmd.box && !chess.get(cmd.box as any) && !data.lootboxes.some(l => l.sq === cmd.box)) {
    data.lootboxes.push({ sq: cmd.box, id: uuid().slice(0, 6) });
  }
  if (cmd.effect) {
    const piece = chess.get(cmd.effect.sq as any);
    if (piece) {
      data.effects[cmd.effect.sq] = { ...makeEffect(cmd.effect.type, cmd.effect.sq, piece.color), fresh: false };
    }
  }
  if (cmd.forceNext) data.forceNext = cmd.forceNext;
}
