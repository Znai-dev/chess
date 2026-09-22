import { Chess } from 'chess.js';
import { MagicData, MagicSpell, Color, MoveOption, GameEvent } from './types';
import { otherColor, setTurn } from './helpers';

// Fixed magic square layout
export const MAGIC_TELEPORT_A: [string, string] = ['a4', 'h4']; // left edge <-> right edge
export const MAGIC_TELEPORT_B: [string, string] = ['a5', 'h5'];
export const MAGIC_REBIRTH: [string, string]    = ['d4', 'e5']; // centre of the board

const FREEZE_TURNS = 2;     // victim's own turns
const INVISIBLE_TURNS = 3;  // opponent turns during which the piece is hidden
const REBIRTH_TURNS = 3;    // own turns standing on the square

const SPELL_DEFS: Omit<MagicSpell, 'currentCooldown'>[] = [
  { id: 'freeze',     name: 'Заморозка',    cooldown: 4, needsTarget: 'enemy' },
  { id: 'invisible',  name: 'Невидимість',  cooldown: 5, needsTarget: 'own'   },
  { id: 'minishield', name: 'Міні-щит',     cooldown: 4, needsTarget: 'own'   },
];

function makeSpells(): MagicSpell[] {
  return SPELL_DEFS.map(s => ({ ...s, currentCooldown: 0 }));
}

export function initMagicData(): MagicData {
  return {
    teleports: { a: MAGIC_TELEPORT_A, b: MAGIC_TELEPORT_B },
    rebirthSqs: MAGIC_REBIRTH,
    usedTeleports: new Set(),
    pieceShields: {},
    frozenPieces: {},
    invisiblePieces: {},
    rebirthCounters: { w: null, b: null },
    captured: { w: [], b: [] },
    spells: { w: makeSpells(), b: makeSpells() },
    pendingSpell: null,
    spellUsedThisTurn: { w: false, b: false },
    thawed: null,
  };
}

/** Board as `color` sees it: enemy invisible pieces removed (never the king). */
export function maskedFenFor(chess: Chess, data: MagicData, color: Color): string {
  const opp = otherColor(color);
  const board = chess.board();
  let fenPos = '';
  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    let empty = 0;
    for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
      const sq = String.fromCharCode('a'.charCodeAt(0) + fileIdx) + (8 - rankIdx);
      const piece = board[rankIdx][fileIdx];
      const hidden = piece?.color === opp && (data.invisiblePieces[sq] ?? 0) > 0 && piece?.type !== 'k';
      if (!piece || hidden) {
        empty++;
      } else {
        if (empty) { fenPos += empty; empty = 0; }
        fenPos += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
      }
    }
    if (empty) fenPos += empty;
    if (rankIdx < 7) fenPos += '/';
  }
  const parts = chess.fen().split(' ');
  return [fenPos, parts[1], parts[2], parts[3], parts[4], parts[5]].join(' ');
}

/**
 * If every legal move of `color` belongs to frozen pieces, the freeze melts:
 * a frozen piece must still be able to save its king.
 */
export function thawIfStuck(chess: Chess, data: MagicData, color: Color): boolean {
  if (chess.turn() !== color) return false;
  const all = chess.moves({ verbose: true });
  if (all.length === 0) return false;
  if (all.some(m => !data.frozenPieces[m.from])) return false;
  for (const sq of Object.keys(data.frozenPieces)) {
    if (chess.get(sq as any)?.color === color) delete data.frozenPieces[sq];
  }
  data.thawed = color;
  return true;
}

/**
 * Moves to show `color`. Computed on the board as the player sees it, so an
 * invisible enemy piece is not given away by the hints; the server still
 * validates on the real board.
 */
export function computeMagicMoves(chess: Chess, data: MagicData, color: Color): MoveOption[] {
  if (chess.turn() !== color) return [];
  const view = new Chess(maskedFenFor(chess, data, color));
  let moves: ReturnType<Chess['moves']>;
  try { moves = view.moves({ verbose: true }); } catch { return []; }
  return moves
    .filter(m => !data.frozenPieces[m.from])
    .map(m => ({ from: m.from, to: m.to, kind: 'normal' as const, capture: !!m.captured }));
}

