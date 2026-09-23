import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import type { GameMode } from '../types';
import { BASE } from '../base';
import { playerName } from '../names';

const MODES: { id: GameMode; icon: string; title: string; desc: string }[] = [
  { id: 'expand',   icon: '🗺️', title: 'Експансія',      desc: 'Карта росте з 4×4 до 20×20' },
  { id: 'lootbox',  icon: '📦', title: 'Лутбокси',        desc: 'Скрині: лють, бомби, телепорт, щити…' },
  { id: 'fog',      icon: '🌫️', title: 'Туман війни',     desc: 'Обмежена видимість поля бою' },
  { id: 'magic',    icon: '✨', title: 'Магічні шахи',    desc: 'Заклинання та магічні клітинки' },
];

type Opponent = 'friend' | 'easy' | 'medium' | 'hard';

const OPPONENTS: { id: Opponent; icon: string; label: string; hint: string }[] = [
  { id: 'friend', icon: '👤', label: 'Друг',     hint: 'Створить посилання, яке треба надіслати другу' },
  { id: 'easy',   icon: '🙂', label: 'Легкий',   hint: 'Ходить майже навмання — щоб розібратися в правилах' },
  { id: 'medium', icon: '🤖', label: 'Середній', hint: 'Бере все, що погано лежить, але не думає про відповідь' },
  { id: 'hard',   icon: '🔥', label: 'Складний', hint: 'Рахує вашу відповідь на свій хід і не підставляє фігури' },
];

export default function Home() {
  const [mode, setMode]         = useState<GameMode>('expand');
  const [opponent, setOpponent] = useState<Opponent>('friend');
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

  const vsBot = opponent !== 'friend';

  async function createGame() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, bot: vsBot ? opponent : undefined }),
      });
      const { roomId } = await res.json();
      playerName();   // settle on a name now so the game page never has to ask
      navigate(`/game/${roomId}`);
    } catch {
      toast.error('Не вдалося створити гру');
    } finally {
      setLoading(false);
    }
  }

  const modeIcon = MODES.find(m => m.id === mode)?.icon ?? '♟';

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <div className="text-7xl mb-3 select-none">♟</div>
          <h1 className="text-4xl font-bold tracking-tight text-white mb-1">
            Chess <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">Online</span>
          </h1>
          <p className="text-slate-400 text-sm">Зіграй з ботом або запроси друга</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="glass rounded-2xl p-6"
        >
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Режим</p>
          <div className="grid grid-cols-2 gap-3 mb-5">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`rounded-xl p-3 text-left transition-all border-2 ${
                  mode === m.id
                    ? 'border-indigo-500 bg-indigo-500/20'
                    : 'border-slate-700/60 bg-slate-800/40 hover:border-slate-600 hover:bg-slate-700/40'
                }`}
              >
                <div className="text-2xl mb-1">{m.icon}</div>
                <div className="text-white text-xs font-semibold leading-tight">{m.title}</div>
                <div className="text-slate-400 text-xs mt-0.5 leading-tight">{m.desc}</div>
              </button>
            ))}
          </div>

          <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Суперник</p>
          <div className="grid grid-cols-4 gap-2 mb-2">
            {OPPONENTS.map((o) => (
              <button
                key={o.id}
                onClick={() => setOpponent(o.id)}
                className={`rounded-xl py-2 px-1 transition-all border-2 ${
                  opponent === o.id
                    ? 'border-indigo-500 bg-indigo-500/20'
                    : 'border-slate-700/60 bg-slate-800/40 hover:border-slate-600 hover:bg-slate-700/40'
                }`}
              >
                <div className="text-xl leading-none mb-1">{o.icon}</div>
                <div className="text-white text-[11px] font-medium leading-tight">{o.label}</div>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 leading-snug mb-5 min-h-[2.2em]">
            {OPPONENTS.find(o => o.id === opponent)?.hint}
          </p>

          <button
            onClick={createGame}
            disabled={loading}
            className="btn-primary w-full text-base disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Створення...
              </span>
            ) : vsBot ? `${modeIcon} Грати проти бота` : `${modeIcon} Створити гру`}
          </button>
        </motion.div>
      </div>
    </div>
  );
}
