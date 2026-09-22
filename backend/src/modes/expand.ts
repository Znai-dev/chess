/**
 * Expansion mode: the map grows from 4x4 to 20x20, one ring every 3 plies.
 *
 * chess.js is 8x8 only, so this mode carries its own board, move generator and
 * check detection. Coordinates are absolute on the final 20x20 grid (0..19);
 * the visible window is [min..max] and only ever grows, so nothing ever has to
 * be renumbered. Squares are named a1..t20.
 */
import { Color, MoveOption, GameEvent } from './types';
import { otherColor, pickRandom } from './helpers';

export const FILES = 'abcdefghijklmnopqrst';
export const GRID = 20;
export const START_SIZE = 4;
export const MAX_SIZE = 20;
export const PLIES_PER_EXPANSION = 3;
/** Hits needed to bring a wall down. Attacking one costs a move; the attacker stays put. */
export const WALL_HP = 2;

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type TerrainType = 'wall' | 'portal' | 'treasure';

export interface ExpandPiece { type: PieceType; color: Color }
export interface TerrainCell { type: TerrainType; pair?: string; hp?: number }

export interface ExpandData {
  min: number;
  max: number;
  turn: Color;
  plies: number;
  expansions: number;
  board: Record<string, ExpandPiece>;
  terrain: Record<string, TerrainCell>;
  /** square → index in ZONES, for the client's tinting and the map legend */
  zone: Record<string, number>;
  /** pieces each colour has captured */
  taken: { w: PieceType[]; b: PieceType[] };
  lastMove: { from: string; to: string } | null;
}

interface Zone {
  name: string;
  tint: string;
  walls: number;      // per half-ring; everything is mirrored to the other half
  portals: number;
  treasures: number;
  spawn: PieceType[];
}

/** Index 0 is the starting 4x4; 1..8 are the rings, opened in order. */
export const ZONES: Zone[] = [
  { name: 'Серце карти', tint: '#4a7c59', walls: 0, portals: 0, treasures: 0, spawn: [] },
  { name: 'Ліс',         tint: '#2f6b3a', walls: 2, portals: 0, treasures: 1, spawn: ['p', 'p', 'n'] },
  { name: 'Пустеля',     tint: '#9c8340', walls: 2, portals: 1, treasures: 2, spawn: ['p', 'p', 'n', 'b'] },
  { name: 'Гори',        tint: '#63697a', walls: 5, portals: 0, treasures: 1, spawn: ['p', 'p', 'p', 'b', 'r'] },
  { name: 'Болото',      tint: '#3d5c4a', walls: 3, portals: 1, treasures: 2, spawn: ['p', 'p', 'p', 'n', 'b'] },
  { name: 'Тундра',      tint: '#4f7488', walls: 4, portals: 1, treasures: 1, spawn: ['p', 'p', 'p', 'n', 'b', 'r'] },
  { name: 'Вулкан',      tint: '#8f3c2a', walls: 5, portals: 1, treasures: 2, spawn: ['p', 'p', 'p', 'p', 'r', 'q'] },
  { name: 'Руїни',       tint: '#7a6647', walls: 5, portals: 1, treasures: 2, spawn: ['p', 'p', 'p', 'p', 'n', 'b', 'r'] },
  { name: 'Безодня',     tint: '#463a6e', walls: 6, portals: 2, treasures: 3, spawn: ['p', 'p', 'p', 'p', 'n', 'b', 'r', 'q'] },
];

export const PIECE_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const GLYPH: Record<PieceType, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
/** What a treasure turns a piece into. Queens and kings walk past it. */
const UPGRADE: Partial<Record<PieceType, PieceType>> = { p: 'n', n: 'b', b: 'r', r: 'q' };

const KNIGHT_JUMPS: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const ROOK_DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ALL_DIRS: [number, number][] = [...ROOK_DIRS, ...BISHOP_DIRS];

// ─── Squares ───────────────────────────────────────────────────────────────

export const sqName = (x: number, y: number): string => FILES[x] + (y + 1);
export const parseSq = (s: string): [number, number] => [FILES.indexOf(s[0]), parseInt(s.slice(1), 10) - 1];

