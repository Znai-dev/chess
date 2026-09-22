import { useState, useMemo, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChessboardDnDProvider, SparePiece } from 'react-chessboard';
import type { Color, MoveOption, ExpandClientData } from '../types';
import type { Flash } from './ChessBoard';

/**
 * Board renderer for the expansion mode. react-chessboard is 8x8 only, so the
 * growing 4x4..20x20 map is drawn here — but the pieces are still its own SVG
 * set, so this board looks like every other board in the app.
 */

interface Props {
  data: ExpandClientData;
  yourColor: Color | null;
  canInteract: boolean;
  legalMoves: MoveOption[];
  onMove: (from: string, to: string) => void;
  lastMove?: { from: string; to: string } | null;
  flashes?: Flash[];
}

const FILES = 'abcdefghijklmnopqrst';

// Same squares as the 8x8 boards, so the two modes feel like one game.
const LIGHT = [238, 238, 210] as const;
const DARK = [118, 150, 86] as const;

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function mix(a: readonly [number, number, number], b: [number, number, number], t: number): string {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}

/** The real chess artwork, scaled to the cell by CSS rather than a pixel width. */
const Piece = memo(function Piece({ code }: { code: string }) {
  // the server sends "wp"/"bk"; react-chessboard keys its set as "wP"/"bK"
  const piece = code[0] + code[1].toUpperCase();
  return (
    <span className="bb-piece">
      <SparePiece piece={piece as never} width={45} dndId={`bb-${piece}`} />
    </span>
  );
});

function Wall({ hp }: { hp: number }) {
  const cracked = hp <= 1;
  return (
    <span className={`bb-art bb-wall-art${cracked ? ' cracked' : ''}`} aria-hidden>
      <svg viewBox="0 0 24 24">
        <rect x="1.5" y="4" width="9.5" height="6" rx="1.2" />
        <rect x="13" y="4" width="9.5" height="6" rx="1.2" />
        <rect x="1.5" y="11.5" width="6" height="6" rx="1.2" />
        <rect x="9.5" y="11.5" width="13" height="6" rx="1.2" />
        {cracked && <path className="bb-crack" d="M12 3.2 L10.2 8 L13.4 10.5 L10.8 14 L12.6 18.6" />}
      </svg>
    </span>
  );
}

function Portal() {
  return (
    <span className="bb-art bb-portal-art" aria-hidden>
      <svg viewBox="0 0 24 24">
        <circle className="bb-portal-ring" cx="12" cy="12" r="8.2" />
        <circle className="bb-portal-core" cx="12" cy="12" r="3.4" />
      </svg>
    </span>
  );
}

function Treasure() {
  return (
    <span className="bb-art bb-treasure-art" aria-hidden>
      <svg viewBox="0 0 24 24">
        <path className="bb-gem-body" d="M12 3.5 L20 10 L12 20.5 L4 10 Z" />
        <path className="bb-gem-face" d="M12 3.5 L20 10 L4 10 Z" />
      </svg>
    </span>
  );
}

