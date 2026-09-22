import { Chess } from 'chess.js';
import { v4 as uuid } from 'uuid';
import { LootboxData, PieceBuff, PieceDebuff, BuffType, DebuffType } from './types';
import { mirrorSquare, sqToCoords, coordsToSq, getAdjacentSquares, applyCustomMove, pickRandom } from './helpers';

// Spawn weights: center-biased
const CENTER_WEIGHT_SQS = new Set(['d4','d5','e4','e5','c4','c5','f4','f5','d3','d6','e3','e6','c3','c6','f3','f6']);

export function initLootboxData(): LootboxData {
  return {
    lootboxes: [],
    buffs: {},
    debuffs: {},
    halfMoves: 0,
    extraMovePending: null,
    teleportPending: null,
    shieldBreakPending: null,
  };
}

function randomBuff(sq: string, pieceType: string, chess: Chess): PieceBuff | PieceDebuff {
  const isDebuff = Math.random() < 0.2;
  if (isDebuff) {
    const type: DebuffType = Math.random() < 0.5 ? 'skip_turn' : 'no_attack';
    return { type, movesLeft: type === 'skip_turn' ? 1 : 2 } as PieceDebuff;
  }
  const roll = Math.random();
  let type: BuffType;
  if (roll < 0.25) type = 'extra_move';
  else if (roll < 0.5) type = 'shield';
  else if (roll < 0.75) type = 'teleport';
  else type = 'berserk';

  const buff: PieceBuff = { type, movesLeft: type === 'berserk' ? 2 : 1 };
  if (type === 'berserk') buff.berserkCells = generateBerserkCells(sq, chess);
  return buff;
}

function generateBerserkCells(sq: string, chess: Chess): string[] {
  const [file, rank] = sqToCoords(sq);
  const piece = chess.get(sq as any);
  const color = piece?.color ?? 'w';
  const dir = color === 'w' ? 1 : -1;
  const candidates: string[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = 1; dr <= 3; dr++) {
      const s = coordsToSq(file + df, rank + dir * dr);
      if (s) candidates.push(s);
    }
  }
  return pickRandom(candidates, 5);
}

function isForwardMove(from: string, to: string, color: 'w' | 'b'): boolean {
  const [, fromRank] = sqToCoords(from);
  const [, toRank] = sqToCoords(to);
  return color === 'w' ? toRank > fromRank : toRank < fromRank;
}

function weightedRandomSquare(occupied: Set<string>, excluded: Set<string>): string | null {
  const candidates: { sq: string; weight: number }[] = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const sq = coordsToSq(f, r)!;
      if (occupied.has(sq) || excluded.has(sq)) continue;
      const weight = CENTER_WEIGHT_SQS.has(sq) ? 4 : 1;
      candidates.push({ sq, weight });
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
  if (data.lootboxes.length >= 6) return;

  const board = chess.board();
  const occupied = new Set<string>();
  for (const row of board) for (const sq of row) if (sq) occupied.add(sq.square);
  const existingLb = new Set(data.lootboxes.map(l => l.sq));

  const sq1 = weightedRandomSquare(occupied, existingLb);
  if (!sq1) return;

  const mirror = mirrorSquare(sq1);
  const occupied2 = new Set([...occupied, ...existingLb, sq1]);

  data.lootboxes.push({ sq: sq1, id: uuid().slice(0, 6) });

  if (!occupied2.has(mirror) && data.lootboxes.length < 6) {
    data.lootboxes.push({ sq: mirror, id: uuid().slice(0, 6) });
  }
}

export type LootboxMoveResult =
  | { ok: true; needsTarget?: false }
  | { ok: true; needsTarget: true; type: 'teleport' | 'shield_break'; candidates?: string[] }
  | { ok: false; reason: string };

