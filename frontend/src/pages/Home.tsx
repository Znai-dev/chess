import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import type { GameMode } from '../types';
import { BASE } from '../base';
import { playerName } from '../names';

const MODES: { id: GameMode; icon: string; title: string; desc: string }[] = [
  { id: 'expand',  icon: '🗺️', title: 'Експансія',    desc: 'Карта росте з 4×4 до 20×20' },
  { id: 'lootbox', icon: '📦', title: 'Лутбокси',      desc: 'Скрині: лють, бомби, телепорт' },
  { id: 'fog',     icon: '🌫️', title: 'Туман війни',   desc: 'Видно лише те, що під ударом' },
  { id: 'magic',   icon: '✨', title: 'Магічні шахи',  desc: 'Заклинання та магічні клітинки' },
];

type Opponent = 'friend' | 'easy' | 'medium' | 'hard';

const OPPONENTS: { id: Opponent; label: string; hint: string }[] = [
  { id: 'friend', label: 'Друг',     hint: 'Створить посилання, яке треба надіслати другу' },
  { id: 'easy',   label: 'Легкий',   hint: 'Бот ходить майже навмання — щоб розібратися в правилах' },
  { id: 'medium', label: 'Середній', hint: 'Бот бере все, що погано лежить, але не думає про відповідь' },
  { id: 'hard',   label: 'Складний', hint: 'Бот рахує вашу відповідь на хід і не підставляє фігури' },
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

  return (
    <div className="min-h-screen flex items-center justify-center p-4 py-8">
      <div className="w-full max-w-md fade-in">
        <header className="text-center mb-7">
          <div className="home-crown" aria-hidden>♞</div>
          <h1 className="home-title">
            Chess <span className="brass">Online</span>
          </h1>
          <p className="home-sub">Зіграй з ботом або запроси друга</p>
        </header>

        <div className="glass rounded-2xl p-5 sm:p-6">
          <p className="rule mb-2.5">Режим</p>
          <div className="grid grid-cols-2 gap-2.5 mb-5">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`pick-card${mode === m.id ? ' on' : ''}`}
              >
                <span className="pick-icon">{m.icon}</span>
                <span className="pick-title">{m.title}</span>
                <span className="pick-desc">{m.desc}</span>
              </button>
            ))}
          </div>

          <p className="rule mb-2.5">Суперник</p>
          <div className="grid grid-cols-4 gap-2 mb-2">
            {OPPONENTS.map((o) => (
              <button
                key={o.id}
                onClick={() => setOpponent(o.id)}
                className={`pick-chip${opponent === o.id ? ' on' : ''}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="pick-hint">{OPPONENTS.find(o => o.id === opponent)?.hint}</p>

          <button onClick={createGame} disabled={loading} className="btn-primary w-full text-base disabled:opacity-60">
            {loading ? 'Створення…' : vsBot ? 'Грати проти бота' : 'Створити гру'}
          </button>
        </div>
      </div>
    </div>
  );
}
