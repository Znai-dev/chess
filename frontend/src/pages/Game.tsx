import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import socket from '../socket';
import type { GameState, Color, GameOverEvent } from '../types';
import ChessBoard from '../components/ChessBoard';
import PlayerCard from '../components/PlayerCard';
import MoveHistory from '../components/MoveHistory';
import GameOverModal from '../components/GameOverModal';
import ShareModal from '../components/ShareModal';

export default function Game() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  // Name can come from sessionStorage (room creator) or needs to be entered (invited player)
  const [playerName, setPlayerName] = useState<string | null>(sessionStorage.getItem('playerName'));
  const [nameInput, setNameInput] = useState('');

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [yourColor, setYourColor] = useState<Color | null>(null);
  const [gameOver, setGameOver] = useState<GameOverEvent | null>(null);
  const [showShare, setShowShare] = useState(false);
  const chessRef = useRef(new Chess());

  function submitName() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    sessionStorage.setItem('playerName', trimmed);
    setPlayerName(trimmed);
  }

  // Connect only after name is known
  useEffect(() => {
    if (!roomId || !playerName) return;
    socket.connect();
    socket.emit('join-room', { roomId, playerName });

    socket.on('game-state', (state: GameState) => {
      chessRef.current.load(state.fen);
      setGameState(state);
      setYourColor(state.yourColor);
      if (state.status === 'waiting' && state.yourColor === 'w') setShowShare(true);
    });

    socket.on('game-start', (state: GameState) => {
      chessRef.current.load(state.fen);
      setGameState(state);
      setShowShare(false);
      toast.success('Гра почалась!', { icon: '♟' });
    });

    socket.on('move-made', (state: GameState) => {
      chessRef.current.load(state.fen);
      setGameState(state);
    });

    socket.on('player-update', (players: GameState['players']) => {
      setGameState((prev) => prev ? { ...prev, players } : prev);
    });

    socket.on('your-color', (color: Color) => {
      setYourColor(color);
    });

    socket.on('game-over', (event: GameOverEvent) => {
      setGameOver(event);
      setGameState((prev) => prev ? { ...prev, status: 'finished', isGameOver: true } : prev);
    });

    socket.on('rematch-start', (state: GameState) => {
      chessRef.current.load(state.fen);
      setGameState(state);
      setGameOver(null);
      toast.success('Реванш! Кольори поміняні.', { icon: '🔄' });
    });

    socket.on('draw-offered', (data: { from: string }) => {
      toast((t) => (
        <div className="flex flex-col gap-2">
          <span><b>{data.from}</b> пропонує нічию</span>
          <div className="flex gap-2">
            <button className="btn-primary text-xs py-1 px-3" onClick={() => {
              socket.emit('respond-draw', { roomId, accept: true });
              toast.dismiss(t.id);
            }}>Прийняти</button>
            <button className="btn-secondary text-xs py-1 px-3" onClick={() => {
              socket.emit('respond-draw', { roomId, accept: false });
              toast.dismiss(t.id);
            }}>Відхилити</button>
          </div>
        </div>
      ), { duration: 15000 });
    });

    socket.on('draw-declined', () => toast.error('Нічию відхилено'));

    socket.on('player-disconnected', (data: { color: Color }) => {
      toast.error(`${data.color === 'w' ? '⬜' : '⬛'} Суперник відключився`, { duration: 5000 });
    });

    socket.on('error', (err: { message: string }) => {
      toast.error(err.message);
      navigate('/');
    });

    return () => {
      socket.off('game-state'); socket.off('game-start'); socket.off('move-made');
      socket.off('player-update'); socket.off('your-color'); socket.off('game-over');
      socket.off('rematch-start'); socket.off('draw-offered'); socket.off('draw-declined');
      socket.off('player-disconnected'); socket.off('error');
      socket.disconnect();
    };
  }, [roomId, playerName]);

  const handleMove = useCallback(
    (from: string, to: string, promotion?: string) => {
      if (!roomId || !gameState || gameState.status !== 'playing') return false;
      if (gameState.turn !== yourColor) return false;
      try {
        const move = chessRef.current.move({ from, to, promotion: promotion || 'q' });
        if (!move) return false;
        socket.emit('move', { roomId, move: { from, to, promotion: promotion || 'q' } });
        setGameState((prev) =>
          prev ? { ...prev, fen: chessRef.current.fen(), turn: chessRef.current.turn() as Color } : prev
        );
        return true;
      } catch { return false; }
    },
    [roomId, gameState, yourColor]
  );

  const handleResign = () => {
    if (!roomId || !gameState || gameState.status !== 'playing') return;
    if (window.confirm('Ви впевнені, що хочете здатися?')) socket.emit('resign', { roomId });
  };

  const handleDrawOffer = () => {
    if (!roomId || !gameState || gameState.status !== 'playing') return;
    socket.emit('offer-draw', { roomId });
    toast.success('Пропозицію нічиї надіслано');
  };

  const handleRematch = () => { if (roomId) socket.emit('rematch', { roomId }); };

  // ── Name entry screen (for invited players who open a direct link) ──
  if (!playerName) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-8 w-full max-w-sm"
        >
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">♟</div>
            <h2 className="text-xl font-bold text-white mb-1">Вас запросили в гру</h2>
            <p className="text-slate-400 text-sm">Введіть ім'я щоб приєднатись</p>
          </div>
          <input
            autoFocus
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitName()}
            placeholder="Ваше ім'я..."
            maxLength={20}
            className="w-full px-4 py-3 rounded-xl bg-slate-800/70 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/40 transition-all mb-4"
          />
          <button
            onClick={submitName}
            disabled={!nameInput.trim()}
            className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            Приєднатись до гри
          </button>
          <button onClick={() => navigate('/')} className="w-full mt-2 text-sm text-slate-500 hover:text-slate-300 transition-colors py-2">
            ← На головну
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Main game UI ──
  const opponent = gameState?.players.find((p) => p.color !== yourColor);
  const me = gameState?.players.find((p) => p.color === yourColor);
  const isSpectator = yourColor === null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 lg:p-8">
      <div className="w-full max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
            <span>←</span> На головну
          </button>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-sm font-mono">#{roomId}</span>
            <button onClick={() => setShowShare(true)} className="btn-secondary text-xs py-1.5 px-3">
              📋 Запросити
            </button>
          </div>
        </motion.div>

        <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
          <div className="flex flex-col items-center gap-3 w-full lg:w-auto">
            <PlayerCard
              player={opponent} isOpponent
              isActive={gameState?.turn !== yourColor && gameState?.status === 'playing'}
              capturedBy={yourColor} history={gameState?.history ?? []}
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="chess-container"
            >
              {gameState ? (
                <ChessBoard
                  fen={gameState.fen} yourColor={yourColor} onMove={handleMove}
                  lastMove={gameState.lastMove} inCheck={gameState.inCheck}
                  isGameOver={gameState.isGameOver} turn={gameState.turn} isSpectator={isSpectator}
                />
              ) : (
                <div className="w-[480px] h-[480px] flex items-center justify-center bg-slate-800 rounded-xl">
                  <div className="text-4xl animate-spin">♟</div>
                </div>
              )}
            </motion.div>

            <PlayerCard
              player={me} isOpponent={false}
              isActive={gameState?.turn === yourColor && gameState?.status === 'playing'}
              capturedBy={yourColor === 'w' ? 'b' : 'w'} history={gameState?.history ?? []}
            />
          </div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="flex flex-col gap-4 w-full lg:w-72"
          >
            <div className="glass rounded-2xl p-4">
              <StatusBadge gameState={gameState} yourColor={yourColor} />
            </div>

            {!isSpectator && gameState?.status === 'playing' && (
              <div className="glass rounded-2xl p-4 flex flex-col gap-2">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Дії</p>
                <button onClick={handleDrawOffer} className="btn-secondary text-sm w-full">🤝 Запропонувати нічию</button>
                <button onClick={handleResign} className="btn-danger text-sm w-full">🏳 Здатися</button>
              </div>
            )}

            <MoveHistory history={gameState?.history ?? []} />
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {showShare && roomId && (
          <ShareModal roomId={roomId} onClose={() => setShowShare(false)} waitingForOpponent={gameState?.status === 'waiting'} />
        )}
        {gameOver && (
          <GameOverModal
            event={gameOver} yourColor={yourColor} players={gameState?.players ?? []}
            onRematch={handleRematch} onHome={() => navigate('/')}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBadge({ gameState, yourColor }: { gameState: GameState | null; yourColor: Color | null }) {
  if (!gameState) return <div className="text-slate-500 text-sm animate-pulse2">Підключення...</div>;

  if (gameState.status === 'waiting') {
    return (
      <div className="flex items-center gap-2">
        <span className="status-dot waiting" />
        <span className="text-amber-400 text-sm font-medium">Очікування суперника...</span>
      </div>
    );
  }
  if (gameState.isCheckmate) return <div className="text-red-400 font-semibold text-sm">♚ Мат!</div>;
  if (gameState.isDraw || gameState.isStalemate) return <div className="text-slate-300 font-semibold text-sm">🤝 Нічия</div>;
  if (gameState.inCheck) return <div className="text-red-400 font-semibold text-sm animate-pulse2">⚠️ Шах!</div>;

  const isMyTurn = gameState.turn === yourColor;
  return (
    <div className="flex items-center gap-2">
      <span className={`w-3 h-3 rounded-full border-2 ${gameState.turn === 'w' ? 'bg-white border-slate-400' : 'bg-slate-900 border-slate-400'}`} />
      <span className={`text-sm font-medium ${isMyTurn ? 'text-emerald-400' : 'text-slate-400'}`}>
        {isMyTurn ? 'Ваш хід' : 'Хід суперника'}
      </span>
      <span className="text-slate-600 text-xs ml-auto">
        Хід {Math.ceil(gameState.history.length / 2)}
      </span>
    </div>
  );
}
