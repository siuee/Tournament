import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, ChevronDown, ChevronRight, Coins, TicketPercent, Flame, Percent } from 'lucide-react';
import { db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { formatMatchHistoryTeam, formatMatchDateTime } from '../lib/utils';
import { ProbabilityPanel, FormPanel } from './BettingExtras';
import { H2HPanel } from './BettingH2H';

// Simple fake data inspired by FC esports betting slates.
// Odds are for FUN ONLY – no real-money betting.
// Betting page is DATA-DRIVEN: only shows tournaments that exist in Firestore.

function slug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function makeTeamId(team, idx) {
  const name = (team?.name || '').trim();
  const playerIds = (team?.playerData || []).map(p => p?.id).filter(Boolean).sort().join('-');
  return `${idx}-${slug(name || playerIds || 'team')}`;
}

function teamLabel(team) {
  return formatMatchHistoryTeam(team, team?.name || '');
}

function generateLeagueFixtures(tournament) {
  const teams = tournament.teams || [];
  if (teams.length < 2) return [];
  const fixtures = [];
  const base = Date.now() + 1000 * 60 * 30; // start in 30 mins
  let idx = 0;
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const home = teams[i];
      const away = teams[j];
      const kickoff = new Date(base + idx * 1000 * 60 * 45); // every 45 mins
      const id = `${makeTeamId(home, i)}-vs-${makeTeamId(away, j)}-${idx}`;
      const homeShort = teamLabel(home);
      const awayShort = teamLabel(away);
      fixtures.push({
        id,
        kickoff,
        label: 'League Fixture',
        home: homeShort,
        away: awayShort,
        homeTeamObj: home,
        awayTeamObj: away,
        markets: {
          moneyline: {
            label: 'Moneyline',
            options: [
              { id: `${id}-home-ml`, label: homeShort, odds: -110 },
              { id: `${id}-draw-ml`, label: 'Draw', odds: +260 },
              { id: `${id}-away-ml`, label: awayShort, odds: +170 },
            ],
          },
          spread: {
            label: 'Handicap',
            lineNote: 'League handicap',
            options: [
              { id: `${id}-home-hcap`, label: `${homeShort} -0.5`, odds: +120 },
              { id: `${id}-away-hcap`, label: `${awayShort} +0.5`, odds: -140 },
            ],
          },
          total: {
            label: 'Total Goals',
            options: [
              { id: `${id}-over-3_5`, label: 'Over 3.5', odds: +135 },
              { id: `${id}-under-3_5`, label: 'Under 3.5', odds: -160 },
            ],
          },
        },
      });
      idx += 1;
    }
  }
  return fixtures;
}

function formatAmericanOdds(odds) {
  if (odds > 0) return `+${odds}`;
  return `${odds}`;
}

function getPayout(stake, odds) {
  const s = Number(stake) || 0;
  if (!s || !odds) return { win: 0, total: 0 };
  let win = 0;
  if (odds > 0) {
    win = (s * odds) / 100;
  } else {
    win = (s * 100) / Math.abs(odds);
  }
  const total = s + win;
  return { win, total };
}

function computeWinProbabilities(match) {
  const h = match.homeTeamObj || {};
  const a = match.awayTeamObj || {};
  const hScore = (h.pts || 0) + (h.totalGoals || 0) * 0.5 + 1;
  const aScore = (a.pts || 0) + (a.totalGoals || 0) * 0.5 + 1;
  let home = hScore;
  let away = aScore;
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    home = 1;
    away = 1;
  }
  let base = home + away;
  if (base <= 0) {
    return { home: 40, draw: 20, away: 40 };
  }
  let homeP = (home / base) * 80;
  let awayP = (away / base) * 80;
  let drawP = 100 - homeP - awayP;
  if (drawP < 10) {
    const diff = 10 - drawP;
    drawP += diff;
    const factor = (homeP + awayP) || 1;
    homeP -= (homeP / factor) * diff;
    awayP -= (awayP / factor) * diff;
  }
  const norm = homeP + awayP + drawP || 1;
  homeP = (homeP / norm) * 100;
  awayP = (awayP / norm) * 100;
  drawP = 100 - homeP - awayP;
  return {
    home: Math.round(homeP),
    draw: Math.round(drawP),
    away: Math.round(awayP),
  };
}

function computeFormString(team) {
  const pts = team?.pts || 0;
  if (pts >= 12) return 'W W W W D';
  if (pts >= 8) return 'W W D W L';
  if (pts >= 4) return 'W D L W L';
  return 'L D L D W';
}

