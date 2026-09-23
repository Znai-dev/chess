import { motion } from 'framer-motion';
import type { Color, GameState } from '../types';
import { EFFECTS, PIECE_GLYPH } from '../effects';

interface Props {
  state: GameState | null;
  yourColor: Color | null;
  spellName?: string | null;
  onSkipExtraMove: () => void;
  onCancelSpell: () => void;
}

/** The one place that always answers: whose move is it, and what exactly do I do now? */
export default function TurnBar({ state, yourColor, spellName, onSkipExtraMove, onCancelSpell }: Props) {
  if (!state) return null;

  if (state.status === 'waiting') {
    return (
      <div className="turn-bar waiting">
        <span className="status-dot waiting" />
        <span>Очікування суперника…</span>
      </div>
    );
  }

  if (state.status === 'finished') {
    return <div className="turn-bar finished">Гру завершено</div>;
  }

  const spectator = yourColor === null;
  const myTurn = !spectator && state.turn === yourColor;
  const pending = state.pending;
  const opponentIsBot = !!state.players.find((p) => p.color !== yourColor)?.isBot;

  // What the game is waiting for, in one line
  let hint: React.ReactNode = null;
  let action: React.ReactNode = null;

  if (myTurn && pending?.kind === 'extra_move') {
    const glyph = pieceAt(state.fen, pending.sq);
    hint = <>⚡ Додатковий хід: походіть {glyph} з <b>{pending.sq}</b></>;
    action = <button onClick={onSkipExtraMove} className="turn-btn">Пропустити</button>;
  } else if (myTurn && pending?.kind === 'shield_break') {
    hint = <>🛡 Щит поглинув удар. Оберіть підсвічену клітинку, куди відскочить ваша фігура</>;
  } else if (myTurn && pending?.kind === 'spell_target') {
    hint = <>🎯 {spellName ?? 'Заклинання'}: клікніть на фігуру-ціль</>;
    action = <button onClick={onCancelSpell} className="turn-btn">Скасувати</button>;
  } else if (myTurn && state.lootboxData?.effectsSuspended === yourColor) {
    hint = <>Ефекти на ваших фігурах зняті на цей хід — інакше ходу не було б</>;
  } else if (myTurn && state.magicData?.thawed === yourColor) {
    hint = <>❄️ Заморозка розтанула: тільки та фігура могла врятувати короля</>;
  } else if (!myTurn && pending && pending.color !== yourColor) {
    hint = pending.kind === 'extra_move' ? 'Суперник має додатковий хід' :
           pending.kind === 'shield_break' ? 'Суперник обирає, куди відскочити' : 'Суперник чаклує';
  }

  return (
    <motion.div
      key={`${state.turn}-${myTurn}`}
      initial={{ opacity: 0.6, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`turn-bar ${spectator ? 'spectator' : myTurn ? 'mine' : 'theirs'}`}
    >
      <div className="flex items-center gap-3 w-full">
        <span className={`turn-pill ${myTurn ? 'mine' : 'theirs'}`}>
          <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${state.turn === 'w' ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-500'}`} />
          {spectator
            ? (state.turn === 'w' ? 'Хід білих' : 'Хід чорних')
            : myTurn ? 'ВАШ ХІД' : opponentIsBot ? 'Бот думає…' : 'Хід суперника'}
        </span>
        {state.inCheck && <span className="check-chip">⚠️ Шах!</span>}
        {state.expandData && (
          <span className="map-chip" title="Розмір карти та скільки ходів до наступного розширення">
            🗺️ {state.expandData.size}×{state.expandData.size}
            {state.expandData.nextIn > 0 && <b className="ml-1 text-slate-300">+{state.expandData.nextIn}</b>}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500 flex-shrink-0">Хід {Math.floor(state.history.length / 2) + 1}</span>
      </div>
      {(hint || action) && (
        <div className="flex items-center gap-3 w-full text-sm">
          <span className="flex-1">{hint}</span>
          {action}
        </div>
      )}
    </motion.div>
  );
}

function pieceAt(fen: string, sq: string): string {
  const rows = fen.split(' ')[0].split('/');
  const rank = 8 - parseInt(sq[1]);
  const fileIdx = sq.charCodeAt(0) - 97;
  let f = 0;
  for (const ch of rows[rank] ?? '') {
    if (/\d/.test(ch)) { f += parseInt(ch); continue; }
    if (f === fileIdx) return PIECE_GLYPH[ch.toLowerCase()] ?? '';
    f++;
  }
  return '';
}

export function effectName(type: keyof typeof EFFECTS): string {
  return `${EFFECTS[type].icon} ${EFFECTS[type].name}`;
}
