export type Color = 'w' | 'b';

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

export interface GameState {
  id: string;
  status: 'waiting' | 'playing' | 'finished';
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
  lastMove?: { from: string; to: string };
  drawOffer: Color | null;
}

export interface GameOverEvent {
  reason: 'checkmate' | 'stalemate' | 'resign' | 'draw-agreement' | 'insufficient-material' | 'threefold-repetition';
  winner: Color | null;
  loserName?: string;
}