export function checkMagicPreMove(data: MagicData, from: string): { ok: false; reason: string } | { ok: true } {
  if (data.frozenPieces[from]) return { ok: false, reason: 'Ця фігура заморожена і не може ходити' };
  return { ok: true };
}

/** Called after a successful chess.js move by `color`. */
export function handleMagicPostMove(
  chess: Chess,
  data: MagicData,
  from: string,
  to: string,
  captured: string | undefined,
  color: Color,
): GameEvent[] {
  const events: GameEvent[] = [];
  // `captured` lists what each side has LOST: that is what rebirth brings back
  if (captured) data.captured[otherColor(color)].push(captured);

  data.pendingSpell = null;
  data.spellUsedThisTurn[color] = false;
  data.thawed = null;

  for (const spell of data.spells[color]) {
    if (spell.currentCooldown > 0) spell.currentCooldown--;
  }

  // Shield / invisibility travel with the piece
  if (data.pieceShields[from]) {
    data.pieceShields[to] = true;
    delete data.pieceShields[from];
  }
  if (data.invisiblePieces[from]) {
    data.invisiblePieces[to] = data.invisiblePieces[from];
    delete data.invisiblePieces[from];
  }

  // Timers count the owner's turns: tick the mover's own pieces
  tickOwn(chess, data.frozenPieces, color);
  tickOwn(chess, data.invisiblePieces, color);
  // Captured piece loses its marks
  for (const map of [data.pieceShields, data.frozenPieces, data.invisiblePieces] as Record<string, unknown>[]) {
    for (const sq of Object.keys(map)) if (!chess.get(sq as any)) delete map[sq];
  }

  // Rebirth: stand on a rebirth square for 3 of your own turns
  const counter = data.rebirthCounters[color];
  const standing = data.rebirthSqs.find(sq => chess.get(sq as any)?.color === color) ?? null;
  if (!standing) {
    data.rebirthCounters[color] = null;
  } else if (!counter || counter.sq !== standing) {
    data.rebirthCounters[color] = { sq: standing, count: 1 };
  } else {
    counter.count++;
    if (counter.count >= REBIRTH_TURNS) {
      const lastCaptured = data.captured[color].pop();
      if (lastCaptured) {
        const startSq = findStartSquare(chess, lastCaptured, color);
        if (startSq) {
          chess.put({ type: lastCaptured as any, color }, startSq as any);
          events.push({ type: 'rebirth', sq: startSq, piece: lastCaptured, color });
        }
      }
      data.rebirthCounters[color] = null;
    }
  }

  // Teleport squares: a piece that lands on one jumps to its pair (once per square)
  const tryTeleport = (pair: [string, string]): boolean => {
    const idx = pair.indexOf(to);
    if (idx === -1) return false;
    const dest = pair[1 - idx];
    const piece = chess.get(to as any);
    if (!piece || piece.type === 'k') return false;
    if (data.usedTeleports.has(to)) return false;

    const destPiece = chess.get(dest as any);
    if (destPiece && (destPiece.color === color || destPiece.type === 'k')) return false;
    // leaving the square must not expose our own king
    const probe = new Chess(chess.fen());
    probe.remove(to as any);
    probe.remove(dest as any);
    probe.put({ type: piece.type, color: piece.color }, dest as any);
    setTurn(probe, color);
    if (probe.inCheck()) return false;

    data.usedTeleports.add(to);
    chess.remove(to as any);
    if (destPiece) {
      data.captured[otherColor(color)].push(destPiece.type);
      chess.remove(dest as any);
      delete data.pieceShields[dest];
      delete data.frozenPieces[dest];
      delete data.invisiblePieces[dest];
    }
    chess.put({ type: piece.type, color: piece.color }, dest as any);
    if (data.pieceShields[to]) { data.pieceShields[dest] = true; delete data.pieceShields[to]; }
    if (data.invisiblePieces[to]) { data.invisiblePieces[dest] = data.invisiblePieces[to]; delete data.invisiblePieces[to]; }
    events.push({ type: 'magic_teleport', from: to, to: dest, color });
    return true;
  };
  tryTeleport(data.teleports.a) || tryTeleport(data.teleports.b);

  return events;
}