export default function Betting() {
  const [tournaments, setTournaments] = useState([]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [betslip, setBetslip] = useState([]);
  const [stake, setStake] = useState('10');
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState('summary'); // summary | h2h | probability | form
  const [h2hState, setH2hState] = useState({ loading: false, error: null, summary: null, matches: [] });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'tournaments'));
        const raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Only show tournaments that actually exist and have teams
        const cleaned = raw
          .filter(t => Array.isArray(t?.teams) && t.teams.length >= 2)
          .map(t => {
            const rawType = t.type || '';
            const sourceName = t.name || rawType || '';
            const typeLower = rawType.toLowerCase();
            const nameLower = sourceName.toLowerCase();

            let name = `${sourceName || 'Tournament'} – Next Events`;
            let region = `${rawType || sourceName || 'Banana FC'} · ${String(t.format || '').toUpperCase()}`.trim();

            // Special styling for eChampions-style tournaments: detect by *tournament name*,
            // then rely on the logo in the header instead of a big all-caps title.
            if (nameLower.includes('champions')) {
              name = 'Champions League – Next Events';
              region = `Europe · ${String(t.format || '').toUpperCase()}`.trim();
            }

            return {
              id: t.id,
              name,
              region,
              highlight: t.status === 'active' ? 'Live' : 'Saved',
              teams: t.teams,
              rawType,
              sourceName,
            };
          });

        if (!mounted) return;
        setTournaments(cleaned);
        setExpandedIds(new Set(cleaned.map(t => t.id)));
      } catch (e) {
        console.error('Failed to load tournaments for betting:', e);
        if (!mounted) return;
        setTournaments([]);
        setExpandedIds(new Set());
      }
    })();
    return () => { mounted = false; };
  }, []);

  const toggleTournament = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addSelection = (match, marketLabel, option) => {
    setBetslip((prev) => {
      const key = `${match.id}-${marketLabel}`;
      const filtered = prev.filter(sel => sel.key !== key);
      return [
        ...filtered,
        {
          key,
          matchLabel: `${match.home} vs ${match.away}`,
          market: marketLabel,
          selection: option.label,
          odds: option.odds,
        },
      ];
    });
  };

  const removeSelection = (key) => {
    setBetslip(prev => prev.filter(sel => sel.key !== key));
  };

  const totals = useMemo(() => {
    const s = Number(stake) || 0;
    if (!s || betslip.length === 0) return { win: 0, total: 0 };
    // Simple single-bet style: assume all selections are singles with same stake.
    const per = betslip.map(sel => getPayout(s, sel.odds).win);
    const win = per.reduce((acc, v) => acc + v, 0);
    const total = win + s * betslip.length;
    return { win, total };
  }, [betslip, stake]);

  // Load head-to-head matches when opening H2H tab
  useEffect(() => {
    if (!detail || detailTab !== 'h2h') return;
    const homeTeam = detail.match.homeTeamObj;
    const awayTeam = detail.match.awayTeamObj;
    const homeIds = (homeTeam?.playerData || []).map(p => p.id).filter(Boolean).sort();
    const awayIds = (awayTeam?.playerData || []).map(p => p.id).filter(Boolean).sort();
    if (homeIds.length === 0 || awayIds.length === 0) {
      setH2hState({ loading: false, error: null, summary: null, matches: [] });
      return;
    }
    const key = (arr) => arr.join(',');
    const homeKey = key(homeIds);
    const awayKey = key(awayIds);

    let cancelled = false;
    const load = async () => {
      setH2hState({ loading: true, error: null, summary: null, matches: [] });
      try {
        const snap = await getDocs(collection(db, 'matches'));
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const filtered = all.filter(m => {
          const mh = key((m.homeTeamPlayerIds || []).slice().sort());
          const ma = key((m.awayTeamPlayerIds || []).slice().sort());
          return (mh === homeKey && ma === awayKey) || (mh === awayKey && ma === homeKey);
        });

        let homeWins = 0;
        let awayWins = 0;
        let draws = 0;

        const matches = filtered
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
            const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
            return tb - ta;
          })
          .map(m => {
            const mh = key((m.homeTeamPlayerIds || []).slice().sort());
            const ma = key((m.awayTeamPlayerIds || []).slice().sort());
            const currentHomeIsDbHome = mh === homeKey;
            const dbHomeScore = m.homeScore ?? 0;
            const dbAwayScore = m.awayScore ?? 0;
            const homeGoals = currentHomeIsDbHome ? dbHomeScore : dbAwayScore;
            const awayGoals = currentHomeIsDbHome ? dbAwayScore : dbHomeScore;

            if (homeGoals > awayGoals) homeWins += 1;
            else if (homeGoals < awayGoals) awayWins += 1;
            else draws += 1;

            return {
              id: m.id,
              dateText: formatMatchDateTime(m.createdAt),
              homeName: currentHomeIsDbHome ? detail.match.home : detail.match.away,
              awayName: currentHomeIsDbHome ? detail.match.away : detail.match.home,
              homeGoals,
              awayGoals,
              tournamentType: m.tournamentType || 'Tournament',
            };
          });

        const summary = { homeWins, awayWins, draws };
        if (!cancelled) {
          setH2hState({ loading: false, error: null, summary, matches });
        }
      } catch (e) {
        console.error('Failed to load H2H matches', e);
        if (!cancelled) {
          setH2hState({ loading: false, error: 'Failed to load', summary: null, matches: [] });
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [detail, detailTab]);

  return (
    <div className="relative flex flex-col gap-6 w-full pb-28 md:pb-20">
      {/* Markets and details */}
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-2xl bg-yellow-500/10 border border-yellow-500/30">
              <TicketPercent className="w-6 h-6 text-yellow-500" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-yellow-200 to-yellow-600">
                Banana Betting Zone
              </h1>
              <p className="text-[11px] text-gray-400 font-medium">
                Fun-only odds inspired by FC26 esports – no real money.
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-gray-400">
            <Flame className="w-4 h-4 text-yellow-500" />
            <span>Upcoming fixtures · Next 24h</span>
          </div>
        </div>

        {/* Tournament groups */}
        <div className="space-y-3">
          {tournaments.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-[#050509]/80 p-8 text-center">
              <p className="text-white/90 font-semibold mb-2">No tournaments yet</p>
              <p className="text-gray-400 text-sm">
                Create a tournament in Match Day, then come back here to see “Next Events” odds.
              </p>
            </div>
          ) : tournaments.map((t) => {
            const expanded = expandedIds.has(t.id);
            const matches = t.matches || generateLeagueFixtures(t);
            const isActiveTournament = detail && detail.tournamentId === t.id;
            return (
              <motion.section
                key={t.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-3xl border border-white/10 bg-[#050509]/80 overflow-hidden"
              >
                <button
                  onClick={() => toggleTournament(t.id)}
                  className="w-full flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-center gap-3 text-left">
                    <div className="p-2 rounded-2xl bg-yellow-500/10 border border-yellow-500/30">
                      <Trophy className="w-4 h-4 text-yellow-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        {String(t.sourceName || '').toLowerCase().includes('champions') ? (
                          <div className="flex items-center gap-2">
                            <img
                              src="/assets/leagues/ucl.png"
                              alt="eChampions League"
                              className="h-6 w-auto rounded-full border border-white/20 bg-white/10"
                            />
                            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                              Next Events
                            </span>
                          </div>
                        ) : (
                          <h2 className="text-sm sm:text-base font-black uppercase tracking-tight text-white">
                            {t.name}
                          </h2>
                        )}
                        {t.highlight && (
                          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-yellow-400 bg-yellow-500/10 border border-yellow-500/40 rounded-full px-2 py-0.5">
                            {t.highlight}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-[0.22em]">
                        {t.region} · {matches.length} fixtures
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-gray-400 text-xs">
                    <span>{expanded ? 'Hide' : 'Show'} odds</span>
                    {expanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18 }}
                      className="divide-y divide-white/5"
                    >
                      {/* Detail tabs row above the table */}
                      <div className="px-4 sm:px-6 py-3 border-b border-white/5 bg-gradient-to-r from-[#090814] via-[#070713] to-[#090814] flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em]">
                        {['summary', 'h2h', 'probability', 'form'].map((tab) => {
                          const labels = {
                            summary: 'Prematch Summary',
                            h2h: 'Head to Head',
                            probability: 'Probability',
                            form: 'Recent Form',
                          };
                          const active = detailTab === tab;
                          return (
                            <button
                              key={tab}
                              onClick={() => {
                                // Switch the active detail tab
                                setDetailTab(tab);
                                // If no match is currently selected for this tournament,
                                // automatically focus the first fixture so the tab always
                                // shows something.
                                if (!detail || detail.tournamentId !== t.id) {
                                  const first = matches[0];
                                  if (first) {
                                    setDetail({ match: first, tournament: t.name, tournamentId: t.id });
                                  }
                                }
                              }}
                              className={`px-2.5 py-1.5 rounded-full border text-[9px] font-bold transition-colors ${
                                active
                                  ? 'border-yellow-400 bg-yellow-500/25 text-yellow-50 shadow-[0_0_12px_rgba(250,204,21,0.45)]'
                                  : 'border-white/10 bg-white/5 text-gray-300 hover:border-yellow-400/70 hover:text-yellow-100'
                              }`}
                            >
                              {labels[tab]}
                            </button>
                          );
                        })}
                        <span className="ml-auto text-[9px] text-gray-400">
                          {detail && detail.tournamentId === t.id
                            ? `${detail.match.home} vs ${detail.match.away}`
                            : 'Select a fixture to view details'}
                        </span>
                      </div>

                      {/* For each fixture, show its own detail block + odds table */}
                      {matches.map((m) => (
                        <div key={m.id}>
                          {/* Inline detail panel for this specific fixture */}
                          {detail && detail.tournamentId === t.id && detail.match.id === m.id && (
                            <div className="px-4 sm:px-6 py-3 bg-[#05050b]/95 border-t border-white/10 h-60 sm:h-64 overflow-y-auto">
                              <div className="space-y-4 pr-1">
                                {detailTab === 'summary' && (
                                  <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#111322] via-[#090b17] to-[#05060c] p-4 space-y-2 text-sm text-gray-100">
                                    <p className="font-semibold text-[13px] tracking-tight">
                                      Prematch view for <span className="text-yellow-300">{m.home}</span> vs{' '}
                                      <span className="text-yellow-300">{m.away}</span>.
                                    </p>
                                    <p className="text-[11px] text-gray-400 leading-relaxed">
                                      Lines are inspired by real sportsbooks but this Banana FC slate is for hype only – no real
                                      money, no prizes, just bragging rights.
                                    </p>
                                  </div>
                                )}

                                {detailTab === 'h2h' && (
                                  <H2HPanel
                                    match={m}
                                    state={h2hState}
                                  />
                                )}

                                {detailTab === 'probability' && (
                                  <ProbabilityPanel
                                    match={m}
                                    probabilities={computeWinProbabilities(m)}
                                  />
                                )}

                                {detailTab === 'form' && (
                                  <FormPanel
                                    homeName={m.home}
                                    awayName={m.away}
                                    homeForm={computeFormString(m.homeTeamObj || {})}
                                    awayForm={computeFormString(m.awayTeamObj || {})}
                                  />
                                )}
                              </div>
                            </div>
                          )}

                          {/* Matches table row (Next Fixture + odds) */}
                          <MatchRow
                            match={m}
                            onSelect={addSelection}
                            onOpenDetails={(match) => {
                              setDetail({ match, tournament: t.name, tournamentId: t.id });
                              setDetailTab((prev) => prev || 'summary');
                            }}
                          />
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.section>
            );
          })}
        </div>
      </div>

      {/* Bet slip below tables */}
      <div className="w-full">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-yellow-500/30 bg-[#050508]/95 shadow-[0_0_40px_rgba(234,179,8,0.25)] p-4 sm:p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-yellow-500" />
              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.18em] text-yellow-200">
                  Bet Slip
                </h3>
                <p className="text-[10px] text-gray-500 uppercase tracking-[0.18em]">
                  Fun only · No cash
                </p>
              </div>
            </div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.18em]">
              {betslip.length} picks
            </span>
          </div>

          {betslip.length === 0 ? (
            <p className="text-xs text-gray-500">
              Tap any odds in the fixtures list to add a fun pick here. Build your own Banana FC
              slip like real betting sites – but without the risk.
            </p>
          ) : (
            <>
              <div className="space-y-3 mb-4 max-h-64 overflow-y-auto pr-1">
                {betslip.map((sel) => {
                  const { win, total } = getPayout(stake || 0, sel.odds);
                  return (
                    <div
                      key={sel.key}
                      className="relative rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5"
                    >
                      <button
                        onClick={() => removeSelection(sel.key)}
                        className="absolute -top-1 -right-1 text-[9px] text-gray-500 hover:text-white bg-black/60 border border-white/20 rounded-full px-1.5"
                      >
                        ×
                      </button>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1">
                        {sel.market}
                      </p>
                      <p className="text-xs font-semibold text-white mb-0.5 line-clamp-1">
                        {sel.matchLabel}
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-gray-300 mt-0.5">
                        <span>{sel.selection}</span>
                        <span className="font-semibold text-yellow-400">
                          {formatAmericanOdds(sel.odds)}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-gray-500">
                        If stake {stake || 0} wins: <span className="text-yellow-400">+{win.toFixed(2)}</span> ·
                        return <span className="text-yellow-300">{total.toFixed(2)}</span>
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3 border-t border-white/10 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                    Stake per pick
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">¤</span>
                    <input
                      value={stake}
                      onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ''))}
                      className="w-20 bg-black border border-white/15 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-yellow-500"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-300">
                  <span>Potential win (all picks)</span>
                  <span className="font-bold text-yellow-400">+{totals.win.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-300">
                  <span>Total return</span>
                  <span className="font-bold text-yellow-300">{totals.total.toFixed(2)}</span>
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full mt-1 py-2.5 rounded-xl bg-gradient-to-r from-yellow-600 to-yellow-500 text-black text-xs font-black uppercase tracking-[0.2em] flex items-center justify-center gap-1"
                >
                  <Percent className="w-3.5 h-3.5" />
                  Lock Fun Slip
                </motion.button>
                <p className="text-[9px] text-gray-500 leading-relaxed">
                  This betting zone is for entertainment only. No money, no prizes – just Banana FC fans
                  sweating the big fixtures like a real sportsbook.
                </p>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function MatchRow({ match, onSelect, onOpenDetails }) {
  const markets = match.markets || {};
  const money = markets.moneyline?.options || [];
  const spread = markets.spread?.options || [];
  const total = markets.total?.options || [];

  const getOpt = (opts, idx) => (idx == null ? null : opts[idx] || null);

  const rows = [
    { id: 'home', label: match.home, moneyIdx: 0, spreadIdx: 0, totalIdx: 0 },
    { id: 'away', label: match.away, moneyIdx: 2, spreadIdx: 1, totalIdx: 1 },
    { id: 'draw', label: 'Draw', moneyIdx: 1, spreadIdx: null, totalIdx: null },
  ];

  const renderCell = (marketLabel, opts, idx) => {
    const opt = getOpt(opts, idx);
    if (!opt) {
      return (
        <div className="px-3 py-2 text-[11px] text-gray-600 text-center border-l border-white/5 bg-[#05050b]">
          —
        </div>
      );
    }
    return (
      <button
        key={opt.id}
        onClick={() => onSelect(match, marketLabel, opt)}
        className="w-full h-full px-3 py-2 text-[11px] flex flex-col items-center justify-center border-l border-white/5 bg-[#05050b] hover:bg-yellow-500/15 hover:border-yellow-400/70 transition-colors"
      >
        <span className="font-semibold text-gray-100 truncate max-w-full">{opt.label}</span>
        <span className="font-bold text-yellow-300 font-mono tracking-tight">
          {formatAmericanOdds(opt.odds)}
        </span>
      </button>
    );
  };

  return (
    <div className="px-2 sm:px-4 py-2 sm:py-3">
      <div className="rounded-2xl border border-white/10 bg-[#05050b]/95 overflow-hidden backdrop-blur-sm shadow-[0_0_30px_rgba(0,0,0,0.6)]">
        {/* Header row */}
        <div className="grid grid-cols-[minmax(0,2.6fr)_repeat(3,minmax(0,1fr))] text-[10px] uppercase tracking-[0.18em] text-yellow-50 bg-gradient-to-r from-yellow-600 via-amber-500 to-yellow-400">
          <div className="px-3 py-2 flex flex-col justify-center gap-0.5">
            <span className="opacity-80 font-semibold">Next Fixture</span>
            <span className="text-[11px] font-bold tracking-tight line-clamp-1">
              {match.home} <span className="text-yellow-900/80">vs</span> {match.away}
            </span>
          </div>
          <div className="px-3 py-2 text-center border-l border-yellow-300/40">Spread</div>
          <div className="px-3 py-2 text-center border-l border-yellow-300/40">Win</div>
          <div className="px-3 py-2 text-center border-l border-yellow-300/40">Total</div>
        </div>

        {/* Rows: home, away, draw */}
        {rows.map((row, idx) => (
          <div
            key={row.id}
            onClick={() => onOpenDetails?.(match)}
            className={`grid grid-cols-[minmax(0,2.6fr)_repeat(3,minmax(0,1fr))] text-[11px] cursor-pointer transition-colors ${
              idx % 2 === 0 ? 'bg-[#05050b]' : 'bg-[#04040a]'
            } hover:bg-[#0b0b15]`}
          >
            {/* Fixture side: team / draw */}
            <div className="px-3 py-2 flex flex-col justify-center">
              <span className="font-semibold text-gray-100 hover:text-yellow-300 transition-colors">
                {row.label}
              </span>
            </div>
            {/* Spread / Win / Total cells */}
            {renderCell('Handicap', spread, row.spreadIdx)}
            {renderCell('Moneyline', money, row.moneyIdx)}
            {renderCell('Total Goals', total, row.totalIdx)}
          </div>
        ))}
      </div>
    </div>
  );
}

