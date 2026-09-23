import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { Color, GameMode, ReplayFrame } from '../types';
import BigBoard from './BigBoard';
import ChessBoard from './ChessBoard';

interface Props {
  frames: ReplayFrame[];
  mode: GameMode;
  yourColor: Color | null;
  onClose: () => void;
}

const STEP_MS = 900;

/** Watch a finished game back move by move — mostly to see how the mate was built. */
export default function ReplayModal({ frames, mode, yourColor, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const last = frames.length - 1;
  const frame = frames[Math.min(index, last)];

  useEffect(() => {
    if (!playing || index >= last) { if (index >= last) setPlaying(false); return; }
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, last)), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, index, last]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { setPlaying(false); setIndex((i) => Math.max(0, i - 1)); }
      if (e.key === 'ArrowRight') { setPlaying(false); setIndex((i) => Math.min(last, i + 1)); }
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last, onClose]);

  useEffect(() => {
    listRef.current?.querySelector('.replay-move.current')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const go = (i: number) => { setPlaying(false); setIndex(Math.max(0, Math.min(last, i))); };

  if (!frame) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ zIndex: 60 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="glass rounded-2xl p-4 w-full max-w-4xl max-h-[95vh] overflow-auto"
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white font-semibold">Реплей партії</h3>
            <p className="text-[11px] text-slate-500">← → перемотка, пробіл — пауза</p>
          </div>
          <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-3">Закрити</button>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex flex-col items-center gap-3 mx-auto">
            <div className="chess-container">
              {mode === 'expand' && frame.expand ? (
                <BigBoard
                  data={frame.expand}
                  yourColor={yourColor}
                  canInteract={false}
                  legalMoves={[]}
                  onMove={() => {}}
                  lastMove={frame.lastMove}
                />
              ) : (
                <ChessBoard
                  fen={frame.fen}
                  yourColor={yourColor}
                  canInteract={false}
                  legalMoves={[]}
                  onMove={() => {}}
                  lastMove={frame.lastMove}
                />
              )}
            </div>

            <div className="flex items-center gap-2 w-full">
              <button onClick={() => go(0)} className="replay-btn" title="На початок">⏮</button>
              <button onClick={() => go(index - 1)} className="replay-btn" title="Назад">◀</button>
              <button
                onClick={() => (index >= last ? go(0) : setPlaying((p) => !p))}
                className="replay-btn wide"
                title="Відтворення"
              >
                {index >= last ? '↻' : playing ? '⏸' : '▶'}
              </button>
              <button onClick={() => go(index + 1)} className="replay-btn" title="Вперед">▶</button>
              <button onClick={() => go(last)} className="replay-btn" title="У кінець">⏭</button>
              <span className="text-xs text-slate-400 ml-1 whitespace-nowrap tabular-nums">
                {index} / {last}
              </span>
            </div>

            <input
              type="range" min={0} max={last} value={Math.min(index, last)}
              onChange={(e) => go(Number(e.target.value))}
              className="replay-range"
            />
          </div>

          <div className="glass rounded-xl p-3 w-full lg:w-56 flex-shrink-0" style={{ maxHeight: 460 }}>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Ходи</p>
            <div ref={listRef} className="overflow-y-auto pr-1" style={{ maxHeight: 400 }}>
              {frames.slice(1).map((f, i) => (
                <button
                  key={i}
                  onClick={() => go(i + 1)}
                  className={`replay-move${index === i + 1 ? ' current' : ''}`}
                >
                  <span className="text-slate-600 w-6 text-right flex-shrink-0">{Math.floor(i / 2) + 1}.</span>
                  <span className={f.color === 'w' ? 'text-slate-100' : 'text-slate-400'}>{f.san}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
