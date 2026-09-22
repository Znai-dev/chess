export type Color = 'w' | 'b';
export type GameMode = 'expand' | 'lootbox' | 'fog' | 'magic';

export interface PlayerInfo {
  name: string;
  color: Color;
  connected: boolean;
}

export interface LogEntry {
  color: Color;
  san: string;
}

export type MoveKind = 'normal' | 'rage' | 'knight' | 'teleport' | 'break';
export interface MoveOption {
  from: string;
  to: string;
  kind: MoveKind;
  capture: boolean;
}

export type Pending =
  | { kind: 'extra_move'; sq: string; color: Color }
  | { kind: 'shield_break'; attackerSq: string; targetSq: string; candidates: string[]; color: Color }
  | { kind: 'spell_target'; spellId: string; color: Color }
  | null;

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
  | { type: 'expand'; size: number; zone: string; pieces: number }
  | { type: 'portal_jump'; from: string; to: string; color: Color }
  | { type: 'promote'; sq: string; color: Color }
  | { type: 'treasure'; sq: string; to: string; color: Color }
  | { type: 'wall_break'; sq: string; color: Color; destroyed: boolean };

// ── Lootbox ──────────────────────────────────────────────────────────────

export type BuffType = 'extra_move' | 'shield' | 'teleport' | 'rage' | 'knight' | 'bomb';
export type DebuffType = 'stun' | 'pacifist';
export type EffectType = BuffType | DebuffType;

export interface PieceEffect {
  type: EffectType;
  movesLeft: number;
  fresh: boolean;
  rageCells?: string[];
}

export interface LootboxClientData {
  lootboxes: { sq: string; id: string }[];
  effects: Record<string, PieceEffect>;
  halfMoves: number;
  pending: Pending;
  effectsSuspended: Color | null;
}

// ── Fog ──────────────────────────────────────────────────────────────────

export interface FogClientData {
  visibleSquares: string[];
}

// ── Magic ─────────────────────────────────────────────────────────────────

export interface MagicSpellClient {
  id: string;
  name: string;
  cooldown: number;
  currentCooldown: number;
  needsTarget: 'none' | 'own' | 'enemy';
}

export interface MagicClientData {
  teleports: { a: [string, string]; b: [string, string] };
  rebirthSqs: [string, string];
  pieceShields: Record<string, boolean>;
  frozenPieces: Record<string, number>;
  invisiblePieces: Record<string, number>;
  rebirthCounters: { w: { sq: string; count: number } | null; b: { sq: string; count: number } | null };
  spells: { w: MagicSpellClient[]; b: MagicSpellClient[] };
  pendingSpell: { color: Color; spellId: string } | null;
  spellUsedThisTurn: { w: boolean; b: boolean };
  thawed: Color | null;
  usedTeleports: string[];
  captured: { w: string[]; b: string[] };
}

// ── Expansion ─────────────────────────────────────────────────────────────

export type TerrainType = 'wall' | 'portal' | 'treasure';

export interface ExpandClientData {
  min: number;
  max: number;
  size: number;
  maxSize: number;
  /** square → "wp" / "bk" … */
  board: Record<string, string>;
  terrain: Record<string, { type: TerrainType; pair?: string; hp?: number }>;
  zone: Record<string, number>;
  zones: { name: string; tint: string }[];
  plies: number;
  expansions: number;
  /** plies until the map grows again; 0 once it is fully grown */
  nextIn: number;
  checkSq: string | null;
}

// ── Game State ────────────────────────────────────────────────────────────

export interface GameState {
  id: string;
  status: 'waiting' | 'playing' | 'finished';
  mode: GameMode;
  fen: string;
  turn: Color;
  players: PlayerInfo[];
  history: LogEntry[];
  captured: { w: string[]; b: string[] };
  material: { w: number; b: number };
  inCheck: boolean;
  isGameOver: boolean;
  drawOffer: Color | null;
  lastMove: { from: string; to: string } | null;
  legalMoves: MoveOption[];
  pending: Pending;
  yourColor: Color | null;
  events?: GameEvent[];
  // Mode-specific
  lootboxData?: LootboxClientData;
  fogData?: FogClientData;
  magicData?: MagicClientData;
  expandData?: ExpandClientData;
}

export interface GameOverEvent {
  reason: 'checkmate' | 'stalemate' | 'resign' | 'draw-agreement' | 'insufficient-material' | 'threefold-repetition' | 'draw';
  winner: Color | null;
  loserName?: string;
}
