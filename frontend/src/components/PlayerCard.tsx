import { motion } from 'framer-motion';
import type { PlayerInfo } from '../types';
import { PIECE_GLYPH } from '../effects';

interface Props {
  player?: PlayerInfo;
  isOpponent: boolean;
  isActive: boolean;
  /** pieces this player has taken */
  captured: string[];
  /** material lead of this player (negative = behind) */
  advantage: number;
}

export default function PlayerCard({ player, isOpponent, isActive, captured, advantage }: Props) {
  return (
    <div className={`w-full lg:w-auto flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 ${isActive ? 'bg-slate-700/50 ring-1 ring-emerald-500/50' : 'bg-slate-800/30'}`}
      style={{ minWidth: 'min(480px, 90vw)' }}
    >
      <div className={`w-8 h-8 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-sm ${player?.color === 'w' ? 'bg-white border-slate-300 text-slate-800' : 'bg-slate-900 border-slate-600 text-white'}`}>
        {player?.color === 'w' ? '♔' : '♚'}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {player ? (
            <>
              <span className="text-sm font-semibold text-white truncate">{player.name}</span>
              <span className={`status-dot flex-shrink-0 ${player.connected ? 'online' : 'offline'}`} title={player.connected ? 'онлайн' : 'відключився'} />
            </>
          ) : (
            <span className="text-sm text-slate-500 animate-pulse2">Очікування...</span>
          )}
          {isActive && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-1 flex-shrink-0">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </motion.div>
          )}
        </div>
        {captured.length > 0 && (
          <div className="flex items-center gap-0.5 mt-0.5">
            <span className="text-xs text-slate-400 leading-none">{captured.map(p => PIECE_GLYPH[p]).join('')}</span>
            {advantage > 0 && <span className="text-xs text-emerald-400 font-medium ml-1">+{advantage}</span>}
          </div>
        )}
      </div>

      <span className="text-xs text-slate-500 flex-shrink-0">
        {isOpponent ? 'Суперник' : 'Ви'}
      </span>
    </div>
  );
}
