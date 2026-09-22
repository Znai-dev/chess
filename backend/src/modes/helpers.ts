import { Chess } from 'chess.js';
import { Color } from './types';

export const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const INITIAL_COUNTS: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

export function mirrorSquare(sq: string): string {
  return sq[0] + String(9 - parseInt(sq[1]));
}

export function sqToCoords(sq: string): [number, number] {
  return [sq.charCodeAt(0) - 'a'.charCodeAt(0), parseInt(sq[1]) - 1];
}

export function coordsToSq(f: number, r: number): string | null {
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return String.fromCharCode('a'.charCodeAt(0) + f) + (r + 1);
}

export function getAdjacentSquares(sq: string): string[] {
  const [f, r] = sqToCoords(sq);
  const result: string[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const s = coordsToSq(f + df, r + dr);
      if (s) result.push(s);
    }
  }
  return result;
}

export const KNIGHT_OFFSETS: [number, number][] = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];

export function knightSquares(sq: string): string[] {
  const [f, r] = sqToCoords(sq);
  return KNIGHT_OFFSETS.map(([df, dr]) => coordsToSq(f + df, r + dr)).filter((s): s is string => !!s);
}

export function isLastRank(sq: string, color: Color): boolean {
  return color === 'w' ? sq[1] === '8' : sq[1] === '1';
}

export function otherColor(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

/** Set side to move without touching the position. Clears en passant. */
export function setTurn(chess: Chess, color: Color): void {
  const parts = chess.fen().split(' ');
  if (parts[1] === color) return;
  parts[1] = color;
  parts[3] = '-';
  chess.load(parts.join(' '));
}

export function flipTurn(chess: Chess): void {
  const parts = chess.fen().split(' ');
  const wasWhite = parts[1] === 'w';
  parts[1] = wasWhite ? 'b' : 'w';
  parts[3] = '-';
  parts[4] = String(parseInt(parts[4]) + 1);
  if (!wasWhite) parts[5] = String(parseInt(parts[5]) + 1);
  chess.load(parts.join(' '));
}

/**
 * Move a piece outside the chess rules (jump, teleport…). Pawns reaching the
 * last rank become queens. Does NOT change the side to move.
 */
export function placeCustomMove(chess: Chess, from: string, to: string): void {
  const piece = chess.get(from as any);
  if (!piece) return;
  chess.remove(from as any);
  chess.remove(to as any);
  const type = piece.type === 'p' && isLastRank(to, piece.color) ? 'q' : piece.type;
  chess.put({ type: type as any, color: piece.color }, to as any);
}

/** Would this custom move leave the mover's own king attacked? */
export function customMoveIsSafe(chess: Chess, from: string, to: string, color: Color): boolean {
  const clone = new Chess(chess.fen());
  placeCustomMove(clone, from, to);
  setTurn(clone, color);
  return !clone.inCheck();
}

/** Compute attack squares for a piece (ignoring pins/legality) */
export function getAttackSquares(
  pieceType: string,
  color: Color,
  sq: string,
  chess: Chess
): string[] {
  const [file, rank] = sqToCoords(sq);
  const squares: string[] = [];
  const board = chess.board();

  const addSq = (f: number, r: number) => {
    const s = coordsToSq(f, r);
    if (s) squares.push(s);
  };

  const slide = (df: number, dr: number) => {
    let f = file + df, r = rank + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      squares.push(coordsToSq(f, r)!);
      if (board[7 - r][f]) break;
      f += df; r += dr;
    }
  };

  switch (pieceType) {
    case 'p': {
      const dir = color === 'w' ? 1 : -1;
      addSq(file - 1, rank + dir);
      addSq(file + 1, rank + dir);
      addSq(file, rank + dir);
      break;
    }
    case 'n':
      for (const [df, dr] of KNIGHT_OFFSETS) addSq(file + df, rank + dr);
      break;
    case 'b':
      for (const [df, dr] of [[-1,-1],[-1,1],[1,-1],[1,1]]) slide(df, dr);
      break;
    case 'r':
      for (const [df, dr] of [[-1,0],[1,0],[0,-1],[0,1]]) slide(df, dr);
      break;
    case 'q':
      for (const [df, dr] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) slide(df, dr);
      break;
    case 'k':
      for (const [df, dr] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])
        addSq(file + df, rank + dr);
      break;
  }
  return [...new Set(squares)];
}

export function findKing(chess: Chess, color: Color): string | null {
  const board = chess.board();
  for (const row of board)
    for (const sq of row)
      if (sq && sq.type === 'k' && sq.color === color) return sq.square;
  return null;
}

export function getAllPieces(chess: Chess, color: Color) {
  const result: { sq: string; type: string }[] = [];
  const board = chess.board();
  for (const row of board)
    for (const sq of row)
      if (sq && sq.color === color) result.push({ sq: sq.square, type: sq.type });
  return result;
}

export function materialOf(chess: Chess, color: Color): number {
  return getAllPieces(chess, color).reduce((s, p) => s + PIECE_VALUES[p.type], 0);
}

/** Pieces each side has taken, derived from what is missing from the board. */
export function capturedPieces(chess: Chess): { w: string[]; b: string[] } {
  const result = { w: [] as string[], b: [] as string[] };
  for (const victim of ['w', 'b'] as Color[]) {
    const counts: Record<string, number> = {};
    for (const p of getAllPieces(chess, victim)) counts[p.type] = (counts[p.type] ?? 0) + 1;
    const taker = otherColor(victim);
    for (const type of ['q', 'r', 'b', 'n', 'p']) {
      const missing = INITIAL_COUNTS[type] - (counts[type] ?? 0);
      for (let i = 0; i < missing; i++) result[taker].push(type);
    }
  }
  return result;
}

/** Pick N random items from array */
export function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const result: T[] = [];
  while (result.length < n && copy.length > 0) {
    const i = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(i, 1)[0]);
  }
  return result;
}

export function weightedPick<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}