function inBounds(d: ExpandData, x: number, y: number): boolean {
  return x >= d.min && x <= d.max && y >= d.min && y <= d.max;
}
function pieceAt(d: ExpandData, x: number, y: number): ExpandPiece | undefined {
  if (!inBounds(d, x, y)) return undefined;
  return d.board[sqName(x, y)];
}
function isWall(d: ExpandData, x: number, y: number): boolean {
  return d.terrain[sqName(x, y)]?.type === 'wall';
}
/** The square opposite through the centre — how the map stays fair for both sides. */
function mirror(d: ExpandData, x: number, y: number): [number, number] {
  return [d.min + d.max - x, d.min + d.max - y];
}

// ─── Setup ─────────────────────────────────────────────────────────────────

export function initExpandData(): ExpandData {
  const off = (GRID - START_SIZE) / 2;
  const min = off, max = off + START_SIZE - 1;
  const d: ExpandData = {
    min, max, turn: 'w', plies: 0, expansions: 0,
    board: {}, terrain: {}, zone: {},
    taken: { w: [], b: [] },
    lastMove: null,
  };
  for (let x = min; x <= max; x++) for (let y = min; y <= max; y++) d.zone[sqName(x, y)] = 0;

  // Point-symmetric so neither side starts better; no piece attacks a king yet.
  d.board[sqName(min, min)]     = { type: 'n', color: 'w' };
  d.board[sqName(min + 1, min)] = { type: 'k', color: 'w' };
  d.board[sqName(max, min)]     = { type: 'r', color: 'w' };
  d.board[sqName(max, max)]     = { type: 'n', color: 'b' };
  d.board[sqName(max - 1, max)] = { type: 'k', color: 'b' };
  d.board[sqName(min, max)]     = { type: 'r', color: 'b' };
  return d;
}

// ─── Attacks and checks ────────────────────────────────────────────────────

function rayHits(d: ExpandData, x: number, y: number, dx: number, dy: number, by: Color, slider: PieceType): boolean {
  let cx = x + dx, cy = y + dy;
  while (inBounds(d, cx, cy) && !isWall(d, cx, cy)) {
    const p = d.board[sqName(cx, cy)];
    if (p) return p.color === by && (p.type === slider || p.type === 'q');
    cx += dx; cy += dy;
  }
  return false;
}

export function isAttacked(d: ExpandData, x: number, y: number, by: Color): boolean {
  for (const [dx, dy] of KNIGHT_JUMPS) {
    const p = pieceAt(d, x + dx, y + dy);
    if (p && p.color === by && p.type === 'n') return true;
  }
  for (const [dx, dy] of ALL_DIRS) {
    const p = pieceAt(d, x + dx, y + dy);
    if (p && p.color === by && p.type === 'k') return true;
  }
  const pd = by === 'w' ? 1 : -1;   // a `by` pawn one step behind attacks diagonally forward
  for (const dx of [-1, 1]) {
    const p = pieceAt(d, x + dx, y - pd);
    if (p && p.color === by && p.type === 'p') return true;
  }
  for (const [dx, dy] of ROOK_DIRS) if (rayHits(d, x, y, dx, dy, by, 'r')) return true;
  for (const [dx, dy] of BISHOP_DIRS) if (rayHits(d, x, y, dx, dy, by, 'b')) return true;
  return false;
}

export function findKingSq(d: ExpandData, color: Color): string | null {
  for (const [sq, p] of Object.entries(d.board)) if (p.color === color && p.type === 'k') return sq;
  return null;
}

export function inCheck(d: ExpandData, color: Color): boolean {
  const k = findKingSq(d, color);
  if (!k) return false;
  const [kx, ky] = parseSq(k);
  return isAttacked(d, kx, ky, otherColor(color));
}

// ─── Move generation ───────────────────────────────────────────────────────

/** Where a piece actually ends up: stepping on a portal throws it to the pair. */
export function portalTarget(d: ExpandData, to: string, color: Color): string {
  const cell = d.terrain[to];
  if (!cell || cell.type !== 'portal' || !cell.pair) return to;
  const occupant = d.board[cell.pair];
  // own piece blocks the exit; an enemy king is never taken, so it blocks too
  if (occupant && (occupant.color === color || occupant.type === 'k')) return to;
  return cell.pair;
}

