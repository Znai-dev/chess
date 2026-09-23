/**
 * Runs the bot against itself in the chess.js-backed modes, using the same
 * snapshot/restore pattern the server builds for it. The point is the awkward
 * parts: lootbox pending states (extra move, shield break) and magic spells.
 *
 *   node scripts/bot-modes.js [games]
 */
const { Chess } = require('chess.js');
const L = require('../dist/modes/lootbox');
const M = require('../dist/modes/magic');
const H = require('../dist/modes/helpers');
const { chooseBotMove } = require('../dist/bot');

const GAMES = parseInt(process.argv[2] || '8', 10);
const MAX_PLIES = 160;
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

function victimLure(chess, color, move, extra) {
  let s = 0;
  const v = chess.get(move.to);
  if (v && v.color !== color) s += VALUE[v.type];
  s += extra ? extra(move) : 0;
  if (move.capture && s === 0) s += 0.5;
  return s;
}

// ── lootbox ────────────────────────────────────────────────────────────────
function lootboxGame(levels, stats) {
  const state = { chess: new Chess(), data: L.initLootboxData() };
  L.spawnLootboxes(state.chess, state.data);
  L.spawnLootboxes(state.chess, state.data);

  const active = () => (state.data.pending ? state.data.pending.color : state.chess.turn());
  const env = {
    legalMoves: (c) => (active() === c ? L.computeLootboxMoves(state.chess, state.data, c).options : []),
    play: (c, m) => active() === c && L.applyLootboxMove(state.chess, state.data, m, c).ok,
    snapshot: () => ({ fen: state.chess.fen(), data: JSON.stringify(state.data) }),
    restore: (s) => { state.chess = new Chess(s.fen); state.data = JSON.parse(s.data); },
    material: (c) => H.materialOf(state.chess, c),
    lure: (c, m) => victimLure(state.chess, c, m, (mv) =>
      state.data.lootboxes.some((b) => b.sq === mv.to) ? 2.5 : 0),
    inCheck: (c) => state.chess.turn() === c && state.chess.inCheck(),
  };

  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const me = active();
    const { options } = L.computeLootboxMoves(state.chess, state.data, me);
    if (options.length === 0) {
      if (state.data.pending) throw new Error('lootbox: pending state with no way out');
      break;
    }
    if (state.data.pending) stats.pending++;

    const before = env.snapshot();
    let move = null;
    try { move = chooseBotMove(env, me, levels[me]); } finally { env.restore(before); }
    if (!move) break;

    const res = L.applyLootboxMove(state.chess, state.data, move, me);
    if (!res.ok) throw new Error(`lootbox: bot picked an illegal move — ${res.reason}`);
    stats.plies++;
    if (!H.findKing(state.chess, 'w') || !H.findKing(state.chess, 'b')) throw new Error('lootbox: a king vanished');
  }
}

// ── magic ──────────────────────────────────────────────────────────────────
function magicGame(levels, stats) {
  const state = { chess: new Chess(), data: M.initMagicData() };
  const env = {
    legalMoves: (c) => (state.chess.turn() === c ? M.computeMagicMoves(state.chess, state.data, c) : []),
    play: (c, m) => {
      if (state.chess.turn() !== c) return false;
      let r;
      try { r = state.chess.move({ from: m.from, to: m.to, promotion: 'q' }); } catch { r = null; }
      if (!r) return false;
      M.handleMagicPostMove(state.chess, state.data, m.from, m.to, r.captured, c);
      return true;
    },
    snapshot: () => ({
      fen: state.chess.fen(),
      data: JSON.stringify({ ...state.data, usedTeleports: [...state.data.usedTeleports] }),
    }),
    restore: (s) => {
      state.chess = new Chess(s.fen);
      const d = JSON.parse(s.data);
      d.usedTeleports = new Set(d.usedTeleports);
      state.data = d;
    },
    material: (c) => H.materialOf(state.chess, c),
    lure: (c, m) => victimLure(state.chess, c, m, (mv) =>
      state.data.rebirthSqs.includes(mv.to) ? 0.8 : 0),
    inCheck: (c) => state.chess.turn() === c && state.chess.inCheck(),
  };

  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const me = state.chess.turn();
    M.thawIfStuck(state.chess, state.data, me);

    // the bot's spell habit, same shape as the server's
    if (levels[me] !== 'easy' && !state.data.spellUsedThisTurn[me] && Math.random() < 0.3) {
      const freeze = state.data.spells[me].find((sp) => sp.id === 'freeze' && sp.currentCooldown === 0);
      if (freeze && M.castSpell(state.data, 'freeze', me).ok) {
        const targets = H.getAllPieces(state.chess, H.otherColor(me)).filter((p) => p.type !== 'k');
        if (targets.length && M.applySpellWithTarget(state.chess, state.data, rnd(targets).sq, me).ok) stats.spells++;
        else M.cancelSpell(state.data, me);
      }
    }

    const moves = M.computeMagicMoves(state.chess, state.data, me);
    if (moves.length === 0) break;

    const before = env.snapshot();
    let move = null;
    try { move = chooseBotMove(env, me, levels[me]); } finally { env.restore(before); }
    if (!move) break;

    if (!env.play(me, move)) throw new Error('magic: bot picked an illegal move');
    stats.plies++;
    if (!H.findKing(state.chess, 'w') || !H.findKing(state.chess, 'b')) throw new Error('magic: a king vanished');
    if (state.chess.isGameOver()) break;
  }
}

const stats = { lootbox: { plies: 0, pending: 0 }, magic: { plies: 0, spells: 0 } };
for (let i = 0; i < GAMES; i++) {
  lootboxGame({ w: 'hard', b: 'medium' }, stats.lootbox);
  magicGame({ w: 'hard', b: 'medium' }, stats.magic);
}
console.log('lootbox:', JSON.stringify(stats.lootbox));
console.log('magic:  ', JSON.stringify(stats.magic));
console.log('OK — bot played every mode without an illegal move or a stuck pending state');
