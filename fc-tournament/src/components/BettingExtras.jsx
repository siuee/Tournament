import { motion } from 'framer-motion';

export function ProbabilityPanel({ match, probabilities }) {
  const { home, draw, away } = probabilities;
  const rows = [
    { label: match.home, value: home, color: 'from-cyan-400 to-emerald-400' },
    { label: 'Draw', value: draw, color: 'from-slate-400 to-slate-600' },
    { label: match.away, value: away, color: 'from-fuchsia-400 to-pink-500' },
  ];

  return (
    <div className="rounded-2xl border border-cyan-500/40 bg-[#020617]/90 p-4 space-y-3 text-sm text-slate-100 shadow-[0_0_24px_rgba(34,211,238,0.6)]">
      <p className="font-semibold text-cyan-100">AI prediction Winning Probability</p>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-200">
              <span className="truncate">{row.label}</span>
              <span className="font-bold text-cyan-300">{row.value}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-800/60 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${row.value}%` }}
                transition={{ type: 'spring', damping: 20, stiffness: 200 }}
                className={`h-full rounded-full bg-gradient-to-r ${row.color}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormPanel({ homeName, awayName, homeForm, awayForm, emptyMessage }) {
  return (
    <div className="rounded-2xl border border-fuchsia-500/40 bg-[#020617]/90 p-4 space-y-3 text-sm text-slate-100 shadow-[0_0_24px_rgba(232,121,249,0.65)]">
      <p className="font-semibold text-fuchsia-100">Recent form (last 5)</p>
      <div className="space-y-2">
        <FormRow label={homeName} form={homeForm} accent="text-emerald-400" emptyMessage={emptyMessage} />
        <FormRow label={awayName} form={awayForm} accent="text-sky-400" emptyMessage={emptyMessage} />
      </div>
      <p className="text-[10px] text-slate-400">
        W = Win, D = Draw, L = Loss. Form is from recorded matches only (last 5). Blank = no matches in that format yet.
      </p>
    </div>
  );
}

function FormRow({ label, form, accent, emptyMessage }) {
  const safeForm = typeof form === 'string' ? form.trim() : '';
  const items = safeForm ? safeForm.split(' ').filter(Boolean) : [];
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-xs font-semibold truncate drop-shadow-[0_0_10px_rgba(15,23,42,0.9)] ${accent}`}>{label}</span>
      {items.length > 0 ? (
        <div className="flex items-center gap-1.5">
          {items.map((ch, idx) => (
            <span
              key={idx}
              className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                ch === 'W'
                  ? 'bg-emerald-500/40 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.8)]'
                  : ch === 'D'
                  ? 'bg-slate-500/40 text-slate-100'
                  : 'bg-rose-500/35 text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.8)]'
              }`}
            >
              {ch}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-slate-500 italic">{emptyMessage || 'No recent matches yet'}</span>
      )}
    </div>
  );
}

