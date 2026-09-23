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
import {
  ExpandData, initExpandData, legalExpandMoves, applyExpandMove, serializeExpand,
  expandMaterial, inCheck as expandInCheck,
} from './modes/expand';
import { flipTurn, otherColor, capturedPieces, materialOf } from './modes/helpers';
import {
  BotEnv, Difficulty, chooseBotMove, isDifficulty, BOT_NAMES, BOT_DELAY_MS,
} from './bot';

interface Player {
  socketId: string;
  color: Color;
  name: string;
  connected: boolean;
  isBot?: boolean;
}

interface LogEntry { color: Color; san: string }

/** One position in the game record — enough for the client to redraw the board. */
interface ReplayFrame {
  san: string;
  color: Color | null;
  lastMove: { from: string; to: string } | null;
  fen: string;
  expand?: ReturnType<typeof serializeExpand>;
}

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
  expandData: ExpandData | null;
  /** chess.js forgets its history whenever we rewrite the FEN, so we keep our own */
  log: LogEntry[];
  lastMove: { from: string; to: string } | null;
  bot: { difficulty: Difficulty; color: Color } | null;
  botTimer: NodeJS.Timeout | null;
  frames: ReplayFrame[];
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
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const publicPlayers = (room: Room) =>
  room.players.map((p) => ({ name: p.name, color: p.color, connected: p.connected, isBot: !!p.isBot }));

// ── State for clients ──────────────────────────────────────────────────────

/** Whose turn it really is: a pending action belongs to its owner even if chess.js disagrees. */
function activeColor(room: Room): Color {
  if (room.mode === 'expand') return room.expandData?.turn ?? 'w';
  if (room.mode === 'lootbox' && room.lootboxData?.pending) return room.lootboxData.pending.color;
  return room.game.turn();
}

