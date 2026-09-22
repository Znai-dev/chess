import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Color, MoveOption, ExpandClientData } from '../types';
import type { Flash } from './ChessBoard';

/**
 * Board renderer for the expansion mode. react-chessboard is 8x8 only, so the
 * growing 4x4..20x20 map is drawn here: a CSS grid whose cell size comes from
 * one custom property, so the whole thing scales as the map opens up.
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
const GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const TERRAIN_GLYPH: Record<string, string> = { wall: '⛰', portal: '🌀', treasure: '💎' };
const TERRAIN_TITLE: Record<string, string> = {
  wall: 'Гора — непрохідна, перекриває промінь фігур',
  portal: 'Портал — переносить на парну клітинку на іншому боці карти',
  treasure: 'Скарб — підвищує фігуру на ранг',
};

const LIGHT = [233, 229, 206] as const;
const DARK = [112, 138, 91] as const;

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function mix(a: readonly [number, number, number], b: [number, number, number], t: number): string {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
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

  // Each zone gets its own tint, so the map reads as regions rather than one green field.
  const zoneColors = useMemo(
    () => data.zones.map(z => hexToRgb(z.tint)),
    [data.zones],
  );

  const cells = useMemo(() => {
    const flip = yourColor === 'b';
    const rows: string[][] = [];
    for (let i = 0; i < size; i++) {
      const y = flip ? min + i : max - i;
      const row: string[] = [];
      for (let j = 0; j < size; j++) {
        const x = flip ? max - j : min + j;
        row.push(FILES[x] + (y + 1));
      }
      rows.push(row);
    }
    return rows.flat();
  }, [min, max, size, yourColor]);

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

  const showLabels = size <= 12;
  // Ringing every movable piece is noise on a 400-square map; only useful when
  // the choice is already narrow.
  const showMovable = movesFrom.size <= 3;

  return (
    <div
      className="big-board"
      style={{
        ['--cells' as string]: String(size),
        gridTemplateColumns: `repeat(${size}, 1fr)`,
      }}
    >
      {cells.map((sq) => {
        const x = FILES.indexOf(sq[0]);
        const y = parseInt(sq.slice(1), 10) - 1;
        const zoneIdx = data.zone[sq] ?? 0;
        const tint = zoneColors[Math.min(zoneIdx, zoneColors.length - 1)] ?? hexToRgb('#4a7c59');
        const dark = (x + y) % 2 === 0;
        const bg = mix(dark ? DARK : LIGHT, tint, dark ? 0.45 : 0.22);

        const code = data.board[sq];
        const terrain = data.terrain[sq];
        const target = targets.get(sq);
        const isSelected = selected === sq;
        const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
        const isCheck = data.checkSq === sq;
        const movable = showMovable && canInteract && !selected && movesFrom.has(sq);

        return (
          <div
            key={sq}
            className={`bb-cell${terrain?.type === 'wall' ? ' bb-wall' : ''}`}
            data-sq={sq}
            data-zone={zoneIdx}
            style={{ background: bg }}
            onClick={() => handleClick(sq)}
            title={terrain ? TERRAIN_TITLE[terrain.type] : sq}
          >
            {isLast && <div className="bb-last" />}
            {isCheck && <div className="bb-check" />}
            {isSelected && <div className="bb-selected" />}
            {movable && <div className="bb-movable" />}

            {terrain && !code && (
              <span className={`bb-terrain bb-terrain-${terrain.type}`}>{TERRAIN_GLYPH[terrain.type]}</span>
            )}
            {terrain && code && <span className="bb-terrain-corner">{TERRAIN_GLYPH[terrain.type]}</span>}

            {code && (
              <span className={`bb-piece ${code[0] === 'w' ? 'bb-white' : 'bb-black'}`}>
                {GLYPH[code[1]]}
              </span>
            )}

            {target && <div className={target.capture ? 'bb-capture' : `bb-dot${target.kind === 'teleport' ? ' bb-dot-portal' : ''}`} />}

            {showLabels && y === min && <span className="bb-label bb-label-file">{sq[0]}</span>}
            {showLabels && x === min && <span className="bb-label bb-label-rank">{y + 1}</span>}
          </div>
        );
      })}

      <AnimatePresence>
        {(flashes ?? []).map((f) => {
          const idx = cells.indexOf(f.sq);
          if (idx < 0) return null;
          const col = idx % size, row = Math.floor(idx / size);
          return (
            <motion.div
              key={f.id}
              className="bb-flash"
              style={{ left: `${(col / size) * 100}%`, top: `${(row / size) * 100}%`, width: `${100 / size}%`, height: `${100 / size}%` }}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.4, 1.2, 1.7] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.3, times: [0, 0.2, 0.7, 1], ease: 'easeOut' }}
            >
              <span>{f.icon}</span>
              {f.label && <span className="bb-flash-label">{f.label}</span>}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