function pseudoMoves(d: ExpandData, x: number, y: number, piece: ExpandPiece, out: MoveOption[]): void {
  const from = sqName(x, y);
  const add = (tx: number, ty: number): boolean => {
    if (!inBounds(d, tx, ty)) return false;
    const to = sqName(tx, ty);
    if (isWall(d, tx, ty)) {
      out.push({ from, to, kind: 'break', capture: false });
      return false;   // the wall still blocks the ray until it comes down
    }
    const target = d.board[to];
    if (target && target.color === piece.color) return false;
    const kind = d.terrain[to]?.type === 'portal' ? 'teleport' : 'normal';
    out.push({ from, to, kind, capture: !!target });
    return !target;   // sliding stops on the first piece
  };
  const slide = (dirs: [number, number][]) => {
    for (const [dx, dy] of dirs) {
      let cx = x + dx, cy = y + dy;
      while (add(cx, cy)) { cx += dx; cy += dy; }
    }
  };

  switch (piece.type) {
    case 'p': {
      // No double step and no en passant: the board keeps changing shape under them.
      const dir = piece.color === 'w' ? 1 : -1;
      const fy = y + dir;
      if (inBounds(d, x, fy)) {
        const to = sqName(x, fy);
        if (isWall(d, x, fy)) {
          // a pawn only moves forward, so a wall in front would wall it in for good
          out.push({ from, to, kind: 'break', capture: false });
        } else if (!d.board[to]) {
          out.push({ from, to, kind: d.terrain[to]?.type === 'portal' ? 'teleport' : 'normal', capture: false });
        }
      }
      for (const dx of [-1, 1]) {
        const cx = x + dx, cy = y + dir;
        if (!inBounds(d, cx, cy)) continue;
        const to = sqName(cx, cy);
        if (isWall(d, cx, cy)) { out.push({ from, to, kind: 'break', capture: false }); continue; }
        const target = d.board[to];
        if (!target || target.color === piece.color) continue;
        out.push({ from, to, kind: d.terrain[to]?.type === 'portal' ? 'teleport' : 'normal', capture: true });
      }
      break;
    }
    case 'n': for (const [dx, dy] of KNIGHT_JUMPS) add(x + dx, y + dy); break;  // jumps over walls, cannot land on one
    case 'k': for (const [dx, dy] of ALL_DIRS) add(x + dx, y + dy); break;
    case 'b': slide(BISHOP_DIRS); break;
    case 'r': slide(ROOK_DIRS); break;
    case 'q': slide(ALL_DIRS); break;
  }
}

/**
 * Play the move on the real board just far enough to ask "is our king safe?",
 * then put everything back. The portal hop is included: without it a pinned
 * piece could block a check and then be flung away by the portal.
 */
function kingSafeAt(d: ExpandData, kingSq: string | null, color: Color): boolean {
  if (!kingSq) return true;
  const [kx, ky] = parseSq(kingSq);
  return !isAttacked(d, kx, ky, otherColor(color));
}

function leavesKingSafe(d: ExpandData, from: string, to: string, color: Color, kingSq: string | null): boolean {
  const piece = d.board[from];
  if (!piece) return false;

  const wall = d.terrain[to];
  if (wall?.type === 'wall') {
    // Hitting a wall costs the move but moves nothing, so it can never answer a
    // check; only the blow that brings the wall down changes the position.
    if ((wall.hp ?? 1) > 1) return kingSafeAt(d, kingSq, color);
    delete d.terrain[to];
    const safe = kingSafeAt(d, kingSq, color);
    d.terrain[to] = wall;
    return safe;
  }

  const final = portalTarget(d, to, color);
  const capA = d.board[to];
  const capB = final !== to ? d.board[final] : undefined;

  delete d.board[from];
  if (capA) delete d.board[to];
  if (capB) delete d.board[final];
  d.board[final] = piece;

  const kSq = piece.type === 'k' ? final : kingSq;
  let safe = true;
  if (kSq) {
    const [kx, ky] = parseSq(kSq);
    safe = !isAttacked(d, kx, ky, otherColor(color));
  }

  delete d.board[final];
  if (capB) d.board[final] = capB;
  if (capA) d.board[to] = capA;
  d.board[from] = piece;
  return safe;
}

