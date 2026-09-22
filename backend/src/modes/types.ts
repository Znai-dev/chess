export type GameMode = 'classic' | 'lootbox' | 'fog' | 'magic';

// ─── Lootbox ───────────────────────────────────────────────────────────────
export type BuffType = 'extra_move' | 'shield' | 'teleport' | 'berserk';
export type DebuffType = 'skip_turn' | 'no_attack';

export interface PieceBuff {
  type: BuffType;
  movesLeft: number;
  /** berserk: pre-generated jump cells */
  berserkCells?: string[];
}

export interface PieceDebuff {
  type: DebuffType;
  movesLeft: number;
}

export interface LootboxEntry {
  sq: string;
  id: string;
}

export interface LootboxData {
  lootboxes: LootboxEntry[];
  buffs: Record<string, PieceBuff>;    // square → buff on piece at that square
  debuffs: Record<string, PieceDebuff>; // square → debuff on piece at that square
  halfMoves: number;
  extraMovePending: { sq: string; color: 'w' | 'b' } | null;
  teleportPending: { sq: string; color: 'w' | 'b' } | null;
  shieldBreakPending: { attackerSq: string; color: 'w' | 'b'; candidates: string[] } | null;
}

// ─── Fog ───────────────────────────────────────────────────────────────────
export interface FogData {
  _placeholder?: true;
}

// ─── Magic ─────────────────────────────────────────────────────────────────
export interface MagicSpell {
  id: string;
  name: string;
  cooldown: number;
  currentCooldown: number;
  needsTarget: 'none' | 'own' | 'enemy';
}

export interface RebirthCounter {
  sq: string;
  count: number;
}

export interface MagicData {
  teleports: { a: [string, string]; b: [string, string] };
  rebirthSqs: [string, string];

  usedTeleports: Set<string>;
  pieceShields: Record<string, boolean>;
  frozenPieces: Record<string, number>;
  invisiblePieces: Record<string, number>;

  rebirthCounters: { w: RebirthCounter | null; b: RebirthCounter | null };
  captured: { w: string[]; b: string[] };

  spells: { w: MagicSpell[]; b: MagicSpell[] };
  pendingSpell: { color: 'w' | 'b'; spellId: string } | null;
}
