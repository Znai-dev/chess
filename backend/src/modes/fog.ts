import { Chess } from 'chess.js';
import { FogData } from './types';
import { getAttackSquares, findKing } from './helpers';

export function initFogData(): FogData {
  return {};
}

export function computeVisibility(chess: Chess, color: 'w' | 'b'): Set<string> {
  const visible = new Set<string>();
  const board = chess.board();
  const opp = color === 'w' ? 'b' : 'w';

  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      if (sq.color === color) {
        visible.add(sq.square);
        // Add all attack squares (diagonal only for pawns)
        const attacks = getAttackSquares(sq.type, color, sq.square, chess);
        attacks.forEach(s => visible.add(s));
      }
    }
  }

  // Always see the piece(s) attacking the king
  const king = findKing(chess, color);
  if (king && chess.inCheck() && chess.turn() === color) {
    for (const row of board) {
      for (const sq of row) {
        if (!sq || sq.color !== opp) continue;
        const attacks = getAttackSquares(sq.type, opp, sq.square, chess);
        if (attacks.includes(king)) visible.add(sq.square);
      }
    }
  }

  return visible;
}

export function maskFenForPlayer(
  chess: Chess,
  color: 'w' | 'b',
  visible: Set<string>
): string {
  const board = chess.board();
  const opp = color === 'w' ? 'b' : 'w';
  let fenPos = '';

  // Build piece placement (rank 8 to rank 1)
  for (let rankIdx = 0; rankIdx < 8; rankIdx++) { // rankIdx 0 = rank 8
    let empty = 0;
    for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
      const sq = String.fromCharCode('a'.charCodeAt(0) + fileIdx) + (8 - rankIdx);
      const piece = board[rankIdx][fileIdx];

      if (!piece) {
        empty++;
      } else if (piece.color === opp && !visible.has(sq) && piece.type !== 'k') {
        // Enemy not visible → hide (never hide king: FEN would be invalid)
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

export function getFogStateForPlayer(
  chess: Chess,
  _fogData: FogData,
  color: 'w' | 'b'
) {
  const visible = computeVisibility(chess, color);
  const maskedFen = maskFenForPlayer(chess, color, visible);
  return {
    fen: maskedFen,
    fogData: {
      visibleSquares: [...visible],
    },
  };
}
