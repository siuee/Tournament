import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Trophy,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  CalendarDays,
  TicketPercent,
  Flame,
  Coins,
  Percent,
} from 'lucide-react';
import { db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { formatMatchHistoryTeam, formatMatchDateTime, matchTeamToMatch } from '../lib/utils';
import { ProbabilityPanel, FormPanel } from './BettingExtras';
import { H2HPanel } from './BettingH2H';
// Landing view is pure schedule; stats panels are used on the match detail view.

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

function generateLeagueFixtures(tournament, selectedDate) {
  const teams = tournament.teams || [];
  if (teams.length < 2) return [];
  const fixtures = [];
  const baseDate =
    selectedDate instanceof Date ? selectedDate : new Date();
  const base =
    new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      12,
      0,
      0,
      0,
    ).getTime() + 1000 * 60 * 30; // first kick in ~30 mins after noon
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

// Fun-only win probability based on simple team stats.
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

function getSafeTime(dateObj) {
  if (!dateObj) return 0;
  if (typeof dateObj.toMillis === 'function') return dateObj.toMillis();
  if (dateObj instanceof Date) return dateObj.getTime();
  if (dateObj.seconds) return dateObj.seconds * 1000;
  return new Date(dateObj).getTime() || 0;
}

// Simple time formatter for kickoff times in the schedule
function formatKickoffTime(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Map tournament name/type to league logo + cleaned display name
function getLeagueMeta(tournament) {
  const raw = tournament?.sourceName || tournament?.name || '';
  const lower = raw.toLowerCase();

  if (lower.includes('champions')) {
    return {
      logo: '/assets/leagues/ucl.png',
      short: 'UCL',
      display: 'eChampions League',
    };
  }

  if (lower.includes('laliga') || lower.includes('la liga')) {
    return {
      logo: '/assets/leagues/laliga.png',
      short: 'LaLiga',
      display: 'eLaLiga',
    };
  }

  if (lower.includes('premier')) {
    return {
      // Uses pl.png from public/assets/leagues
      logo: '/assets/leagues/pl.png',
      short: 'Premier League',
      display: raw,
    };
  }

  return {
    logo: null,
    short: 'League',
    display: raw || 'League',
  };
}

export default function Betting() {
  const [tournaments, setTournaments] = useState([]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [betslip, setBetslip] = useState([]);
  const [stake, setStake] = useState('10');
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [showCalendar, setShowCalendar] = useState(false);
  const [detailMatch, setDetailMatch] = useState(null);
  const [detailTournament, setDetailTournament] = useState(null);
  const [detailTab, setDetailTab] = useState('preview'); // preview | probability | form | h2h | bet
  const [h2hState, setH2hState] = useState({ loading: false, error: null, summary: null, matches: [] });
  const [formState, setFormState] = useState({ loading: false, homeForm: null, awayForm: null });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'tournaments'));
        const raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const cleaned = raw
          .filter(t => Array.isArray(t?.teams) && t.teams.length >= 2)
          .map(t => {
            const rawType = t.type || '';
            const sourceName = t.name || rawType || '';
            let name = sourceName || 'Tournament';
            let region = `${rawType || sourceName || 'Banana FC'} · ${String(t.format || '').toUpperCase()}`.trim();
            return {
              id: t.id,
              name,
              region,
              highlight: t.status === 'active' ? 'Live' : undefined,
              teams: t.teams,
              type: rawType,
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

  const changeDay = (delta) => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + delta);
      next.setHours(0, 0, 0, 0);
      return next;
    });
  };

  const resetToToday = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setSelectedDate(today);
  };

  const formattedSelectedDate = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isToday = selectedDate.getTime() === today.getTime();
    if (isToday) return 'Today';
    return selectedDate.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  })();

  const totals = useMemo(() => {
    const s = Number(stake) || 0;
    if (!s || betslip.length === 0) return { win: 0, total: 0 };
    const per = betslip.map(sel => getPayout(s, sel.odds).win);
    const win = per.reduce((acc, v) => acc + v, 0);
    const total = win + s * betslip.length;
    return { win, total };
  }, [betslip, stake]);

  const toggleSelection = (match, marketLabel, optionLabel, odds) => {
    const key = `${match.id || match.kickoff}-${marketLabel}-${optionLabel}`;
    setBetslip(prev => {
      const exists = prev.some(sel => sel.key === key);
      if (exists) {
        return prev.filter(sel => sel.key !== key);
      }
      return [
        ...prev,
        {
          key,
          matchId: match.id,
          matchLabel: `${match.home} vs ${match.away}`,
          market: marketLabel,
          selection: optionLabel,
          odds,
        },
      ];
    });
  };

  // Load head-to-head matches when opening H2H tab on the detail page
  useEffect(() => {
    if (!detailMatch || detailTab !== 'h2h') return;

    const homeTeam = detailMatch.homeTeamObj;
    const awayTeam = detailMatch.awayTeamObj;
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
    (async () => {
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
              homeName: currentHomeIsDbHome ? detailMatch.home : detailMatch.away,
              awayName: currentHomeIsDbHome ? detailMatch.away : detailMatch.home,
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
    })();
    return () => {
      cancelled = true;
    };
  }, [detailMatch, detailTab]);

  // Load real form data for the two teams when viewing Form tab
  useEffect(() => {
    if (!detailMatch || detailTab !== 'form') return;

    const homeTeam = detailMatch.homeTeamObj;
    const awayTeam = detailMatch.awayTeamObj;
    if (!homeTeam || !awayTeam) {
      setFormState({ loading: false, homeForm: null, awayForm: null });
      return;
    }

    let cancelled = false;

    (async () => {
      setFormState({ loading: true, homeForm: null, awayForm: null });
      try {
        const snap = await getDocs(collection(db, 'matches'));
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        const computeTeamForm = (team) => {
          const teamMatches = all.filter(m =>
            matchTeamToMatch(team, m, 'home') || matchTeamToMatch(team, m, 'away')
          );
          const sorted = [...teamMatches].sort((a, b) => getSafeTime(b.createdAt) - getSafeTime(a.createdAt));
          const formArr = [];
          sorted.forEach((m, idx) => {
            const isHome = matchTeamToMatch(team, m, 'home');
            const tS = isHome ? (Number(m.homeScore) || 0) : (Number(m.awayScore) || 0);
            const oS = isHome ? (Number(m.awayScore) || 0) : (Number(m.homeScore) || 0);
            const res = tS > oS ? 'W' : tS === oS ? 'D' : 'L';
            if (idx < 5) formArr.push(res);
          });
          return formArr.join(' ');
        };

        const homeForm = computeTeamForm(homeTeam);
        const awayForm = computeTeamForm(awayTeam);

        if (!cancelled) {
          setFormState({ loading: false, homeForm: homeForm || null, awayForm: awayForm || null });
        }
      } catch (e) {
        console.error('Failed to load form data for match', e);
        if (!cancelled) {
          setFormState({ loading: false, homeForm: null, awayForm: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailMatch, detailTab]);

  return (
    <div className="relative flex flex-col gap-4 w-full pb-28 md:pb-20">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-2xl bg-yellow-500/10 border border-yellow-500/40 shadow-[0_0_24px_rgba(250,204,21,0.35)]">
            <TicketPercent className="w-6 h-6 text-yellow-400" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-yellow-200 to-yellow-500">
              Banana Betting Zone
            </h1>
            <p className="text-[11px] text-gray-400 font-medium">
              Fixtures from your tournaments for hype only – no real money, just Banana FC drama.
            </p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-gray-400">
          <Flame className="w-4 h-4 text-yellow-400" />
          <span>Upcoming fixtures · Banana FC</span>
        </div>
      </div>

      {/* Main content: schedule or match detail */}
      <div className="space-y-4 w-full">
        {detailMatch ? (
          <MatchDetailView
            match={detailMatch}
            tournament={detailTournament}
            tab={detailTab}
            setTab={setDetailTab}
            formState={formState}
            betslip={betslip}
            stake={stake}
            totals={totals}
            onToggleSelection={toggleSelection}
            onStakeChange={setStake}
            onBack={() => {
              setDetailMatch(null);
              setDetailTournament(null);
              setDetailTab('preview');
            }}
            h2hState={h2hState}
          />
        ) : (
          <>
            {/* Date selector / calendar bar */}
            <div className="flex flex-col gap-2 rounded-3xl border border-white/10 bg-[#050509]/80 px-3 sm:px-4 py-2.5 shadow-[0_0_24px_rgba(0,0,0,0.55)]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => changeDay(-1)}
                    className="p-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-gray-200"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCalendar((prev) => !prev)}
                    title={formattedSelectedDate}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-[11px] font-semibold text-gray-100"
                  >
                    <CalendarDays className="w-3.5 h-3.5 text-yellow-400" />
                    <span>Calendar</span>
                    <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${showCalendar ? 'rotate-180' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => changeDay(1)}
                    className="p-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-gray-200"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {showCalendar && (
                <CalendarGrid
                  selectedDate={selectedDate}
                  tournaments={tournaments}
                  onSelectDate={(date) => {
                    const d = new Date(date);
                    d.setHours(0, 0, 0, 0);
                    setSelectedDate(d);
                    setShowCalendar(false);
                  }}
                />
              )}
            </div>

            {/* Tournament groups / leagues */}
            <div className="space-y-4">
              {tournaments.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-[#050509]/90 p-8 text-center shadow-[0_0_32px_rgba(0,0,0,0.65)]">
                  <p className="text-white font-semibold mb-2">No tournaments yet</p>
                  <p className="text-gray-400 text-sm">
                    Create a tournament in Match Day, then come back here to see upcoming fixtures.
                  </p>
                </div>
              ) : (
                tournaments.map((t) => {
                  const expanded = expandedIds.has(t.id);
                  const matches = generateLeagueFixtures(t, selectedDate);
                  const meta = getLeagueMeta(t);

                  return (
                    <motion.section
                      key={t.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-3xl overflow-hidden bg-[#050509]/95 border border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.7)]"
                    >
                      {/* League header row, inspired by FotMob section headers */}
                      <button
                        onClick={() => toggleTournament(t.id)}
                        className="w-full flex items-center justify-between px-4 sm:px-6 py-3 bg-white/5 hover:bg-white/10 text-white transition-colors"
                      >
                        <div className="flex items-center gap-3 text-left">
                          <div className="w-8 h-8 rounded-full bg-yellow-500/10 border border-yellow-500/40 flex items-center justify-center overflow-hidden shadow-sm">
                            {meta.logo ? (
                              <img
                                src={meta.logo}
                                alt={meta.short}
                                className="w-7 h-7 object-contain"
                              />
                            ) : (
                              <Trophy className="w-4 h-4 text-yellow-400" />
                            )}
                          </div>
                          <h2 className="text-xs sm:text-sm md:text-base font-black tracking-[0.18em] uppercase text-white">
                            {meta.display}
                          </h2>
                        </div>
                        <div className="flex items-center gap-2 text-gray-400 text-xs">
                          <span>{matches.length} fixtures</span>
                          {expanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </div>
                      </button>

                      {/* Match schedule list */}
                      {expanded && matches.length > 0 && (
                        <div className="bg-black/40 divide-y divide-white/5">
                          {matches.map((m) => (
                            <MatchRow
                              key={m.id}
                              match={m}
                              onOpen={() => {
                                setDetailMatch(m);
                                setDetailTournament(t);
                                setDetailTab('preview');
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </motion.section>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MatchRow({ match, onOpen }) {
  const homePlayersArr = match.homeTeamObj?.playerData || [];
  const awayPlayersArr = match.awayTeamObj?.playerData || [];

  const is1v1 =
    homePlayersArr.length === 1 &&
    awayPlayersArr.length === 1;

  const is2v2 =
    homePlayersArr.length === 2 &&
    awayPlayersArr.length === 2;

  const getNick = (player) =>
    player?.gamertag || player?.displayName || player?.nickname || player?.name || '';

  const getReal = (player) => {
    if (!player) return '';
    const combined =
      [player.firstName, player.lastName].filter(Boolean).join(' ') ||
      player.realName ||
      player.name ||
      '';
    return combined;
  };

  const formatPlayersLine = (arr) =>
    arr
      .map(p => p.firstName || p.name || p.displayName || p.gamertag || '')
      .filter(Boolean)
      .slice(0, 4)
      .join(', ');

  // 1v1: top = real name, bottom = nickname
  const home1Real = is1v1 ? getReal(homePlayersArr[0]) : '';
  const home1Nick = is1v1 ? (match.home || getNick(homePlayersArr[0])) : '';
  const away1Real = is1v1 ? getReal(awayPlayersArr[0]) : '';
  const away1Nick = is1v1 ? (match.away || getNick(awayPlayersArr[0])) : '';

  // 2v2: top = both real names, bottom = team name
  const home2Top = is2v2
    ? homePlayersArr.map(getReal).filter(Boolean).join(' & ')
    : '';
  const away2Top = is2v2
    ? awayPlayersArr.map(getReal).filter(Boolean).join(' & ')
    : '';

  // Fallback for larger squads: team name + short players line
  const homePlayers = !is1v1 && !is2v2 ? formatPlayersLine(homePlayersArr) : '';
  const awayPlayers = !is1v1 && !is2v2 ? formatPlayersLine(awayPlayersArr) : '';

  return (
    <button
      className="w-full px-4 sm:px-6 py-3 flex items-center justify-between text-sm text-gray-100 hover:bg-white/5 transition-colors"
      type="button"
      onClick={onOpen}
    >
      <span className="flex-1 flex items-center justify-center gap-4 text-center">
        <span className="flex flex-col items-end max-w-[40%]">
          <span className="font-medium">
            {/* Top: always team/nickname label if present */}
            {match.home || (is1v1 && home1Nick) || match.home || home1Nick || home2Top || home1Real}
          </span>
          {/* Bottom: player real names */}
          {is1v1 && home1Real && (
            <span className="mt-0.5 text-[10px] text-gray-500 truncate">
              {home1Real}
            </span>
          )}
          {is2v2 && home2Top && (
            <span className="mt-0.5 text-[10px] text-gray-500 truncate">
              {home2Top}
            </span>
          )}
          {!is1v1 && !is2v2 && homePlayers && (
            <span className="mt-0.5 text-[10px] text-gray-500 truncate">
              {homePlayers}
            </span>
          )}
        </span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
          vs
        </span>
        <span className="flex flex-col items-start max-w-[40%]">
          <span className="font-medium">
            {/* Top: always team/nickname label if present */}
            {match.away || (is1v1 && away1Nick) || match.away || away1Nick || away2Top || away1Real}
          </span>
          {/* Bottom: player real names */}
          {is1v1 && away1Real && (
            <span className="mt-0.5 text-[10px] text-gray-500 truncate">
              {away1Real}
            </span>
          )}
          {is2v2 && away2Top && (
            <span className="mt-0.5 text-[10px] text-gray-500 truncate">
              {away2Top}
            </span>
          )}
          {!is1v1 && !is2v2 && awayPlayers && (
            <span className="mt-0.5 text-[10px] text-gray-500 truncate">
              {awayPlayers}
            </span>
          )}
        </span>
      </span>
      <span className="ml-3 text-[11px] text-gray-500 hidden sm:inline">
        {formatKickoffTime(match.kickoff)}
      </span>
    </button>
  );
}

function MatchDetailView({
  match,
  tournament,
  tab,
  setTab,
  onBack,
  h2hState,
  formState,
  betslip,
  stake,
  totals,
  onToggleSelection,
  onStakeChange,
}) {
  const kickoff = match.kickoff instanceof Date ? match.kickoff : new Date(match.kickoff);
  const kickoffText = kickoff.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateText = kickoff.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const tabs = [
    { id: 'preview', label: 'Preview' },
    { id: 'probability', label: 'Probability' },
    { id: 'form', label: 'Form' },
    { id: 'h2h', label: 'Head to Head' },
    { id: 'bet', label: 'Bet' },
  ];

  const probabilities = computeWinProbabilities(match);
  const fallbackHomeForm = computeFormString(match.homeTeamObj || {});
  const fallbackAwayForm = computeFormString(match.awayTeamObj || {});
  const homeForm = formState?.homeForm || fallbackHomeForm;
  const awayForm = formState?.awayForm || fallbackAwayForm;

  const formatPlayerLine = (team) => {
    const arr = team?.playerData || [];
    if (!arr.length) return '';
    const names = arr
      .map((p) => {
        const full = p.realName || p.name || p.displayName || p.gamertag || '';
        const first = full.trim().split(' ')[0];
        return first || full;
      })
      .filter(Boolean)
      .slice(0, 3);
    return names.join(' & ');
  };

  const homePlayersLine = formatPlayerLine(match.homeTeamObj);
  const awayPlayersLine = formatPlayerLine(match.awayTeamObj);

  return (
    <div className="space-y-4">
      {/* Match header like FotMob */}
      <div className="rounded-3xl border border-white/10 bg-[#050509]/95 px-4 sm:px-6 py-4 shadow-[0_0_32px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between gap-3 text-xs text-gray-400 mb-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-[11px] text-gray-300 hover:text-white"
          >
            <ChevronLeft className="w-3 h-3" />
            <span>Back to schedule</span>
          </button>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <CalendarDays className="w-3.5 h-3.5 text-yellow-400" />
              <span>{dateText} · {kickoffText}</span>
            </span>
            {tournament?.name && (
              <span className="hidden sm:inline text-[11px] text-gray-500">
                {tournament.name}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 sm:gap-10 mb-3">
          <span className="flex flex-col items-end max-w-[40%]">
            <span className="text-sm sm:text-base md:text-lg font-semibold text-gray-100">
              {match.home}
            </span>
            {homePlayersLine && (
              <span className="mt-0.5 text-[10px] text-gray-500 truncate max-w-full">
                {homePlayersLine}
              </span>
            )}
          </span>
          <span className="text-lg sm:text-2xl font-black text-white">
            {kickoffText}
          </span>
          <span className="flex flex-col items-start max-w-[40%]">
            <span className="text-sm sm:text-base md:text-lg font-semibold text-gray-100">
              {match.away}
            </span>
            {awayPlayersLine && (
              <span className="mt-0.5 text-[10px] text-gray-500 truncate max-w-full">
                {awayPlayersLine}
              </span>
            )}
          </span>
        </div>

        {/* Tabs */}
        <div className="mt-3 border-t border-white/10 pt-3 flex flex-wrap items-center gap-2 text-[11px]">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-full border text-[10px] font-semibold tracking-[0.18em] uppercase ${
                tab === t.id
                  ? 'border-yellow-400 bg-yellow-500/20 text-yellow-100'
                  : 'border-white/10 bg-white/5 text-gray-300 hover:border-yellow-400/70 hover:text-yellow-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content below header */}
      <div className="space-y-3">
        {tab === 'preview' && (
          <div className="rounded-2xl border border-white/10 bg-[#050509]/95 p-4 text-sm text-gray-200">
            <p className="font-semibold text-[13px] mb-2">
              Preview for <span className="text-yellow-300">{match.home}</span> vs{' '}
              <span className="text-yellow-300">{match.away}</span>
            </p>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              This is a fun-only Banana FC matchup. Use the tabs above to explore win probabilities,
              recent form, head-to-head meetings, and betting-style odds. No real money, no prizes –
              just hype for the fixture.
            </p>
          </div>
        )}

        {tab === 'probability' && (
          <ProbabilityPanel
            match={match}
            probabilities={probabilities}
          />
        )}

        {tab === 'form' && (
          formState?.loading ? (
            <div className="rounded-2xl border border-white/10 bg-[#050509]/95 p-4 text-[11px] text-gray-400">
              Loading recent form from Banana FC matches…
            </div>
          ) : (
            <FormPanel
              homeName={match.home}
              awayName={match.away}
              homeForm={homeForm}
              awayForm={awayForm}
            />
          )
        )}

        {tab === 'h2h' && (
          <H2HPanel
            match={match}
            state={h2hState}
          />
        )}

        {tab === 'bet' && (
          <BetMarketsPanel
            match={match}
            betslip={betslip}
            stake={stake}
            totals={totals}
            onToggleSelection={onToggleSelection}
            onStakeChange={onStakeChange}
          />
        )}
      </div>
    </div>
  );
}

function BetMarketsPanel({ match, betslip, stake, totals, onToggleSelection, onStakeChange }) {
  const home = match.home || 'Home';
  const away = match.away || 'Away';

  const makeKey = (marketLabel, optionLabel) =>
    `${match.id || match.kickoff}-${marketLabel}-${optionLabel}`;

  const isSelected = (marketLabel, optionLabel) => {
    const key = makeKey(marketLabel, optionLabel);
    return betslip.some(sel => sel.key === key);
  };

  // Core match winner / result style markets
  const coreMarkets = [
    {
      label: 'Match Winner (2-Way)',
      description: '(Draw = void)',
      options: [
        { label: home, odds: -165 },
        { label: away, odds: +145 },
      ],
    },
    {
      label: 'Match Winner (3-Way / 1X2)',
      options: [
        { label: home, odds: -110 },
        { label: 'Draw', odds: +275 },
        { label: away, odds: +210 },
      ],
    },
    {
      label: 'To Lift the Trophy / To Advance',
      options: [
        { label: home, odds: -150 },
        { label: away, odds: +130 },
      ],
    },
    {
      label: 'Correct Score (Full Time)',
      options: [
        { label: '2 - 1', odds: +650 },
        { label: '3 - 2', odds: +900 },
        { label: 'Any Other', odds: +350 },
      ],
    },
    {
      label: 'Draw No Bet',
      options: [
        { label: home, odds: -190 },
        { label: away, odds: +155 },
      ],
    },
    {
      label: 'Double Chance',
      options: [
        { label: `${home} or Draw`, odds: -380 },
        { label: `${away} or Draw`, odds: -210 },
        { label: `${home} or ${away}`, odds: -500 },
      ],
    },
    {
      label: 'Both Players to Score (BTTS)',
      options: [
        { label: 'Yes', odds: -135 },
        { label: 'No', odds: +115 },
      ],
    },
    {
      label: 'Method of Victory',
      options: [
        { label: `${home} – Normal Time`, odds: -110 },
        { label: `${home} – Extra Time`, odds: +650 },
        { label: `${home} – Penalties`, odds: +900 },
        { label: `${away} – Normal Time`, odds: +260 },
        { label: `${away} – Extra Time`, odds: +900 },
        { label: `${away} – Penalties`, odds: +1000 },
      ],
    },
    {
      label: 'Will the Match Go to Extra Time?',
      options: [
        { label: 'Yes', odds: +350 },
        { label: 'No', odds: -550 },
      ],
    },
    {
      label: 'Will the Match Go to Penalties?',
      options: [
        { label: 'Yes', odds: +600 },
        { label: 'No', odds: -900 },
      ],
    },
  ];

  const totalsMarkets = [
    '1.5',
    '2.5',
    '3.5',
    '4.5',
    '5.5',
    '6.5',
  ].map((line, idx) => ({
    label: `Total Goals - Over/Under ${line}`,
    options: [
      { label: `Over ${line}`, odds: idx < 2 ? -135 : +120 + idx * 10 },
      { label: `Under ${line}`, odds: +115 + idx * 10 },
    ],
  }));

  const totalsExtras = [
    {
      label: 'Total Goals - Odd/Even',
      options: [
        { label: 'Odd', odds: -105 },
        { label: 'Even', odds: -105 },
      ],
    },
    {
      label: 'Exact Number of Goals',
      options: [
        { label: '0', odds: +900 },
        { label: '1', odds: +550 },
        { label: '2', odds: +330 },
        { label: '3', odds: +360 },
        { label: '4', odds: +525 },
        { label: '5+', odds: +475 },
      ],
    },
  ];

  const handicapMarkets = [
    {
      label: 'Asian Handicap (-0.5 / +0.5)',
      options: [
        { label: `${home} -0.5`, odds: -130 },
        { label: `${away} +0.5`, odds: +110 },
      ],
    },
    {
      label: 'Asian Handicap (-1.5 / +1.5)',
      options: [
        { label: `${home} -1.5`, odds: +165 },
        { label: `${away} +1.5`, odds: -210 },
      ],
    },
    {
      label: 'Asian Handicap (-2.5 / +2.5)',
      options: [
        { label: `${home} -2.5`, odds: +280 },
        { label: `${away} +2.5`, odds: -360 },
      ],
    },
    {
      label: 'Exact Winning Margin',
      options: [
        { label: `${home} by exactly 1`, odds: +260 },
        { label: `${home} by exactly 2`, odds: +475 },
        { label: `${home} by 3+`, odds: +900 },
        { label: `${away} by exactly 1`, odds: +425 },
        { label: `${away} by exactly 2`, odds: +800 },
        { label: `${away} by 3+`, odds: +1400 },
      ],
    },
  ];

  const halfTimeMarkets = [
    {
      label: 'Half Time Result (1X2)',
      options: [
        { label: home, odds: +120 },
        { label: 'Draw', odds: +115 },
        { label: away, odds: +260 },
      ],
    },
    {
      label: 'Half Time Correct Score',
      options: [
        { label: '0 - 0', odds: +260 },
        { label: '1 - 0', odds: +350 },
        { label: '0 - 1', odds: +500 },
        { label: '1 - 1', odds: +475 },
      ],
    },
    {
      label: 'Half Time / Full Time',
      options: [
        { label: `${home} / ${home}`, odds: +175 },
        { label: `Draw / ${home}`, odds: +320 },
        { label: `${away} / ${away}`, odds: +650 },
        { label: `Draw / ${away}`, odds: +750 },
        { label: `${home} / Draw`, odds: +900 },
        { label: `${away} / Draw`, odds: +1400 },
      ],
    },
    {
      label: 'First Half - Total Goals Over/Under 0.5',
      options: [
        { label: 'Over 0.5', odds: -220 },
        { label: 'Under 0.5', odds: +185 },
      ],
    },
    {
      label: 'First Half - Total Goals Over/Under 1.5',
      options: [
        { label: 'Over 1.5', odds: +115 },
        { label: 'Under 1.5', odds: -135 },
      ],
    },
    {
      label: 'First Half - Total Goals Over/Under 2.5',
      options: [
        { label: 'Over 2.5', odds: +360 },
        { label: 'Under 2.5', odds: -475 },
      ],
    },
    {
      label: 'First Half - Asian Handicap',
      options: [
        { label: `${home} -0.5`, odds: +135 },
        { label: `${away} +0.5`, odds: -165 },
      ],
    },
    {
      label: 'First Half - Both Players to Score',
      options: [
        { label: 'Yes', odds: +175 },
        { label: 'No', odds: -230 },
      ],
    },
    {
      label: 'First Half - Exact Goals',
      options: [
        { label: '0', odds: +185 },
        { label: '1', odds: +155 },
        { label: '2+', odds: +260 },
      ],
    },
    {
      label: 'First Half - Odd/Even Goals',
      options: [
        { label: 'Odd', odds: -105 },
        { label: 'Even', odds: -105 },
      ],
    },
  ];

  const secondHalfMarkets = [
    {
      label: 'Second Half Result (1X2)',
      options: [
        { label: home, odds: +130 },
        { label: 'Draw', odds: +200 },
        { label: away, odds: +260 },
      ],
    },
    {
      label: 'Second Half - Total Goals Over/Under 0.5',
      options: [
        { label: 'Over 0.5', odds: -260 },
        { label: 'Under 0.5', odds: +210 },
      ],
    },
    {
      label: 'Second Half - Total Goals Over/Under 1.5',
      options: [
        { label: 'Over 1.5', odds: +110 },
        { label: 'Under 1.5', odds: -130 },
      ],
    },
    {
      label: 'Second Half - Asian Handicap',
      options: [
        { label: `${home} -0.5`, odds: +140 },
        { label: `${away} +0.5`, odds: -175 },
      ],
    },
    {
      label: 'Second Half - Both Players to Score',
      options: [
        { label: 'Yes', odds: +165 },
        { label: 'No', odds: -210 },
      ],
    },
    {
      label: 'Second Half - Exact Goals',
      options: [
        { label: '0', odds: +210 },
        { label: '1', odds: +170 },
        { label: '2+', odds: +260 },
      ],
    },
    {
      label: 'Second Half - Odd/Even Goals',
      options: [
        { label: 'Odd', odds: -105 },
        { label: 'Even', odds: -105 },
      ],
    },
    {
      label: 'Highest Scoring Half',
      options: [
        { label: 'First Half', odds: +220 },
        { label: 'Second Half', odds: +145 },
        { label: 'Tie', odds: +260 },
      ],
    },
  ];

  const playerProps = [
    {
      label: 'First Player to Score',
      options: [
        { label: home, odds: +115 },
        { label: away, odds: +160 },
        { label: 'No Goals', odds: +900 },
      ],
    },
    {
      label: 'Last Player to Score',
      options: [
        { label: home, odds: +120 },
        { label: away, odds: +170 },
        { label: 'No Goals', odds: +900 },
      ],
    },
    {
      label: 'Team to Score in Both Halves',
      options: [
        { label: `${home} – Yes`, odds: +150 },
        { label: `${home} – No`, odds: -190 },
        { label: `${away} – Yes`, odds: +210 },
        { label: `${away} – No`, odds: -260 },
      ],
    },
    {
      label: 'To Win Either Half',
      options: [
        { label: home, odds: -220 },
        { label: away, odds: -140 },
      ],
    },
    {
      label: 'To Win Both Halves',
      options: [
        { label: home, odds: +260 },
        { label: away, odds: +550 },
      ],
    },
    {
      label: 'Clean Sheet',
      options: [
        { label: `${home} – Yes`, odds: +260 },
        { label: `${home} – No`, odds: -360 },
        { label: `${away} – Yes`, odds: +400 },
        { label: `${away} – No`, odds: -600 },
      ],
    },
  ];

  const comboMarkets = [
    'Over 1.5',
    'Over 2.5',
    'Over 3.5',
    'Under 1.5',
    'Under 2.5',
    'Under 3.5',
  ].map((totalStr, idx) => ({
    label: `Match Winner + ${totalStr}`,
    options: [
      { label: `${home} & ${totalStr}`, odds: +150 + idx * 15 },
      { label: `${away} & ${totalStr}`, odds: +220 + idx * 15 },
    ],
  })).concat([
    {
      label: 'Match Winner + BTTS (Yes)',
      options: [
        { label: `${home} & BTTS Yes`, odds: +240 },
        { label: `${away} & BTTS Yes`, odds: +300 },
      ],
    },
    {
      label: 'Match Winner + BTTS (No)',
      options: [
        { label: `${home} & BTTS No`, odds: +260 },
        { label: `${away} & BTTS No`, odds: +340 },
      ],
    },
    {
      label: 'Draw + BTTS',
      options: [
        { label: 'Draw & BTTS Yes', odds: +350 },
        { label: 'Draw & BTTS No', odds: +475 },
      ],
    },
    {
      label: 'Draw + Over/Under 2.5 Goals',
      options: [
        { label: 'Draw & Over 2.5', odds: +475 },
        { label: 'Draw & Under 2.5', odds: +425 },
      ],
    },
    {
      label: 'Double Chance + Total Goals',
      options: [
        { label: `${home} or Draw & Over 1.5`, odds: -165 },
        { label: `${away} or Draw & Over 1.5`, odds: -145 },
        { label: `${home} or ${away} & Over 2.5`, odds: -135 },
      ],
    },
    {
      label: 'Double Chance + BTTS',
      options: [
        { label: `${home} or Draw & BTTS Yes`, odds: -110 },
        { label: `${away} or Draw & BTTS Yes`, odds: +105 },
      ],
    },
  ]);

  const individualTotals = [
    {
      label: `${home} - Total Goals`,
      options: [
        { label: 'Over 0.5', odds: -260 },
        { label: 'Under 0.5', odds: +210 },
        { label: 'Over 1.5', odds: +130 },
        { label: 'Under 1.5', odds: -160 },
        { label: 'Over 2.5', odds: +360 },
        { label: 'Under 2.5', odds: -475 },
        { label: 'Over 3.5', odds: +800 },
        { label: 'Under 3.5', odds: -1600 },
      ],
    },
    {
      label: `${away} - Total Goals`,
      options: [
        { label: 'Over 0.5', odds: -210 },
        { label: 'Under 0.5', odds: +170 },
        { label: 'Over 1.5', odds: +260 },
        { label: 'Under 1.5', odds: -320 },
        { label: 'Over 2.5', odds: +650 },
        { label: 'Under 2.5', odds: -1100 },
        { label: 'Over 3.5', odds: +1400 },
        { label: 'Under 3.5', odds: -2500 },
      ],
    },
    {
      label: `${home} - Exact Goals`,
      options: [
        { label: '0', odds: +210 },
        { label: '1', odds: +250 },
        { label: '2', odds: +320 },
        { label: '3+', odds: +475 },
      ],
    },
    {
      label: `${away} - Exact Goals`,
      options: [
        { label: '0', odds: +170 },
        { label: '1', odds: +260 },
        { label: '2', odds: +475 },
        { label: '3+', odds: +800 },
      ],
    },
  ];

  const timeIntervalMarkets = [
    '00:00 - 14:59',
    '15:00 - 29:59',
    '30:00 - Half Time',
    '45:00 - 59:59',
    '60:00 - 74:59',
    '75:00 - Full Time',
  ].map((window, idx) => ({
    label: `Goal Scored Between ${window}`,
    options: [
      { label: 'Yes', odds: +155 + idx * 20 },
      { label: 'No', odds: -210 - idx * 10 },
    ],
  })).concat([
    {
      label: `${home} - Half with Most Goals`,
      options: [
        { label: 'First Half', odds: +260 },
        { label: 'Second Half', odds: +155 },
      ],
    },
    {
      label: `${away} - Half with Most Goals`,
      options: [
        { label: 'First Half', odds: +320 },
        { label: 'Second Half', odds: +175 },
      ],
    },
  ]);

  const raceToMarkets = [
    {
      label: 'Race to 2 Goals',
      options: [
        { label: home, odds: -110 },
        { label: away, odds: +190 },
        { label: 'Neither', odds: +260 },
      ],
    },
    {
      label: 'Race to 3 Goals',
      options: [
        { label: home, odds: +130 },
        { label: away, odds: +320 },
        { label: 'Neither', odds: -125 },
      ],
    },
    {
      label: 'Race to 4 Goals',
      options: [
        { label: home, odds: +260 },
        { label: away, odds: +475 },
        { label: 'Neither', odds: -220 },
      ],
    },
    {
      label: 'First to Score in the 2nd Half',
      options: [
        { label: home, odds: +115 },
        { label: away, odds: +175 },
        { label: 'No Goal', odds: +800 },
      ],
    },
  ];

  const htftExactMarkets = [
    `${home} / ${home}`,
    `${home} / Draw`,
    `${home} / ${away}`,
    `Draw / ${home}`,
    'Draw / Draw',
    `Draw / ${away}`,
    `${away} / ${home}`,
    `${away} / Draw`,
    `${away} / ${away}`,
  ].map((combo, idx) => ({
    label: `HT/FT - ${combo}`,
    options: [
      { label: combo, odds: +175 + idx * 40 },
    ],
  }));

  const multiGoalMarkets = [
    {
      label: `Winning Margin - ${home}`,
      options: [
        { label: 'Exactly 1 Goal', odds: +260 },
        { label: 'Exactly 2 Goals', odds: +475 },
        { label: '3+ Goals', odds: +900 },
      ],
    },
    {
      label: `Winning Margin - ${away}`,
      options: [
        { label: 'Exactly 1 Goal', odds: +425 },
        { label: 'Exactly 2 Goals', odds: +800 },
        { label: '3+ Goals', odds: +1400 },
      ],
    },
    {
      label: 'Total Goals Band',
      options: [
        { label: '0 – 1 Goals', odds: +475 },
        { label: '2 – 3 Goals', odds: +175 },
        { label: '4 – 5 Goals', odds: +260 },
        { label: '6+ Goals', odds: +650 },
      ],
    },
    {
      label: 'Any Team to Win from Behind',
      options: [
        { label: 'Yes', odds: +350 },
        { label: 'No', odds: -550 },
      ],
    },
    {
      label: 'Both Halves Over 0.5 Goals',
      options: [
        { label: 'Yes', odds: -135 },
        { label: 'No', odds: +115 },
      ],
    },
    {
      label: 'Both Halves Over 1.5 Goals',
      options: [
        { label: 'Yes', odds: +260 },
        { label: 'No', odds: -340 },
      ],
    },
    {
      label: 'Either Player to Keep a Clean Sheet',
      options: [
        { label: 'Yes', odds: -135 },
        { label: 'No', odds: +115 },
      ],
    },
    {
      label: `Exact Score Multiples - ${home}`,
      options: [
        { label: '1-0, 2-0 or 2-1', odds: +260 },
        { label: '3-0, 3-1 or 3-2', odds: +550 },
      ],
    },
    {
      label: `Exact Score Multiples - ${away}`,
      options: [
        { label: '1-0, 2-0 or 2-1', odds: +475 },
        { label: '3-0, 3-1 or 3-2', odds: +900 },
      ],
    },
  ];

  const sections = [
    {
      key: 'core',
      title: 'Match Winner & Core Markets',
      markets: coreMarkets,
    },
    {
      key: 'totals',
      title: 'Goal Totals (Over/Under)',
      markets: [...totalsMarkets, ...totalsExtras],
    },
    {
      key: 'handicap',
      title: 'Handicap Betting (Spreads)',
      markets: handicapMarkets,
    },
    {
      key: 'half-time',
      title: 'Half-Time Markets',
      markets: halfTimeMarkets,
    },
    {
      key: 'second-half',
      title: 'Second-Half Markets',
      markets: secondHalfMarkets,
    },
    {
      key: 'player-props',
      title: 'Player / Scoring Props',
      markets: playerProps,
    },
    {
      key: 'combo',
      title: 'Combo Bets (Match Winner + Totals)',
      markets: comboMarkets,
    },
    {
      key: 'individual-totals',
      title: 'Individual Player Goal Totals',
      markets: individualTotals,
    },
    {
      key: 'time-interval',
      title: 'Time-Interval Betting',
      markets: timeIntervalMarkets,
    },
    {
      key: 'race-to',
      title: '"Race To" Markets',
      markets: raceToMarkets,
    },
    {
      key: 'htft',
      title: 'Half-Time/Full-Time (HT/FT) Exact Combos',
      markets: htftExactMarkets,
    },
    {
      key: 'multi-goal',
      title: 'Multi-Goal & Specific Margin Outcomes',
      markets: multiGoalMarkets,
    },
  ];

  return (
    <div className="relative lg:pr-[22rem]">
      {/* Left side: markets list (scrolls) */}
      <div className="space-y-4">
        {sections.map((section) => (
          <div
            key={section.key}
            className="rounded-2xl border border-yellow-500/30 bg-[#050509]/95 shadow-[0_0_40px_rgba(250,204,21,0.18)] overflow-hidden"
          >
            <div className="px-4 sm:px-5 py-3 border-b border-white/10 bg-gradient-to-r from-yellow-500/10 via-yellow-400/5 to-yellow-500/10 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-yellow-200">
                  {section.title}
                </p>
                <p className="text-[10px] text-gray-400">
                  Tap odds to add or remove fun picks.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs sm:text-[11px] text-gray-100">
                <tbody>
                  {section.markets.map((mkt, idx) => (
                    <tr
                      key={`${section.key}-${idx}`}
                      className={idx % 2 === 0 ? 'bg-black/40' : 'bg-black/20'}
                    >
                      <td className="align-top px-3 sm:px-4 py-2.5 border-t border-white/5 w-56">
                        <div className="flex flex-col">
                          <span className="font-medium text-[11px] text-gray-100">
                            {mkt.label}
                          </span>
                          {mkt.description && (
                            <span className="text-[10px] text-gray-500">
                              {mkt.description}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="align-top px-3 sm:px-4 py-2.5 border-t border-white/5">
                        <div className="flex flex-wrap gap-1.5">
                          {mkt.options.map((opt, i) => {
                            const marketLabel = `${section.title} · ${mkt.label}`;
                            const selected = isSelected(marketLabel, opt.label);
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() =>
                                  onToggleSelection(
                                    match,
                                    marketLabel,
                                    opt.label,
                                    opt.odds,
                                  )
                                }
                                className={`inline-flex items-center justify-between gap-1.5 rounded-full border px-2.5 py-1 transition-all ${
                                  selected
                                    ? 'border-yellow-400 bg-yellow-500/30 shadow-[0_0_20px_rgba(250,204,21,0.45)] scale-[0.98]'
                                    : 'border-white/10 bg-white/5 hover:border-yellow-400/70 hover:bg-yellow-500/10'
                                }`}
                              >
                                <span className="text-[10px] font-medium text-gray-100 truncate max-w-[120px] sm:max-w-[160px]">
                                  {opt.label}
                                </span>
                                <span className="text-[10px] font-bold text-yellow-300 font-mono">
                                  {formatAmericanOdds(opt.odds)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Right side: fixed bet slip on large screens, inline on mobile */}
      {/* Mobile / small screens: slip appears below markets and scrolls normally */}
      <div className="mt-4 w-full max-w-sm lg:hidden">
        <BetSlipCard
          betslip={betslip}
          stake={stake}
          totals={totals}
          onToggleSelection={onToggleSelection}
          onStakeChange={onStakeChange}
        />
      </div>

      {/* Desktop: slip fixed to viewport right, does not move when markets scroll */}
      <div className="hidden lg:block">
        <div className="fixed top-[75vh] right-8 w-80 max-w-xs -translate-y-1/2">
          <BetSlipCard
            betslip={betslip}
            stake={stake}
            totals={totals}
            onToggleSelection={onToggleSelection}
            onStakeChange={onStakeChange}
          />
        </div>
      </div>
    </div>
  );
}

function BetSlipCard({ betslip, stake, totals, onToggleSelection, onStakeChange }) {
  const [localStakes, setLocalStakes] = useState({});

  return (
    <div className="rounded-2xl border border-cyan-400/60 bg-gradient-to-br from-[#020617] via-[#020617] to-[#0f172a] shadow-[0_0_45px_rgba(34,211,238,0.45)] p-4 sm:p-5 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.45),transparent_55%),radial-gradient(circle_at_bottom,_rgba(244,63,94,0.45),transparent_55%)]" />
      <div className="relative">
      <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="absolute inset-0 blur-md bg-cyan-400/60 rounded-full" />
              <Coins className="relative w-5 h-5 text-cyan-200 drop-shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100 drop-shadow-[0_0_10px_rgba(34,211,238,0.9)]">
                Bet Slip
              </h3>
              <p className="text-[10px] text-cyan-300/80 uppercase tracking-[0.18em]">
                Fun only
              </p>
            </div>
          </div>
          {betslip.length > 0 && (
            <span className="text-[10px] font-bold text-fuchsia-300 uppercase tracking-[0.18em] bg-fuchsia-500/10 border border-fuchsia-400/40 rounded-full px-2 py-0.5">
              {betslip.length} picks
            </span>
          )}
        </div>

        {betslip.length === 0 ? (
          <p className="text-[11px] text-cyan-100/80">
            Tap any odds on the left to add a selection.
          </p>
        ) : (
          <>
            <div className="space-y-3 mb-4 max-h-64 overflow-y-auto pr-1 custom-scrollbar-thin">
            {betslip.map((sel) => {
              const riskRaw = localStakes[sel.key] ?? '';
              const riskNum = Number(riskRaw) || 0;
              const { win } = getPayout(riskNum || 0, sel.odds);
              return (
                <div
                  key={sel.key}
                  className="relative rounded-2xl border border-cyan-500/40 bg-slate-950/75 px-3 py-2.5 shadow-[0_0_22px_rgba(15,23,42,0.95)]"
                >
                  <button
                    type="button"
                    onClick={() =>
                      onToggleSelection(
                        { id: sel.matchId, home: '', away: '', kickoff: '' },
                        sel.market,
                        sel.selection,
                        sel.odds,
                      )
                    }
                    className="absolute -top-1 -right-1 text-[9px] text-cyan-200 hover:text-white bg-slate-900/80 border border-cyan-400/60 rounded-full px-1.5"
                  >
                    ×
                  </button>
                  <p className="text-[10px] font-bold text-cyan-300 uppercase tracking-[0.2em] mb-1">
                    {sel.market}
                  </p>
                  <p className="text-xs font-semibold text-slate-50 mb-0.5 line-clamp-1">
                    {sel.matchLabel}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-slate-200 mt-0.5">
                    <span>{sel.selection}</span>
                    <span className="font-semibold text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]">
                      {formatAmericanOdds(sel.odds)}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Risk"
                      value={riskRaw}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, '');
                        setLocalStakes((prev) => ({ ...prev, [sel.key]: v }));
                      }}
                      className="flex-1 rounded-xl bg-slate-900/80 border border-cyan-500/50 px-2.5 py-1.5 text-[11px] text-cyan-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                    />
                    <div className="flex-1 rounded-xl bg-slate-900/60 border border-emerald-400/40 px-2.5 py-1.5 text-[11px] text-emerald-200 flex items-center justify-between">
                      <span className="opacity-70">Win</span>
                      <span className="font-semibold">
                        {riskNum ? win.toFixed(2) : '--'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

            <div className="space-y-3 border-t border-cyan-500/40 pt-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200">
                Stake per pick
              </label>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-cyan-300">¤</span>
                <input
                  value={stake}
                  onChange={(e) =>
                    onStakeChange(e.target.value.replace(/[^0-9.]/g, ''))
                  }
                  className="w-20 bg-slate-950 border border-cyan-500/60 rounded-lg px-2 py-1.5 text-xs text-cyan-100 focus:outline-none focus:border-emerald-400 focus:ring-0"
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-200">
              <span>Potential win (all picks)</span>
              <span className="font-bold text-emerald-300">
                +{totals.win.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-200">
              <span>Total return</span>
              <span className="font-bold text-emerald-200">
                {totals.total.toFixed(2)}
              </span>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full mt-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-emerald-400 text-black text-xs font-black uppercase tracking-[0.2em] flex items-center justify-center gap-1 shadow-[0_0_26px_rgba(6,182,212,0.75)]"
              type="button"
            >
              <Percent className="w-3.5 h-3.5" />
              Confirm Slip
            </motion.button>
            <p className="text-[9px] text-cyan-200/80 leading-relaxed">
              For entertainment only. No real bets.
            </p>
          </div>
          </>
        )}
      </div>
    </div>
  );
}

function CalendarGrid({ selectedDate, tournaments, onSelectDate }) {
  const base = new Date(selectedDate);
  base.setDate(1);
  base.setHours(0, 0, 0, 0);

  const month = base.getMonth();
  const year = base.getFullYear();

  const startDay = base.getDay(); // 0 (Sun) - 6 (Sat)
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startDay; i += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, month, day));
  }

  const hasFixturesOn = (date) => {
    if (!tournaments || tournaments.length === 0) return false;
    return tournaments.some((t) => generateLeagueFixtures(t, date).length > 0);
  };

  const isSameDay = (a, b) => {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  };

  const monthLabel = base.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="mt-2 rounded-2xl border border-white/10 bg-black/60 p-3 sm:p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-200">{monthLabel}</span>
        <button
          type="button"
          onClick={() => onSelectDate(new Date())}
          className="text-[11px] text-yellow-300 hover:text-yellow-200"
        >
          Today
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1 text-[10px] text-gray-400">
        {weekDays.map((d) => (
          <span key={d} className="text-center">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, idx) => {
          if (!date) {
            return <span key={`empty-${idx}`} />;
          }
          const selected = isSameDay(date, selectedDate);
          const hasFixtures = hasFixturesOn(date);

          return (
            <button
              key={date.toISOString()}
              type="button"
              onClick={() => onSelectDate(date)}
              className={`relative flex items-center justify-center h-7 rounded-full text-[11px] ${
                selected
                  ? 'bg-yellow-500 text-black font-semibold'
                  : 'bg-white/5 text-gray-200 hover:bg-white/10'
              }`}
            >
              {date.getDate()}
              {hasFixtures && (
                <span className={`absolute -bottom-0.5 w-1.5 h-1.5 rounded-full ${
                  selected ? 'bg-black/70' : 'bg-yellow-400'
                }`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

