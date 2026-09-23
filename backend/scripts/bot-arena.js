/**
 * Bot sanity check: do the difficulty levels actually differ?
 *
 * Plays bot against bot on the expansion engine, using the same snapshot/restore
 * pattern the server uses, and reports the material result. Run after a build:
 *   node scripts/bot-arena.js [games]
 */
const E = require('../dist/modes/expand');
const { chooseBotMove } = require('../dist/bot');

const GAMES = parseInt(process.argv[2] || '30', 10);
const MAX_PLIES = 110;
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function makeEnv(state) {
  const material = (color) => {
    let sum = 0;
    for (const p of Object.values(state.d.board)) if (p.color === color) sum += VALUE[p.type];
    return sum;
  };
  return {
    legalMoves: (c) => (state.d.turn === c ? E.legalExpandMoves(state.d, c) : []),
    play: (c, m) => {
      if (state.d.turn !== c) return false;
      return E.applyExpandMove(state.d, m.from, m.to).ok;
    },
    snapshot: () => JSON.stringify(state.d),
    restore: (snap) => { state.d = JSON.parse(snap); },
    material,
    lure: (c, m) => {
      let s = 0;
      const victim = state.d.board[m.to];
      if (victim && victim.color !== c) s += VALUE[victim.type];
      const t = state.d.terrain[m.to];
      if (t && t.type === 'treasure') s += 3;
      if (t && t.type === 'portal') s += 0.5;
      if (m.kind === 'break') s += 0.4;
      if (m.capture && s === 0) s += 0.5;
      return s;
    },
    inCheck: (c) => E.inCheck(state.d, c),
  };
}

/** One game. Returns +1 if white's level won, -1 if black's did, 0 for a draw. */
function play(whiteLevel, blackLevel) {
  const state = { d: E.initExpandData() };
  const env = makeEnv(state);

  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const me = state.d.turn;
    const level = me === 'w' ? whiteLevel : blackLevel;
    const moves = E.legalExpandMoves(state.d, me);
    if (moves.length === 0) {
      // mated or stalemated
      if (!E.inCheck(state.d, me)) return 0;
      return me === 'w' ? -1 : 1;
    }

    const before = JSON.stringify(state.d);
    let move = null;
    try {
      move = chooseBotMove(env, me, level);
    } finally {
      state.d = JSON.parse(before);   // the search must leave no trace
    }
    if (!move) return 0;

    const res = E.applyExpandMove(state.d, move.from, move.to);
    if (!res.ok) throw new Error(`bot picked an illegal move: ${JSON.stringify(move)} — ${res.reason}`);

    if (!E.findKingSq(state.d, 'w') || !E.findKingSq(state.d, 'b')) throw new Error('a king vanished');
  }

  // Ran long: call it on material, which is what the bots are optimising anyway.
  const diff = env.material('w') - env.material('b');
  if (Math.abs(diff) < 2) return 0;
  return diff > 0 ? 1 : -1;
}

function duel(a, b, games) {
  const score = { [a]: 0, [b]: 0, draws: 0 };
  for (let i = 0; i < games; i++) {
    // alternate colours so neither level gets the first-move edge
    const aIsWhite = i % 2 === 0;
    const r = aIsWhite ? play(a, b) : play(b, a);
    const winner = r === 0 ? null : (r === 1) === aIsWhite ? a : b;
    if (!winner) score.draws++; else score[winner]++;
  }
  return score;
}

const started = Date.now();
for (const [a, b] of [['hard', 'easy'], ['medium', 'easy'], ['hard', 'medium']]) {
  const s = duel(a, b, GAMES);
  const decided = s[a] + s[b];
  const pct = decided ? Math.round((s[a] / decided) * 100) : 0;
  console.log(`${a} vs ${b}: ${s[a]}-${s[b]} (draws ${s.draws}) — ${a} wins ${pct}% of decided games`);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
