import { useEffect, useRef } from 'react';
import type { MoveVerbose } from '../types';

interface Props {
  history: MoveVerbose[];
}

export default function MoveHistory({ history }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history.length]);

  const pairs: [MoveVerbose, MoveVerbose | undefined][] = [];
  for (let i = 0; i < history.length; i += 2) {
    pairs.push([history[i], history[i + 1]]);
  }

  return (
    <div className="glass rounded-2xl p-4 flex flex-col" style={{ maxHeight: '320px' }}>
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-3">Історія ходів</p>

      {history.length === 0 ? (
        <p className="text-slate-600 text-xs text-center py-4">Ходів ще не було</p>
      ) : (
        <div className="overflow-y-auto flex-1 pr-1 space-y-0.5">
          {pairs.map(([white, black], i) => (
            <div key={i} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1 hover:bg-slate-700/30 transition-colors">
              <span className="text-slate-600 w-6 text-right flex-shrink-0 text-xs font-mono">{i + 1}.</span>
              <span className={`flex-1 font-mono text-xs px-1.5 py-0.5 rounded ${i === pairs.length - 1 && history.length % 2 !== 0 ? 'bg-emerald-900/30 text-emerald-300' : 'text-slate-300'}`}>
                {white.san}
              </span>
              {black ? (
                <span className={`flex-1 font-mono text-xs px-1.5 py-0.5 rounded ${i === pairs.length - 1 ? 'bg-emerald-900/30 text-emerald-300' : 'text-slate-300'}`}>
                  {black.san}
                </span>
              ) : (
                <span className="flex-1" />
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
