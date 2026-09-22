import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import { GameMode, LootboxData, FogData, MagicData } from './modes/types';
import { initLootboxData, handleLootboxMove, spawnLootboxes } from './modes/lootbox';
import { initFogData, getFogStateForPlayer } from './modes/fog';
import {
  initMagicData, handleMagicPostMove, castSpell, applySpellWithTarget,
  checkMagicPreMove, serializeMagicData,
} from './modes/magic';
import { flipTurn } from './modes/helpers';

interface Player {
  socketId: string;
  color: 'w' | 'b';
  name: string;
  connected: boolean;
}

interface Room {
  id: string;
  game: Chess;
  players: Player[];
  status: 'waiting' | 'playing' | 'finished';
  drawOffer: 'w' | 'b' | null;
  mode: GameMode;
  lootboxData: LootboxData | null;
  fogData: FogData | null;
  magicData: MagicData | null;
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

const rooms = new Map<string, Room>();

// ── Helpers ────────────────────────────────────────────────────────────────

function getMagicFenForPlayer(chess: Chess, magicData: MagicData, color: 'w' | 'b'): string {
  const opp = color === 'w' ? 'b' : 'w';
  const board = chess.board();
  let fenPos = '';
  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    let empty = 0;
    for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
      const sq = String.fromCharCode('a'.charCodeAt(0) + fileIdx) + (8 - rankIdx);
      const piece = board[rankIdx][fileIdx];
      const isInvisibleEnemy = piece?.color === opp && (magicData.invisiblePieces[sq] ?? 0) > 0 && piece?.type !== 'k';
      if (!piece || isInvisibleEnemy) {
        empty++;
      } else {
        if (empty) { fenPos += empty; empty = 0; }
        fenPos += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
      }
    }
    if (empty) fenPos += empty;
    if (rankIdx < 7) fenPos += '/';
  }
  const parts = chess.fen().split(' ');
  return [fenPos, parts[1], parts[2], parts[3], parts[4], parts[5]].join(' ');
}

function roomPublicForPlayer(room: Room, color: 'w' | 'b' | null) {
  const base = {
    id: room.id,
    status: room.status,
    mode: room.mode,
    fen: room.game.fen(),
    turn: room.game.turn(),
    players: room.players.map((p) => ({ name: p.name, color: p.color, connected: p.connected })),
    history: room.game.history({ verbose: true }),
    inCheck: room.game.inCheck(),
    isGameOver: room.game.isGameOver(),
    isCheckmate: room.game.isCheckmate(),
    isDraw: room.game.isDraw(),
    isStalemate: room.game.isStalemate(),
    drawOffer: room.drawOffer,
  };

  if (room.mode === 'fog' && room.fogData && color) {
    const fogState = getFogStateForPlayer(room.game, room.fogData, color);
    return { ...base, fen: fogState.fen, fogData: fogState.fogData };
  }
  if (room.mode === 'fog' && room.fogData && !color) {
    return { ...base, fogData: { visibleSquares: [] } };
  }

  if (room.mode === 'lootbox' && room.lootboxData) {
    return { ...base, lootboxData: { ...room.lootboxData } };
  }

  if (room.mode === 'magic' && room.magicData) {
    const fen = color ? getMagicFenForPlayer(room.game, room.magicData, color) : room.game.fen();
    return { ...base, fen, magicData: serializeMagicData(room.magicData) };
  }

  return base;
}

function emitToRoom(room: Room, event: string, extra: object = {}) {
  if (room.mode === 'fog' || room.mode === 'magic') {
    for (const p of room.players) {
      io.to(p.socketId).emit(event, { ...roomPublicForPlayer(room, p.color), ...extra });
    }
  } else {
    io.to(room.id).emit(event, { ...roomPublicForPlayer(room, null), ...extra });
  }
}

function initModeData(room: Room) {
  if (room.mode === 'lootbox') {
    room.lootboxData = initLootboxData();
    // Spawn initial lootboxes
    spawnLootboxes(room.game, room.lootboxData);
    spawnLootboxes(room.game, room.lootboxData);
  } else if (room.mode === 'fog') {
    room.fogData = initFogData();
  } else if (room.mode === 'magic') {
    room.magicData = initMagicData();
  }
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
  });
  res.json({ roomId, mode });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ id: room.id, status: room.status, playerCount: room.players.length, mode: room.mode });
});

