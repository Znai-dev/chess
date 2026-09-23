import { useEffect, useRef, useState, useCallback, useMemo, CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import socket from '../socket';
import type { GameState, Color, GameOverEvent, GameEvent, PlayerInfo, ReplayFrame } from '../types';
import { EFFECTS, SPELL_META } from '../effects';
import ChessBoard, { Badge, Flash } from '../components/ChessBoard';
import PlayerCard from '../components/PlayerCard';
import MoveHistory from '../components/MoveHistory';
import GameOverModal from '../components/GameOverModal';
import ShareModal from '../components/ShareModal';
import SpellPanel from '../components/SpellPanel';
import LootPanel from '../components/LootPanel';
import BigBoard from '../components/BigBoard';
import ExpandPanel from '../components/ExpandPanel';
import TurnBar from '../components/TurnBar';
import ReplayModal from '../components/ReplayModal';
import { playerName as playerName_ } from '../names';

const MODE_LABEL: Record<string, string> = { expand: '🗺️ Експансія', lootbox: '📦 Лутбокси', fog: '🌫️ Туман', magic: '✨ Магія' };

export default function Game() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  // Settled once, no form: opening a link drops you straight into the game.
  const [playerName] = useState(playerName_);

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [yourColor, setYourColor] = useState<Color | null>(null);
  const [gameOver, setGameOver] = useState<GameOverEvent | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const [zoneHighlight, setZoneHighlight] = useState<number | null>(null);
  const [replay, setReplay] = useState<ReplayFrame[] | null>(null);
  const flashSeq = useRef(0);
  const yourColorRef = useRef<Color | null>(null);
  const playersRef = useRef<PlayerInfo[]>([]);

  // ── Bursts on the board ───────────────────────────────────────────────────
  const flash = useCallback((sq: string, icon: string, tone: Flash['tone'], label?: string) => {
    const id = `f${++flashSeq.current}`;
    setFlashes((fs) => [...fs, { id, sq, icon, tone, label }]);
    setTimeout(() => setFlashes((fs) => fs.filter((f) => f.id !== id)), 1400);
  }, []);

  const who = useCallback((color: Color) => {
    const me = yourColorRef.current;
    if (color === me) return 'Ви';
    const p = playersRef.current.find((pl) => pl.color === color);
    return p?.name ?? (color === 'w' ? 'Білі' : 'Чорні');
  }, []);

  const handleEvents = useCallback((events: GameEvent[]) => {
    const me = yourColorRef.current;
    for (const e of events) {
      switch (e.type) {
        case 'pickup': {
          const m = EFFECTS[e.effect];
          const mine = e.color === me;
          flash(e.sq, m.icon, m.tone, m.name);
          toast(
            <div className="flex flex-col gap-0.5">
              <span><b>{who(e.color)}</b> {mine ? 'відкрили' : 'відкрив'} скриню: <b>{m.icon} {m.name}</b></span>
              <span className="text-xs text-slate-400">{m.desc}</span>
            </div>,
            { icon: '📦', duration: 5000 },
          );
          break;
        }
        case 'extra_move_lost':
          toast(`⚡ Додатковий хід пропав: фігурі на ${e.sq} нікуди ходити`, { duration: 4000 });
          break;
        case 'shield_absorb':
          flash(e.at, '🛡', 'neutral', 'поглинуто');
          toast(e.stayed ? `🛡 Щит на ${e.at} поглинув удар — атакуючий лишився на місці` : `🛡 Щит на ${e.at} поглинув удар`, { duration: 4000 });
          break;
        case 'bomb':
          flash(e.at, '💥', 'debuff', 'бум');
          toast(`💣 Бомба на ${e.at}! Обидві фігури згоріли`, { icon: '💥', duration: 4500 });
          break;
        case 'effects_suspended':
          if (e.color === me) toast('Ефекти на ваших фігурах зняті на цей хід — інакше ходу не було б', { icon: 'ℹ️', duration: 4500 });
          break;
        case 'teleport':
          flash(e.to, '🌀', 'buff');
          break;
        case 'spell': {
          const meta = SPELL_META[e.spellId];
          flash(e.target, meta?.icon ?? '✨', 'buff');
          if (e.color !== me || e.spellId !== 'invisible') {
            toast(`${meta?.icon ?? '✨'} ${who(e.color)}: заклинання на ${e.target}`, { duration: 3500 });
          }
          break;
        }
        case 'rebirth':
          flash(e.sq, '♻️', 'buff', 'відродження');
          toast(`♻️ ${who(e.color)}: фігура повернулась на ${e.sq}`, { duration: 4000 });
          break;
        case 'magic_teleport':
          flash(e.to, '🌀', 'buff');
          toast(`🌀 Портал: ${e.from} → ${e.to}`, { duration: 3000 });
          break;
        case 'thawed':
          if (e.color === me) toast('❄️ Заморозка розтанула: тільки та фігура могла врятувати короля', { duration: 4500 });
          break;
        case 'blocked_by_invisible':
          break;
        case 'expand':
          toast(
            <div className="flex flex-col gap-0.5">
              <span>Карта розрослася до <b>{e.size}×{e.size}</b></span>
              <span className="text-xs text-slate-400">Відкрито: <b>{e.zone}</b> · нових фігур: {e.pieces}</span>
            </div>,
            { icon: '🗺️', duration: 5000 },
          );
          break;
        case 'portal_jump':
          flash(e.to, '🌀', 'buff');
          toast(`🌀 Портал: ${e.from} → ${e.to}`, { duration: 3000 });
          break;
        case 'promote':
          flash(e.sq, '♛', 'buff', 'ферзь');
          toast(`♛ ${who(e.color)}: пішак пройшов у ферзі на ${e.sq}`, { duration: 4000 });
          break;
        case 'treasure':
          flash(e.sq, '💎', 'buff', 'підвищення');
          toast(`💎 ${who(e.color)}: скарб на ${e.sq} підвищив фігуру`, { duration: 4000 });
          break;
        case 'wall_break':
          flash(e.sq, e.destroyed ? '💥' : '⚒', e.destroyed ? 'buff' : 'neutral', e.destroyed ? 'пролом' : 'тріщина');
          toast(
            e.destroyed
              ? `⚒ ${who(e.color)}: стіна на ${e.sq} впала — прохід відкрито`
              : `⚒ ${who(e.color)}: стіна на ${e.sq} тріснула, ще один удар`,
            { duration: 3500 },
          );
          break;
      }
    }
  }, [flash, who]);

  // ── Socket setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId || !playerName) return;
    socket.connect();
    socket.emit('join-room', { roomId, playerName });

    const applyState = (state: GameState) => {
      yourColorRef.current = state.yourColor;
      playersRef.current = state.players;
      setGameState(state);
      setYourColor(state.yourColor);
    };

    socket.on('game-state', (state: GameState) => {
      applyState(state);
      if (state.status === 'waiting' && state.yourColor === 'w') setShowShare(true);
      if (state.status === 'playing') setShowShare(false);
    });

    socket.on('game-start', (state: GameState) => {
      applyState(state);
      setShowShare(false);
      toast.success('Гра почалась!', { icon: '♟' });
    });

    socket.on('move-made', (state: GameState) => {
      applyState(state);
      // a zone spotlight is for planning; never leave the board dimmed over a move
      setZoneHighlight(null);
      if (state.events?.length) handleEvents(state.events);
    });

    socket.on('player-update', (players: GameState['players']) => {
      playersRef.current = players;
      setGameState((prev) => prev ? { ...prev, players } : prev);
    });

    socket.on('game-over', (event: GameOverEvent) => {
      setGameOver(event);
      setGameState((prev) => prev ? { ...prev, status: 'finished', isGameOver: true } : prev);
    });

    socket.on('rematch-start', (state: GameState) => {
      applyState(state);
      setGameOver(null);
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

    socket.on('replay-data', ({ frames }: { frames: ReplayFrame[] }) => {
      if (frames.length < 2) { toast('Партія надто коротка для реплею'); return; }
      setReplay(frames);
    });
    socket.on('draw-declined', () => toast.error('Нічию відхилено'));
    socket.on('invalid-move', ({ message }: { message: string }) => toast.error(message));
    socket.on('spell-error', ({ message }: { message: string }) => toast.error(message));
    socket.on('player-disconnected', (data: { name: string }) => {
      toast.error(`${data.name} відключився — чекаємо на повернення`, { duration: 5000 });
    });
    socket.on('error', (err: { message: string }) => { toast.error(err.message); navigate('/'); });

    return () => {
      for (const ev of ['game-state', 'game-start', 'move-made', 'player-update', 'game-over', 'rematch-start',
        'draw-offered', 'draw-declined', 'invalid-move', 'spell-error', 'player-disconnected', 'error',
        'replay-data']) socket.off(ev);
      socket.disconnect();
    };
  }, [roomId, playerName, navigate, handleEvents]);

  // ── Derived view state ────────────────────────────────────────────────────
  const mode = gameState?.mode ?? 'expand';
  const isSpectator = yourColor === null;
  const playing = gameState?.status === 'playing';
  const myTurn = !!gameState && playing && !isSpectator && gameState.turn === yourColor;
  const pending = gameState?.pending ?? null;
  const myPending = pending && pending.color === yourColor ? pending : null;
  const lb = gameState?.lootboxData;
  const md = gameState?.magicData;
  const ex = gameState?.expandData;

  // Tab title: the cheapest "it's your move" signal there is
  useEffect(() => {
    document.title = myTurn ? '● Ваш хід — Chess Online' : 'Chess Online';
    return () => { document.title = 'Chess Online'; };
  }, [myTurn]);

  const checkSquare = useMemo(() => {
    if (!gameState?.inCheck) return null;
    if (gameState.mode === 'expand') return null;   // the big board marks its own king
    try {
      const c = new Chess(gameState.fen);
      for (const row of c.board()) for (const sq of row) if (sq?.type === 'k' && sq.color === gameState.turn) return sq.square;
    } catch { /* masked */ }
    return null;
  }, [gameState?.inCheck, gameState?.fen, gameState?.turn]);

  const fogCoverSquares = useMemo(() => {
    if (mode !== 'fog' || !gameState?.fogData) return undefined;
    const visible = new Set(gameState.fogData.visibleSquares);
    const hidden: string[] = [];
    for (let f = 0; f < 8; f++)
      for (let r = 1; r <= 8; r++) {
        const sq = String.fromCharCode(97 + f) + r;
        if (!visible.has(sq)) hidden.push(sq);
      }
    return hidden;
  }, [mode, gameState?.fogData]);

  const squareStyles = useMemo((): Record<string, CSSProperties> => {
    const styles: Record<string, CSSProperties> = {};
    if (mode === 'lootbox' && lb) {
      for (const box of lb.lootboxes) {
        styles[box.sq] = { background: 'radial-gradient(circle, rgba(234,179,8,0.35) 0%, rgba(234,179,8,0.08) 70%)' };
      }
      if (myPending?.kind === 'extra_move') {
        styles[myPending.sq] = { boxShadow: 'inset 0 0 0 3px rgba(52,211,153,0.95)' };
      }
    }
    if (mode === 'magic' && md) {
      for (const sq of [...md.teleports.a, ...md.teleports.b]) {
        const used = md.usedTeleports.includes(sq);
        styles[sq] = { outline: used ? '2px dashed rgba(168,85,247,0.3)' : '2px solid rgba(168,85,247,0.7)', outlineOffset: '-2px' };
      }
      for (const sq of md.rebirthSqs) {
        styles[sq] = { background: 'rgba(34,197,94,0.14)', outline: '2px solid rgba(34,197,94,0.55)', outlineOffset: '-2px' };
      }
      for (const sq of Object.keys(md.frozenPieces)) {
        styles[sq] = { ...(styles[sq] || {}), background: 'rgba(147,197,253,0.45)' };
      }
    }
    return styles;
  }, [mode, lb, md, myPending]);

  const badges = useMemo((): Record<string, Badge> => {
    const out: Record<string, Badge> = {};
    if (mode === 'lootbox' && lb) {
      for (const [sq, eff] of Object.entries(lb.effects)) {
        const m = EFFECTS[eff.type];
        out[sq] = { icon: m.icon, title: `${m.name}: ${m.desc}`, tone: m.tone, count: eff.movesLeft || undefined };
      }
    }
    if (mode === 'magic' && md) {
      for (const [sq, n] of Object.entries(md.frozenPieces)) out[sq] = { icon: '❄️', title: 'Заморожена', tone: 'magic', count: n };
      for (const sq of Object.keys(md.pieceShields)) out[sq] = { icon: '🛡', title: 'Міні-щит', tone: 'magic' };
      for (const [sq, n] of Object.entries(md.invisiblePieces)) {
        // only the owner sees their own invisible piece marked
        out[sq] = { icon: '👻', title: 'Невидима для суперника', tone: 'magic', count: Math.max(0, n - 1) || undefined };
      }
    }
    return out;
  }, [mode, lb, md]);

  const centerIcons = useMemo((): Record<string, string> => {
    const out: Record<string, string> = {};
    if (mode === 'lootbox' && lb) for (const box of lb.lootboxes) out[box.sq] = '📦';
    return out;
  }, [mode, lb]);

  const selectionExtras = useMemo((): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    if (mode === 'lootbox' && lb) {
      for (const [sq, eff] of Object.entries(lb.effects)) if (eff.type === 'rage' && eff.rageCells) out[sq] = eff.rageCells;
    }
    return out;
  }, [mode, lb]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleMove = useCallback((from: string, to: string, promotion?: string) => {
    if (!roomId) return;
    socket.emit('move', { roomId, move: { from, to, promotion } });
  }, [roomId]);

  const handleTargetSelect = useCallback((sq: string) => {
    if (!roomId || !myPending) return;
    if (myPending.kind === 'shield_break') socket.emit('move', { roomId, move: { from: myPending.attackerSq, to: sq } });
    else if (myPending.kind === 'spell_target') socket.emit('spell-target', { roomId, targetSq: sq });
  }, [roomId, myPending]);

  const targetMode = useMemo(() => {
    if (!myPending || !playing) return null;
    if (myPending.kind === 'shield_break') return { candidates: myPending.candidates, onSelect: handleTargetSelect };
    if (myPending.kind === 'spell_target') return { candidates: null, onSelect: handleTargetSelect };
    return null;
  }, [myPending, playing, handleTargetSelect]);

  const handleSkipExtraMove = useCallback(() => { if (roomId) socket.emit('skip-extra-move', { roomId }); }, [roomId]);
  const handleCastSpell = useCallback((spellId: string) => { if (roomId) socket.emit('cast-spell', { roomId, spellId }); }, [roomId]);
  const handleCancelSpell = useCallback(() => { if (roomId) socket.emit('cancel-spell', { roomId }); }, [roomId]);

  const handleResign = () => {
    if (!roomId || !playing) return;
    if (window.confirm('Ви впевнені, що хочете здатися?')) socket.emit('resign', { roomId });
  };
  const handleDrawOffer = () => {
    if (!roomId || !playing) return;
    socket.emit('offer-draw', { roomId });
    toast.success('Пропозицію нічиї надіслано');
  };
  const handleRematch = () => { if (roomId) socket.emit('rematch', { roomId }); };
  const handleReplay = () => { if (roomId) socket.emit('request-replay', { roomId }); };

  // ── Main game UI ──────────────────────────────────────────────────────
  const opponent = gameState?.players.find((p) => p.color !== yourColor);
  const me = gameState?.players.find((p) => p.color === yourColor);
  const oppColor: Color = yourColor === 'w' ? 'b' : 'w';
  const material = gameState?.material ?? { w: 0, b: 0 };
  const captured = gameState?.captured ?? { w: [], b: [] };
  const pendingSpellId = myPending?.kind === 'spell_target' ? myPending.spellId : null;
  const spellName = pendingSpellId && md ? md.spells[yourColor!]?.find(s => s.id === pendingSpellId)?.name ?? null : null;

  return (
    // anchored to the top: a vertically centred layout shifts the board every time a hint appears
    <div className="min-h-screen flex flex-col items-center p-4 lg:p-8">
      <div className="w-full max-w-6xl">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-6">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
            ← На головну
          </button>
          <div className="flex items-center gap-2">
            {MODE_LABEL[mode] && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {MODE_LABEL[mode]}
              </span>
            )}
            <span className="text-slate-500 text-sm font-mono">#{roomId}</span>
            <button onClick={() => setShowShare(true)} className="btn-secondary text-xs py-1.5 px-3">📋 Запросити</button>
          </div>
        </motion.div>

        <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
          {/* Board column */}
          <div className="flex flex-col items-center gap-3 w-full lg:w-auto">
            <PlayerCard
              player={opponent} isOpponent
              isActive={!!playing && gameState?.turn === oppColor}
              captured={captured[oppColor]} advantage={material[oppColor] - material[yourColor ?? 'w']}
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className={`chess-container ${myTurn ? 'my-turn' : ''}`}
            >
              {gameState && ex ? (
                <BigBoard
                  data={ex}
                  yourColor={yourColor}
                  canInteract={myTurn}
                  legalMoves={gameState.legalMoves}
                  onMove={handleMove}
                  lastMove={gameState.lastMove}
                  flashes={flashes}
                  highlightZone={zoneHighlight}
                />
              ) : gameState ? (
                <ChessBoard
                  fen={gameState.fen}
                  yourColor={yourColor}
                  canInteract={myTurn}
                  legalMoves={gameState.legalMoves}
                  onMove={handleMove}
                  lastMove={gameState.lastMove}
                  checkSquare={checkSquare}
                  squareStyles={squareStyles}
                  badges={badges}
                  centerIcons={centerIcons}
                  fogCoverSquares={fogCoverSquares}
                  targetMode={targetMode}
                  selectionExtras={selectionExtras}
                  animationDuration={mode === 'fog' ? 0 : 200}
                  flashes={flashes}
                />
              ) : (
                <div className="w-[480px] h-[480px] flex items-center justify-center bg-slate-800 rounded-xl">
                  <div className="text-4xl animate-spin">♟</div>
                </div>
              )}
            </motion.div>

            <TurnBar
              state={gameState}
              yourColor={yourColor}
              spellName={spellName}
              onSkipExtraMove={handleSkipExtraMove}
              onCancelSpell={handleCancelSpell}
            />

            <PlayerCard
              player={me} isOpponent={false}
              isActive={myTurn}
              captured={yourColor ? captured[yourColor] : []} advantage={yourColor ? material[yourColor] - material[oppColor] : 0}
            />
          </div>

          {/* Sidebar */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="flex flex-col gap-4 w-full lg:w-72">
            {!isSpectator && playing && (
              <div className="glass rounded-2xl p-4 flex flex-col gap-2">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Дії</p>
                <button onClick={handleDrawOffer} className="btn-secondary text-sm w-full">🤝 Запропонувати нічию</button>
                <button onClick={handleResign} className="btn-danger text-sm w-full">🏳 Здатися</button>
              </div>
            )}

            {mode === 'magic' && md && yourColor && (
              <SpellPanel
                data={md}
                yourColor={yourColor}
                isYourTurn={myTurn}
                pendingSpellId={pendingSpellId}
                onCastSpell={handleCastSpell}
                onCancel={handleCancelSpell}
              />
            )}

            {mode === 'lootbox' && lb && gameState && (
              <LootPanel data={lb} fen={gameState.fen} yourColor={yourColor} />
            )}

            {mode === 'expand' && ex && gameState && (
              <ExpandPanel
                data={ex}
                yourColor={yourColor}
                turn={gameState.turn}
                highlight={zoneHighlight}
                onHighlight={setZoneHighlight}
              />
            )}

            {mode === 'fog' && (
              <div className="glass rounded-2xl p-4 text-xs text-slate-400 leading-relaxed">
                🌫️ Ви бачите лише клітинки під ударом своїх фігур. Фігура, що дає шах, видима завжди.
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
            onRematch={handleRematch} onHome={() => navigate('/')} onReplay={handleReplay}
          />
        )}
        {replay && gameState && (
          <ReplayModal
            frames={replay}
            mode={gameState.mode}
            yourColor={yourColor}
            onClose={() => setReplay(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
