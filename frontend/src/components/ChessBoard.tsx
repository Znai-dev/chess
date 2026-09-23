import { useState, useMemo, useEffect, useLayoutEffect, useRef, CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { motion, AnimatePresence } from 'framer-motion';
import type { Color, MoveOption } from '../types';
import { KIND_STYLE } from '../effects';

export interface Badge {
  icon: string;
  title: string;
  tone: 'buff' | 'debuff' | 'magic' | 'neutral';
  count?: number;
}

export interface Flash {
  id: string;
  sq: string;
  icon: string;
  label?: string;
  tone: 'buff' | 'debuff' | 'neutral';
}

interface Props {
  fen: string;
  yourColor: Color | null;
  canInteract: boolean;
  legalMoves: MoveOption[];
  onMove: (from: string, to: string, promotion?: string) => void;
  lastMove?: { from: string; to: string } | null;
  checkSquare?: string | null;
  /** Mode overlays drawn under the pieces */
  squareStyles?: Record<string, CSSProperties>;
  /** Small pills in the corner of a square (effects, spells) */
  badges?: Record<string, Badge>;
  /** Big icon in the middle of an EMPTY square (loot boxes) */
  centerIcons?: Record<string, string>;
  fogCoverSquares?: string[];
  /** Click-to-pick mode: candidates === null means any square */
  targetMode?: { candidates: string[] | null; onSelect: (sq: string) => void } | null;
  /** Extra highlight while a piece is selected (rage cells) */
  selectionExtras?: Record<string, string[]>;
  animationDuration?: number;
  flashes?: Flash[];
}

const ALL_SQUARES: string[] = [];
for (let r = 8; r >= 1; r--) for (let f = 0; f < 8; f++) ALL_SQUARES.push(String.fromCharCode(97 + f) + r);

function sqToPercent(sq: string, orientation: 'white' | 'black'): { left: number; top: number } {
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { left: col * 12.5, top: row * 12.5 };
}

const TONE_BG: Record<Badge['tone'], string> = {
  buff: 'rgba(16,185,129,0.92)',
  debuff: 'rgba(239,68,68,0.92)',
  magic: 'rgba(129,140,248,0.92)',
  neutral: 'rgba(30,41,59,0.92)',
};

export default function ChessBoard({
  fen, yourColor, canInteract, legalMoves, onMove, lastMove, checkSquare,
  squareStyles, badges, centerIcons, fogCoverSquares, targetMode, selectionExtras,
  animationDuration = 200, flashes,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [promotionPending, setPromotionPending] = useState<{ from: string; to: string } | null>(null);

  // react-chessboard measures its container only once, on mount; if that
  // happens to be 0 (page opened by direct link before layout settles) it
  // never draws anything. Measure ourselves and hand it the width.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize(Math.round(el.getBoundingClientRect().width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  const chess = useMemo(() => {
    const c = new Chess();
    try { c.load(fen); } catch { /* masked FEN can be odd */ }
    return c;
  }, [fen]);

  const orientation = yourColor === 'b' ? 'black' : 'white';

  // Index legal moves: from → options
  const movesFrom = useMemo(() => {
    const map = new Map<string, MoveOption[]>();
    for (const m of legalMoves) {
      if (!map.has(m.from)) map.set(m.from, []);
      map.get(m.from)!.push(m);
    }
    return map;
  }, [legalMoves]);

  // Drop the selection when it stops making sense (turn passed, piece moved)
  useEffect(() => {
    if (selected && (!canInteract || !movesFrom.has(selected))) setSelected(null);
  }, [selected, canInteract, movesFrom]);

  const hintStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (!selected || !canInteract || targetMode) return styles;
    for (const m of movesFrom.get(selected) ?? []) {
      const s = KIND_STYLE[m.kind];
      styles[m.to] = { ...(m.capture ? s.capture : s.empty), borderRadius: 0 };
    }
    for (const sq of selectionExtras?.[selected] ?? []) {
      if (!styles[sq]) styles[sq] = { boxShadow: 'inset 0 0 0 2px rgba(249,115,22,0.5)' };
    }
    return styles;
  }, [selected, canInteract, targetMode, movesFrom, selectionExtras]);

  const movableStyles = useMemo(() => {
    // Subtle ring on pieces that may move: with restrictions (extra move, stun) this
    // is what tells the player which piece the game is waiting for.
    const styles: Record<string, CSSProperties> = {};
    if (!canInteract || targetMode || selected) return styles;
    if (movesFrom.size <= 2) {
      for (const from of movesFrom.keys()) {
        styles[from] = { boxShadow: 'inset 0 0 0 3px rgba(52,211,153,0.9)' };
      }
    }
    return styles;
  }, [canInteract, targetMode, selected, movesFrom]);

  const candidateStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (!targetMode?.candidates) return styles;
    for (const sq of targetMode.candidates) {
      styles[sq] = { background: 'rgba(234,179,8,0.45)', boxShadow: 'inset 0 0 0 2px rgba(234,179,8,0.95)' };
    }
    return styles;
  }, [targetMode]);

  const customSquareStyles: Record<string, CSSProperties> = {
    ...(lastMove ? {
      [lastMove.from]: { background: 'rgba(255, 255, 0, 0.22)' },
      [lastMove.to]: { background: 'rgba(255, 255, 0, 0.30)' },
    } : {}),
    ...(checkSquare ? { [checkSquare]: { background: 'radial-gradient(circle, rgba(239,68,68,0.85) 20%, rgba(239,68,68,0.35) 70%, transparent 100%)' } } : {}),
    ...(squareStyles || {}),
    ...movableStyles,
    ...hintStyles,
    ...(selected ? { [selected]: { background: 'rgba(20, 180, 100, 0.45)' } } : {}),
    ...candidateStyles,
  };

  function tryMove(from: string, to: string): boolean {
    const opt = (movesFrom.get(from) ?? []).find(m => m.to === to);
    if (!opt) return false;
    const piece = chess.get(from as any);
    const isPromo = opt.kind === 'normal' && piece?.type === 'p' && (to[1] === '8' || to[1] === '1');
    if (isPromo) { setPromotionPending({ from, to }); setSelected(null); return false; }
    onMove(from, to);
    setSelected(null);
    return true;
  }

  function onSquareClick(square: string) {
    if (targetMode) {
      if (targetMode.candidates && !targetMode.candidates.includes(square)) return;
      targetMode.onSelect(square);
      return;
    }
    if (!canInteract) return;

    if (selected === square) { setSelected(null); return; }
    if (selected && tryMove(selected, square)) return;

    // Select a piece that can move; clicking anything else clears
    setSelected(movesFrom.has(square) ? square : null);
  }

  function onPieceDrop(from: string, to: string): boolean {
    if (!canInteract || targetMode) return false;
    return tryMove(from, to);
  }

  function handlePromotion(piece: string) {
    if (!promotionPending) return;
    onMove(promotionPending.from, promotionPending.to, piece);
    setPromotionPending(null);
  }

  const fogSet = useMemo(() => new Set(fogCoverSquares ?? []), [fogCoverSquares]);

  return (
    <div ref={wrapRef} className="relative" style={{ width: 'min(480px, 90vw)', height: 'min(480px, 90vw)' }}>
      <Chessboard
        id="chess-board"
        boardWidth={size || 480}
        position={fen}
        onSquareClick={onSquareClick}
        onPieceDrop={onPieceDrop}
        boardOrientation={orientation}
        customSquareStyles={customSquareStyles}
        customBoardStyle={{ borderRadius: '0px', boxShadow: 'none' }}
        customDarkSquareStyle={{ backgroundColor: '#769656' }}
        customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
        arePiecesDraggable={canInteract && !targetMode}
        isDraggablePiece={({ sourceSquare }) => movesFrom.has(sourceSquare)}
        customArrows={lastMove ? [[lastMove.from as never, lastMove.to as never, 'rgba(250, 204, 21, 0.8)']] : []}
        animationDuration={animationDuration}
        customDropSquareStyle={{ boxShadow: 'inset 0 0 1px 4px rgba(255,255,255,0.6)' }}
      />

      {/* Fog: every square always mounted so the cover can fade instead of popping */}
      {fogCoverSquares && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 4 }}>
          {ALL_SQUARES.map((sq) => {
            const { left, top } = sqToPercent(sq, orientation);
            const file = sq.charCodeAt(0) - 97;
            const rank = parseInt(sq[1]) - 1;
            const isDark = (file + rank) % 2 === 0;
            const hidden = fogSet.has(sq);
            return (
              <div
                key={`fog-${sq}`}
                className="fog-square"
                style={{
                  position: 'absolute', left: `${left}%`, top: `${top}%`, width: '12.5%', height: '12.5%',
                  background: isDark ? '#4a5f3a' : '#5c5f4f',
                  opacity: hidden ? 1 : 0,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Loot boxes: centred, gently pulsing */}
      {centerIcons && Object.keys(centerIcons).length > 0 && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
          {Object.entries(centerIcons).map(([sq, icon]) => {
            const { left, top } = sqToPercent(sq, orientation);
            return (
              <div key={`c-${sq}`} className="loot-box" style={{ position: 'absolute', left: `${left}%`, top: `${top}%`, width: '12.5%', height: '12.5%' }}>
                {icon}
              </div>
            );
          })}
        </div>
      )}

      {/* Effect badges: small pill in the corner so the piece stays readable */}
      {badges && Object.keys(badges).length > 0 && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
          {Object.entries(badges).map(([sq, b]) => {
            const { left, top } = sqToPercent(sq, orientation);
            return (
              <div key={`b-${sq}`} title={b.title} style={{ position: 'absolute', left: `${left}%`, top: `${top}%`, width: '12.5%', height: '12.5%' }}>
                <div className="effect-badge" style={{ background: TONE_BG[b.tone] }}>
                  <span>{b.icon}</span>
                  {b.count ? <span className="effect-badge-count">{b.count}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* One-shot bursts: box opened, shield absorbed, bomb… */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 7 }}>
        <AnimatePresence>
          {(flashes ?? []).map((f) => {
            const { left, top } = sqToPercent(f.sq, orientation);
            const color = f.tone === 'buff' ? '#34d399' : f.tone === 'debuff' ? '#f87171' : '#e2e8f0';
            return (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, scale: 0.3 }}
                animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.35, 1.2, 1.6] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.3, times: [0, 0.2, 0.7, 1], ease: 'easeOut' }}
                style={{
                  position: 'absolute', left: `${left}%`, top: `${top}%`, width: '12.5%', height: '12.5%',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'clamp(1.2rem, 5vw, 2.2rem)', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.9))',
                }}
              >
                <span>{f.icon}</span>
                {f.label && (
                  <span style={{ fontSize: '0.55rem', fontWeight: 700, color, whiteSpace: 'nowrap', textShadow: '0 1px 3px #000' }}>
                    {f.label}
                  </span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {targetMode && (
        <div className="absolute inset-0" style={{ zIndex: 6, cursor: 'crosshair', pointerEvents: 'none' }} />
      )}

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
                  {promotionPieceChar(p, yourColor ?? 'w')}
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
