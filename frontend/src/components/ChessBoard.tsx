import { useState, useCallback, useMemo, CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import type { Color } from '../types';

interface Props {
  fen: string;
  yourColor: Color | null;
  onMove: (from: string, to: string, promotion?: string) => boolean;
  lastMove?: { from: string; to: string } | null;
  inCheck: boolean;
  isGameOver: boolean;
  turn: Color;
  isSpectator: boolean;
  // Mode overlays
  extraSquareStyles?: Record<string, CSSProperties>;
  squareIcons?: Record<string, string>;
  // Fog: squares to cover with an opaque overlay (hides pieces visually)
  fogCoverSquares?: string[];
  // For pending-target selection (lootbox shield break / magic spell target)
  targetCandidates?: string[];
  onTargetSelect?: (sq: string) => void;
  // For pending piece restriction (extra_move / teleport: must use specific piece)
  restrictToSquare?: string | null;
  // For fog/lootbox: skip local move validation
  skipLocalValidation?: boolean;
}

function sqToPercent(sq: string, orientation: 'white' | 'black'): { left: number; top: number } {
  const file = sq.charCodeAt(0) - 97; // a=0..h=7
  const rank = parseInt(sq[1]) - 1;   // rank1=0..rank8=7
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { left: col * 12.5, top: row * 12.5 };
}

export default function ChessBoard({
  fen, yourColor, onMove, lastMove, inCheck, isGameOver, turn, isSpectator,
  extraSquareStyles, squareIcons, fogCoverSquares, targetCandidates, onTargetSelect,
  restrictToSquare, skipLocalValidation,
}: Props) {
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [promotionPending, setPromotionPending] = useState<{ from: string; to: string } | null>(null);

  const chess = useMemo(() => {
    const c = new Chess();
    try { c.load(fen); } catch { /* ignore */ }
    return c;
  }, [fen]);

  const canInteract = !isSpectator && !isGameOver && yourColor === turn;
  const boardOrientation = yourColor === 'b' ? 'black' : 'white';

  // Move squares for selected piece
  const moveSquares = useMemo(() => {
    if (!selectedSquare || !canInteract || skipLocalValidation) return {};
    const moves = chess.moves({ square: selectedSquare as any, verbose: true });
    const styles: Record<string, CSSProperties> = {};
    moves.forEach((m) => {
      styles[m.to] = chess.get(m.to as any)
        ? { background: 'radial-gradient(circle, rgba(239,68,68,0.35) 60%, transparent 70%)', borderRadius: '0' }
        : { background: 'radial-gradient(circle, rgba(0,0,0,0.25) 30%, transparent 35%)', borderRadius: '0' };
    });
    return styles;
  }, [selectedSquare, chess, canInteract, skipLocalValidation]);

  const lastMoveSquares = useMemo(() => {
    if (!lastMove) return {};
    return {
      [lastMove.from]: { background: 'rgba(255, 255, 0, 0.22)' },
      [lastMove.to]: { background: 'rgba(255, 255, 0, 0.28)' },
    };
  }, [lastMove]);

  const selectedSquareStyle = useMemo(() => {
    if (!selectedSquare) return {};
    return { [selectedSquare]: { background: 'rgba(20, 180, 100, 0.4)' } };
  }, [selectedSquare]);

  const checkSquares = useMemo(() => {
    if (!inCheck) return {};
    const board = chess.board();
    for (const row of board)
      for (const sq of row)
        if (sq && sq.type === 'k' && sq.color === turn)
          return { [sq.square]: { background: 'rgba(239, 68, 68, 0.55)', boxShadow: 'inset 0 0 12px rgba(239,68,68,0.8)' } };
    return {};
  }, [inCheck, chess, turn]);

  // Target candidate highlight
  const candidateStyles = useMemo(() => {
    if (!targetCandidates?.length) return {};
    const styles: Record<string, CSSProperties> = {};
    for (const sq of targetCandidates) {
      styles[sq] = { background: 'rgba(234,179,8,0.45)', boxShadow: 'inset 0 0 0 2px rgba(234,179,8,0.9)' };
    }
    return styles;
  }, [targetCandidates]);

  const customSquareStyles: Record<string, CSSProperties> = {
    ...lastMoveSquares,
    ...checkSquares,
    ...(extraSquareStyles || {}),
    ...moveSquares,
    ...selectedSquareStyle,
    ...candidateStyles,
  };

  function onSquareClick(square: string) {
    // Target selection mode overrides everything
    if (onTargetSelect) {
      onTargetSelect(square);
      return;
    }

    if (!canInteract) return;

    if (selectedSquare === square) { setSelectedSquare(null); return; }

    if (selectedSquare) {
      // If restricted to a specific piece, only that piece can be moved
      if (restrictToSquare && selectedSquare !== restrictToSquare) {
        setSelectedSquare(null);
        return;
      }

      if (skipLocalValidation) {
        // For fog/lootbox teleport: attempt any destination
        const isPromo = chess.get(selectedSquare as any)?.type === 'p' && (square[1] === '8' || square[1] === '1');
        if (isPromo) { setPromotionPending({ from: selectedSquare, to: square }); setSelectedSquare(null); return; }
        onMove(selectedSquare, square);
        setSelectedSquare(null);
        return;
      }

      // Normal: check chess.js moves
      const moves = chess.moves({ square: selectedSquare as any, verbose: true });
      const valid = moves.find((m) => m.to === square);
      if (valid) {
        if (valid.promotion) { setPromotionPending({ from: selectedSquare, to: square }); setSelectedSquare(null); return; }
        onMove(selectedSquare, square);
        setSelectedSquare(null);
        return;
      }
    }

    // Select own piece
    const piece = chess.get(square as any);
    const isOwnPiece = piece && piece.color === yourColor;

    if (isOwnPiece) {
      // Restrict to forced piece if set
      if (restrictToSquare && square !== restrictToSquare) return;
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  }

  function onPieceDrop(from: string, to: string, piece: string): boolean {
    if (!canInteract) return false;
    if (restrictToSquare && from !== restrictToSquare) return false;
    const isPromotion = piece[1] === 'P' && (to[1] === '8' || to[1] === '1');
    if (isPromotion) { setPromotionPending({ from, to }); return false; }
    const result = onMove(from, to);
    if (result) setSelectedSquare(null);
    return result;
  }

  function handlePromotion(piece: string) {
    if (!promotionPending) return;
    onMove(promotionPending.from, promotionPending.to, piece);
    setPromotionPending(null);
  }

  return (
    <div className="relative" style={{ width: 'min(480px, 90vw)', height: 'min(480px, 90vw)' }}>
      <Chessboard
        id="chess-board"
        position={fen}
        onSquareClick={onSquareClick}
        onPieceDrop={onPieceDrop}
        boardOrientation={boardOrientation}
        customSquareStyles={customSquareStyles}
        customBoardStyle={{ borderRadius: '0px', boxShadow: 'none' }}
        customDarkSquareStyle={{ backgroundColor: '#769656' }}
        customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
        arePiecesDraggable={canInteract && !onTargetSelect}
        animationDuration={180}
        customDropSquareStyle={{ boxShadow: 'inset 0 0 1px 4px rgba(255,255,255,0.6)' }}
      />

      {/* Fog cover: opaque squares rendered ABOVE pieces to hide them */}
      {fogCoverSquares && fogCoverSquares.length > 0 && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 4 }}>
          {fogCoverSquares.map((sq) => {
            const { left, top } = sqToPercent(sq, boardOrientation);
            const file = sq.charCodeAt(0) - 97;
            const rank = parseInt(sq[1]) - 1;
            const isDark = (file + rank) % 2 === 0;
            const baseColor = isDark ? '#769656' : '#eeeed2';
            return (
              <div
                key={`fog-${sq}`}
                style={{
                  position: 'absolute',
                  left: `${left}%`, top: `${top}%`,
                  width: '12.5%', height: '12.5%',
                  background: baseColor,
                }}
              >
                {/* dark fog tint on top */}
                <div style={{ width: '100%', height: '100%', background: 'rgba(0,0,0,0.65)' }} />
              </div>
            );
          })}
        </div>
      )}

      {/* Square icon overlays (lootboxes, buffs, magic markers) */}
      {squareIcons && Object.keys(squareIcons).length > 0 && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
          {Object.entries(squareIcons).map(([sq, icon]) => {
            const { left, top } = sqToPercent(sq, boardOrientation);
            return (
              <div
                key={sq}
                style={{
                  position: 'absolute',
                  left: `${left}%`,
                  top: `${top}%`,
                  width: '12.5%',
                  height: '12.5%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'clamp(0.7rem, 2.5vw, 1.2rem)',
                  userSelect: 'none',
                  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))',
                }}
              >
                {icon}
              </div>
            );
          })}
        </div>
      )}

      {/* Cursor hint when targeting */}
      {onTargetSelect && (
        <div
          className="absolute inset-0"
          style={{ zIndex: 6, cursor: 'crosshair', pointerEvents: 'none' }}
        />
      )}

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
    q: ['♛', '♕'], r: ['♜', '♖'], b: ['♝', '♗'], n: ['♞', '♘'],
  };
  return color === 'b' ? pieces[piece][0] : pieces[piece][1];
}
