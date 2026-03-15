import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Color, MoveVerbose, PlayerInfo } from '../types';

interface Props {
  player?: PlayerInfo;
  isOpponent: boolean;
  isActive: boolean;
  capturedBy?: Color | null;
  history: MoveVerbose[];
}

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const PIECE_CHARS: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };

export default function PlayerCard({ player, isOpponent, isActive, capturedBy, history }: Props) {
  const captured = useMemo(() => {
    if (!capturedBy) return { pieces: [], advantage: 0 };
    const counts: Record<string, number> = {};
    const oppCounts: Record<string, number> = {};

    history.forEach((m) => {
      if (m.captured) {
        // The capturing color gets the piece
        if (m.color !== capturedBy) {
          counts[m.captured] = (counts[m.captured] ?? 0) + 1;
        } else {
          oppCounts[m.captured] = (oppCounts[m.captured] ?? 0) + 1;
        }
      }
    });

    const pieces: string[] = [];
    let advantage = 0;
    Object.entries(counts).forEach(([p, n]) => {
      for (let i = 0; i < n; i++) pieces.push(PIECE_CHARS[p]);
      advantage += PIECE_VALUES[p] * n;
    });
    Object.entries(oppCounts).forEach(([p, n]) => {
      advantage -= PIECE_VALUES[p] * n;
    });

    return { pieces, advantage };
  }, [history, capturedBy]);

  return (
    <div className={`w-full lg:w-auto flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 ${isActive ? 'bg-slate-700/50 ring-1 ring-emerald-500/40' : 'bg-slate-800/30'}`}
      style={{ minWidth: 'min(480px, 90vw)' }}
    >
      {/* Color indicator */}
      <div className={`w-8 h-8 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-sm ${player?.color === 'w' ? 'bg-white border-slate-300 text-slate-800' : 'bg-slate-900 border-slate-600 text-white'}`}>
        {player?.color === 'w' ? '♔' : '♚'}
      </div>

      {/* Name + status */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {player ? (
            <>
              <span className="text-sm font-semibold text-white truncate">{player.name}</span>
              <span className={`status-dot flex-shrink-0 ${player.connected ? 'online' : 'offline'}`} />
            </>
          ) : (
            <span className="text-sm text-slate-500 animate-pulse2">Очікування...</span>
          )}
          {isActive && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="ml-1 flex-shrink-0"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </motion.div>
          )}
        </div>
        {/* Captured pieces */}
        {captured.pieces.length > 0 && (
          <div className="flex items-center gap-0.5 mt-0.5">
            <span className="text-xs text-slate-400 leading-none">{captured.pieces.join('')}</span>
            {captured.advantage > 0 && (
              <span className="text-xs text-emerald-400 font-medium ml-1">+{captured.advantage}</span>
            )}
          </div>
        )}
      </div>

      {/* Role label */}
      <span className="text-xs text-slate-500 flex-shrink-0">
        {isOpponent ? 'Суперник' : 'Ви'}
      </span>
    </div>
  );
}
