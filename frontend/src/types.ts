export type Color = 'w' | 'b';
export type GameMode = 'classic' | 'lootbox' | 'fog' | 'magic';

export interface PlayerInfo {
  name: string;
  color: Color;
  connected: boolean;
}

export interface MoveVerbose {
  color: Color;
  from: string;
  to: string;
  piece: string;
  captured?: string;
  promotion?: string;
  flags: string;
  san: string;
  lan: string;
  before: string;
  after: string;
}

// ── Lootbox ──────────────────────────────────────────────────────────────

export interface LootboxEntry {
  sq: string;
  id: string;
}

export interface PieceBuffClient {
  type: 'extra_move' | 'shield' | 'teleport' | 'berserk';
  movesLeft: number;
  berserkCells?: string[];
}

export interface PieceDebuffClient {
  type: 'skip_turn' | 'no_attack';
  movesLeft: number;
}

export interface LootboxClientData {
  lootboxes: LootboxEntry[];
  buffs: Record<string, PieceBuffClient>;
  debuffs: Record<string, PieceDebuffClient>;
  halfMoves: number;
  extraMovePending: { sq: string; color: Color } | null;
  teleportPending: { sq: string; color: Color } | null;
  shieldBreakPending: { attackerSq: string; color: Color; candidates: string[] } | null;
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
  usedTeleports: string[];
  captured: { w: string[]; b: string[] };
}

// ── Game State ────────────────────────────────────────────────────────────

export interface GameState {
  id: string;
  status: 'waiting' | 'playing' | 'finished';
  mode: GameMode;
  fen: string;
  turn: Color;
  players: PlayerInfo[];
  history: MoveVerbose[];
  inCheck: boolean;
  isGameOver: boolean;
  isCheckmate: boolean;
  isDraw: boolean;
  isStalemate: boolean;
  yourColor: Color | null;
  lastMove?: { from: string; to: string } | null;
  drawOffer: Color | null;
  // Mode-specific
  lootboxData?: LootboxClientData;
  fogData?: FogClientData;
  magicData?: MagicClientData;
}

export interface GameOverEvent {
  reason: 'checkmate' | 'stalemate' | 'resign' | 'draw-agreement' | 'insufficient-material' | 'threefold-repetition';
  winner: Color | null;
  loserName?: string;
}
