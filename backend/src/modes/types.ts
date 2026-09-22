export type GameMode = 'expand' | 'lootbox' | 'fog' | 'magic';
export type Color = 'w' | 'b';

/** A move the player may make right now. `kind` tells the client how to draw it. */
export type MoveKind = 'normal' | 'rage' | 'knight' | 'teleport' | 'break';
export interface MoveOption {
  from: string;
  to: string;
  kind: MoveKind;
  capture: boolean;
}

/** Something notable that happened during a move; the client turns these into toasts/animations. */
export type GameEvent =
  | { type: 'pickup'; sq: string; color: Color; effect: EffectType }
  | { type: 'extra_move_lost'; sq: string; color: Color }
  | { type: 'shield_absorb'; at: string; attackerSq: string; color: Color; stayed: boolean }
  | { type: 'bomb'; at: string; victimSq: string; color: Color }
  | { type: 'effects_suspended'; color: Color }
  | { type: 'teleport'; from: string; to: string; color: Color }
  | { type: 'spell'; spellId: string; target: string; color: Color }
  | { type: 'rebirth'; sq: string; piece: string; color: Color }
  | { type: 'magic_teleport'; from: string; to: string; color: Color }
  | { type: 'thawed'; color: Color }
  | { type: 'blocked_by_invisible'; color: Color }
  // expansion mode
  | { type: 'expand'; size: number; zone: string; pieces: number }
  | { type: 'portal_jump'; from: string; to: string; color: Color }
  | { type: 'promote'; sq: string; color: Color }
  | { type: 'treasure'; sq: string; to: string; color: Color }
  | { type: 'wall_break'; sq: string; color: Color; destroyed: boolean };

/** What the player to move must do before the turn can pass. */
export type Pending =
  | { kind: 'extra_move'; sq: string; color: Color }
  | { kind: 'shield_break'; attackerSq: string; targetSq: string; candidates: string[]; color: Color }
  | null;

// ─── Lootbox ───────────────────────────────────────────────────────────────
export type BuffType = 'extra_move' | 'shield' | 'teleport' | 'rage' | 'knight' | 'bomb';
export type DebuffType = 'stun' | 'pacifist';
export type EffectType = BuffType | DebuffType;

export interface PieceEffect {
  type: EffectType;
  /** Turns (stun/pacifist) or own moves (rage/knight) left. 0 = untimed. */
  movesLeft: number;
  /** Picked up this turn: timed effects start counting from the next turn. */
  fresh: boolean;
  /** rage: squares this piece may jump to, regenerated after each of its moves */
  rageCells?: string[];
}

export interface LootboxEntry { sq: string; id: string }

export interface LootboxData {
  lootboxes: LootboxEntry[];
  /** square → effect on the piece standing there (one per piece, newer replaces older) */
  effects: Record<string, PieceEffect>;
  halfMoves: number;
  pending: Pending;
  /** set when restrictions had to be lifted so the player could move at all */
  effectsSuspended: Color | null;
  /** dev only: what the next box will contain */
  forceNext?: EffectType | null;
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
  pendingSpell: { color: Color; spellId: string } | null;
  spellUsedThisTurn: { w: boolean; b: boolean };
  /** freeze lifted because the frozen piece was the only way out of check */
  thawed: Color | null;
}
