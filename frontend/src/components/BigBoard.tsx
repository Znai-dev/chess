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
  /** zone index to spotlight; every other ring is dimmed */
  highlightZone?: number | null;
}

const FILES = 'abcdefghijklmnopqrst';

// Same walnut squares as the 8x8 boards, so every mode feels like one set.
const LIGHT = [240, 217, 181] as const;
const DARK = [181, 136, 99] as const;

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

function Wall() {
  return (
    <span className="bb-art bb-wall-art" aria-hidden>
      <svg viewBox="0 0 24 24">
        <rect x="1.5" y="4" width="9.5" height="6" rx="1.2" />
        <rect x="13" y="4" width="9.5" height="6" rx="1.2" />
        <rect x="1.5" y="11.5" width="6" height="6" rx="1.2" />
        <rect x="9.5" y="11.5" width="13" height="6" rx="1.2" />
      </svg>
    </span>
  );
}

/** Each portal pair gets its own hue, so both ends of a jump are obvious. */
const PORTAL_HUES = [276, 190, 30, 330, 140, 210, 58, 0, 95, 250];
export const portalColor = (pairId = 0): string =>
  `hsl(${PORTAL_HUES[pairId % PORTAL_HUES.length]}, 85%, 62%)`;

function Portal({ pairId }: { pairId?: number }) {
  const color = portalColor(pairId);
  return (
    <span className="bb-art bb-portal-art" aria-hidden>
      <svg viewBox="0 0 24 24">
        <circle className="bb-portal-ring" cx="12" cy="12" r="8.2" style={{ stroke: color }} />
        <circle className="bb-portal-core" cx="12" cy="12" r="3.4" style={{ fill: color }} />
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
  data, yourColor, canInteract, legalMoves, onMove, lastMove, flashes, highlightZone,
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

  /** Where the portals under the current move hints would spit you out. */
  const portalExits = useMemo(() => {
    const out = new Map<string, string>();
    for (const [to, opt] of targets) {
      if (opt.kind !== 'teleport') continue;
      const cell = data.terrain[to];
      if (cell?.pair) out.set(cell.pair, portalColor(cell.pairId));
    }
    return out;
  }, [targets, data.terrain]);

  /** The last move drawn as an arrow — a tinted square alone is too easy to miss. */
  const arrow = useMemo(() => {
    if (!lastMove) return null;
    const a = flatIndex.get(lastMove.from);
    const b = flatIndex.get(lastMove.to);
    if (a === undefined || b === undefined || a === b) return null;
    const cell = 100 / size;
    const at = (i: number) => ({ x: (i % size + 0.5) * cell, y: (Math.floor(i / size) + 0.5) * cell });
    const from = at(a), to = at(b);
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const head = Math.min(cell * 0.5, len * 0.45);
    const tip = { x: to.x - ux * cell * 0.1, y: to.y - uy * cell * 0.1 };
    const base = { x: tip.x - ux * head, y: tip.y - uy * head };
    const wing = head * 0.45;
    return {
      x1: from.x, y1: from.y, x2: base.x, y2: base.y,
      head: `${tip.x},${tip.y} ${base.x - uy * wing},${base.y + ux * wing} ${base.x + uy * wing},${base.y - ux * wing}`,
      width: Math.max(cell * 0.11, 0.35),
    };
  }, [lastMove, flatIndex, size]);

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
          const bg = mix(isDark ? DARK : LIGHT, tint, isDark ? 0.3 : 0.14);

          // A hairline where two zones meet, so the rings read as borders on a map.
          const edges: string[] = [];
          const zoneAt = (rr: number, cc: number) => {
            const other = rows[rr]?.[cc];
            return other ? (data.zone[other.sq] ?? 0) : zoneIdx;
          };
          if (zoneAt(r - 1, c) !== zoneIdx) edges.push('inset 0 1px 0 rgba(36,24,12,.45)');
          if (zoneAt(r + 1, c) !== zoneIdx) edges.push('inset 0 -1px 0 rgba(36,24,12,.45)');
          if (zoneAt(r, c - 1) !== zoneIdx) edges.push('inset 1px 0 0 rgba(36,24,12,.45)');
          if (zoneAt(r, c + 1) !== zoneIdx) edges.push('inset -1px 0 0 rgba(36,24,12,.45)');

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
              {highlightZone != null && zoneIdx !== highlightZone && <span className="bb-dim" />}
              {isLast && <span className="bb-last" />}
              {isCheck && <span className="bb-check" />}
              {selected === sq && <span className="bb-selected" />}
              {movable && <span className="bb-movable" />}

              {terrain?.type === 'wall' && <Wall />}
              {terrain?.type === 'portal' && !code && <Portal pairId={terrain.pairId} />}
              {terrain?.type === 'treasure' && !code && <Treasure />}
              {terrain && code && terrain.type !== 'wall' && (
                <span
                  className={`bb-under bb-under-${terrain.type}`}
                  style={terrain.type === 'portal' ? { background: portalColor(terrain.pairId) } : undefined}
                />
              )}
              {portalExits.has(sq) && (
                <span className="bb-exit" style={{ boxShadow: `inset 0 0 0 .08em ${portalExits.get(sq)}` }} />
              )}

              {code && <Piece code={code} />}

              {target && (
                target.kind === 'break'
                  ? <span className="bb-break final" />
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

        {arrow && (
          <svg className="bb-arrow" viewBox="0 0 100 100" aria-hidden>
            <line x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2} strokeWidth={arrow.width} />
            <polygon points={arrow.head} />
          </svg>
        )}

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