export function legalExpandMoves(d: ExpandData, color: Color): MoveOption[] {
  const kingSq = findKingSq(d, color);
  const out: MoveOption[] = [];
  const pseudo: MoveOption[] = [];
  for (const [sq, piece] of Object.entries(d.board)) {
    if (piece.color !== color) continue;
    const [x, y] = parseSq(sq);
    pseudo.length = 0;
    pseudoMoves(d, x, y, piece, pseudo);
    for (const m of pseudo) {
      if (d.board[m.to]?.type === 'k') continue;   // kings are never actually taken
      if (leavesKingSafe(d, m.from, m.to, color, kingSq)) out.push({ ...m });
    }
  }
  return out;
}

// ─── Expansion ─────────────────────────────────────────────────────────────

export function nextExpandIn(d: ExpandData): number {
  if (d.max - d.min + 1 >= MAX_SIZE) return 0;
  return PLIES_PER_EXPANSION - (d.plies % PLIES_PER_EXPANSION);
}

/** Squares of the ring that was just opened, split into the two halves. */
function newRing(d: ExpandData): { lower: string[]; all: string[] } {
  const lower: string[] = [];
  const all: string[] = [];
  const midDoubled = d.min + d.max;   // size is always even, so no square sits on the midline
  for (let x = d.min; x <= d.max; x++) {
    for (let y = d.min; y <= d.max; y++) {
      if (x !== d.min && x !== d.max && y !== d.min && y !== d.max) continue;
      const sq = sqName(x, y);
      all.push(sq);
      if (2 * y < midDoubled) lower.push(sq);
    }
  }
  return { lower, all };
}

/**
 * A spawned piece may never arrive already giving check — that would be a free,
 * random mate threat. Measured against the check state before the expansion, so
 * that a check delivered by the move that triggered it does not block every spawn.
 */
function spawnIsQuiet(d: ExpandData, sq: string, piece: ExpandPiece, base: Record<Color, boolean>): boolean {
  d.board[sq] = piece;
  const quiet = (['w', 'b'] as Color[]).every(c => base[c] || !inCheck(d, c));
  delete d.board[sq];
  return quiet;
}

export function maybeExpand(d: ExpandData): GameEvent[] {
  if (d.plies === 0 || d.plies % PLIES_PER_EXPANSION !== 0) return [];
  if (d.max - d.min + 1 >= MAX_SIZE) return [];

  d.min--; d.max++; d.expansions++;
  const zoneIdx = Math.min(d.expansions, ZONES.length - 1);
  const zone = ZONES[zoneIdx];

  const { lower, all } = newRing(d);
  for (const sq of all) d.zone[sq] = zoneIdx;

  const free = pickRandom(lower, lower.length);   // shuffled lower half
  const take = (): string | undefined => free.pop();
  const mirrorSq = (sq: string): string => {
    const [x, y] = parseSq(sq);
    const [mx, my] = mirror(d, x, y);
    return sqName(mx, my);
  };

  // Pieces first — an empty new ring is the thing we are trying to avoid.
  const base: Record<Color, boolean> = { w: inCheck(d, 'w'), b: inCheck(d, 'b') };
  let placed = 0;
  for (const type of zone.spawn) {
    const attempts: string[] = [];
    let done = false;
    while (!done) {
      const sq = take();
      if (!sq) break;
      const twin = mirrorSq(sq);
      if (spawnIsQuiet(d, sq, { type, color: 'w' }, base) && spawnIsQuiet(d, twin, { type, color: 'b' }, base)) {
        d.board[sq] = { type, color: 'w' };
        d.board[twin] = { type, color: 'b' };
        placed += 2;
        done = true;
      } else {
        attempts.push(sq);   // square would give check; keep it for terrain instead
      }
    }
    free.push(...attempts);
  }

  for (let i = 0; i < zone.walls; i++) {
    const sq = take();
    if (!sq) break;
    d.terrain[sq] = { type: 'wall', hp: WALL_HP };
    d.terrain[mirrorSq(sq)] = { type: 'wall', hp: WALL_HP };
  }
  for (let i = 0; i < zone.portals; i++) {
    const sq = take();
    if (!sq) break;
    const twin = mirrorSq(sq);
    // The pair links the two halves: stepping in throws you across the map.
    d.terrain[sq] = { type: 'portal', pair: twin };
    d.terrain[twin] = { type: 'portal', pair: sq };
  }
  for (let i = 0; i < zone.treasures; i++) {
    const sq = take();
    if (!sq) break;
    d.terrain[sq] = { type: 'treasure' };
    d.terrain[mirrorSq(sq)] = { type: 'treasure' };
  }

  return [{ type: 'expand', size: d.max - d.min + 1, zone: zone.name, pieces: placed }];
}

