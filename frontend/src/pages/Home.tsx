import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import type { GameMode } from '../types';
import { BASE } from '../base';

const MODES: { id: GameMode; icon: string; title: string; desc: string }[] = [
  { id: 'classic',  icon: '♟',  title: 'Класичні шахи',  desc: 'Стандартні правила без змін' },
  { id: 'lootbox',  icon: '📦', title: 'Лутбокси',        desc: 'Збирай скрині для бафів та дебафів' },
  { id: 'fog',      icon: '🌫️', title: 'Туман війни',     desc: 'Обмежена видимість поля бою' },
  { id: 'magic',    icon: '✨', title: 'Магічні шахи',    desc: 'Заклинання та магічні клітинки' },
];

const ADJECTIVES = [
  'Лютий', 'Сонний', 'Голодний', 'Шалений', 'Мудрий', 'Хитрий', 'Дикий', 'Ледачий',
  'Гучний', 'Тихий', 'Смілий', 'Рандомний', 'Космічний', 'Бойовий', 'Пухнастий',
  'Залізний', 'Мокрий', 'Розлючений', 'Веселий', 'Сердитий', 'Загадковий', 'Безстрашний',
];

const NOUNS = [
  'Бобер', 'Гусак', 'Кабан', 'Хом\'як', 'Єнот', 'Тигр', 'Їжак', 'Пінгвін',
  'Дракон', 'Кіт', 'Собака', 'Папуга', 'Краб', 'Жираф', 'Пінгвін', 'Мамонт',
  'Огірок', 'Ведмідь', 'Лось', 'Акула', 'Скунс', 'Лінивець', 'Страус',
];

function randomName() {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

export default function Home() {
  const [name, setName]       = useState(randomName);
  const [mode, setMode]       = useState<GameMode>('classic');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function createGame() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const { roomId } = await res.json();
      sessionStorage.setItem('playerName', name);
      navigate(`/game/${roomId}`);
    } catch {
      toast.error('Не вдалося створити гру');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
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
          <p className="text-slate-400 text-sm">Запроси друга та зіграй партію</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="glass rounded-2xl p-6"
        >
          {/* Random name badge */}
          <div className="flex items-center justify-between mb-5 px-1">
            <span className="text-slate-400 text-sm">Ваше ім'я:</span>
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold text-sm">{name}</span>
              <button
                onClick={() => setName(randomName())}
                title="Нове ім'я"
                className="text-slate-400 hover:text-indigo-400 transition-colors text-base leading-none"
              >
                🎲
              </button>
            </div>
          </div>

          {/* Mode grid */}
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
            ) : `${MODES.find(m => m.id === mode)?.icon} Створити гру`}
          </button>
        </motion.div>
      </div>
    </div>
  );
}
