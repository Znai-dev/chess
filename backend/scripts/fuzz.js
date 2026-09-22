/**
 * Random-playout fuzzer for the mode engines. Plays many games with random
 * legal moves and screams if a position ever has no way forward (deadlock),
 * or an engine throws. Run after `npm run build`:  node scripts/fuzz.js [games]
 */
const { Chess } = require('chess.js');
const L = require('../dist/modes/lootbox');
const M = require('../dist/modes/magic');
const H = require('../dist/modes/helpers');

const GAMES = parseInt(process.argv[2] || '300', 10);
const MAX_PLIES = 300;
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

function active(chess, data) {
  return data.pending ? data.pending.color : chess.turn();
}

function fuzzLootbox() {
  const stats = { games: 0, plies: 0, pickups: 0, extra: 0, extraLost: 0, shields: 0, bombs: 0, suspended: 0, skips: 0, mates: 0, stalemates: 0, kinds: {} };
  for (let g = 0; g < GAMES; g++) {
    const chess = new Chess();
    const data = L.initLootboxData();
    L.spawnLootboxes(chess, data); L.spawnLootboxes(chess, data);
    stats.games++;
    for (let ply = 0; ply < MAX_PLIES; ply++) {
      const color = active(chess, data);
      if (chess.turn() !== color) throw new Error(`turn mismatch: chess=${chess.turn()} active=${color} pending=${JSON.stringify(data.pending)}`);
      const { options, suspended } = L.computeLootboxMoves(chess, data, color);
      if (suspended) stats.suspended++;
      if (options.length === 0) {
        if (data.pending) throw new Error(`DEADLOCK: pending ${JSON.stringify(data.pending)} but no options\n${chess.ascii()}`);
        if (chess.inCheck()) stats.mates++; else stats.stalemates++;
        break;
      }
      // Sometimes skip an extra move instead of using it
      if (data.pending && data.pending.kind === 'extra_move' && Math.random() < 0.3) {
        if (!L.skipExtraMove(chess, data, color)) throw new Error('skip refused');
        stats.skips++;
        continue;
      }
      const opt = rnd(options);
      stats.kinds[opt.kind] = (stats.kinds[opt.kind] || 0) + 1;
      const res = L.applyLootboxMove(chess, data, { from: opt.from, to: opt.to }, color);
      if (!res.ok) throw new Error(`engine rejected its own option ${JSON.stringify(opt)}: ${res.reason}\n${chess.ascii()}`);
      for (const e of res.events) {
        if (e.type === 'pickup') stats.pickups++;
        if (e.type === 'pickup' && e.effect === 'extra_move') stats.extra++;
        if (e.type === 'extra_move_lost') stats.extraLost++;
        if (e.type === 'shield_absorb') stats.shields++;
        if (e.type === 'bomb') stats.bombs++;
      }
      // Invariants
      if (!H.findKing(chess, 'w') || !H.findKing(chess, 'b')) throw new Error(`a king vanished\n${chess.ascii()}`);
      for (const sq of Object.keys(data.effects)) {
        const p = chess.get(sq);
        if (!p && !data.pending) throw new Error(`orphan effect on ${sq}`);
      }
      stats.plies++;
    }
  }
  return stats;
}

function fuzzMagic() {
  const stats = { games: 0, plies: 0, spells: 0, thawed: 0, shields: 0, teleports: 0, rebirths: 0, mates: 0 };
  for (let g = 0; g < GAMES; g++) {
    const chess = new Chess();
    const data = M.initMagicData();
    stats.games++;
    for (let ply = 0; ply < MAX_PLIES; ply++) {
      const color = chess.turn();
      if (M.thawIfStuck(chess, data, color)) stats.thawed++;
      // random spell
      if (Math.random() < 0.25) {
        const spell = rnd(data.spells[color]);
        const cast = M.castSpell(data, spell.id, color);
        if (cast.ok) {
          const pieces = H.getAllPieces(chess, spell.needsTarget === 'enemy' ? H.otherColor(color) : color).filter(p => p.type !== 'k');
          if (pieces.length) {
            const r = M.applySpellWithTarget(chess, data, rnd(pieces).sq, color);
            if (r.ok) stats.spells++;
          } else M.cancelSpell(data, color);
        }
      }
      const moves = chess.moves({ verbose: true }).filter(m => !data.frozenPieces[m.from]);
      if (moves.length === 0) {
        if (chess.moves().length > 0) throw new Error(`DEADLOCK: only frozen pieces can move\n${chess.ascii()}`);
        if (chess.inCheck()) stats.mates++;
        break;
      }
      const m = rnd(moves);
      const target = chess.get(m.to);
      if (target && target.color !== color && data.pieceShields[m.to] && target.type !== 'k' && !chess.inCheck()) {
        delete data.pieceShields[m.to];
        H.flipTurn(chess);
        stats.shields++;
        continue;
      }
      const res = chess.move({ from: m.from, to: m.to, promotion: 'q' });
      const events = M.handleMagicPostMove(chess, data, m.from, m.to, res.captured, color);
      for (const e of events) {
        if (e.type === 'magic_teleport') stats.teleports++;
        if (e.type === 'rebirth') stats.rebirths++;
      }
      if (!H.findKing(chess, 'w') || !H.findKing(chess, 'b')) throw new Error(`a king vanished\n${chess.ascii()}`);
      if (chess.isGameOver()) break;
      stats.plies++;
    }
  }
  return stats;
}