// ── Socket ─────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  let currentRoomId: string | null = null;

  socket.on('join-room', ({ roomId, playerName }: { roomId: string; playerName: string }) => {
    const id = roomId.toUpperCase();
    const room = rooms.get(id);
    if (!room) { socket.emit('error', { message: 'Кімнату не знайдено' }); return; }

    currentRoomId = id;
    socket.join(id);

    // Reconnect
    const existing = room.players.find((p) => p.name === playerName && !p.connected);
    if (existing) {
      existing.socketId = socket.id;
      existing.connected = true;
      socket.emit('game-state', { ...roomPublicForPlayer(room, existing.color), yourColor: existing.color });
      io.to(id).emit('player-update', room.players.map((p) => ({ name: p.name, color: p.color, connected: p.connected })));
      return;
    }

    if (room.players.length < 2) {
      const color: 'w' | 'b' = room.players.length === 0 ? 'w' : 'b';
      room.players.push({ socketId: socket.id, color, name: playerName || `Гравець ${room.players.length + 1}`, connected: true });

      if (room.players.length === 2) {
        room.status = 'playing';
        initModeData(room);
      }

      socket.emit('game-state', { ...roomPublicForPlayer(room, color), yourColor: color });
      io.to(id).emit('player-update', room.players.map((p) => ({ name: p.name, color: p.color, connected: p.connected })));

      if (room.players.length === 2) {
        // game-start sent per-player for fog/magic
        if (room.mode === 'fog' || room.mode === 'magic') {
          for (const p of room.players) {
            io.to(p.socketId).emit('game-start', { ...roomPublicForPlayer(room, p.color), yourColor: p.color });
          }
        } else {
          io.to(id).emit('game-start', { ...roomPublicForPlayer(room, null) });
        }
      }
    } else {
      socket.emit('game-state', { ...roomPublicForPlayer(room, null), yourColor: null });
    }
  });

  // ── Move ──────────────────────────────────────────────────────────────────

  socket.on('move', ({ roomId, move }: { roomId: string; move: { from: string; to: string; promotion?: string } }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.status !== 'playing') return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    const color = player.color;

    // ── Classic / Fog ──────────────────────────────────────────────────────
    if (room.mode === 'classic' || room.mode === 'fog') {
      if (room.game.turn() !== color) { socket.emit('invalid-move', { message: 'Не ваш хід' }); return; }
      try {
        const result = room.game.move(move);
        if (!result) { socket.emit('invalid-move', { message: 'Недозволений хід' }); return; }
        if (room.game.isGameOver()) room.status = 'finished';
        room.drawOffer = null;
        emitToRoom(room, 'move-made', { lastMove: { from: result.from, to: result.to } });
      } catch { socket.emit('invalid-move', { message: 'Недозволений хід' }); }
      return;
    }

    // ── Lootbox ────────────────────────────────────────────────────────────
    if (room.mode === 'lootbox') {
      const data = room.lootboxData!;
      const hasPending = data.extraMovePending?.color === color ||
                         data.teleportPending?.color === color ||
                         data.shieldBreakPending?.color === color;
      if (!hasPending && room.game.turn() !== color) {
        socket.emit('invalid-move', { message: 'Не ваш хід' }); return;
      }
      const lbResult = handleLootboxMove(room.game, data, move, color);
      if (!lbResult.ok) { socket.emit('invalid-move', { message: lbResult.reason }); return; }

      if (lbResult.needsTarget) {
        socket.emit('lootbox-needs-target', { type: lbResult.type, candidates: lbResult.candidates, attackerSq: (data.shieldBreakPending as any)?.attackerSq });
        emitToRoom(room, 'move-made', { lastMove: { from: move.from, to: move.to } });
        return;
      }

      // If same player gets to move again, flip turn back
      if (data.extraMovePending?.color === color || data.teleportPending?.color === color) {
        flipTurn(room.game);
      }

      if (room.game.isGameOver()) room.status = 'finished';
      room.drawOffer = null;
      emitToRoom(room, 'move-made', { lastMove: { from: move.from, to: move.to } });
      return;
    }

    // ── Magic ──────────────────────────────────────────────────────────────
    if (room.mode === 'magic') {
      const data = room.magicData!;
      const { from, to } = move;

      if (room.game.turn() !== color) { socket.emit('invalid-move', { message: 'Не ваш хід' }); return; }

      const preCheck = checkMagicPreMove(data, from);
      if (!preCheck.ok) { socket.emit('invalid-move', { message: preCheck.reason }); return; }

      const targetPiece = room.game.get(to as any);

      // Shield intercept: attack on shielded piece consumes shield and wastes the move
      if (targetPiece && targetPiece.color !== color && data.pieceShields[to] && targetPiece.type !== 'k') {
        delete data.pieceShields[to];
        socket.emit('shield-blocked', { at: to });
        flipTurn(room.game);
        emitToRoom(room, 'move-made', { lastMove: null });
        return;
      }

      let captured: string | undefined;
      try {
        const result = room.game.move({ from, to, promotion: move.promotion || 'q' });
        if (!result) { socket.emit('invalid-move', { message: 'Недозволений хід' }); return; }
        captured = result.captured;
      } catch { socket.emit('invalid-move', { message: 'Недозволений хід' }); return; }

      handleMagicPostMove(room.game, data, from, to, captured, color);

      if (room.game.isGameOver()) room.status = 'finished';
      room.drawOffer = null;
      emitToRoom(room, 'move-made', { lastMove: { from, to } });
    }
  });

  // ── Skip extra move / teleport (lootbox mode) ─────────────────────────

  socket.on('skip-extra-move', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.mode !== 'lootbox' || room.status !== 'playing') return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    const data = room.lootboxData!;
    if (data.extraMovePending?.color === player.color) {
      data.extraMovePending = null;
    } else if (data.teleportPending?.color === player.color) {
      data.teleportPending = null;
    } else {
      return; // nothing to skip
    }
    emitToRoom(room, 'move-made', { lastMove: null });
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
    if (result.needsTarget) { socket.emit('spell-needs-target', { spellId }); return; }
    // No-target spell (currently unused) — update state without ending turn
    emitToRoom(room, 'move-made', { lastMove: null });
    socket.emit('spell-cast', { spellId });
  });

  socket.on('spell-target', ({ roomId, targetSq }: { roomId: string; targetSq: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.mode !== 'magic' || room.status !== 'playing') return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    const result = applySpellWithTarget(room.game, room.magicData!, targetSq, player.color);
    if (!result.ok) { socket.emit('spell-error', { message: result.reason }); return; }
    // Spell applied — update state but keep the turn (player still makes a move)
    emitToRoom(room, 'move-made', { lastMove: null });
    socket.emit('spell-cast', { targetSq });
  });

  // ── Standard events ────────────────────────────────────────────────────

  socket.on('resign', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    room.status = 'finished';
    io.to(roomId.toUpperCase()).emit('game-over', {
      reason: 'resign',
      winner: player.color === 'w' ? 'b' : 'w',
      loserName: player.name,
    });
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
      io.to(roomId.toUpperCase()).emit('game-over', { reason: 'draw-agreement', winner: null });
    } else {
      const offererColor = room.drawOffer;
      room.drawOffer = null;
      const offerer = room.players.find((p) => p.color === offererColor);
      if (offerer) io.to(offerer.socketId).emit('draw-declined');
      io.to(roomId.toUpperCase()).emit('draw-update', { drawOffer: null });
    }
  });

  socket.on('rematch', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return;
    room.game = new Chess();
    room.status = 'playing';
    room.drawOffer = null;
    room.lootboxData = null;
    room.fogData = null;
    room.magicData = null;
    room.players.forEach((p) => { p.color = p.color === 'w' ? 'b' : 'w'; });
    initModeData(room);
    if (room.mode === 'fog' || room.mode === 'magic') {
      for (const p of room.players) {
        io.to(p.socketId).emit('rematch-start', { ...roomPublicForPlayer(room, p.color), yourColor: p.color });
      }
    } else {
      io.to(roomId.toUpperCase()).emit('rematch-start', roomPublicForPlayer(room, null));
    }
    room.players.forEach((p) => { io.to(p.socketId).emit('your-color', p.color); });
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (player) {
      player.connected = false;
      io.to(currentRoomId).emit('player-update', room.players.map((p) => ({ name: p.name, color: p.color, connected: p.connected })));
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Backend running on :${PORT}`));
