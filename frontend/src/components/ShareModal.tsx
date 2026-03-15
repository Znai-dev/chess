import { useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';

interface Props {
  roomId: string;
  onClose: () => void;
  waitingForOpponent: boolean;
}

export default function ShareModal({ roomId, onClose, waitingForOpponent }: Props) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/game/${roomId}`;

  async function copyLink() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
      } else {
        // HTTP fallback (execCommand)
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success('Посилання скопійовано!');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Не вдалося скопіювати — виділіть посилання вручну');
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !waitingForOpponent) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        className="glass rounded-3xl p-8 max-w-md w-full"
      >
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🔗</div>
          <h2 className="text-xl font-bold text-white mb-1">Запросити суперника</h2>
          {waitingForOpponent && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="status-dot waiting" />
              <span className="text-amber-400 text-sm">Очікування суперника...</span>
            </div>
          )}
        </div>

        <div className="mb-4">
          <p className="text-xs text-slate-400 mb-2">Надішли це посилання другу:</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={link}
              className="flex-1 px-3 py-2.5 rounded-xl bg-slate-800/70 border border-slate-700/60 text-slate-300 text-sm font-mono truncate focus:outline-none"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              onClick={copyLink}
              className={`px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 flex-shrink-0 ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
              }`}
            >
              {copied ? '✓' : '📋'}
            </button>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-800/50 mb-5">
          <div className="flex items-start gap-2 text-xs text-slate-400">
            <span className="mt-0.5">ℹ️</span>
            <span>
              Ви граєте <b className="text-white">білими</b>. Друг, який відкриє посилання, гратиме <b className="text-white">чорними</b>.
              Гра почнеться автоматично після його приєднання.
            </span>
          </div>
        </div>

        {!waitingForOpponent && (
          <button onClick={onClose} className="btn-secondary w-full text-sm">
            Закрити
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}
