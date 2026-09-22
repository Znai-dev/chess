import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { Chess } from 'chess.js';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import { GameMode, LootboxData, FogData, MagicData, Color, MoveOption, GameEvent, Pending } from './modes/types';
import {
  initLootboxData, applyLootboxMove, computeLootboxMoves, spawnLootboxes, skipExtraMove, serializeLootboxData, debugLootbox,
} from './modes/lootbox';
import { initFogData, getFogStateForPlayer, computeFogMoves } from './modes/fog';
import {
  initMagicData, handleMagicPostMove, castSpell, cancelSpell, applySpellWithTarget,
  checkMagicPreMove, serializeMagicData, maskedFenFor, computeMagicMoves, thawIfStuck,
} from './modes/magic';
import { flipTurn, otherColor, capturedPieces, materialOf } from './modes/helpers';

interface Player {
  socketId: string;
  color: Color;
  name: string;
  connected: boolean;
}

interface LogEntry { color: Color; san: string }

interface Room {
  id: string;
  game: Chess;
  players: Player[];
  status: 'waiting' | 'playing' | 'finished';
  drawOffer: Color | null;
  mode: GameMode;
  lootboxData: LootboxData | null;
  fogData: FogData | null;
  magicData: MagicData | null;
  /** chess.js forgets its history whenever we rewrite the FEN, so we keep our own */
  log: LogEntry[];
  lastMove: { from: string; to: string } | null;
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

const rooms = new Map<string, Room>();

const GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

// ── State for clients ──────────────────────────────────────────────────────

/** Whose turn it really is: a pending action belongs to its owner even if chess.js disagrees. */
function activeColor(room: Room): Color {
  if (room.mode === 'lootbox' && room.lootboxData?.pending) return room.lootboxData.pending.color;
  return room.game.turn();
}

function legalMovesFor(room: Room, color: Color): MoveOption[] {
  if (room.status !== 'playing' || activeColor(room) !== color) return [];
  switch (room.mode) {
    case 'lootbox':
      return computeLootboxMoves(room.game, room.lootboxData!, color).options;
    case 'fog':
      return computeFogMoves(room.game, color);
    case 'magic':
      return computeMagicMoves(room.game, room.magicData!, color);
    default:
      return room.game.moves({ verbose: true }).map(m => ({ from: m.from, to: m.to, kind: 'normal' as const, capture: !!m.captured }));
  }
}

function pendingFor(room: Room): Pending | { kind: 'spell_target'; spellId: string; color: Color } {
  if (room.mode === 'lootbox') return room.lootboxData?.pending ?? null;
  if (room.mode === 'magic' && room.magicData?.pendingSpell) {
    return { kind: 'spell_target', spellId: room.magicData.pendingSpell.spellId, color: room.magicData.pendingSpell.color };
  }
  return null;
}

function buildState(room: Room, color: Color | null) {
  const game = room.game;
  const base = {
    id: room.id,
    status: room.status,
    mode: room.mode,
    fen: game.fen(),
    turn: activeColor(room),
    players: room.players.map((p) => ({ name: p.name, color: p.color, connected: p.connected })),
    history: room.log,
    captured: capturedPieces(game),
    material: { w: materialOf(game, 'w'), b: materialOf(game, 'b') },
    inCheck: game.inCheck(),
    isGameOver: room.status === 'finished',
    drawOffer: room.drawOffer,
    lastMove: room.lastMove,
    legalMoves: color ? legalMovesFor(room, color) : [],
    pending: pendingFor(room),
    yourColor: color,
  };

  if (room.mode === 'fog' && room.fogData) {
    if (!color) return { ...base, fogData: { visibleSquares: [] as string[] } };
    const fogState = getFogStateForPlayer(game, room.fogData, color);
    return { ...base, fen: fogState.fen, fogData: fogState.fogData };
  }
  if (room.mode === 'lootbox' && room.lootboxData) {
    return { ...base, lootboxData: serializeLootboxData(room.lootboxData) };
  }
  if (room.mode === 'magic' && room.magicData) {
    const fen = color ? maskedFenFor(game, room.magicData, color) : game.fen();
    return { ...base, fen, magicData: serializeMagicData(room.magicData) };
  }
  return base;
}

function emitState(room: Room, event: string, extra: object = {}) {
  const playerSockets: string[] = [];
  for (const p of room.players) {
    playerSockets.push(p.socketId);
    io.to(p.socketId).emit(event, { ...buildState(room, p.color), ...extra });
  }
  io.to(room.id).except(playerSockets).emit(event, { ...buildState(room, null), ...extra });
}

function initModeData(room: Room) {
  room.lootboxData = null; room.fogData = null; room.magicData = null;
  if (room.mode === 'lootbox') {
    room.lootboxData = initLootboxData();
    spawnLootboxes(room.game, room.lootboxData);
    spawnLootboxes(room.game, room.lootboxData);
  } else if (room.mode === 'fog') {
    room.fogData = initFogData();
  } else if (room.mode === 'magic') {
    room.magicData = initMagicData();
  }
}

// ── After every change: detect the end, then broadcast ────────────────────

function afterChange(room: Room, events: GameEvent[]) {
  const game = room.game;
  let over: { reason: string; winner: Color | null } | null = null;

  if (room.mode === 'lootbox') {
    const data = room.lootboxData!;
    const next = activeColor(room);
    const { options, suspended } = computeLootboxMoves(game, data, next);
    if (suspended) {
      data.effectsSuspended = next;
      events.push({ type: 'effects_suspended', color: next });
    }
    if (!data.pending && options.length === 0) {
      over = game.inCheck()
        ? { reason: 'checkmate', winner: otherColor(next) }
        : { reason: 'stalemate', winner: null };
    }
  } else {
    if (room.mode === 'magic' && thawIfStuck(game, room.magicData!, game.turn())) {
      events.push({ type: 'thawed', color: game.turn() });
    }
    if (game.isCheckmate()) over = { reason: 'checkmate', winner: otherColor(game.turn()) };
    else if (game.isStalemate()) over = { reason: 'stalemate', winner: null };
    else if (game.isInsufficientMaterial()) over = { reason: 'insufficient-material', winner: null };
    else if (game.isThreefoldRepetition()) over = { reason: 'threefold-repetition', winner: null };
    else if (game.isDraw()) over = { reason: 'draw', winner: null };
  }

  if (over) room.status = 'finished';
  emitState(room, 'move-made', { events });
  if (over) io.to(room.id).emit('game-over', over);
}

function rejectMove(socket: Socket, room: Room, color: Color, message: string) {
  socket.emit('invalid-move', { message });
  socket.emit('game-state', buildState(room, color));
}

function lootboxLabel(room: Room, move: { from: string; to: string }, kind: string, capture: boolean): string {
  const data = room.lootboxData!;
  const from = data.pending?.kind === 'shield_break' ? data.pending.attackerSq : move.from;
  const piece = room.game.get(from as any);
  const arrow = kind === 'teleport' ? '⇝' : kind === 'rage' ? '⤳' : kind === 'knight' ? '↷' : capture ? '×' : '→';
  return `${piece ? GLYPH[piece.type] : ''}${from}${arrow}${move.to}`;
}

// ── REST ───────────────────────────────────────────────────────────────────

app.post('/api/rooms', (req, res) => {
  const mode: GameMode = req.body?.mode ?? 'classic';
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  rooms.set(roomId, {
    id: roomId,
    game: new Chess(),
    players: [],
    status: 'waiting',
    drawOffer: null,
    mode,
    lootboxData: null,
    fogData: null,
    magicData: null,
    log: [],
    lastMove: null,
  });
  res.json({ roomId, mode });
});

// Dev only: rig the next box / put an effect on a piece, to test the UI deterministically
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/debug/lootbox/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.mode !== 'lootbox' || !room.lootboxData) return res.status(404).json({ error: 'no lootbox room' });
    debugLootbox(room.game, room.lootboxData, req.body ?? {});
    emitState(room, 'move-made', { events: [] });
    res.json({ ok: true, effects: room.lootboxData.effects, boxes: room.lootboxData.lootboxes.map(l => l.sq) });
  });
}

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ id: room.id, status: room.status, playerCount: room.players.length, mode: room.mode });
});

