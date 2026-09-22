import { useMemo } from 'react';
import type { ExpandClientData, Color } from '../types';

interface Props {
  data: ExpandClientData;
  yourColor: Color | null;
  turn: Color;
  /** zone index currently highlighted on the board, or null */
  highlight: number | null;
  onHighlight: (zone: number | null) => void;
}

const TERRAIN = [
  { icon: '⛰', name: 'Стіни', desc: 'Перекривають промінь тур, слонів і ферзів. Ламаються: бийте по стіні звідки могли б узяти фігуру — пішак і вперед, і по діагоналі. Удар коштує хід, фігура лишається на місці; два удари — і стіна падає.' },
  { icon: '🌀', name: 'Портали', desc: 'Парні. Заходиш в один — вилітаєш з парного на протилежному боці карти. Зайнятий своєю фігурою портал не спрацьовує.' },
  { icon: '💎', name: 'Скарби', desc: 'Підвищують фігуру на ранг: пішак → кінь → слон → тура → ферзь. Ферзь і король просто проходять повз.' },
];

export default function ExpandPanel({ data, yourColor, turn, highlight, onHighlight }: Props) {
  const { size, maxSize, nextIn, zones, expansions } = data;
  const full = size >= maxSize;
  // Expansion lands every 3 plies, so it alternates sides; this says whose move it will be.
  const growsOn: Color = nextIn % 2 === 1 ? turn : (turn === 'w' ? 'b' : 'w');
  const growsMine = growsOn === yourColor;

  /** What is actually left standing in each ring — the reason to look at this list at all. */
  const stats = useMemo(() => {
    const out = zones.map(() => ({ walls: 0, portals: 0, treasures: 0, pieces: 0 }));
    for (const [sq, z] of Object.entries(data.zone)) {
      const s = out[z];
      if (!s) continue;
      const t = data.terrain[sq];
      if (t?.type === 'wall') s.walls++;
      else if (t?.type === 'portal') s.portals++;
      else if (t?.type === 'treasure') s.treasures++;
      if (data.board[sq]) s.pieces++;
    }
    return out;
  }, [data.zone, data.terrain, data.board, zones]);

  return (
    <div className="flex flex-col gap-3">
      <div className="glass rounded-2xl p-4">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-3">Карта</p>

        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-2xl font-bold text-white">{size}×{size}</span>
          <span className="text-xs text-slate-500">з {maxSize}×{maxSize}</span>
        </div>

        <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden mb-3">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-all duration-700"
            style={{ width: `${((size - 4) / (maxSize - 4)) * 100}%` }}
          />
        </div>

        {full ? (
          <p className="text-xs text-slate-400">Карта розрослася повністю. Далі — тільки бій.</p>
        ) : (
          <p className="text-xs text-slate-400">
            Наступне кільце через <b className="text-slate-200">{nextIn}</b> {nextIn === 1 ? 'хід' : 'ходи'} —
            {' '}випаде на {growsMine ? <b className="text-emerald-300">ваш хід</b> : 'хід суперника'}.
            <span className="block text-[10px] text-slate-600 mt-1">Розширення чергується: раз ваше, раз суперника.</span>
          </p>
        )}
      </div>

      <div className="glass rounded-2xl p-4">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">
          Землі <span className="text-slate-600">({expansions + 1}/9)</span>
        </p>
        <p className="text-[10px] text-slate-500 leading-snug mb-2.5">
          Карта росте кільцями, і кожне кільце — окрема земля зі своїм кольором на дошці.
          Тут видно, що в ній ще лишилось. Клацніть — підсвітиться на дошці.
        </p>

        <div className="flex flex-col gap-0.5">
          {zones.map((z, i) => {
            const s = stats[i] ?? { walls: 0, portals: 0, treasures: 0, pieces: 0 };
            const active = highlight === i;
            const isNewest = i === zones.length - 1 && expansions > 0;
            return (
              <button
                key={z.name}
                onClick={() => onHighlight(active ? null : i)}
                className={`zone-row${active ? ' active' : ''}`}
                title={active ? 'Клацніть ще раз, щоб зняти підсвітку' : `Підсвітити «${z.name}» на дошці`}
              >
                <span className="zone-swatch" style={{ background: z.tint }} />
                <span className={`zone-name${isNewest ? ' newest' : ''}`}>{z.name}</span>
                {isNewest && <span className="zone-fresh">щойно</span>}
                <span className="zone-counts">
                  {s.walls > 0 && <span title="стіни">⛰{s.walls}</span>}
                  {s.portals > 0 && <span title="портали">🌀{s.portals}</span>}
                  {s.treasures > 0 && <span title="скарби">💎{s.treasures}</span>}
                  {s.walls + s.portals + s.treasures === 0 && <span className="text-slate-600">чисто</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <details className="glass rounded-2xl p-4 group">
        <summary className="text-xs text-slate-500 font-medium uppercase tracking-wider cursor-pointer list-none flex items-center gap-1">
          <span className="transition-transform group-open:rotate-90">▸</span> Правила карти
        </summary>
        <div className="flex flex-col gap-2 mt-3">
          {TERRAIN.map((t) => (
            <div key={t.name} className="flex items-start gap-2">
              <span className="text-sm flex-shrink-0 mt-0.5">{t.icon}</span>
              <div>
                <div className="text-xs text-slate-300 font-medium leading-tight">{t.name}</div>
                <div className="text-[10px] text-slate-500 leading-tight">{t.desc}</div>
              </div>
            </div>
          ))}
          <p className="text-[10px] text-slate-600 leading-relaxed mt-1">
            Пішаки ходять на одну клітинку (без стрибка через дві та без взяття на проході) і перетворюються
            на ферзя на <b>поточному</b> дальньому краю — але кожне розширення відсуває цей край далі.
            Рокіровки немає. Нові фігури з'являються дзеркально для обох сторін і ніколи не ставлять шах одразу.
          </p>
        </div>
      </details>
    </div>
  );
}