export function handleLootboxMove(
  chess: Chess,
  data: LootboxData,
  move: { from: string; to: string; promotion?: string },
  color: 'w' | 'b'
): LootboxMoveResult {
  const { from, to } = move;
  let isExtraMove = false;

  // ── Handle pending extra move ──────────────────────────────────────────
  if (data.extraMovePending) {
    if (data.extraMovePending.color !== color) return { ok: false, reason: 'Not your turn (extra move pending for opponent)' };
    if (data.extraMovePending.sq !== from) return { ok: false, reason: 'Must use extra move with the buffed piece' };
    // Forbid capturing the king with extra move
    const target = chess.get(to as any);
    if (target?.type === 'k') return { ok: false, reason: 'Extra move cannot capture the king' };
    data.extraMovePending = null;
    isExtraMove = true;
    // fall through to normal move processing
  }

  // ── Handle pending teleport ────────────────────────────────────────────
  if (data.teleportPending) {
    if (data.teleportPending.color !== color) return { ok: false, reason: 'Not your turn' };
    if (data.teleportPending.sq !== from) return { ok: false, reason: 'Use teleport with the buffed piece' };

    const targetPiece = chess.get(to as any);
    if (targetPiece) return { ok: false, reason: 'Teleport destination must be empty' };

    // Teleport: move piece manually
    applyCustomMove(chess, from, to, false);
    transferBuff(data, from, to);
    data.teleportPending = null;
    data.halfMoves++;
    onMoveDone(chess, data, to, color);
    return { ok: true };
  }

  // ── Handle pending shield break landing ───────────────────────────────
  if (data.shieldBreakPending) {
    if (data.shieldBreakPending.color !== color) return { ok: false, reason: 'Not your turn' };
    if (!data.shieldBreakPending.candidates.includes(to)) return { ok: false, reason: 'Choose a valid adjacent square' };

    const attackerSq = data.shieldBreakPending.attackerSq;
    applyCustomMove(chess, attackerSq, to, false);
    transferBuff(data, attackerSq, to);
    data.shieldBreakPending = null;
    data.halfMoves++;
    onMoveDone(chess, data, to, color);
    return { ok: true };
  }

  // ── Debuff checks ──────────────────────────────────────────────────────
  const debuff = data.debuffs[from];
  if (debuff) {
    if (debuff.type === 'skip_turn') return { ok: false, reason: 'Piece is stunned (skip turn)' };
    if (debuff.type === 'no_attack') {
      const targetPiece = chess.get(to as any);
      if (targetPiece && targetPiece.color !== color) return { ok: false, reason: 'Piece cannot attack this turn' };
    }
  }

  // ── Berserk movement check ─────────────────────────────────────────────
  const buff = data.buffs[from];
  if (buff?.type === 'berserk') {
    const isForward = isForwardMove(from, to, color);
    const inBerserkCells = buff.berserkCells?.includes(to) ?? false;
    if (!isForward && !inBerserkCells) return { ok: false, reason: 'Berserk: must move forward or to berserk cells' };
  }

  // ── Shield intercept ───────────────────────────────────────────────────
  const targetPiece = chess.get(to as any);
  if (targetPiece && targetPiece.color !== color) {
    const targetBuff = data.buffs[to];
    if (targetBuff?.type === 'shield' && targetPiece.type !== 'k') {
      // Shield triggers: remove shield, find landing squares for attacker
      delete data.buffs[to];
      const candidates = getAdjacentSquares(to).filter(sq => !chess.get(sq as any));
      data.shieldBreakPending = { attackerSq: from, color, candidates };
      return { ok: true, needsTarget: true, type: 'shield_break', candidates };
    }
  }

  // ── Normal move ────────────────────────────────────────────────────────
  try {
    const result = chess.move({ from, to, promotion: move.promotion || 'q' });
    if (!result) return { ok: false, reason: 'Invalid move' };
  } catch {
    return { ok: false, reason: 'Invalid move' };
  }

  // Transfer buff/debuff from source to destination
  const hadBuff = !!data.buffs[from];
  const hadDebuff = !!data.debuffs[from];
  transferBuff(data, from, to);
  transferDebuff(data, from, to);
  // If mover had no buff/debuff, remove captured piece's buff/debuff at destination
  if (!hadBuff) delete data.buffs[to];
  if (!hadDebuff) delete data.debuffs[to];

  data.halfMoves++;
  onMoveDone(chess, data, to, color, isExtraMove);
  return { ok: true };
}

function transferBuff(data: LootboxData, from: string, to: string): void {
  if (data.buffs[from]) {
    data.buffs[to] = data.buffs[from];
    delete data.buffs[from];
  }
}

function transferDebuff(data: LootboxData, from: string, to: string): void {
  if (data.debuffs[from]) {
    data.debuffs[to] = data.debuffs[from];
    delete data.debuffs[from];
  }
}

function onMoveDone(chess: Chess, data: LootboxData, landedSq: string, color: 'w' | 'b', isExtraMove = false): void {
  // Pick up lootbox if landed on one
  const lbIdx = data.lootboxes.findIndex(l => l.sq === landedSq);
  if (lbIdx !== -1) {
    data.lootboxes.splice(lbIdx, 1);
    const piece = chess.get(landedSq as any);
    const newEffect = randomBuff(landedSq, piece?.type ?? 'p', chess);

    if ((newEffect as PieceDebuff).type === 'skip_turn' || (newEffect as PieceDebuff).type === 'no_attack') {
      // It's a debuff
      data.debuffs[landedSq] = newEffect as PieceDebuff;
      // Also remove existing buff
      delete data.buffs[landedSq];
    } else {
      const b = newEffect as PieceBuff;
      // Shield doesn't work for king
      if (b.type === 'shield' && piece?.type === 'k') {
        // Give extra move instead
        data.buffs[landedSq] = { type: 'extra_move', movesLeft: 1 };
      } else {
        data.buffs[landedSq] = b;
        delete data.debuffs[landedSq];
      }
    }
  }

  // Tick debuffs
  for (const sq of Object.keys(data.debuffs)) {
    data.debuffs[sq].movesLeft--;
    if (data.debuffs[sq].movesLeft <= 0) delete data.debuffs[sq];
  }

  // Tick berserk
  const buff = data.buffs[landedSq];
  if (buff?.type === 'berserk') {
    buff.movesLeft--;
    if (buff.movesLeft <= 0) delete data.buffs[landedSq];
  }

  // Check extra move — not allowed to chain from another extra move
  const activeBuff = data.buffs[landedSq];
  if (activeBuff?.type === 'extra_move' && !data.extraMovePending && !isExtraMove) {
    data.extraMovePending = { sq: landedSq, color };
    delete data.buffs[landedSq];
  }

  // Check teleport pending
  if (activeBuff?.type === 'teleport') {
    data.teleportPending = { sq: landedSq, color };
    delete data.buffs[landedSq];
  }

  // Spawn lootboxes every 3 half-moves
  if (data.halfMoves % 3 === 0) spawnLootboxes(chess, data);
}

export function tickTurnStart(data: LootboxData, color: 'w' | 'b'): void {
  // Called at the start of a player's turn to pre-process skip
  // (skip_turn is checked during move processing)
}