function tickOwn(chess: Chess, map: Record<string, number>, color: Color): void {
  for (const sq of Object.keys(map)) {
    if (chess.get(sq as any)?.color !== color) continue;
    map[sq]--;
    if (map[sq] <= 0) delete map[sq];
  }
}

export type SpellResult =
  | { ok: false; reason: string }
  | { ok: true; needsTarget?: false }
  | { ok: true; needsTarget: true };

export function castSpell(data: MagicData, spellId: string, color: Color): SpellResult {
  if (data.spellUsedThisTurn[color]) return { ok: false, reason: 'Одне заклинання за хід' };
  const spell = data.spells[color].find(s => s.id === spellId);
  if (!spell) return { ok: false, reason: 'Невідоме заклинання' };
  if (spell.currentCooldown > 0) return { ok: false, reason: `Перезарядка: ще ${spell.currentCooldown} хд` };
  data.pendingSpell = { color, spellId };
  return { ok: true, needsTarget: true };
}

export function cancelSpell(data: MagicData, color: Color): boolean {
  if (!data.pendingSpell || data.pendingSpell.color !== color) return false;
  data.pendingSpell = null;
  return true;
}

export function applySpellWithTarget(
  chess: Chess,
  data: MagicData,
  targetSq: string,
  color: Color,
): SpellResult {
  if (!data.pendingSpell || data.pendingSpell.color !== color)
    return { ok: false, reason: 'Немає активного заклинання' };

  const spell = data.spells[color].find(s => s.id === data.pendingSpell!.spellId);
  if (!spell) { data.pendingSpell = null; return { ok: false, reason: 'Заклинання не знайдено' }; }

  const piece = chess.get(targetSq as any);
  const opp = otherColor(color);

  switch (spell.id) {
    case 'freeze': {
      if (!piece || piece.color !== opp || piece.type === 'k')
        return { ok: false, reason: 'Оберіть ворожу фігуру (не короля)' };
      data.frozenPieces[targetSq] = FREEZE_TURNS;
      break;
    }
    case 'invisible': {
      if (!piece || piece.color !== color || piece.type === 'k')
        return { ok: false, reason: 'Оберіть свою фігуру (не короля)' };
      // +1: the caster's own move this turn ticks it once before the enemy looks
      data.invisiblePieces[targetSq] = INVISIBLE_TURNS + 1;
      break;
    }
    case 'minishield': {
      if (!piece || piece.color !== color || piece.type === 'k')
        return { ok: false, reason: 'Оберіть свою фігуру (не короля)' };
      data.pieceShields[targetSq] = true;
      break;
    }
    default:
      return { ok: false, reason: 'Невідоме заклинання' };
  }

  data.pendingSpell = null;
  data.spellUsedThisTurn[color] = true;
  spell.currentCooldown = spell.cooldown;
  return { ok: true };
}

function findStartSquare(chess: Chess, pieceType: string, color: Color): string | null {
  const startRank = color === 'w' ? '1' : '8';
  const pawnRank  = color === 'w' ? '2' : '7';
  if (pieceType === 'p') {
    // pawns: second rank, then third - never the back rank (illegal position)
    for (const rank of [pawnRank, color === 'w' ? '3' : '6']) {
      for (let f = 0; f < 8; f++) {
        const sq = String.fromCharCode('a'.charCodeAt(0) + f) + rank;
        if (!chess.get(sq as any)) return sq;
      }
    }
    return null;
  }
  for (const file of ['a','b','c','d','e','f','g','h']) {
    const sq = file + startRank;
    if (!chess.get(sq as any)) return sq;
  }
  return null;
}

export function serializeMagicData(data: MagicData) {
  return {
    teleports: data.teleports,
    rebirthSqs: data.rebirthSqs,
    pieceShields: data.pieceShields,
    frozenPieces: data.frozenPieces,
    invisiblePieces: data.invisiblePieces,
    rebirthCounters: data.rebirthCounters,
    captured: data.captured,
    pendingSpell: data.pendingSpell,
    spellUsedThisTurn: data.spellUsedThisTurn,
    thawed: data.thawed,
    usedTeleports: [...data.usedTeleports],
    spells: data.spells,
  };
}
