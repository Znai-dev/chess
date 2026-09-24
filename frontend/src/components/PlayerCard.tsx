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
    <div className={`player-card${isActive ? ' active' : ''}`}>
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
          {/* always in the flow: appearing on your turn would nudge the row */}
          <span className={`turn-dot${isActive ? ' on' : ''}`} />
        </div>
        {/* always rendered: appearing later would nudge the board down */}
        <div className="flex items-center gap-0.5 h-4">
          <span className="text-xs text-slate-400 leading-none truncate">{captured.map(p => PIECE_GLYPH[p]).join('')}</span>
          {advantage > 0 && <span className="text-xs text-emerald-400 font-medium ml-1">+{advantage}</span>}
        </div>
      </div>

      <span className="text-xs text-slate-500 flex-shrink-0">
        {isOpponent ? 'Суперник' : 'Ви'}
      </span>
    </div>
  );
}
