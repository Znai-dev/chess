import { useMemo } from 'react';
import { Chess } from 'chess.js';
import type { Color, LootboxClientData, EffectType } from '../types';
import { EFFECTS, PIECE_GLYPH } from '../effects';

interface Props {
  data: LootboxClientData;
  fen: string;
  yourColor: Color | null;
}

const ORDER: EffectType[] = ['extra_move', 'shield', 'teleport', 'rage', 'knight', 'bomb', 'stun', 'pacifist'];

export default function LootPanel({ data, fen, yourColor }: Props) {
  const active = useMemo(() => {
    const chess = new Chess();
    try { chess.load(fen); } catch { return []; }
    return Object.entries(data.effects).map(([sq, eff]) => {
      const piece = chess.get(sq as any);
      return { sq, eff, piece, mine: piece?.color === yourColor };
    }).filter(e => e.piece);
  }, [data.effects, fen, yourColor]);

  const mine = active.filter(e => e.mine);
  const theirs = active.filter(e => !e.mine);

  return (
    <div className="glass rounded-2xl p-4 flex flex-col gap-3">
      <div>
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Ефекти на полі</p>
        {active.length === 0 ? (
          <p className="text-xs text-slate-600">Поки що ніхто нічого не підібрав. Скрині 📦 — на дошці.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {[...mine, ...theirs].map(({ sq, eff, piece, mine }) => {
              const meta = EFFECTS[eff.type];
              const timer = eff.movesLeft > 0 ? ` · ${eff.movesLeft} ${eff.type === 'stun' || eff.type === 'pacifist' ? 'хд' : 'ходи фігури'}` : '';
              return (
                <div key={sq} className={`flex items-center gap-2 text-xs rounded-lg px-2 py-1 ${mine ? 'bg-slate-700/40' : 'bg-slate-800/30'}`} title={meta.desc}>
                  <span className="text-base leading-none">{meta.icon}</span>
                  <span className="text-slate-200 font-medium">{meta.name}</span>
                  <span className="text-slate-500 ml-auto whitespace-nowrap">
                    {mine ? 'ваш' : 'суперника'} {PIECE_GLYPH[piece!.type]}{sq}{timer}{eff.fresh ? ' · з наст. ходу' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <details className="group">
        <summary className="text-xs text-slate-500 font-medium uppercase tracking-wider cursor-pointer list-none flex items-center gap-1">
          <span className="transition-transform group-open:rotate-90">▸</span> Що випадає зі скринь
        </summary>
        <div className="flex flex-col gap-1.5 mt-2">
          {ORDER.map((type) => {
            const m = EFFECTS[type];
            return (
              <div key={type} className="flex items-start gap-2">
                <span className="text-sm flex-shrink-0 mt-0.5">{m.icon}</span>
                <div>
                  <div className={`text-xs font-medium leading-tight ${m.tone === 'debuff' ? 'text-red-300' : 'text-slate-200'}`}>{m.name}</div>
                  <div className="text-[10px] text-slate-500 leading-tight">{m.desc}</div>
                </div>
              </div>
            );
          })}
          <p className="text-[10px] text-slate-600 mt-1">
            Нова скриня замінює старий ефект. Кому не щастить по матеріалу — тому скрині трохи щедріші.
          </p>
        </div>
      </details>
    </div>
  );
}
