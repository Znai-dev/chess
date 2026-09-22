import type { MagicClientData, Color } from '../types';
import { SPELL_META } from '../effects';

interface Props {
  data: MagicClientData;
  yourColor: Color;
  isYourTurn: boolean;
  pendingSpellId: string | null;
  onCastSpell: (spellId: string) => void;
  onCancel: () => void;
}

export default function SpellPanel({ data, yourColor, isYourTurn, pendingSpellId, onCastSpell, onCancel }: Props) {
  const spells = data.spells[yourColor];
  const used = data.spellUsedThisTurn[yourColor];
  const rebirth = data.rebirthCounters[yourColor];
  const lost = data.captured[yourColor];

  return (
    <div className="flex flex-col gap-3">
      <div className="glass rounded-2xl p-4">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-3">
          Заклинання {yourColor === 'w' ? '⬜' : '⬛'}
        </p>

        {pendingSpellId && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2">
            <span className="flex-1">Клікніть на фігуру-ціль</span>
            <button onClick={onCancel} className="underline hover:text-amber-100">скасувати</button>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {spells.map((spell) => {
            const ready = spell.currentCooldown === 0;
            const isPending = pendingSpellId === spell.id;
            const canCast = isYourTurn && ready && !pendingSpellId && !used;
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
                  <div className="text-slate-500 text-[10px] leading-tight">{meta?.desc}</div>
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

        <p className="text-[10px] text-slate-600 text-center mt-2">
          {used ? 'Заклинання на цей хід уже використано' : 'Одне заклинання за хід, перед ходом фігурою'}
        </p>
      </div>

      <div className="glass rounded-2xl p-4">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-3">Магічні клітинки</p>
        <div className="flex flex-col gap-2">
          <Legend icon="🌀" label={`Портали ${data.teleports.a.join('↔')}, ${data.teleports.b.join('↔')}`}
                  desc="Фігура (не король) миттєво переноситься на парну клітинку. Кожен портал спрацьовує раз." />
          <Legend icon="♻️" label={`Відродження ${data.rebirthSqs.join(', ')}`}
                  desc={`Стійте тут 3 свої ходи — повернеться остання втрачена фігура.${rebirth ? ` Зараз: ${rebirth.count}/3 на ${rebirth.sq}.` : ''}${lost.length ? ` Наступна: ${lost[lost.length - 1]}.` : ' Втрат ще немає.'}`} />
        </div>
      </div>
    </div>
  );
}

function Legend({ icon, label, desc }: { icon: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-sm flex-shrink-0 mt-0.5">{icon}</span>
      <div>
        <div className="text-xs text-slate-300 font-medium leading-tight">{label}</div>
        <div className="text-[10px] text-slate-500 leading-tight">{desc}</div>
      </div>
    </div>
  );
}
