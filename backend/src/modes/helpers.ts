import { Chess } from 'chess.js';

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

/** Move a piece manually (bypass chess.js move validation), flip turn */
export function applyCustomMove(
  chess: Chess,
  fromSq: string,
  toSq: string,
  captureTarget = false
): void {
  const piece = chess.get(fromSq as any);
  if (!piece) return;
  chess.remove(fromSq as any);
  if (captureTarget) chess.remove(toSq as any);
  chess.put({ type: piece.type, color: piece.color }, toSq as any);
  flipTurn(chess);
}

export function flipTurn(chess: Chess): void {
  const parts = chess.fen().split(' ');
  const wasWhite = parts[1] === 'w';
  parts[1] = wasWhite ? 'b' : 'w';
  parts[3] = '-'; // clear en passant
  parts[4] = String(parseInt(parts[4]) + 1); // half-move
  if (!wasWhite) parts[5] = String(parseInt(parts[5]) + 1); // full move after black
  chess.load(parts.join(' '));
}

/** Compute attack squares for a piece (ignoring pins/legality) */
export function getAttackSquares(
  pieceType: string,
  color: 'w' | 'b',
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
      if (board[7 - r][f]) break; // blocked
      f += df; r += dr;
    }
  };

  switch (pieceType) {
    case 'p': {
      const dir = color === 'w' ? 1 : -1;
      addSq(file - 1, rank + dir); // diagonal attack
      addSq(file + 1, rank + dir); // diagonal attack
      addSq(file, rank + dir);     // one square forward (see blocked pawn)
      break;
    }
    case 'n':
      for (const [df, dr] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])
        addSq(file + df, rank + dr);
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

export function findKing(chess: Chess, color: 'w' | 'b'): string | null {
  const board = chess.board();
  for (const row of board)
    for (const sq of row)
      if (sq && sq.type === 'k' && sq.color === color) return sq.square;
  return null;
}

export function getAllPieces(chess: Chess, color: 'w' | 'b') {
  const result: { sq: string; type: string }[] = [];
  const board = chess.board();
  for (const row of board)
    for (const sq of row)
      if (sq && sq.color === color) result.push({ sq: sq.square, type: sq.type });
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
