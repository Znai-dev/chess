import type { CSSProperties } from 'react';
import type { EffectType, MoveKind } from './types';

export interface EffectMeta {
  icon: string;
  name: string;
  desc: string;
  tone: 'buff' | 'debuff';
}

export const EFFECTS: Record<EffectType, EffectMeta> = {
  extra_move: { icon: '⚡', name: 'Додатковий хід',  tone: 'buff',   desc: 'Одразу ще один хід цією ж фігурою. Дається лише якщо їй є куди ходити.' },
  shield:     { icon: '🛡', name: 'Щит',             tone: 'buff',   desc: 'Поглинає одне взяття: атакуючий не бере фігуру, а приземляється на вільну клітинку поруч.' },
  teleport:   { icon: '🌀', name: 'Телепорт',        tone: 'buff',   desc: 'Замість ходу — стрибок на будь-яку вільну клітинку. Одноразово.' },
  rage:       { icon: '🔥', name: 'Лють',            tone: 'buff',   desc: '2 ходи: тільки вперед, зате може стрибати на червоні клітинки перед собою крізь будь-які фігури.' },
  knight:     { icon: '🐴', name: 'Кінська сила',    tone: 'buff',   desc: '2 ходи: на додачу до своїх ходів фігура ходить як кінь.' },
  bomb:       { icon: '💣', name: 'Бомба',           tone: 'buff',   desc: 'Хто візьме цю фігуру — згорить разом із нею. Король не ризикне.' },
  stun:       { icon: '💤', name: 'Оглушення',       tone: 'debuff', desc: 'Фігура пропускає наступний хід.' },
  pacifist:   { icon: '🕊', name: 'Пацифіст',        tone: 'debuff', desc: '2 ходи фігура не може брати чужі фігури.' },
};

export const SPELL_META: Record<string, { icon: string; desc: string }> = {
  freeze:     { icon: '❄️', desc: 'Ворожа фігура не ходить 2 свої ходи. Не діє на короля.' },
  invisible:  { icon: '👻', desc: 'Своя фігура зникає для суперника на 3 його ходи.' },
  minishield: { icon: '🛡', desc: 'Своя фігура поглинає одне взяття; атакуючий втрачає хід.' },
};

export const PIECE_GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

/** How a legal-move hint is drawn, by kind */
export const KIND_STYLE: Record<MoveKind, { empty: CSSProperties; capture: CSSProperties; label: string }> = {
  normal:   { label: '',
              empty:   { background: 'radial-gradient(circle, rgba(0,0,0,0.28) 26%, transparent 30%)' },
              capture: { background: 'radial-gradient(circle, transparent 60%, rgba(239,68,68,0.55) 62%)' } },
  rage:     { label: '🔥',
              empty:   { background: 'radial-gradient(circle, rgba(249,115,22,0.75) 26%, transparent 30%)' },
              capture: { background: 'radial-gradient(circle, transparent 60%, rgba(249,115,22,0.85) 62%)' } },
  knight:   { label: '🐴',
              empty:   { background: 'radial-gradient(circle, rgba(245,158,11,0.75) 26%, transparent 30%)' },
              capture: { background: 'radial-gradient(circle, transparent 60%, rgba(245,158,11,0.85) 62%)' } },
  teleport: { label: '🌀',
              empty:   { background: 'radial-gradient(circle, rgba(168,85,247,0.6) 22%, transparent 26%)' },
              capture: { background: 'radial-gradient(circle, transparent 60%, rgba(168,85,247,0.85) 62%)' } },
};