function legalMovesFor(room: Room, color: Color): MoveOption[] {
  if (room.status !== 'playing' || activeColor(room) !== color) return [];
  switch (room.mode) {
    case 'expand':
      return legalExpandMoves(room.expandData!, color);
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
  if (room.mode === 'expand') return buildExpandState(room, color);
  const game = room.game;
  const base = {
    id: room.id,
    status: room.status,
    mode: room.mode,
    fen: game.fen(),
    turn: activeColor(room),
    players: publicPlayers(room),
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

/** Expansion mode owns its board, so it builds its state without chess.js. */
function buildExpandState(room: Room, color: Color | null) {
  // A room that nobody has joined yet has no mode data; show the starting map.
  const d = room.expandData ?? initExpandData();
  return {
    id: room.id,
    status: room.status,
    mode: room.mode,
    fen: '',
    turn: d.turn,
    players: publicPlayers(room),
    history: room.log,
    captured: { w: d.taken.w as string[], b: d.taken.b as string[] },
    material: expandMaterial(d),
    inCheck: expandInCheck(d, d.turn),
    isGameOver: room.status === 'finished',
    drawOffer: room.drawOffer,
    lastMove: room.lastMove,
    legalMoves: color ? legalMovesFor(room, color) : [],
    pending: null,
    yourColor: color,
    expandData: serializeExpand(d),
  };
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
  room.lootboxData = null; room.fogData = null; room.magicData = null; room.expandData = null;
  if (room.mode === 'expand') {
    room.expandData = initExpandData();
  } else if (room.mode === 'lootbox') {
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

  if (room.mode === 'expand') {
    const d = room.expandData!;
    if (legalExpandMoves(d, d.turn).length === 0) {
      over = expandInCheck(d, d.turn)
        ? { reason: 'checkmate', winner: otherColor(d.turn) }
        : { reason: 'stalemate', winner: null };
    }
  } else if (room.mode === 'lootbox') {
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
  else maybeScheduleBot(room);   // every state change funnels through here
}

type ApplyResult = { ok: true } | { ok: false; reason: string; blockedByInvisible?: boolean };

/**
 * Play one move for `color`. `quiet` runs the engine only — no log entry, no
 * broadcast — which is what the bot's search needs while it tries moves out.
 */
function applyMove(
  room: Room,
  color: Color,
  move: { from: string; to: string; promotion?: string },
  quiet = false,
): ApplyResult {
  const commit = (san: string, lastMove: { from: string; to: string } | null, events: GameEvent[]): ApplyResult => {
    if (!quiet) {
      room.log.push({ color, san });
      room.lastMove = lastMove;
      room.drawOffer = null;
      pushFrame(room, san, color);
      afterChange(room, events);
    }
    return { ok: true };
  };

  // ── Expansion ──────────────────────────────────────────────────────────
  if (room.mode === 'expand') {
    const res = applyExpandMove(room.expandData!, move.from, move.to);
    if (!res.ok) return { ok: false, reason: res.reason };
    return commit(res.san, room.expandData!.lastMove, res.events);
  }

  // ── Fog ────────────────────────────────────────────────────────────────
  if (room.mode === 'fog') {
    let result;
    try { result = room.game.move(move); } catch { result = null; }
    if (!result) return { ok: false, reason: 'Хід неможливий — щось у тумані' };
    return commit(result.san, { from: result.from, to: result.to }, []);
  }

  // ── Lootbox ────────────────────────────────────────────────────────────
  if (room.mode === 'lootbox') {
    const data = room.lootboxData!;
    const { options } = computeLootboxMoves(room.game, data, color);
    const opt = options.find(o => o.from === move.from && o.to === move.to);
    if (!opt) return { ok: false, reason: 'Недозволений хід' };
    const label = quiet ? '' : lootboxLabel(room, move, opt.kind, opt.capture);

    const res = applyLootboxMove(room.game, data, move, color);
    if (!res.ok) return { ok: false, reason: res.reason };

    const absorbed = res.events.some(e => e.type === 'shield_absorb');
    return commit(absorbed ? `${label} 🛡` : label, res.lastMove ?? room.lastMove, res.events);
  }

  // ── Magic ──────────────────────────────────────────────────────────────
  const data = room.magicData!;
  const { from, to } = move;

  const preCheck = checkMagicPreMove(data, from);
  if (!preCheck.ok) return { ok: false, reason: preCheck.reason };

  const targetPiece = room.game.get(to as any);
  const events: GameEvent[] = [];

  // Shield: the attack is absorbed and the move is spent. Never while in
  // check - the check must stay resolvable.
  if (targetPiece && targetPiece.color !== color && data.pieceShields[to] && targetPiece.type !== 'k' && !room.game.inCheck()) {
    const legal = room.game.moves({ verbose: true }).some(m => m.from === from && m.to === to);
    if (!legal) return { ok: false, reason: 'Недозволений хід' };
    delete data.pieceShields[to];
    data.pendingSpell = null;
    data.spellUsedThisTurn[color] = false;
    flipTurn(room.game);
    events.push({ type: 'shield_absorb', at: to, attackerSq: from, color, stayed: true });
    return commit(`${from}×${to} 🛡`, null, events);
  }

  let result;
  try { result = room.game.move({ from, to, promotion: move.promotion || 'q' }); } catch { result = null; }
  if (!result) {
    // The player's view may have hidden the piece that blocks this move
    const seemedLegal = computeMagicMoves(room.game, data, color).some(m => m.from === from && m.to === to);
    return seemedLegal
      ? { ok: false, reason: 'Шлях перекриває невидима фігура!', blockedByInvisible: true }
      : { ok: false, reason: 'Недозволений хід' };
  }

  events.push(...handleMagicPostMove(room.game, data, from, to, result.captured, color));
  return commit(result.san, { from, to }, events);
}

// -- Game record ------------------------------------------------------------

const MAX_FRAMES = 400;

function pushFrame(room: Room, san: string, color: Color | null): void {
  if (room.frames.length >= MAX_FRAMES) return;
  room.frames.push({
    san,
    color,
    lastMove: room.lastMove,
    fen: room.mode === 'expand' ? '' : room.game.fen(),
    expand: room.mode === 'expand' && room.expandData ? serializeExpand(room.expandData) : undefined,
  });
}

/** Start a fresh record with the opening position in it. */
function startRecord(room: Room): void {
  room.frames = [];
  pushFrame(room, '', null);
}

// -- Bot -------------------------------------------------------------------

interface RoomSnap { fen: string; lootbox?: string; magic?: string; expand?: string }

/** Everything a search has to be able to put back. */
function snapshotRoom(room: Room): RoomSnap {
  return {
    fen: room.game.fen(),
    lootbox: room.lootboxData ? JSON.stringify(room.lootboxData) : undefined,
    magic: room.magicData
      ? JSON.stringify({ ...room.magicData, usedTeleports: [...room.magicData.usedTeleports] })
      : undefined,
    expand: room.expandData ? JSON.stringify(room.expandData) : undefined,
  };
}

function restoreRoom(room: Room, snap: RoomSnap): void {
  try { room.game = new Chess(snap.fen); } catch { /* keep what we have */ }
  if (snap.lootbox) room.lootboxData = JSON.parse(snap.lootbox);
  if (snap.magic) {
    const m = JSON.parse(snap.magic);
    m.usedTeleports = new Set<string>(m.usedTeleports);
    room.magicData = m;
  }
  if (snap.expand) room.expandData = JSON.parse(snap.expand);
}

function materialFor(room: Room, color: Color): number {
  if (room.mode === 'expand') return expandMaterial(room.expandData!)[color];
  return materialOf(room.game, color);
}

function inCheckFor(room: Room, color: Color): boolean {
  if (room.mode === 'expand') return expandInCheck(room.expandData!, color);
  return room.game.turn() === color && room.game.inCheck();
}

/** How tempting a move looks before playing it - this is what keeps the shortlist sane. */
function lureFor(room: Room, color: Color, move: MoveOption): number {
  let score = 0;
  if (room.mode === 'expand') {
    const d = room.expandData!;
    const victim = d.board[move.to];
    if (victim && victim.color !== color) score += VALUE[victim.type];
    const terrain = d.terrain[move.to];
    if (terrain?.type === 'treasure') score += 3;
    if (terrain?.type === 'portal') score += 0.5;
    if (move.kind === 'break') score += 0.4;
  } else {
    const victim = room.game.get(move.to as any);
    if (victim && victim.color !== color) score += VALUE[victim.type];
    if (room.mode === 'lootbox' && room.lootboxData!.lootboxes.some(b => b.sq === move.to)) score += 2.5;
    if (room.mode === 'magic') {
      const d = room.magicData!;
      if (d.rebirthSqs.includes(move.to)) score += 0.8;
      if (!d.usedTeleports.has(move.to) && [...d.teleports.a, ...d.teleports.b].includes(move.to)) score += 0.5;
    }
  }
  if (move.capture && score === 0) score += 0.5;   // a capture we could not price
  return score;
}

function botEnv(room: Room): BotEnv {
  return {
    legalMoves: (c) => legalMovesFor(room, c),
    play: (c, m) => applyMove(room, c, m, true).ok,
    snapshot: () => snapshotRoom(room),
    restore: (snap) => restoreRoom(room, snap as RoomSnap),
    material: (c) => materialFor(room, c),
    lure: (c, m) => lureFor(room, c, m),
    inCheck: (c) => inCheckFor(room, c),
  };
}

/** Magic mode only: from medium up the bot sometimes freezes the best piece it can see. */
function castBotSpell(room: Room, color: Color, level: Difficulty): void {
  if (room.mode !== 'magic' || level === 'easy') return;
  const d = room.magicData!;
  if (d.spellUsedThisTurn[color] || d.pendingSpell) return;
  if (Math.random() > (level === 'hard' ? 0.35 : 0.18)) return;
  const freeze = d.spells[color].find(sp => sp.id === 'freeze' && sp.currentCooldown === 0);
  if (!freeze) return;

  const opp = otherColor(color);
  let target: string | null = null;
  let bestVal = 0;
  for (const row of room.game.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== opp || sq.type === 'k') continue;
      if (VALUE[sq.type] > bestVal) { bestVal = VALUE[sq.type]; target = sq.square; }
    }
  }
  if (!target) return;
  if (!castSpell(d, 'freeze', color).ok) return;
  if (!applySpellWithTarget(room.game, d, target, color).ok) { cancelSpell(d, color); return; }
  room.log.push({ color, san: `✨freeze→${target}` });
  emitState(room, 'move-made', { events: [{ type: 'spell', spellId: 'freeze', target, color }] });
}

function playBotMove(room: Room): void {
  const bot = room.bot;
  if (!bot || room.status !== 'playing' || activeColor(room) !== bot.color) return;

  castBotSpell(room, bot.color, bot.difficulty);

  // The search plays moves on the real state, so guarantee it leaves no trace.
  const before = snapshotRoom(room);
  let move: MoveOption | null = null;
  try {
    move = chooseBotMove(botEnv(room), bot.color, bot.difficulty);
  } catch (err) {
    console.error('bot search failed', err);
  } finally {
    restoreRoom(room, before);
  }

  let chosen = move ?? legalMovesFor(room, bot.color)[0];
  // Fog and magic build the move list from a masked board; if that ever comes back
  // empty while the real position still has moves, fall back rather than stall.
  if (!chosen && room.mode !== 'expand' && room.game.turn() === bot.color) {
    const real = room.game.moves({ verbose: true })[0];
    if (real) chosen = { from: real.from, to: real.to, kind: 'normal', capture: !!real.captured };
  }
  if (!chosen) return;
  if (applyMove(room, bot.color, { from: chosen.from, to: chosen.to }).ok) return;
  // A refused bot move must never freeze the game.
  const fallback = legalMovesFor(room, bot.color).find(m => m.from !== chosen.from || m.to !== chosen.to);
  if (fallback) applyMove(room, bot.color, { from: fallback.from, to: fallback.to });
}

function maybeScheduleBot(room: Room): void {
  if (!room.bot || room.status !== 'playing' || room.botTimer) return;
  if (activeColor(room) !== room.bot.color) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    try { playBotMove(room); } catch (err) { console.error('bot move failed', err); }
  }, BOT_DELAY_MS[room.bot.difficulty]);
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
  const mode: GameMode = req.body?.mode ?? 'expand';
  const botLevel: Difficulty | null = isDifficulty(req.body?.bot) ? req.body.bot : null;
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  const room: Room = {
    id: roomId,
    game: new Chess(),
    players: [],
    status: 'waiting',
    drawOffer: null,
    mode,
    lootboxData: null,
    fogData: null,
    magicData: null,
    expandData: null,
    log: [],
    lastMove: null,
    bot: botLevel ? { difficulty: botLevel, color: 'b' } : null,
    botTimer: null,
    frames: [],
  };
  rooms.set(roomId, room);
  if (botLevel) {
    // The bot takes its seat immediately, so the human never waits on a lobby.
    room.players.push({ socketId: 'bot', color: 'b', name: BOT_NAMES[botLevel], connected: true, isBot: true });
  }
  initModeData(room);   // so a half-joined room always has a consistent state
  res.json({ roomId, mode, bot: botLevel });
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
    io.to(room.id).emit('player-update', publicPlayers(room));

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
      // a bot may already hold one colour, so take whichever seat is free
      const taken = new Set(room.players.map((p) => p.color));
      const color: Color = taken.has('w') ? 'b' : 'w';
      room.players.push({ socketId: socket.id, color, name: playerName || `Гравець ${room.players.length + 1}`, connected: true });

      if (room.players.length === 2) {
        room.status = 'playing';
        initModeData(room);
        startRecord(room);
      }

      socket.emit('game-state', buildState(room, color));
      playerUpdate(room);
      if (room.players.length === 2) {
        emitState(room, 'game-start');
        maybeScheduleBot(room);
      }
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

    const res = applyMove(room, color, move);
    if (res.ok) return;
    rejectMove(socket, room, color, res.reason);
    if (res.blockedByInvisible) {
      socket.emit('move-made', { ...buildState(room, color), events: [{ type: 'blocked_by_invisible', color }] });
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

  socket.on('request-replay', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return;
    // The record holds the unmasked board, so it stays sealed until the game is
    // over — otherwise it would hand out fog positions and invisible pieces.
    if (room.status !== 'finished') { socket.emit('replay-data', { mode: room.mode, frames: [] }); return; }
    socket.emit('replay-data', { mode: room.mode, frames: room.frames });
  });

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
    if (room.bot) room.bot.color = otherColor(room.bot.color);
    initModeData(room);
    startRecord(room);
    emitState(room, 'rematch-start');
    maybeScheduleBot(room);
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