export default function BigBoard({
  data, yourColor, canInteract, legalMoves, onMove, lastMove, flashes,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const { min, max, size } = data;

  const movesFrom = useMemo(() => {
    const map = new Map<string, MoveOption[]>();
    for (const m of legalMoves) {
      if (!map.has(m.from)) map.set(m.from, []);
      map.get(m.from)!.push(m);
    }
    return map;
  }, [legalMoves]);

  useEffect(() => {
    if (selected && (!canInteract || !movesFrom.has(selected))) setSelected(null);
  }, [selected, canInteract, movesFrom]);

  const targets = useMemo(() => {
    const map = new Map<string, MoveOption>();
    for (const m of movesFrom.get(selected ?? '') ?? []) map.set(m.to, m);
    return map;
  }, [movesFrom, selected]);

  const zoneColors = useMemo(() => data.zones.map(z => hexToRgb(z.tint)), [data.zones]);

  /** Board in display order: rows top→bottom as this player sees them. */
  const rows = useMemo(() => {
    const flip = yourColor === 'b';
    const out: { sq: string; x: number; y: number }[][] = [];
    for (let i = 0; i < size; i++) {
      const y = flip ? min + i : max - i;
      const row: { sq: string; x: number; y: number }[] = [];
      for (let j = 0; j < size; j++) {
        const x = flip ? max - j : min + j;
        row.push({ sq: FILES[x] + (y + 1), x, y });
      }
      out.push(row);
    }
    return out;
  }, [min, max, size, yourColor]);

  const flatIndex = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((row, r) => row.forEach((c, i) => m.set(c.sq, r * size + i)));
    return m;
  }, [rows, size]);

  function handleClick(sq: string) {
    if (!canInteract) return;
    if (selected === sq) { setSelected(null); return; }
    if (selected && targets.has(sq)) {
      onMove(selected, sq);
      setSelected(null);
      return;
    }
    setSelected(movesFrom.has(sq) ? sq : null);
  }

  const showLabels = size <= 14;
  // A ring on every movable piece is noise on a 400-square map.
  const showMovable = movesFrom.size <= 3;

  return (
    <ChessboardDnDProvider>
      <div
        className="big-board"
        style={{ ['--cells' as string]: String(size), gridTemplateColumns: `repeat(${size}, 1fr)` }}
      >
        {rows.map((row, r) => row.map((cell, c) => {
          const { sq, x, y } = cell;
          const zoneIdx = data.zone[sq] ?? 0;
          const tint = zoneColors[Math.min(zoneIdx, zoneColors.length - 1)] ?? hexToRgb('#4a7c59');
          const isDark = (x + y) % 2 === 0;
          const bg = mix(isDark ? DARK : LIGHT, tint, isDark ? 0.34 : 0.16);

          // A hairline where two zones meet, so the rings read as borders on a map.
          const edges: string[] = [];
          const zoneAt = (rr: number, cc: number) => {
            const other = rows[rr]?.[cc];
            return other ? (data.zone[other.sq] ?? 0) : zoneIdx;
          };
          if (zoneAt(r - 1, c) !== zoneIdx) edges.push('inset 0 1px 0 rgba(12,20,12,.45)');
          if (zoneAt(r + 1, c) !== zoneIdx) edges.push('inset 0 -1px 0 rgba(12,20,12,.45)');
          if (zoneAt(r, c - 1) !== zoneIdx) edges.push('inset 1px 0 0 rgba(12,20,12,.45)');
          if (zoneAt(r, c + 1) !== zoneIdx) edges.push('inset -1px 0 0 rgba(12,20,12,.45)');

          const code = data.board[sq];
          const terrain = data.terrain[sq];
          const target = targets.get(sq);
          const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
          const isCheck = data.checkSq === sq;
          const movable = showMovable && canInteract && !selected && movesFrom.has(sq);

          return (
            <div
              key={sq}
              className="bb-cell"
              data-sq={sq}
              style={{ background: bg, boxShadow: edges.join(', ') || undefined }}
              onClick={() => handleClick(sq)}
            >
              {isLast && <span className="bb-last" />}
              {isCheck && <span className="bb-check" />}
              {selected === sq && <span className="bb-selected" />}
              {movable && <span className="bb-movable" />}

              {terrain?.type === 'wall' && <Wall hp={terrain.hp ?? 2} />}
              {terrain?.type === 'portal' && !code && <Portal />}
              {terrain?.type === 'treasure' && !code && <Treasure />}
              {terrain && code && terrain.type !== 'wall' && (
                <span className={`bb-under bb-under-${terrain.type}`} />
              )}

              {code && <Piece code={code} />}

              {target && (
                target.kind === 'break'
                  ? <span className={`bb-break${(terrain?.hp ?? 2) <= 1 ? ' final' : ''}`} />
                  : target.capture
                    ? <span className="bb-capture" />
                    : <span className={`bb-dot${target.kind === 'teleport' ? ' portal' : ''}`} />
              )}

              {showLabels && c === 0 && (
                <span className={`bb-label bb-label-rank ${isDark ? 'on-dark' : 'on-light'}`}>{y + 1}</span>
              )}
              {showLabels && r === size - 1 && (
                <span className={`bb-label bb-label-file ${isDark ? 'on-dark' : 'on-light'}`}>{FILES[x]}</span>
              )}
            </div>
          );
        }))}

        <AnimatePresence>
          {(flashes ?? []).map((f) => {
            const idx = flatIndex.get(f.sq);
            if (idx === undefined) return null;
            const col = idx % size, row = Math.floor(idx / size);
            return (
              <motion.div
                key={f.id}
                className="bb-flash"
                style={{ left: `${(col / size) * 100}%`, top: `${(row / size) * 100}%`, width: `${100 / size}%`, height: `${100 / size}%` }}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.35, 1.15, 1.6] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.2, times: [0, 0.2, 0.7, 1], ease: 'easeOut' }}
              >
                <span>{f.icon}</span>
                {f.label && <span className="bb-flash-label">{f.label}</span>}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ChessboardDnDProvider>
  );
}
