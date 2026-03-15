import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';

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
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

const rooms = new Map<string, Room>();

function roomPublic(room: Room) {
  return {
    id: room.id,
    status: room.status,
    fen: room.game.fen(),
    turn: room.game.turn(),
    players: room.players.map((p) => ({
      name: p.name,
      color: p.color,
      connected: p.connected,
    })),
    history: room.game.history({ verbose: true }),
    inCheck: room.game.inCheck(),
    isGameOver: room.game.isGameOver(),
    isCheckmate: room.game.isCheckmate(),
    isDraw: room.game.isDraw(),
    isStalemate: room.game.isStalemate(),
    drawOffer: room.drawOffer,
  };
}

app.post('/api/rooms', (_req, res) => {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  rooms.set(roomId, {
    id: roomId,
    game: new Chess(),
    players: [],
    status: 'waiting',
    drawOffer: null,
  });
  res.json({ roomId });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    id: room.id,
    status: room.status,
    playerCount: room.players.length,
  });
});

io.on('connection', (socket) => {
  let currentRoomId: string | null = null;

  socket.on('join-room', ({ roomId, playerName }: { roomId: string; playerName: string }) => {
    const id = roomId.toUpperCase();
    const room = rooms.get(id);
    if (!room) {
      socket.emit('error', { message: 'Кімнату не знайдено' });
      return;
    }

    currentRoomId = id;
    socket.join(id);

    // Reconnect existing player
    const existing = room.players.find((p) => p.name === playerName && !p.connected);
    if (existing) {
      existing.socketId = socket.id;
      existing.connected = true;
      socket.emit('game-state', { ...roomPublic(room), yourColor: existing.color });
      io.to(id).emit('player-update', room.players.map((p) => ({ name: p.name, color: p.color, connected: p.connected })));
      return;
    }

    if (room.players.length < 2) {
      const color: 'w' | 'b' = room.players.length === 0 ? 'w' : 'b';
      room.players.push({ socketId: socket.id, color, name: playerName || `Гравець ${room.players.length + 1}`, connected: true });

      if (room.players.length === 2) {
        room.status = 'playing';
      }

      socket.emit('game-state', { ...roomPublic(room), yourColor: color });
      io.to(id).emit('player-update', room.players.map((p) => ({ name: p.name, color: p.color, connected: p.connected })));

      if (room.players.length === 2) {
        io.to(id).emit('game-start', roomPublic(room));
      }
    } else {
      // Spectator
      socket.emit('game-state', { ...roomPublic(room), yourColor: null });
    }
  });

  socket.on('move', ({ roomId, move }: { roomId: string; move: { from: string; to: string; promotion?: string } }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.status !== 'playing') return;

    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player || room.game.turn() !== player.color) {
      socket.emit('invalid-move', { message: 'Не ваш хід' });
      return;
    }

    try {
      const result = room.game.move(move);
      if (!result) { socket.emit('invalid-move', { message: 'Недозволений хід' }); return; }

      if (room.game.isGameOver()) room.status = 'finished';
      room.drawOffer = null;

      io.to(roomId.toUpperCase()).emit('move-made', {
        ...roomPublic(room),
        lastMove: { from: result.from, to: result.to },
      });
    } catch {
      socket.emit('invalid-move', { message: 'Недозволений хід' });
    }
  });

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
      room.drawOffer = null;
      const offerer = room.players.find((p) => p.color === room.drawOffer);
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
    // Swap colors
    room.players.forEach((p) => { p.color = p.color === 'w' ? 'b' : 'w'; });
    io.to(roomId.toUpperCase()).emit('rematch-start', roomPublic(room));
    // Tell each player their new color
    room.players.forEach((p) => {
      io.to(p.socketId).emit('your-color', p.color);
    });
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
