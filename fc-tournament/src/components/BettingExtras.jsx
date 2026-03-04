import { motion } from 'framer-motion';

export function ProbabilityPanel({ match, probabilities }) {
  const { home, draw, away } = probabilities;
  const rows = [
    { label: match.home, value: home, color: 'from-emerald-400 to-emerald-600' },
    { label: 'Draw', value: draw, color: 'from-slate-400 to-slate-600' },
    { label: match.away, value: away, color: 'from-sky-400 to-sky-600' },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3 text-sm text-gray-200">
      <p className="font-semibold text-white">Win probability (fun estimate)</p>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1">
            <div className="flex justify-between text-[11px] text-gray-300">
              <span className="truncate">{row.label}</span>
              <span className="font-bold text-yellow-300">{row.value}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
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
      <p className="text-[10px] text-gray-500">
        Probabilities are derived from Banana FC standings and goal stats, and are for entertainment only.
      </p>
    </div>
  );
}

export function FormPanel({ homeName, awayName, homeForm, awayForm }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3 text-sm text-gray-200">
      <p className="font-semibold text-white">Recent form (last 5)</p>
      <div className="space-y-2">
        <FormRow label={homeName} form={homeForm} accent="text-emerald-400" />
        <FormRow label={awayName} form={awayForm} accent="text-sky-400" />
      </div>
      <p className="text-[10px] text-gray-500">
        W = Win, D = Draw, L = Loss. Form strings are approximations based on current Banana FC league stats.
      </p>
    </div>
  );
}

function FormRow({ label, form, accent }) {
  const items = form.split(' ').filter(Boolean);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-xs font-semibold truncate ${accent}`}>{label}</span>
      <div className="flex items-center gap-1.5">
        {items.map((ch, idx) => (
          <span
            key={idx}
            className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
              ch === 'W'
                ? 'bg-emerald-500/30 text-emerald-300'
                : ch === 'D'
                ? 'bg-slate-500/30 text-slate-200'
                : 'bg-rose-500/25 text-rose-300'
            }`}
          >
            {ch}
          </span>
        ))}
      </div>
    </div>
  );
}