function fuzzExpand() {
  const E = require('../dist/modes/expand');
  const stats = { games: 0, plies: 0, expansions: 0, spawned: 0, portals: 0, promos: 0, treasures: 0,
                  mates: 0, stalemates: 0, maxSizeReached: 0, spawnMates: 0 };
  for (let g = 0; g < GAMES; g++) {
    const d = E.initExpandData();
    stats.games++;
    let expectedPlies = 0;
    const expandedOn = [];
    for (let ply = 0; ply < MAX_PLIES; ply++) {
      const color = d.turn;
      const moves = E.legalExpandMoves(d, color);
      if (moves.length === 0) {
        if (E.inCheck(d, color)) stats.mates++; else stats.stalemates++;
        break;
      }
      const m = moves[Math.floor(Math.random() * moves.length)];
      const sizeBefore = d.max - d.min + 1;
      const res = E.applyExpandMove(d, m.from, m.to);
      if (!res.ok) throw new Error(`engine rejected its own move ${JSON.stringify(m)}: ${res.reason}`);
      expectedPlies++;
      stats.plies++;

      for (const e of res.events) {
        if (e.type === 'expand') { stats.expansions++; stats.spawned += e.pieces; expandedOn.push({ ply: expectedPlies, by: color }); }
        if (e.type === 'portal_jump') stats.portals++;
        if (e.type === 'promote') stats.promos++;
        if (e.type === 'treasure') stats.treasures++;
      }

      // ── invariants ──
      if (d.plies !== expectedPlies) throw new Error('ply counter drifted');
      const sizeAfter = d.max - d.min + 1;
      const grew = sizeAfter !== sizeBefore;
      const shouldGrow = expectedPlies % 3 === 0 && sizeBefore < 20;
      if (grew !== shouldGrow) throw new Error(`expansion schedule broken at ply ${expectedPlies}: ${sizeBefore}->${sizeAfter}`);
      if (grew && sizeAfter !== sizeBefore + 2) throw new Error('ring is not +2');
      if (!E.findKingSq(d, 'w') || !E.findKingSq(d, 'b')) throw new Error('a king was captured');
      for (const [sq, p] of Object.entries(d.board)) {
        const [x, y] = E.parseSq(sq);
        if (x < d.min || x > d.max || y < d.min || y > d.max) throw new Error(`piece ${sq} outside the map`);
        if (d.terrain[sq] && d.terrain[sq].type === 'wall') throw new Error(`piece standing inside a wall at ${sq}`);
        if (p.type === 'p' && (y === d.min || y === d.max)) {
          // a pawn may sit on its own back edge, never on the promotion edge
          const promoEdge = p.color === 'w' ? d.max : d.min;
          if (y === promoEdge) throw new Error(`unpromoted pawn on the promotion edge at ${sq}`);
        }
      }
      if (grew && E.legalExpandMoves(d, d.turn).length === 0) stats.spawnMates++;
      stats.maxSizeReached = Math.max(stats.maxSizeReached, sizeAfter);
    }
    // expansions must alternate colours
    for (let i = 1; i < expandedOn.length; i++) {
      if (expandedOn[i].by === expandedOn[i - 1].by) throw new Error('two expansions in a row on the same colour');
    }
  }
  return stats;
}

const MODE = process.argv[3] || 'all';
if (MODE === 'all' || MODE === 'expand')  console.log('expand: ', JSON.stringify(fuzzExpand()));
if (MODE === 'all' || MODE === 'lootbox') console.log('lootbox:', JSON.stringify(fuzzLootbox()));
if (MODE === 'all' || MODE === 'magic')   console.log('magic:  ', JSON.stringify(fuzzMagic()));
console.log('OK - no deadlocks, no exceptions');