// ─── Applying a move ───────────────────────────────────────────────────────

export type ExpandResult =
  | { ok: false; reason: string }
  | { ok: true; events: GameEvent[]; san: string };

export function applyExpandMove(d: ExpandData, from: string, to: string): ExpandResult {
  const color = d.turn;
  const legal = legalExpandMoves(d, color);
  if (!legal.some(m => m.from === from && m.to === to)) return { ok: false, reason: 'Недозволений хід' };

  const piece = d.board[from]!;
  const events: GameEvent[] = [];
  const glyph = GLYPH[piece.type];

  const wall = d.terrain[to];
  if (wall?.type === 'wall') {
    const hp = (wall.hp ?? 1) - 1;
    const destroyed = hp <= 0;
    if (destroyed) delete d.terrain[to]; else wall.hp = hp;
    events.push({ type: 'wall_break', sq: to, color, destroyed });
    d.lastMove = { from, to };
    d.turn = otherColor(color);
    d.plies++;
    events.push(...maybeExpand(d));
    return { ok: true, events, san: `${glyph}${from}⚒${to}${destroyed ? '✕' : ''}` };
  }

  const final = portalTarget(d, to, color);

  const victimA = d.board[to];
  const victimB = final !== to ? d.board[final] : undefined;
  if (victimA) d.taken[color].push(victimA.type);
  if (victimB) d.taken[color].push(victimB.type);

  delete d.board[from];
  delete d.board[to];
  delete d.board[final];
  d.board[final] = piece;

  let suffix = '';
  if (final !== to) {
    events.push({ type: 'portal_jump', from: to, to: final, color });
    suffix += '⇝' + final;
  }

  // Promotion happens on the current far edge, which the next expansion pushes away again.
  const [, fy] = parseSq(final);
  if (piece.type === 'p' && fy === (color === 'w' ? d.max : d.min)) {
    piece.type = 'q';
    events.push({ type: 'promote', sq: final, color });
    suffix += '♛';
  } else {
    const cell = d.terrain[final];
    const upgraded = cell?.type === 'treasure' ? UPGRADE[piece.type] : undefined;
    if (upgraded) {
      piece.type = upgraded;
      delete d.terrain[final];
      events.push({ type: 'treasure', sq: final, to: upgraded, color });
      suffix += '💎' + GLYPH[upgraded];
    }
  }

  d.lastMove = { from, to: final };
  d.turn = otherColor(color);
  d.plies++;
  events.push(...maybeExpand(d));

  return { ok: true, events, san: `${glyph}${from}${victimA ? '×' : '→'}${to}${suffix}` };
}

// ─── For the client ────────────────────────────────────────────────────────

export function expandMaterial(d: ExpandData): { w: number; b: number } {
  const out = { w: 0, b: 0 };
  for (const p of Object.values(d.board)) out[p.color] += PIECE_VALUE[p.type];
  return out;
}

export function serializeExpand(d: ExpandData) {
  const board: Record<string, string> = {};
  for (const [sq, p] of Object.entries(d.board)) board[sq] = p.color + p.type;
  const kingSq = findKingSq(d, d.turn);
  return {
    min: d.min,
    max: d.max,
    size: d.max - d.min + 1,
    maxSize: MAX_SIZE,
    board,
    terrain: d.terrain,
    zone: d.zone,
    zones: ZONES.slice(0, d.expansions + 1).map(z => ({ name: z.name, tint: z.tint })),
    plies: d.plies,
    expansions: d.expansions,
    nextIn: nextExpandIn(d),
    checkSq: inCheck(d, d.turn) ? kingSq : null,
  };
}
