import { Chess } from 'chess.js';
import { MagicData, MagicSpell } from './types';

// Fixed magic square layout
export const MAGIC_TELEPORT_A: [string, string] = ['a4', 'h4']; // left edge ↔ right edge
export const MAGIC_TELEPORT_B: [string, string] = ['a5', 'h5']; // left edge ↔ right edge
export const MAGIC_REBIRTH: [string, string]    = ['d4', 'e5']; // centre of the board

// Only 3 spells
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
  };
}

/** Called before chess.js move to check if it's allowed */
export function checkMagicPreMove(
  data: MagicData,
  from: string,
): { ok: false; reason: string } | { ok: true } {
  if (data.frozenPieces[from]) return { ok: false, reason: 'Ця фігура заморожена і не може ходити' };
  return { ok: true };
}

/** Called after a successful chess.js move */
export function handleMagicPostMove(
  chess: Chess,
  data: MagicData,
  from: string,
  to: string,
  captured: string | undefined,
  color: 'w' | 'b'
): void {
  // Record captured pieces (for rebirth)
  if (captured) data.captured[color].push(captured);

  // Tick spell cooldowns for the moving color
  for (const spell of data.spells[color]) {
    if (spell.currentCooldown > 0) spell.currentCooldown--;
  }

  // Tick frozen pieces
  for (const sq of Object.keys(data.frozenPieces)) {
    data.frozenPieces[sq]--;
    if (data.frozenPieces[sq] <= 0) delete data.frozenPieces[sq];
  }

  // Tick invisible pieces
  for (const sq of Object.keys(data.invisiblePieces)) {
    data.invisiblePieces[sq]--;
    if (data.invisiblePieces[sq] <= 0) delete data.invisiblePieces[sq];
  }

  // Transfer shield when piece moves
  if (data.pieceShields[from]) {
    data.pieceShields[to] = true;
    delete data.pieceShields[from];
  }

  // Transfer invisible tracking when piece moves
  if (data.invisiblePieces[from]) {
    data.invisiblePieces[to] = data.invisiblePieces[from];
    delete data.invisiblePieces[from];
  }

  // Rebirth counter: stand on rebirth square 3 turns to revive last captured piece
  (['w', 'b'] as const).forEach(c => {
    let foundRebirth = false;
    for (const rebSq of data.rebirthSqs) {
      const piece = chess.get(rebSq as any);
      if (piece && piece.color === c) {
        foundRebirth = true;
        if (!data.rebirthCounters[c] || data.rebirthCounters[c]!.sq !== rebSq) {
          data.rebirthCounters[c] = { sq: rebSq, count: 1 };
        } else {
          data.rebirthCounters[c]!.count++;
          if (data.rebirthCounters[c]!.count >= 3) {
            const lastCaptured = data.captured[c].pop();
            if (lastCaptured) {
              const startSq = findStartSquare(chess, lastCaptured, c);
              if (startSq) chess.put({ type: lastCaptured as any, color: c }, startSq as any);
            }
            data.rebirthCounters[c] = null;
          }
        }
        break;
      }
    }
    if (!foundRebirth) data.rebirthCounters[c] = null;
  });

  // Teleport squares: piece that lands on one teleports to the paired square
  const tryTeleport = (pair: [string, string]): boolean => {
    const idx = pair.indexOf(to);
    if (idx === -1) return false;
    const dest = pair[1 - idx];
    const piece = chess.get(to as any);
    if (!piece || piece.type === 'k') return false;
    if (data.usedTeleports.has(to)) return false;

    const destPiece = chess.get(dest as any);
    if (destPiece && destPiece.color === color) return false; // blocked by own piece

    data.usedTeleports.add(to);
    chess.remove(to as any);
    if (destPiece) {
      data.captured[color].push(destPiece.type);
      chess.remove(dest as any);
    }
    chess.put({ type: piece.type, color: piece.color }, dest as any);
    return true;
  };

  tryTeleport(data.teleports.a) || tryTeleport(data.teleports.b);
}

export type SpellResult =
  | { ok: false; reason: string }
  | { ok: true; needsTarget?: false }
  | { ok: true; needsTarget: true };

export function castSpell(
  data: MagicData,
  spellId: string,
  color: 'w' | 'b'
): SpellResult {
  const spell = data.spells[color].find(s => s.id === spellId);
  if (!spell) return { ok: false, reason: 'Невідоме заклинання' };
  if (spell.currentCooldown > 0) return { ok: false, reason: `Перезарядка: ще ${spell.currentCooldown} хд` };
  data.pendingSpell = { color, spellId };
  return { ok: true, needsTarget: true };
}

export function applySpellWithTarget(
  chess: Chess,
  data: MagicData,
  targetSq: string,
  color: 'w' | 'b'
): SpellResult {
  if (!data.pendingSpell || data.pendingSpell.color !== color)
    return { ok: false, reason: 'Немає активного заклинання' };

  const spell = data.spells[color].find(s => s.id === data.pendingSpell!.spellId);
  if (!spell) return { ok: false, reason: 'Заклинання не знайдено' };
  data.pendingSpell = null;

  const piece = chess.get(targetSq as any);
  const opp = color === 'w' ? 'b' : 'w';

  switch (spell.id) {
    case 'freeze': {
      if (!piece || piece.color !== opp || piece.type === 'k')
        return { ok: false, reason: 'Оберіть ворожу фігуру (не короля)' };
      data.frozenPieces[targetSq] = 2;
      break;
    }
    case 'invisible': {
      if (!piece || piece.color !== color || piece.type === 'k')
        return { ok: false, reason: 'Оберіть свою фігуру (не короля)' };
      data.invisiblePieces[targetSq] = 3;
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

  spell.currentCooldown = spell.cooldown;
  return { ok: true };
}

function findStartSquare(chess: Chess, pieceType: string, color: 'w' | 'b'): string | null {
  const startRank = color === 'w' ? '1' : '8';
  const pawnRank  = color === 'w' ? '2' : '7';
  if (pieceType === 'p') {
    for (let f = 0; f < 8; f++) {
      const sq = String.fromCharCode('a'.charCodeAt(0) + f) + pawnRank;
      if (!chess.get(sq as any)) return sq;
    }
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
    usedTeleports: [...data.usedTeleports],
    spells: data.spells,
  };
}
