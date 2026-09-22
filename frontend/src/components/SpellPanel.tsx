import type { MagicSpellClient, Color } from '../types';

interface Props {
  spells: MagicSpellClient[];
  yourColor: Color;
  isYourTurn: boolean;
  pendingSpellId: string | null;
  onCastSpell: (spellId: string) => void;
}

const SPELL_META: Record<string, { icon: string; desc: string }> = {
  freeze:     { icon: '❄️', desc: 'Заморожує ворожу фігуру на 2 ходи' },
  invisible:  { icon: '👻', desc: 'Ховає свою фігуру від суперника на 3 ходи' },
  minishield: { icon: '🛡', desc: 'Щит поглинає одну атаку на свою фігуру' },
};

const MAGIC_SQUARES = [
  { icon: '↕️', label: 'Телепорт (b3↔b6, g3↔g6)', desc: 'Фігура миттєво переміщується на парну клітинку' },
  { icon: '♻️', label: 'Відродження (d3, d6)',      desc: 'Стійте тут 3 ходи — повернеться остання захоплена фігура' },
  { icon: '🛡', label: 'Щит (f3, f6)',              desc: 'Фігура отримує щит, що поглинає одну атаку' },
];

export default function SpellPanel({ spells, yourColor, isYourTurn, pendingSpellId, onCastSpell }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {/* Spells */}
      <div className="glass rounded-2xl p-4">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-3">
          Заклинання {yourColor === 'w' ? '⬜' : '⬛'}
        </p>

        {pendingSpellId && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs text-center">
            Клікніть на фігуру для застосування
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {spells.map((spell) => {
            const ready = spell.currentCooldown === 0;
            const isPending = pendingSpellId === spell.id;
            const canCast = isYourTurn && ready && !pendingSpellId;
            const meta = SPELL_META[spell.id];

            return (
              <button
                key={spell.id}
                onClick={() => canCast && onCastSpell(spell.id)}
                disabled={!canCast}
                title={meta?.desc}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all text-xs
                  ${isPending ? 'bg-amber-500/30 border border-amber-400/60 text-amber-200' :
                    canCast   ? 'bg-slate-700/60 hover:bg-slate-600/60 border border-slate-600/40 text-slate-200 cursor-pointer' :
                                'bg-slate-800/40 border border-slate-700/30 text-slate-500 cursor-not-allowed'}
                `}
              >
                <span className="text-base flex-shrink-0">{meta?.icon ?? '✦'}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium leading-tight">{spell.name}</div>
                  <div className="text-slate-500 text-[10px] leading-tight truncate">{meta?.desc}</div>
                </div>
                {ready ? (
                  <span className="text-emerald-400 text-xs font-semibold flex-shrink-0">готово</span>
                ) : (
                  <span className="text-slate-400 text-xs flex-shrink-0">{spell.currentCooldown}хд</span>
                )}
              </button>
            );
          })}
        </div>

        {!isYourTurn && (
          <p className="text-xs text-slate-600 text-center mt-2">Заклинання — перед вашим ходом</p>
        )}
      </div>

      {/* Magic squares legend */}
      <div className="glass rounded-2xl p-4">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-3">Магічні клітинки</p>
        <div className="flex flex-col gap-2">
          {MAGIC_SQUARES.map((sq) => (
            <div key={sq.label} className="flex items-start gap-2">
              <span className="text-sm flex-shrink-0 mt-0.5">{sq.icon}</span>
              <div>
                <div className="text-xs text-slate-300 font-medium leading-tight">{sq.label}</div>
                <div className="text-[10px] text-slate-500 leading-tight">{sq.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
