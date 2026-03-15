import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';

export default function Home() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function createGame() {
    if (!name.trim()) { toast.error('Введіть своє ім\'я'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const { roomId } = await res.json();
      sessionStorage.setItem('playerName', name.trim());
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
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <div className="text-7xl mb-4 select-none">♟</div>
          <h1 className="text-4xl font-bold tracking-tight text-white mb-2">
            Chess <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">Online</span>
          </h1>
          <p className="text-slate-400 text-sm">Запроси друга та зіграй партію</p>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="glass rounded-2xl p-8"
        >
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-2">Ваше ім'я</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createGame()}
              placeholder="Введіть ім'я..."
              maxLength={20}
              className="w-full px-4 py-3 rounded-xl bg-slate-800/70 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/40 transition-all"
            />
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
            ) : '♟ Створити гру'}
          </button>

          <div className="mt-6 pt-6 border-t border-slate-700/50">
            <p className="text-xs text-slate-500 text-center leading-relaxed">
              Після створення ви отримаєте посилання, яке можна надіслати другу.
              Перший гравець грає білими, другий — чорними.
            </p>
          </div>
        </motion.div>

        {/* Features */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 grid grid-cols-3 gap-3 text-center"
        >
          {[
            { icon: '⚡', label: 'Real-time' },
            { icon: '🎨', label: 'Сучасний UI' },
            { icon: '📱', label: 'Будь-який пристрій' },
          ].map((f) => (
            <div key={f.label} className="glass rounded-xl py-3 px-2">
              <div className="text-xl mb-1">{f.icon}</div>
              <div className="text-xs text-slate-400">{f.label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