// ── Socket ─────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  let currentRoomId: string | null = null;

  const playerUpdate = (room: Room) =>
    io.to(room.id).emit('player-update', room.players.map((p) => ({ name: p.name, color: p.color, connected: p.connected })));

  socket.on('join-room', ({ roomId, playerName }: { roomId: string; playerName: string }) => {
    const id = roomId.toUpperCase();
    const room = rooms.get(id);
    if (!room) { socket.emit('error', { message: 'Кімнату не знайдено' }); return; }

    currentRoomId = id;
    socket.join(id);

    // Reconnect / takeover: the same name is the same person (a refresh, a second
    // tab, React's double-mounted effect). Never let them join twice as two players.
    const existing = room.players.find((p) => p.name === playerName);
    if (existing) {
      existing.socketId = socket.id;
      existing.connected = true;
      socket.emit('game-state', buildState(room, existing.color));
      playerUpdate(room);
      return;
    }

    if (room.players.length < 2) {
      const color: Color = room.players.length === 0 ? 'w' : 'b';
      room.players.push({ socketId: socket.id, color, name: playerName || `Гравець ${room.players.length + 1}`, connected: true });

      if (room.players.length === 2) {
        room.status = 'playing';
        initModeData(room);
      }

      socket.emit('game-state', buildState(room, color));
      playerUpdate(room);
      if (room.players.length === 2) emitState(room, 'game-start');
    } else {
      socket.emit('game-state', buildState(room, null));
    }
  });

  // ── Move ──────────────────────────────────────────────────────────────────

  socket.on('move', ({ roomId, move }: { roomId: string; move: { from: string; to: string; promotion?: string } }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.status !== 'playing') return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    const color = player.color;
    if (activeColor(room) !== color) { rejectMove(socket, room, color, 'Не ваш хід'); return; }

    // ── Classic / Fog ──────────────────────────────────────────────────────
    if (room.mode === 'classic' || room.mode === 'fog') {
      let result;
      try { result = room.game.move(move); } catch { result = null; }
      if (!result) { rejectMove(socket, room, color, room.mode === 'fog' ? 'Хід неможливий — щось у тумані' : 'Недозволений хід'); return; }
      room.log.push({ color, san: result.san });
      room.lastMove = { from: result.from, to: result.to };
      room.drawOffer = null;
      afterChange(room, []);
      return;
    }

    // ── Lootbox ────────────────────────────────────────────────────────────
    if (room.mode === 'lootbox') {
      const data = room.lootboxData!;
      const { options } = computeLootboxMoves(room.game, data, color);
      const opt = options.find(o => o.from === move.from && o.to === move.to);
      if (!opt) { rejectMove(socket, room, color, 'Недозволений хід'); return; }
      const label = lootboxLabel(room, move, opt.kind, opt.capture);

      const res = applyLootboxMove(room.game, data, move, color);
      if (!res.ok) { rejectMove(socket, room, color, res.reason); return; }

      const absorbed = res.events.find(e => e.type === 'shield_absorb');
      room.log.push({ color, san: absorbed ? `${label} 🛡` : label });
      if (res.lastMove) room.lastMove = res.lastMove;
      room.drawOffer = null;
      afterChange(room, res.events);
      return;
    }

    // ── Magic ──────────────────────────────────────────────────────────────
    if (room.mode === 'magic') {
      const data = room.magicData!;
      const { from, to } = move;

      const preCheck = checkMagicPreMove(data, from);
      if (!preCheck.ok) { rejectMove(socket, room, color, preCheck.reason); return; }

      const targetPiece = room.game.get(to as any);
      const events: GameEvent[] = [];

      // Shield: the attack is absorbed and the move is spent. Never while in
      // check - the check must stay resolvable.
      if (targetPiece && targetPiece.color !== color && data.pieceShields[to] && targetPiece.type !== 'k' && !room.game.inCheck()) {
        const legal = room.game.moves({ verbose: true }).some(m => m.from === from && m.to === to);
        if (!legal) { rejectMove(socket, room, color, 'Недозволений хід'); return; }
        delete data.pieceShields[to];
        data.pendingSpell = null;
        data.spellUsedThisTurn[color] = false;
        flipTurn(room.game);
        room.log.push({ color, san: `${from}×${to} 🛡` });
        room.lastMove = null;
        events.push({ type: 'shield_absorb', at: to, attackerSq: from, color, stayed: true });
        afterChange(room, events);
        return;
      }

      let result;
      try { result = room.game.move({ from, to, promotion: move.promotion || 'q' }); } catch { result = null; }
      if (!result) {
        // The player's view may have hidden the piece that blocks this move
        const seemedLegal = computeMagicMoves(room.game, data, color).some(m => m.from === from && m.to === to);
        rejectMove(socket, room, color, seemedLegal ? 'Шлях перекриває невидима фігура!' : 'Недозволений хід');
        if (seemedLegal) socket.emit('move-made', { ...buildState(room, color), events: [{ type: 'blocked_by_invisible', color }] });
        return;
      }

      events.push(...handleMagicPostMove(room.game, data, from, to, result.captured, color));
      room.log.push({ color, san: result.san });
      room.lastMove = { from, to };
      room.drawOffer = null;
      afterChange(room, events);
    }
  });

  // ── Skip extra move (lootbox mode) ─────────────────────────────────────

  socket.on('skip-extra-move', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.mode !== 'lootbox' || room.status !== 'playing') return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    if (!skipExtraMove(room.game, room.lootboxData!, player.color)) return;
    room.log.push({ color: player.color, san: '⚡ пропуск' });
    afterChange(room, []);
  });

  // ── Spell events (magic mode) ──────────────────────────────────────────

  socket.on('cast-spell', ({ roomId, spellId }: { roomId: string; spellId: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.mode !== 'magic' || room.status !== 'playing') return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player || room.game.turn() !== player.color) {
      socket.emit('spell-error', { message: 'Не ваш хід' }); return;
    }
    const result = castSpell(room.magicData!, spellId, player.color);
    if (!result.ok) { socket.emit('spell-error', { message: result.reason }); return; }
    socket.emit('game-state', buildState(room, player.color));
  });

  socket.on('cancel-spell', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.mode !== 'magic') return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    if (cancelSpell(room.magicData!, player.color)) socket.emit('game-state', buildState(room, player.color));
  });

  socket.on('spell-target', ({ roomId, targetSq }: { roomId: string; targetSq: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.mode !== 'magic' || room.status !== 'playing') return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    const spellId = room.magicData!.pendingSpell?.spellId ?? '';
    const result = applySpellWithTarget(room.game, room.magicData!, targetSq, player.color);
    if (!result.ok) { socket.emit('spell-error', { message: result.reason }); socket.emit('game-state', buildState(room, player.color)); return; }
    room.log.push({ color: player.color, san: `✨${spellId}→${targetSq}` });
    emitState(room, 'move-made', { events: [{ type: 'spell', spellId, target: targetSq, color: player.color }] });
  });

  // ── Standard events ────────────────────────────────────────────────────

  socket.on('resign', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.status !== 'playing') return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    room.status = 'finished';
    emitState(room, 'move-made', { events: [] });
    io.to(room.id).emit('game-over', { reason: 'resign', winner: otherColor(player.color), loserName: player.name });
  });

  socket.on('offer-draw', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    room.drawOffer = player.color;
    const opponent = room.players.find((p) => p.socketId !== socket.id);
    if (opponent) io.to(opponent.socketId).emit('draw-offered', { from: player.name });
  });

  socket.on('respond-draw', ({ roomId, accept }: { roomId: string; accept: boolean }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return;
    if (accept) {
      room.status = 'finished';
      room.drawOffer = null;
      emitState(room, 'move-made', { events: [] });
      io.to(room.id).emit('game-over', { reason: 'draw-agreement', winner: null });
    } else {
      const offerer = room.players.find((p) => p.color === room.drawOffer);
      room.drawOffer = null;
      if (offerer) io.to(offerer.socketId).emit('draw-declined');
    }
  });

  socket.on('rematch', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return;
    room.game = new Chess();
    room.status = 'playing';
    room.drawOffer = null;
    room.log = [];
    room.lastMove = null;
    room.players.forEach((p) => { p.color = otherColor(p.color); });
    initModeData(room);
    emitState(room, 'rematch-start');
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (player) {
      player.connected = false;
      playerUpdate(room);
      io.to(room.id).emit('player-disconnected', { color: player.color, name: player.name });
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Backend running on :${PORT}`));
