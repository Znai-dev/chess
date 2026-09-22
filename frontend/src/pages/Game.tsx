import { useEffect, useRef, useState, useCallback, useMemo, CSSProperties } from 'react';
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
import SpellPanel from '../components/SpellPanel';

export default function Game() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [playerName, setPlayerName] = useState<string | null>(sessionStorage.getItem('playerName'));
  const [nameInput, setNameInput] = useState('');

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [yourColor, setYourColor] = useState<Color | null>(null);
  const [gameOver, setGameOver] = useState<GameOverEvent | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [pendingSpellId, setPendingSpellId] = useState<string | null>(null);
  const chessRef = useRef(new Chess());

  function submitName() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    sessionStorage.setItem('playerName', trimmed);
    setPlayerName(trimmed);
  }

  // ── Socket setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId || !playerName) return;
    socket.connect();
    socket.emit('join-room', { roomId, playerName });

    socket.on('game-state', (state: GameState) => {
      try { chessRef.current.load(state.fen); } catch { /* masked FEN may be incomplete */ }
      setGameState(state);
      setYourColor(state.yourColor);
      if (state.status === 'waiting' && state.yourColor === 'w') setShowShare(true);
      if (state.status === 'playing') setShowShare(false);
    });

    socket.on('game-start', (state: GameState) => {
      try { chessRef.current.load(state.fen); } catch { /* masked FEN */ }
      setGameState(state);
      setShowShare(false);
      toast.success('Гра почалась!', { icon: '♟' });
    });

    socket.on('move-made', (state: GameState) => {
      try { chessRef.current.load(state.fen); } catch { /* masked FEN */ }
      setGameState(state);
    });

    socket.on('player-update', (players: GameState['players']) => {
      setGameState((prev) => prev ? { ...prev, players } : prev);
    });

    socket.on('your-color', (color: Color) => setYourColor(color));

    socket.on('game-over', (event: GameOverEvent) => {
      setGameOver(event);
      setGameState((prev) => prev ? { ...prev, status: 'finished', isGameOver: true } : prev);
    });

    socket.on('rematch-start', (state: GameState) => {
      try { chessRef.current.load(state.fen); } catch { /* masked FEN */ }
      setGameState(state);
      setGameOver(null);
      setPendingSpellId(null);
      toast.success('Реванш! Кольори поміняні.', { icon: '🔄' });
    });

    socket.on('draw-offered', (data: { from: string }) => {
      toast((t) => (
        <div className="flex flex-col gap-2">
          <span><b>{data.from}</b> пропонує нічию</span>
          <div className="flex gap-2">
            <button className="btn-primary text-xs py-1 px-3" onClick={() => { socket.emit('respond-draw', { roomId, accept: true }); toast.dismiss(t.id); }}>Прийняти</button>
            <button className="btn-secondary text-xs py-1 px-3" onClick={() => { socket.emit('respond-draw', { roomId, accept: false }); toast.dismiss(t.id); }}>Відхилити</button>
          </div>
        </div>
      ), { duration: 15000 });
    });

    socket.on('draw-declined', () => toast.error('Нічию відхилено'));

    socket.on('invalid-move', ({ message }: { message: string }) => {
      toast.error(message);
    });

    socket.on('player-disconnected', (data: { color: Color }) => {
      toast.error(`${data.color === 'w' ? '⬜' : '⬛'} Суперник відключився`, { duration: 5000 });
    });

    socket.on('error', (err: { message: string }) => { toast.error(err.message); navigate('/'); });

    // Lootbox events
    socket.on('lootbox-needs-target', () => {
      // State update via move-made will show candidates from lootboxData.shieldBreakPending
    });

    // Magic events
    socket.on('spell-needs-target', ({ spellId }: { spellId: string }) => {
      setPendingSpellId(spellId);
      toast('Клікніть на ціль для заклинання', { icon: '🎯', duration: 5000 });
    });

    socket.on('spell-cast', () => {
      setPendingSpellId(null);
    });

    socket.on('spell-error', (err: { message: string }) => {
      toast.error(err.message);
      setPendingSpellId(null);
    });

    socket.on('shield-blocked', ({ at }: { at: string }) => {
      toast(`🛡 Щит на ${at} поглинув атаку!`, { duration: 3000 });
    });

    return () => {
      socket.off('game-state'); socket.off('game-start'); socket.off('move-made');
      socket.off('player-update'); socket.off('your-color'); socket.off('game-over');
      socket.off('rematch-start'); socket.off('draw-offered'); socket.off('draw-declined');
      socket.off('player-disconnected'); socket.off('error'); socket.off('invalid-move');
      socket.off('lootbox-needs-target');
      socket.off('spell-needs-target'); socket.off('spell-cast'); socket.off('spell-error');
      socket.off('shield-blocked');
      socket.disconnect();
    };
  }, [roomId, playerName]);

  // ── Derived pending state ────────────────────────────────────────────────
  const lb = gameState?.lootboxData;
  const shieldBreakPending = lb?.shieldBreakPending?.color === yourColor ? lb.shieldBreakPending : null;
  const extraMovePending   = lb?.extraMovePending?.color === yourColor   ? lb.extraMovePending   : null;
  const teleportPending    = lb?.teleportPending?.color === yourColor    ? lb.teleportPending    : null;
  // Active as soon as spell-needs-target is received (pendingSpellId set), regardless of server state sync
  const magicTargetPending = pendingSpellId;

  // Target selection mode: either shield_break or magic spell target
  const inTargetMode = !!(shieldBreakPending || magicTargetPending);

  const targetCandidates = useMemo(() => {
    if (shieldBreakPending) return shieldBreakPending.candidates;
    if (magicTargetPending) return []; // any square, no pre-highlight
    return [];
  }, [shieldBreakPending, magicTargetPending]);

  const restrictToSquare = extraMovePending?.sq || teleportPending?.sq || null;

  // Fog: squares to cover with opaque overlay (hides enemy pieces visually)
  const fogCoverSquares = useMemo(() => {
    if (gameState?.mode !== 'fog' || !gameState.fogData) return undefined;
    const visible = new Set(gameState.fogData.visibleSquares);
    const hidden: string[] = [];
    for (let f = 0; f < 8; f++)
      for (let r = 1; r <= 8; r++) {
        const sq = String.fromCharCode(97 + f) + r;
        if (!visible.has(sq)) hidden.push(sq);
      }
    return hidden;
  }, [gameState?.mode, gameState?.fogData]);

  // ── Mode overlay: extra square styles + icons ────────────────────────────
  const modeSquareStyles = useMemo((): Record<string, CSSProperties> => {
    const styles: Record<string, CSSProperties> = {};

    // Lootbox overlays
    if (gameState?.mode === 'lootbox' && lb) {
      for (const lbEntry of lb.lootboxes) {
        styles[lbEntry.sq] = { background: 'rgba(234,179,8,0.2)', outline: '2px solid rgba(234,179,8,0.6)', outlineOffset: '-2px' };
      }
      for (const [sq, buff] of Object.entries(lb.buffs)) {
        const bg = buff.type === 'shield' ? 'rgba(59,130,246,0.35)' :
                   buff.type === 'extra_move' ? 'rgba(34,197,94,0.35)' :
                   buff.type === 'teleport' ? 'rgba(168,85,247,0.35)' :
                   'rgba(239,68,68,0.35)';
        styles[sq] = { ...(styles[sq] || {}), background: bg };
      }
      for (const sq of Object.keys(lb.debuffs)) {
        styles[sq] = { ...(styles[sq] || {}), background: 'rgba(239,68,68,0.4)' };
      }
      if (extraMovePending) {
        styles[extraMovePending.sq] = { ...(styles[extraMovePending.sq] || {}), outline: '3px solid rgba(34,197,94,0.9)', outlineOffset: '-3px' };
      }
      if (teleportPending) {
        styles[teleportPending.sq] = { ...(styles[teleportPending.sq] || {}), outline: '3px solid rgba(168,85,247,0.9)', outlineOffset: '-3px' };
      }
    }

    // Magic overlays
    if (gameState?.mode === 'magic' && gameState.magicData) {
      const d = gameState.magicData;
      for (const sq of [...d.teleports.a, ...d.teleports.b]) {
        const used = d.usedTeleports.includes(sq);
        styles[sq] = { outline: used ? '2px dashed rgba(168,85,247,0.35)' : '2px solid rgba(168,85,247,0.65)', outlineOffset: '-2px' };
      }
      for (const sq of d.rebirthSqs) {
        styles[sq] = { ...(styles[sq] || {}), background: 'rgba(34,197,94,0.12)', outline: '2px solid rgba(34,197,94,0.5)', outlineOffset: '-2px' };
      }
      for (const sq of Object.keys(d.frozenPieces)) {
        styles[sq] = { ...(styles[sq] || {}), background: 'rgba(147,197,253,0.4)', boxShadow: 'inset 0 0 0 2px rgba(147,197,253,0.8)' };
      }
      for (const sq of Object.keys(d.pieceShields)) {
        styles[sq] = { ...(styles[sq] || {}), boxShadow: 'inset 0 0 0 3px rgba(59,130,246,0.85)' };
      }
    }

    return styles;
  }, [gameState, lb, extraMovePending, teleportPending]);

  const squareIcons = useMemo((): Record<string, string> => {
    const icons: Record<string, string> = {};

    if (gameState?.mode === 'lootbox' && lb) {
      for (const lbEntry of lb.lootboxes) icons[lbEntry.sq] = '📦';
      for (const [sq, buff] of Object.entries(lb.buffs)) {
        icons[sq] = buff.type === 'shield' ? '🛡' : buff.type === 'extra_move' ? '⚡' : buff.type === 'teleport' ? '🌀' : '🔥';
      }
      for (const [sq, debuff] of Object.entries(lb.debuffs)) {
        icons[sq] = debuff.type === 'skip_turn' ? '💤' : '🚫';
      }
    }

    if (gameState?.mode === 'magic' && gameState.magicData) {
      const d = gameState.magicData;
      for (const sq of Object.keys(d.frozenPieces)) icons[sq] = '❄️';
      for (const sq of Object.keys(d.pieceShields)) icons[sq] = '🛡';
    }

    return icons;
  }, [gameState, lb]);

  // ── Move handler ──────────────────────────────────────────────────────────
  const handleMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      if (!roomId || !gameState || gameState.status !== 'playing') return false;

      const mode = gameState.mode;

      // Lootbox pending states
      if (mode === 'lootbox') {
        if (teleportPending) {
          if (from !== teleportPending.sq) return false;
          const tgt = chessRef.current.get(to as any);
          if (tgt) return false; // teleport to empty only
          socket.emit('move', { roomId, move: { from, to } });
          return true;
        }
        if (extraMovePending) {
          if (from !== extraMovePending.sq) return false;
          // Normal move with this piece (no local chess.js validation for lootbox moves)
          socket.emit('move', { roomId, move: { from, to, promotion: promotion || 'q' } });
          return true;
        }
        // Normal lootbox move – skip local validation (berserk / debuff checks are server-side)
        if (gameState.turn !== yourColor) return false;
        socket.emit('move', { roomId, move: { from, to, promotion: promotion || 'q' } });
        return true;
      }

      if (gameState.turn !== yourColor) return false;

      if (mode === 'fog') {
        // Skip local validation — server has full board; no optimistic flip to avoid getting stuck
        socket.emit('move', { roomId, move: { from, to, promotion: promotion || 'q' } });
        return true;
      }

      if (mode === 'magic') {
        const md = gameState.magicData;
        if (md?.frozenPieces[from]) { toast.error('Фігура заморожена!'); return false; }
      }

      // Classic / magic: local chess.js validation
      try {
        const result = chessRef.current.move({ from, to, promotion: promotion || 'q' });
        if (!result) return false;
        socket.emit('move', { roomId, move: { from, to, promotion: promotion || 'q' } });
        setGameState((prev) =>
          prev ? { ...prev, fen: chessRef.current.fen(), turn: chessRef.current.turn() as Color } : prev
        );
        return true;
      } catch { return false; }
    },
    [roomId, gameState, yourColor, teleportPending, extraMovePending]
  );

  // ── Target select (shield break / spell target) ────────────────────────
  const handleTargetSelect = useCallback(
    (sq: string) => {
      if (!roomId) return;
      if (shieldBreakPending) {
        if (!shieldBreakPending.candidates.includes(sq)) { toast.error('Оберіть сусідню клітинку'); return; }
        socket.emit('move', { roomId, move: { from: shieldBreakPending.attackerSq, to: sq } });
        return;
      }
      if (magicTargetPending) {
        socket.emit('spell-target', { roomId, targetSq: sq });
        setPendingSpellId(null);
      }
    },
    [roomId, shieldBreakPending, magicTargetPending]
  );

  // ── Skip extra move / teleport ────────────────────────────────────────
  const handleSkipExtraMove = useCallback(() => {
    if (!roomId) return;
    socket.emit('skip-extra-move', { roomId });
  }, [roomId]);

  // ── Spell casting ──────────────────────────────────────────────────────
  const handleCastSpell = useCallback(
    (spellId: string) => {
      if (!roomId) return;
      socket.emit('cast-spell', { roomId, spellId });
    },
    [roomId]
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

  // ── Name entry screen ─────────────────────────────────────────────────
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
            autoFocus type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitName()}
            placeholder="Ваше ім'я..." maxLength={20}
            className="w-full px-4 py-3 rounded-xl bg-slate-800/70 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/40 transition-all mb-4"
          />
          <button onClick={submitName} disabled={!nameInput.trim()} className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none">
            Приєднатись до гри
          </button>
          <button onClick={() => navigate('/')} className="w-full mt-2 text-sm text-slate-500 hover:text-slate-300 transition-colors py-2">
            ← На головну
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Main game UI ──────────────────────────────────────────────────────
  const opponent   = gameState?.players.find((p) => p.color !== yourColor);
  const me         = gameState?.players.find((p) => p.color === yourColor);
  const isSpectator = yourColor === null;
  const mode = gameState?.mode ?? 'classic';

  const skipLocalValidation = mode === 'fog' || mode === 'lootbox';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 lg:p-8">
      <div className="w-full max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
            ← На головну
          </button>
          <div className="flex items-center gap-2">
            {mode !== 'classic' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {mode === 'lootbox' ? '📦 Лутбокси' : mode === 'fog' ? '🌫️ Туман' : '✨ Магія'}
              </span>
            )}
            <span className="text-slate-500 text-sm font-mono">#{roomId}</span>
            <button onClick={() => setShowShare(true)} className="btn-secondary text-xs py-1.5 px-3">
              📋 Запросити
            </button>
          </div>
        </motion.div>

        <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
          {/* Board column */}
          <div className="flex flex-col items-center gap-3 w-full lg:w-auto">
            <PlayerCard
              player={opponent} isOpponent
              isActive={gameState?.turn !== yourColor && gameState?.status === 'playing'}
              capturedBy={yourColor} history={gameState?.history ?? []}
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="chess-container"
            >
              {gameState ? (
                <ChessBoard
                  fen={gameState.fen}
                  yourColor={yourColor}
                  onMove={handleMove}
                  lastMove={gameState.lastMove}
                  inCheck={gameState.inCheck}
                  isGameOver={gameState.isGameOver}
                  turn={gameState.turn}
                  isSpectator={isSpectator}
                  extraSquareStyles={modeSquareStyles}
                  squareIcons={squareIcons}
                  fogCoverSquares={fogCoverSquares}
                  targetCandidates={inTargetMode ? targetCandidates : undefined}
                  onTargetSelect={inTargetMode ? handleTargetSelect : undefined}
                  restrictToSquare={restrictToSquare}
                  skipLocalValidation={skipLocalValidation}
                />
              ) : (
                <div className="w-[480px] h-[480px] flex items-center justify-center bg-slate-800 rounded-xl">
                  <div className="text-4xl animate-spin">♟</div>
                </div>
              )}
            </motion.div>

            {/* Pending action hint */}
            {(shieldBreakPending || extraMovePending || teleportPending) && (
              <div className="px-4 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-sm text-center flex flex-col gap-1.5">
                {shieldBreakPending && <span>🛡 Щит зламано! Оберіть сусідню клітинку для посадки</span>}
                {extraMovePending   && <span>⚡ Додатковий хід! Рухайте виділену фігуру</span>}
                {teleportPending    && <span>🌀 Телепортація! Клікніть на порожню клітинку</span>}
                {(extraMovePending || teleportPending) && (
                  <button
                    onClick={handleSkipExtraMove}
                    className="mt-1 text-xs px-3 py-1 rounded-lg bg-slate-700/60 hover:bg-slate-600/60 border border-slate-600/40 text-slate-300 transition-colors"
                  >
                    Пропустити
                  </button>
                )}
              </div>
            )}

            <PlayerCard
              player={me} isOpponent={false}
              isActive={gameState?.turn === yourColor && gameState?.status === 'playing'}
              capturedBy={yourColor === 'w' ? 'b' : 'w'} history={gameState?.history ?? []}
            />
          </div>

          {/* Sidebar */}
          <motion.div
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
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

            {/* Spells for magic mode */}
            {mode === 'magic' && gameState?.magicData && yourColor && !isSpectator && (
              <SpellPanel
                spells={gameState.magicData.spells[yourColor]}
                yourColor={yourColor}
                isYourTurn={gameState.turn === yourColor && gameState.status === 'playing'}
                pendingSpellId={pendingSpellId}
                onCastSpell={handleCastSpell}
              />
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
      <span className="text-slate-600 text-xs ml-auto">Хід {Math.ceil(gameState.history.length / 2)}</span>
    </div>
  );
}
