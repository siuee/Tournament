import { motion } from 'framer-motion';

export function H2HPanel({ match, state }) {
  const { loading, error, summary, matches } = state || {};

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-gray-200">
        <p className="mb-1 font-semibold">Head to head</p>
        <p className="text-[11px] text-gray-400">Loading previous Banana FC meetings…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-gray-200">
        <p className="mb-1 font-semibold">Head to head</p>
        <p className="text-[11px] text-rose-400">Could not load head-to-head stats.</p>
      </div>
    );
  }

  if (!summary || matches.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-gray-200">
        <p className="mb-1 font-semibold">Head to head</p>
        <p className="text-[11px] text-gray-400">
          These teams have not met yet in recorded Banana FC matches. Their first clash will set the tone.
        </p>
      </div>
    );
  }

  const { homeWins, awayWins, draws } = summary;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-4 text-sm text-gray-200">
      {/* Top summary row */}
      <div className="flex items-center justify-around gap-4 text-center">
        <H2hPill
          label={`${match.home} wins`}
          value={homeWins}
          color="bg-emerald-600"
        />
        <H2hPill
          label="Draws"
          value={draws}
          color="bg-slate-600"
        />
        <H2hPill
          label={`${match.away} wins`}
          value={awayWins}
          color="bg-sky-700"
        />
      </div>

      {/* Matches list */}
      <div className="space-y-2 pr-1">
        {matches.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
          >
            <div className="flex flex-col gap-0.5 text-[11px]">
              <span className="text-gray-400">{m.dateText}</span>
              {(() => {
                const homeWin = m.homeGoals > m.awayGoals;
                const awayWin = m.awayGoals > m.homeGoals;
                const homeClass = homeWin
                  ? 'text-emerald-400 font-semibold'
                  : awayWin
                  ? 'text-rose-400'
                  : 'text-gray-300';
                const awayClass = awayWin
                  ? 'text-emerald-400 font-semibold'
                  : homeWin
                  ? 'text-rose-400'
                  : 'text-gray-300';
                const scoreClass = homeWin || awayWin ? 'text-white font-semibold' : 'text-gray-200 font-semibold';
                return (
                  <span className="text-gray-300">
                    <span className={homeClass}>{m.homeName}</span>{' '}
                    <span className={scoreClass}>
                      {m.homeGoals} - {m.awayGoals}
                    </span>{' '}
                    <span className={awayClass}>{m.awayName}</span>
                  </span>
                );
              })()}
            </div>
            {String(m.tournamentType || '').toLowerCase().includes('champions') ? (
              <div className="flex items-center gap-2">
                <img
                  src="/assets/leagues/ucl.png"
                  alt="eChampions League"
                  className="h-6 w-auto rounded-full border border-white/20 bg-white/10"
                />
              </div>
            ) : (
              <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-[0.16em]">
                {m.tournamentType}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function H2hPill({ label, value, color }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black text-white ${color} shadow-[0_0_15px_rgba(0,0,0,0.6)]`}
      >
        {value}
      </motion.div>
      <span className="text-[10px] text-gray-300 uppercase tracking-[0.18em] max-w-[7rem]">
        {label}
      </span>
    </div>
  );
}

