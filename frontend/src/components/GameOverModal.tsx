import { motion } from 'framer-motion';
import type { Color, GameOverEvent, PlayerInfo } from '../types';

interface Props {
  event: GameOverEvent;
  yourColor: Color | null;
  players: PlayerInfo[];
  onRematch: () => void;
  onHome: () => void;
  onReplay: () => void;
}

const REASON_LABELS: Record<string, string> = {
  checkmate: 'Мат',
  stalemate: 'Пат',
  resign: 'Здача',
  'draw-agreement': 'Нічия за домовленістю',
  'insufficient-material': 'Недостатньо матеріалу',
  'threefold-repetition': 'Троєкратне повторення',
  draw: 'Нічия',
};

export default function GameOverModal({ event, yourColor, players, onRematch, onHome, onReplay }: Props) {
  const isDraw = event.winner === null;
  const iWon = !isDraw && event.winner === yourColor;
  const isSpectator = yourColor === null;

  const winner = event.winner ? players.find((p) => p.color === event.winner) : null;

  let headline = '';
  let emoji = '';
  let headlineColor = '';

  if (isDraw) {
    headline = 'Нічия!';
    emoji = '🤝';
    headlineColor = 'text-slate-300';
  } else if (isSpectator) {
    headline = `${winner?.name ?? (event.winner === 'w' ? 'Білі' : 'Чорні')} перемогли!`;
    emoji = '🏆';
    headlineColor = 'text-amber-400';
  } else if (iWon) {
    headline = 'Ви перемогли!';
    emoji = '🏆';
    headlineColor = 'text-amber-400';
  } else {
    headline = 'Ви програли';
    emoji = '💀';
    headlineColor = 'text-slate-400';
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 30 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        className="glass rounded-3xl p-8 max-w-sm w-full text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', damping: 12 }}
          className="text-6xl mb-4"
        >
          {emoji}
        </motion.div>

        <h2 className={`text-2xl font-bold mb-2 ${headlineColor}`}>{headline}</h2>
        <p className="text-slate-400 text-sm mb-6">{REASON_LABELS[event.reason] ?? event.reason}</p>

        {/* Players recap */}
        {players.length === 2 && (
          <div className="flex items-center justify-center gap-4 mb-6 py-3 px-4 bg-slate-800/50 rounded-xl">
            {players.map((p) => (
              <div key={p.color} className="flex flex-col items-center gap-1">
                <span className="text-xl">{p.color === 'w' ? '♔' : '♚'}</span>
                <span className="text-xs text-slate-300 font-medium">{p.name}</span>
                {event.winner === p.color && <span className="text-xs text-amber-400">Переможець</span>}
                {isDraw && <span className="text-xs text-slate-500">Нічия</span>}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button onClick={onReplay} className="btn-secondary w-full">
            ▶ Переглянути партію
          </button>
          {!isSpectator && (
            <button onClick={onRematch} className="btn-primary w-full">
              🔄 Реванш
            </button>
          )}
          <button onClick={onHome} className="btn-secondary w-full">
            🏠 На головну
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
