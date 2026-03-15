import { useState, useCallback, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import type { Color } from '../types';

interface Props {
  fen: string;
  yourColor: Color | null;
  onMove: (from: string, to: string, promotion?: string) => boolean;
  lastMove?: { from: string; to: string };
  inCheck: boolean;
  isGameOver: boolean;
  turn: Color;
  isSpectator: boolean;
}

export default function ChessBoard({ fen, yourColor, onMove, lastMove, inCheck, isGameOver, turn, isSpectator }: Props) {
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [promotionPending, setPromotionPending] = useState<{ from: string; to: string } | null>(null);

  const chess = useMemo(() => {
    const c = new Chess();
    try { c.load(fen); } catch { /* ignore */ }
    return c;
  }, [fen]);

  const canInteract = !isSpectator && !isGameOver && yourColor === turn;

  // Squares where selected piece can move
  const moveSquares = useMemo(() => {
    if (!selectedSquare || !canInteract) return {};
    const moves = chess.moves({ square: selectedSquare as any, verbose: true });
    const styles: Record<string, React.CSSProperties> = {};
    moves.forEach((m) => {
      styles[m.to] = chess.get(m.to as any)
        ? {
            background: 'radial-gradient(circle, rgba(239,68,68,0.35) 60%, transparent 70%)',
            borderRadius: '0',
          }
        : {
            background: 'radial-gradient(circle, rgba(0,0,0,0.25) 30%, transparent 35%)',
            borderRadius: '0',
          };
    });
    return styles;
  }, [selectedSquare, chess, canInteract]);

  // Last move highlight
  const lastMoveSquares = useMemo(() => {
    if (!lastMove) return {};
    return {
      [lastMove.from]: { background: 'rgba(255, 255, 0, 0.22)' },
      [lastMove.to]: { background: 'rgba(255, 255, 0, 0.28)' },
    };
  }, [lastMove]);

  // Selected square highlight
  const selectedSquareStyle = useMemo(() => {
    if (!selectedSquare) return {};
    return { [selectedSquare]: { background: 'rgba(20, 180, 100, 0.4)' } };
  }, [selectedSquare]);

  // King in check highlight
  const checkSquares = useMemo(() => {
    if (!inCheck) return {};
    const board = chess.board();
    for (const row of board) {
      for (const sq of row) {
        if (sq && sq.type === 'k' && sq.color === turn) {
          return { [sq.square]: { background: 'rgba(239, 68, 68, 0.55)', boxShadow: 'inset 0 0 12px rgba(239,68,68,0.8)' } };
        }
      }
    }
    return {};
  }, [inCheck, chess, turn]);

  const customSquareStyles = {
    ...lastMoveSquares,
    ...checkSquares,
    ...moveSquares,
    ...selectedSquareStyle,
  };

  function onSquareClick(square: string) {
    if (!canInteract) return;

    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }

    if (selectedSquare) {
      // Check if it's a valid destination
      const moves = chess.moves({ square: selectedSquare as any, verbose: true });
      const valid = moves.find((m) => m.to === square);
      if (valid) {
        if (valid.promotion) {
          setPromotionPending({ from: selectedSquare, to: square });
          setSelectedSquare(null);
          return;
        }
        onMove(selectedSquare, square);
        setSelectedSquare(null);
        return;
      }
    }

    // Select own piece
    const piece = chess.get(square as any);
    if (piece && piece.color === yourColor) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  }

  function onPieceDrop(from: string, to: string, piece: string): boolean {
    if (!canInteract) return false;
    const isPromotion = piece[1] === 'P' && (to[1] === '8' || to[1] === '1');
    if (isPromotion) {
      setPromotionPending({ from, to });
      return false; // Will be handled by promotion modal
    }
    const result = onMove(from, to);
    if (result) setSelectedSquare(null);
    return result;
  }

  function handlePromotion(piece: string) {
    if (!promotionPending) return;
    onMove(promotionPending.from, promotionPending.to, piece);
    setPromotionPending(null);
  }

  const boardOrientation = yourColor === 'b' ? 'black' : 'white';

  return (
    <div className="relative" style={{ width: 'min(480px, 90vw)', height: 'min(480px, 90vw)' }}>
      <Chessboard
        id="chess-board"
        position={fen}
        onSquareClick={onSquareClick}
        onPieceDrop={onPieceDrop}
        boardOrientation={boardOrientation}
        customSquareStyles={customSquareStyles}
        customBoardStyle={{
          borderRadius: '0px',
          boxShadow: 'none',
        }}
        customDarkSquareStyle={{ backgroundColor: '#769656' }}
        customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
        arePiecesDraggable={canInteract}
        animationDuration={180}
        customDropSquareStyle={{ boxShadow: 'inset 0 0 1px 4px rgba(255,255,255,0.6)' }}
      />

      {/* Promotion picker */}
      {promotionPending && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50 rounded-sm">
          <div className="glass rounded-2xl p-4">
            <p className="text-sm text-slate-300 text-center mb-3">Вибір фігури</p>
            <div className="flex gap-3">
              {(['q', 'r', 'b', 'n'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => handlePromotion(p)}
                  className="w-14 h-14 rounded-xl bg-slate-700 hover:bg-slate-600 transition-colors flex items-center justify-center text-3xl"
                >
                  {promotionPieceChar(p, turn)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function promotionPieceChar(piece: string, color: Color): string {
  const pieces: Record<string, [string, string]> = {
    q: ['♛', '♕'],
    r: ['♜', '♖'],
    b: ['♝', '♗'],
    n: ['♞', '♘'],
  };
  return color === 'b' ? pieces[piece][0] : pieces[piece][1];
}
