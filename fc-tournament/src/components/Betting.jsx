import { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  Trash2,
  MessageCircle,
  Eye,
  Users,
  TrendingUp,
  X,
  Loader2,
} from 'lucide-react';
import { db } from '../firebase';
import { collection, getDocs, getDoc, doc, setDoc, updateDoc, addDoc, increment, query, orderBy } from 'firebase/firestore';
import { formatMatchHistoryTeam, formatMatchDateTime, matchTeamToMatch } from '../lib/utils';
import { formatCountShort } from '../lib/utils';
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

// Convert win probability (0–100) to American odds. Favourite gets negative odds (low payout), underdog positive (high payout).
function probabilityToAmericanOdds(p) {
  const q = Number(p);
  if (q >= 100) return -9999;
  if (q <= 0) return 9999;
  if (q >= 50) {
    const odds = -100 * q / (100 - q);
    return Math.round(odds);
  }
  const odds = 100 * (100 - q) / q;
  return Math.round(odds);
}

// Implied probability (0–100) from American odds. Used to hide near-certain options and for dynamic styling.
function americanOddsToImpliedProb(odds) {
  const o = Number(odds);
  if (o >= 0) return (100 / (o + 100)) * 100;
  return (Math.abs(o) / (Math.abs(o) + 100)) * 100;
}

// Don't show options that are almost certain (≥ this %) or almost impossible (≤ this %) — keep odds dynamic and bettable.
const BETTABLE_PROB_MIN = 6;
const BETTABLE_PROB_MAX = 94;

// Filter matches by format so 1v1 odds use only 1v1 history (player goals/assists in 1v1) and 2v2 use only 2v2.
function is1v1Match(m) {
  const h = (m.homeTeamPlayerIds || []).length;
  const a = (m.awayTeamPlayerIds || []).length;
  return h === 1 && a === 1;
}
function is2v2Match(m) {
  const h = (m.homeTeamPlayerIds || []).length;
  const a = (m.awayTeamPlayerIds || []).length;
  return h === 2 && a === 2;
}
function filterMatchesByFormat(allMatches, is1v1) {
  if (!Array.isArray(allMatches)) return [];
  return allMatches.filter(is1v1 ? is1v1Match : is2v2Match);
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

function getRiskFromWin(winAmount, odds) {
  const w = Number(winAmount) || 0;
  if (!w || !odds) return 0;
  if (odds > 0) return (w * 100) / odds;
  return (w * Math.abs(odds)) / 100;
}

// Poisson PMF: P(X = k) for lambda
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / (f || 1);
}

// Compute P(home win), P(draw), P(away win) from historical matches using expected goals (Poisson).
// teamStats: { games, goalsFor, goalsAgainst } per team.
function computePoissonProbabilities(homeStats, awayStats) {
  const defaultLambda = 1.2;
  const homeAvgFor = homeStats.games > 0 ? homeStats.goalsFor / homeStats.games : defaultLambda;
  const homeAvgAgainst = homeStats.games > 0 ? homeStats.goalsAgainst / homeStats.games : defaultLambda;
  const awayAvgFor = awayStats.games > 0 ? awayStats.goalsFor / awayStats.games : defaultLambda;
  const awayAvgAgainst = awayStats.games > 0 ? awayStats.goalsAgainst / awayStats.games : defaultLambda;
  const lambdaHome = (homeAvgFor + awayAvgAgainst) / 2;
  const lambdaAway = (awayAvgFor + homeAvgAgainst) / 2;
  const maxGoals = 12;
  let pHomeWin = 0, pDraw = 0, pAwayWin = 0;
  for (let i = 0; i <= maxGoals; i++) {
    const ph = poissonPmf(i, lambdaHome);
    for (let j = 0; j <= maxGoals; j++) {
      const pa = poissonPmf(j, lambdaAway);
      const p = ph * pa;
      if (i > j) pHomeWin += p;
      else if (i === j) pDraw += p;
      else pAwayWin += p;
    }
  }
  const total = pHomeWin + pDraw + pAwayWin;
  if (total <= 0) return { home: 34, draw: 33, away: 33 };
  const scale = 100 / total;
  const home = Math.round(pHomeWin * scale);
  const draw = Math.round(pDraw * scale);
  const away = 100 - home - draw;
  return { home, draw, away };
}

// Total goals Over/Under: use past match data. If they consistently go over X.5, P(Over) is high → lower payout (negative odds).
// If they rarely go over, P(Over) is low → higher payout (positive odds). Fallback to Poisson when no/small history.
const TOTAL_LINES = ['1.5', '2.5', '3.5', '4.5', '5.5', '6.5'];
function computeTotalsProbsFromHistory(all, homeTeam, awayTeam, homeStats, awayStats) {
  const defaultLambda = 1.2;
  const homeAvgFor = homeStats.games > 0 ? homeStats.goalsFor / homeStats.games : defaultLambda;
  const homeAvgAgainst = homeStats.games > 0 ? homeStats.goalsAgainst / homeStats.games : defaultLambda;
  const awayAvgFor = awayStats.games > 0 ? awayStats.goalsFor / awayStats.games : defaultLambda;
  const awayAvgAgainst = awayStats.games > 0 ? awayStats.goalsAgainst / awayStats.games : defaultLambda;
  const lambdaHome = (homeAvgFor + awayAvgAgainst) / 2;
  const lambdaAway = (awayAvgFor + homeAvgAgainst) / 2;
  const lambdaTotal = lambdaHome + lambdaAway;

  const poissonPOver = (line) => {
    const k = Math.floor(Number(line));
    let pUnder = 0;
    for (let i = 0; i <= k; i++) pUnder += poissonPmf(i, lambdaTotal);
    return 1 - pUnder;
  };

  const homeMatches = all.filter(m =>
    matchTeamToMatch(homeTeam, m, 'home') || matchTeamToMatch(homeTeam, m, 'away')
  );
  const awayMatches = all.filter(m =>
    matchTeamToMatch(awayTeam, m, 'home') || matchTeamToMatch(awayTeam, m, 'away')
  );
  const allTotals = [
    ...homeMatches.map(m => (Number(m.homeScore) || 0) + (Number(m.awayScore) || 0)),
    ...awayMatches.map(m => (Number(m.homeScore) || 0) + (Number(m.awayScore) || 0)),
  ];
  const n = allTotals.length;
  const minMatchesForHistory = 3;

  const result = {};
  for (const line of TOTAL_LINES) {
    const threshold = Number(line);
    if (n >= minMatchesForHistory) {
      const overCount = allTotals.filter(t => t > threshold).length;
      result[line] = overCount / n;
    } else {
      result[line] = poissonPOver(line);
    }
  }
  return result;
}

// Per-team goal totals: from past matches, P(team scores Over X.5). If team almost always scores 3+, Over 2.5 is very likely → low odds.
const TEAM_TOTAL_LINES = ['0.5', '1.5', '2.5', '3.5'];
function computeTeamTotalsProbsFromHistory(all, team, teamStats) {
  const defaultLambda = 1.2;
  const lambda = teamStats.games > 0 ? teamStats.goalsFor / teamStats.games : defaultLambda;
  const teamMatches = all.filter(m =>
    matchTeamToMatch(team, m, 'home') || matchTeamToMatch(team, m, 'away')
  );
  const goalsPerGame = teamMatches.map((m) => {
    const isHome = matchTeamToMatch(team, m, 'home');
    return isHome ? (Number(m.homeScore) || 0) : (Number(m.awayScore) || 0);
  });
  const n = goalsPerGame.length;
  const minMatchesForHistory = 3;
  const result = {};
  for (const line of TEAM_TOTAL_LINES) {
    const threshold = Number(line);
    if (n >= minMatchesForHistory) {
      const overCount = goalsPerGame.filter((g) => g > threshold).length;
      result[line] = Math.max(0.01, Math.min(0.99, overCount / n));
    } else {
      let pUnder = 0;
      for (let i = 0; i <= Math.floor(threshold); i++) pUnder += poissonPmf(i, lambda);
      result[line] = Math.max(0.01, Math.min(0.99, 1 - pUnder));
    }
  }
  return result;
}

// Clean sheet probabilities from past data: P(team concedes 0) using all historical matches plus Poisson fallback.
function computeCleanSheetProbsFromHistory(all, homeTeam, awayTeam, homeStats, awayStats) {
  const defaultLambda = 1.2;

  const homeAvgAgainst = homeStats.games > 0 ? homeStats.goalsAgainst / homeStats.games : defaultLambda;
  const awayAvgAgainst = awayStats.games > 0 ? awayStats.goalsAgainst / awayStats.games : defaultLambda;
  const awayAvgFor = awayStats.games > 0 ? awayStats.goalsFor / awayStats.games : defaultLambda;
  const homeAvgFor = homeStats.games > 0 ? homeStats.goalsFor / homeStats.games : defaultLambda;

  const homeMatches = all.filter(m =>
    matchTeamToMatch(homeTeam, m, 'home') || matchTeamToMatch(homeTeam, m, 'away')
  );
  const awayMatches = all.filter(m =>
    matchTeamToMatch(awayTeam, m, 'home') || matchTeamToMatch(awayTeam, m, 'away')
  );

  let homeCsCount = 0;
  homeMatches.forEach((m) => {
    const isHome = matchTeamToMatch(homeTeam, m, 'home');
    const conceded = isHome ? (Number(m.awayScore) || 0) : (Number(m.homeScore) || 0);
    if (conceded === 0) homeCsCount += 1;
  });
  let awayCsCount = 0;
  awayMatches.forEach((m) => {
    const isHome = matchTeamToMatch(awayTeam, m, 'home');
    const conceded = isHome ? (Number(m.awayScore) || 0) : (Number(m.homeScore) || 0);
    if (conceded === 0) awayCsCount += 1;
  });

  const nHome = homeMatches.length;
  const nAway = awayMatches.length;
  const minMatches = 3;

  // Poisson model for opponent goals vs this defence.
  const lambdaHomeConceded = (homeAvgAgainst + awayAvgFor) / 2;
  const lambdaAwayConceded = (awayAvgAgainst + homeAvgFor) / 2;
  const pHomePoisson = poissonPmf(0, lambdaHomeConceded);
  const pAwayPoisson = poissonPmf(0, lambdaAwayConceded);

  const pHomeHist = nHome > 0 ? homeCsCount / nHome : null;
  const pAwayHist = nAway > 0 ? awayCsCount / nAway : null;

  const blend = (hist, poisson, n) => {
    if (hist == null || n < minMatches) return poisson;
    const wHist = 0.7;
    const wPois = 0.3;
    return wHist * hist + wPois * poisson;
  };

  const pHome = Math.max(0.01, Math.min(0.99, blend(pHomeHist, pHomePoisson, nHome)));
  const pAway = Math.max(0.01, Math.min(0.99, blend(pAwayHist, pAwayPoisson, nAway)));

  return { home: pHome, away: pAway };
}

// Half-time odds from past team/player goals. DB has no half-time data → assume goals split 50/50 per half.
// High total goals in past (e.g. 10) → likely ~5 per half → Over 1.5 in each half very likely → lower odds.
// Low total (e.g. 2) → ~1 per half → Over 2.5 in a half unlikely → higher odds.
const HALF_LINES = ['0.5', '1.5', '2.5'];
function computeHalfTimeProbsFromHistory(all, homeTeam, awayTeam, homeStats, awayStats) {
  const defaultLambda = 1.2;
  const homeAvgFor = homeStats.games > 0 ? homeStats.goalsFor / homeStats.games : defaultLambda;
  const homeAvgAgainst = homeStats.games > 0 ? homeStats.goalsAgainst / homeStats.games : defaultLambda;
  const awayAvgFor = awayStats.games > 0 ? awayStats.goalsFor / awayStats.games : defaultLambda;
  const awayAvgAgainst = awayStats.games > 0 ? awayStats.goalsAgainst / awayStats.games : defaultLambda;
  const lambdaHome = (homeAvgFor + awayAvgAgainst) / 2;
  const lambdaAway = (awayAvgFor + homeAvgAgainst) / 2;
  const lambdaTotal = lambdaHome + lambdaAway;
  const lambdaFirstHalf = lambdaTotal / 2;
  const lambdaHome1st = lambdaHome / 2;
  const lambdaAway1st = lambdaAway / 2;

  const homeMatches = all.filter(m =>
    matchTeamToMatch(homeTeam, m, 'home') || matchTeamToMatch(homeTeam, m, 'away')
  );
  const awayMatches = all.filter(m =>
    matchTeamToMatch(awayTeam, m, 'home') || matchTeamToMatch(awayTeam, m, 'away')
  );
  const allTotals = [
    ...homeMatches.map(m => (Number(m.homeScore) || 0) + (Number(m.awayScore) || 0)),
    ...awayMatches.map(m => (Number(m.homeScore) || 0) + (Number(m.awayScore) || 0)),
  ];
  const n = allTotals.length;
  const minMatchesForHistory = 3;

  const halfPOver = (line) => {
    const threshold = Number(line);
    if (n >= minMatchesForHistory) {
      const fullMatchThreshold = 2 * threshold;
      const overCount = allTotals.filter(t => t > fullMatchThreshold).length;
      return overCount / n;
    }
    const k = Math.floor(threshold);
    let pUnder = 0;
    for (let i = 0; i <= k; i++) pUnder += poissonPmf(i, lambdaFirstHalf);
    return 1 - pUnder;
  };

  const firstHalf = {};
  const secondHalf = {};
  for (const line of HALF_LINES) {
    const p = Math.max(0.01, Math.min(0.99, halfPOver(line)));
    firstHalf[line] = p;
    secondHalf[line] = p;
  }

  let home1st = 0, draw1st = 0, away1st = 0;
  const maxGoals = 8;
  for (let i = 0; i <= maxGoals; i++) {
    const ph = poissonPmf(i, lambdaHome1st);
    for (let j = 0; j <= maxGoals; j++) {
      const pa = poissonPmf(j, lambdaAway1st);
      const p = ph * pa;
      if (i > j) home1st += p;
      else if (i === j) draw1st += p;
      else away1st += p;
    }
  }
  const total1st = home1st + draw1st + away1st;
  const scale = total1st > 0 ? 100 / total1st : 1 / 3;
  const result = {
    home: Math.round(home1st * scale),
    draw: Math.round(draw1st * scale),
    away: 100 - Math.round(home1st * scale) - Math.round(draw1st * scale),
  };

  return { firstHalf, secondHalf, result };
}

// Build per-player career stats (goals, assists, games) from all matches.
// Match doc: homeTeamPlayerIds, awayTeamPlayerIds, homeScore, awayScore, homePlayerGoals, awayPlayerGoals.
// homePlayerGoals/awayPlayerGoals are arrays of { name, goals } (index matches team player ids). In 2v2, assists = partner's goals.
function buildPlayerStatsFromMatches(allMatches) {
  const map = new Map(); // playerId -> { games, goals, assists }
  function add(playerId, goals, assists) {
    if (!playerId) return;
    let s = map.get(playerId);
    if (!s) s = { games: 0, goals: 0, assists: 0 };
    s.games += 1;
    s.goals += Number(goals) || 0;
    s.assists += Number(assists) || 0;
    map.set(playerId, s);
  }
  allMatches.forEach((m) => {
    const homeIds = m.homeTeamPlayerIds || [];
    const awayIds = m.awayTeamPlayerIds || [];
    const homeGoalsArr = m.homePlayerGoals || [];
    const awayGoalsArr = m.awayPlayerGoals || [];
    const homeScore = Number(m.homeScore) || 0;
    const awayScore = Number(m.awayScore) || 0;

    // Home side
    if (homeIds.length === 1) {
      const g = homeGoalsArr[0]?.goals != null ? Number(homeGoalsArr[0].goals) : homeScore;
      add(homeIds[0], g, 0);
    } else if (homeIds.length >= 2) {
      const g0 = homeGoalsArr[0]?.goals != null ? Number(homeGoalsArr[0].goals) : Math.floor(homeScore / 2);
      const g1 = homeGoalsArr[1]?.goals != null ? Number(homeGoalsArr[1].goals) : homeScore - Math.floor(homeScore / 2);
      add(homeIds[0], g0, g1);
      add(homeIds[1], g1, g0);
    }
    // Away side
    if (awayIds.length === 1) {
      const g = awayGoalsArr[0]?.goals != null ? Number(awayGoalsArr[0].goals) : awayScore;
      add(awayIds[0], g, 0);
    } else if (awayIds.length >= 2) {
      const g0 = awayGoalsArr[0]?.goals != null ? Number(awayGoalsArr[0].goals) : Math.floor(awayScore / 2);
      const g1 = awayGoalsArr[1]?.goals != null ? Number(awayGoalsArr[1].goals) : awayScore - Math.floor(awayScore / 2);
      add(awayIds[0], g0, g1);
      add(awayIds[1], g1, g0);
    }
  });
  return map;
}

// Player quality = goals + k*assists (career total). Assists weighted slightly less than goals.
const ASSIST_WEIGHT = 0.6;
function playerQuality(stats) {
  if (!stats) return 0;
  return (Number(stats.goals) || 0) + ASSIST_WEIGHT * (Number(stats.assists) || 0);
}

// Compute win/draw/loss probabilities from player quality (1v1 or 2v2). If one side has all the quality and the other none, favourite gets 100%.
// Returns null when both sides have zero quality (caller should use Poisson).
function computePlayerStrengthProbabilities(homeTeam, awayTeam, playerStatsMap) {
  const homePlayers = homeTeam?.playerData || [];
  const awayPlayers = awayTeam?.playerData || [];
  const is1v1 = homePlayers.length === 1 && awayPlayers.length === 1;

  const teamStrength = (players) => {
    let sum = 0;
    (players || []).forEach((p) => {
      const id = p?.id;
      const s = id ? playerStatsMap.get(id) : null;
      sum += playerQuality(s);
    });
    return sum;
  };

  const S_home = teamStrength(homePlayers);
  const S_away = teamStrength(awayPlayers);

  if (S_home > 0 && S_away <= 0) return { home: 100, draw: 0, away: 0 };
  if (S_away > 0 && S_home <= 0) return { home: 0, draw: 0, away: 100 };
  if (S_home <= 0 && S_away <= 0) return null;

  const drawShare = 0.12;
  const total = S_home + S_away;
  const homeP = (1 - drawShare) * (S_home / total);
  const awayP = (1 - drawShare) * (S_away / total);
  const drawP = drawShare;
  const scale = 100 / (homeP + awayP + drawP);
  const home = Math.round(homeP * scale);
  const draw = Math.round(drawP * scale);
  const away = 100 - home - draw;
  return { home, draw, away };
}

// Per-player scoring props: use ALL past match stats to predict likelihood to score first.
// Dynamic model: goals, assists, games (from every past match) → scoring propensity → P(score first).
// Higher predicted probability → lower payout. Lower probability → higher payout.
// Returns { firstToScore: [ { playerId, name, prob } ], lastToScore: same, noGoalsProb }.
const PLAYER_SCORING_OVERROUND = 1.0476; // -105 style: combined implied prob ~104.76%.
// Scoring propensity from full career stats (all past matches). Uses goals, rate (goals/game), and assists.
function firstScorerPropensity(stats, games) {
  if (!stats) return 0.5;
  const goals = Math.max(0, Number(stats.goals) || 0);
  const assists = Math.max(0, Number(stats.assists) || 0);
  const g = games > 0 ? games : 1;
  const goalsPerGame = goals / g;
  const volume = Math.pow(goals + 1, 1.25);
  const rate = Math.pow(goalsPerGame + 0.12, 1.1);
  const involvement = 1 + 0.4 * Math.log1p(assists);
  return volume * rate * involvement;
}

function computePlayerScoringProbs(homeTeam, awayTeam, playerStatsMap, homeStats, awayStats) {
  const homePlayers = homeTeam?.playerData || [];
  const awayPlayers = awayTeam?.playerData || [];
  const list = [];
  const add = (p) => {
    if (!p?.id) return;
    const s = playerStatsMap.get(p.id);
    const games = Math.max(0, Number(s?.games) || 0);
    const goals = Math.max(0, Number(s?.goals) || 0);
    const assists = Math.max(0, Number(s?.assists) || 0);
    const name = (p.realName || p.name || p.displayName || p.gamertag || 'Player').trim().split(/\s+/)[0] || 'Player';
    const propensity = firstScorerPropensity(s, games);
    list.push({ playerId: p.id, name, goals, assists, games, propensity });
  };
  homePlayers.forEach(add);
  awayPlayers.forEach(add);
  if (list.length === 0) return null;

  const defaultLambda = 1.2;
  const homeAvgFor = homeStats?.games > 0 ? homeStats.goalsFor / homeStats.games : defaultLambda;
  const homeAvgAgainst = homeStats?.games > 0 ? homeStats.goalsAgainst / homeStats.games : defaultLambda;
  const awayAvgFor = awayStats?.games > 0 ? awayStats.goalsFor / awayStats.games : defaultLambda;
  const awayAvgAgainst = awayStats?.games > 0 ? awayStats.goalsAgainst / awayStats.games : defaultLambda;
  const lambdaHome = (homeAvgFor + awayAvgAgainst) / 2;
  const lambdaAway = (awayAvgFor + homeAvgAgainst) / 2;
  const lambdaTotal = lambdaHome + lambdaAway;
  const pNoGoals = poissonPmf(0, lambdaTotal);
  const pAtLeastOneGoal = 1 - pNoGoals;

  const sumProp = list.reduce((a, x) => a + x.propensity, 0) || 1;
  let firstToScore = list.map(({ playerId, name, propensity }) => ({
    playerId,
    name,
    prob: pAtLeastOneGoal * (propensity / sumProp),
  }));
  firstToScore = [...firstToScore].sort((a, b) => b.prob - a.prob);
  const noGoalsProb = pNoGoals;

  return {
    firstToScore,
    lastToScore: firstToScore.map((x) => ({ ...x })),
    noGoalsProb,
  };
}

// Apply book margin so combined implied probability is ~104.76% (-105 style). Returns American odds per option.
function playerScoringProbsToOddsWithVig(optionProbs) {
  const total = optionProbs.reduce((a, p) => a + p, 0);
  if (total <= 0) return optionProbs.map(() => 100);
  const vigged = optionProbs.map((p) => (p / total) * PLAYER_SCORING_OVERROUND);
  return vigged.map((implied) => probabilityToAmericanOdds(Math.max(1, Math.min(99, implied * 100))));
}

// Blend two probability objects (a and b) by weight w: w*a + (1-w)*b, then normalize to 100.
function blendProbabilities(pa, pb, weightA) {
  const w = Number(weightA);
  const home = (pa.home * w + pb.home * (1 - w)) / 100;
  const draw = (pa.draw * w + pb.draw * (1 - w)) / 100;
  const away = (pa.away * w + pb.away * (1 - w)) / 100;
  const total = home + draw + away;
  if (total <= 0) return { home: 34, draw: 33, away: 33 };
  const scale = 100 / total;
  return {
    home: Math.round(home * scale),
    draw: Math.round(draw * scale),
    away: 100 - Math.round(home * scale) - Math.round(draw * scale),
  };
}

// Fun-only win probability based on simple team stats (fallback when no history).
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

function getSafeTime(dateObj) {
  if (!dateObj) return 0;
  if (typeof dateObj.toMillis === 'function') return dateObj.toMillis();
  if (dateObj instanceof Date) return dateObj.getTime();
  if (dateObj.seconds) return dateObj.seconds * 1000;
  return new Date(dateObj).getTime() || 0;
}

// Betting fixture doc id for Firestore (views, bet count, total staked, comments)
const BETTING_FIXTURES = 'betting_fixtures';
const BETTING_VIEWED_KEY = 'banana-betting-viewed-';

function getFixtureId(match) {
  if (match?.id) return String(match.id);
  const t = match?.kickoff ? new Date(match.kickoff).getTime() : 0;
  return `${slug(match?.home || 'home')}-vs-${slug(match?.away || 'away')}-${t}`;
}

const BETTING_RANDOM_NAMES = [
  'PitchKing', 'GoalMachine', 'BananaStriker', 'YellowBullet', 'TurfWarrior', 'NetBuster',
  'ShadowDribbler', 'GoldenBoot', 'AceWinger', 'MidfieldMaestro', 'DefensiveRock', 'TurboFwd',
  'MatchDayHero', 'FeverPitch', 'ClutchPlayer', 'SidelineSage', 'BleacherBoss', 'StadiumStar',
  'GrassCutter', 'LastMinuteKing', 'HatTrickHunter', 'AssistAce', 'CleanSheetKeeper',
];
function randomCommenterName() {
  const base = BETTING_RANDOM_NAMES[Math.floor(Math.random() * BETTING_RANDOM_NAMES.length)];
  return base + Math.floor(100 + Math.random() * 900);
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

/** Comment panel for a betting fixture – random username, same UX as Celebration. */
function BettingCommentPanel({ fixtureId, commentCount, onClose, onCommentAdded }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!fixtureId) return;
    setLoading(true);
    const q = query(
      collection(db, BETTING_FIXTURES, fixtureId, 'comments'),
      orderBy('createdAt', 'asc')
    );
    getDocs(q).then(snap => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [fixtureId]);

  useEffect(() => {
    if (fixtureId) inputRef.current?.focus();
  }, [fixtureId]);

  const formatDate = (createdAt) => {
    if (!createdAt) return '';
    const d = createdAt?.toDate ? createdAt.toDate() : new Date(createdAt);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const submit = async () => {
    if (!input.trim() || !fixtureId || submitting) return;
    setSubmitting(true);
    const authorName = randomCommenterName();
    const commentData = { authorName, text: input.trim(), createdAt: new Date() };
    try {
      const docRef = await addDoc(collection(db, BETTING_FIXTURES, fixtureId, 'comments'), {
        ...commentData,
        createdAt: new Date(),
      });
      await updateDoc(doc(db, BETTING_FIXTURES, fixtureId), { commentCount: increment(1) });
      setComments(prev => [...prev, { id: docRef.id, ...commentData, createdAt: { toDate: () => new Date(commentData.createdAt) } }]);
      onCommentAdded?.();
    } catch (e) {
      console.error('Comment failed', e);
    }
    setSubmitting(false);
    setInput('');
  };

  if (!fixtureId) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[1002] flex justify-end"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="w-full max-w-md bg-[#0a0a0c] border-l border-white/10 shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-white/10 flex justify-between items-center">
          <h3 className="font-black uppercase text-sm text-white">Comments</h3>
          <button type="button" onClick={onClose} className="p-2 text-gray-500 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 text-yellow-500 animate-spin" /></div>
          ) : comments.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">No comments yet. Be the first!</p>
          ) : (
            comments.map(c => (
              <div key={c.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-yellow-500 text-sm">{c.authorName}</span>
                  <span className="text-[10px] text-gray-500">{c.createdAt?.toDate ? formatDate(c.createdAt) : ''}</span>
                </div>
                <p className="text-white/90 text-sm">{c.text}</p>
              </div>
            ))
          )}
        </div>
        <div className="p-4 border-t border-white/10 flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit()}
            placeholder="Add a comment..."
            className="flex-1 bg-black border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-500 focus:border-yellow-500 focus:outline-none text-sm"
          />
          <motion.button
            type="button"
            onClick={submit}
            disabled={!input.trim() || submitting}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="px-4 py-3 rounded-xl bg-yellow-500 text-black font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Post'}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
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
  const [probState, setProbState] = useState({ loading: false, home: null, draw: null, away: null });
  const [totalsProbsState, setTotalsProbsState] = useState({ loading: false, lines: null });
  const [halfTimeProbsState, setHalfTimeProbsState] = useState({ loading: false, data: null });
  const [playerScoringProbsState, setPlayerScoringProbsState] = useState(null);
  const [teamTotalsProbsState, setTeamTotalsProbsState] = useState({ home: null, away: null });
  const [cleanSheetProbsState, setCleanSheetProbsState] = useState({ home: null, away: null });
  const [refreshFixtureStatsTrigger, setRefreshFixtureStatsTrigger] = useState(0);

  const handleConfirmSlip = async (slip, localStakes) => {
    if (!slip?.length) return;
    const byMatch = {};
    slip.forEach((sel) => {
      const fid = sel.matchId; // fixture id per match (counted separately per match)
      if (!fid) return;
      const risk = Math.max(0, Number(localStakes?.[sel.key]) || 0);
      const win = getPayout(risk, sel.odds).win;
      if (!byMatch[fid]) byMatch[fid] = { totalStake: 0, potentialWin: 0, selections: [] };
      byMatch[fid].totalStake += risk;
      byMatch[fid].potentialWin += win;
      byMatch[fid].selections.push({ market: sel.market, selection: sel.selection, odds: sel.odds, risk, win });
    });
    for (const fixtureId of Object.keys(byMatch)) {
      const { totalStake, potentialWin, selections } = byMatch[fixtureId];
      if (totalStake <= 0) continue;
      try {
        const ref = doc(db, BETTING_FIXTURES, fixtureId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          await updateDoc(ref, { betCount: increment(1), totalStaked: increment(totalStake) });
        } else {
          await setDoc(ref, { viewCount: 0, betCount: 1, totalStaked: totalStake, commentCount: 0 });
        }
        await addDoc(collection(db, BETTING_FIXTURES, fixtureId, 'bets'), {
          totalStake,
          potentialWin,
          selections,
          createdAt: new Date(),
          won: false,
          winningAmount: 0,
        });
      } catch (e) {
        console.error('Confirm slip failed for', fixtureId, e);
      }
    }
    setRefreshFixtureStatsTrigger((t) => t + 1);
  };

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

  // Load form from database only (no hard-coded form). Run when match is selected so Form tab has data.
  useEffect(() => {
    if (!detailMatch) {
      setFormState({ loading: false, homeForm: null, awayForm: null });
      return;
    }

    const homeTeam = detailMatch.homeTeamObj;
    const awayTeam = detailMatch.awayTeamObj;
    if (!homeTeam || !awayTeam) {
      setFormState({ loading: false, homeForm: null, awayForm: null });
      return;
    }

    const homePlayers = homeTeam.playerData || [];
    const awayPlayers = awayTeam.playerData || [];
    const isCurrent1v1 = homePlayers.length === 1 && awayPlayers.length === 1;

    let cancelled = false;
    setFormState({ loading: true, homeForm: null, awayForm: null });

    (async () => {
      try {
        const snap = await getDocs(collection(db, 'matches'));
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Same logic as Standings: only matches from DB where this team played; filter by 1v1 or 2v2.
        const computeTeamForm = (team, want1v1) => {
          const teamMatches = all.filter(m => {
            const isTeam =
              matchTeamToMatch(team, m, 'home') || matchTeamToMatch(team, m, 'away');
            if (!isTeam) return false;
            const homeCount = Array.isArray(m.homeTeamPlayerIds) ? m.homeTeamPlayerIds.length : 0;
            const awayCount = Array.isArray(m.awayTeamPlayerIds) ? m.awayTeamPlayerIds.length : 0;
            const is1v1 = homeCount === 1 && awayCount === 1;
            const is2v2 = homeCount === 2 && awayCount === 2;
            return want1v1 ? is1v1 : is2v2;
          });
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

        const homeForm = computeTeamForm(homeTeam, isCurrent1v1);
        const awayForm = computeTeamForm(awayTeam, isCurrent1v1);

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
  }, [detailMatch]);

  // Load historical matches and compute win/draw/loss probabilities when a match is selected (for Probability tab and for Bet odds).
  useEffect(() => {
    if (!detailMatch) return;

    const homeTeam = detailMatch.homeTeamObj;
    const awayTeam = detailMatch.awayTeamObj;
    if (!homeTeam || !awayTeam) {
      setProbState({ loading: false, home: null, draw: null, away: null });
      setTotalsProbsState({ loading: false, lines: null });
      setHalfTimeProbsState({ loading: false, data: null });
      setPlayerScoringProbsState(null);
      setTeamTotalsProbsState({ home: null, away: null });
      setCleanSheetProbsState({ home: null, away: null });
      return;
    }

    let cancelled = false;

    (async () => {
      setProbState({ loading: true, home: null, draw: null, away: null });
        setTotalsProbsState({ loading: true, lines: null });
        setHalfTimeProbsState({ loading: true, data: null });
        setPlayerScoringProbsState(null);
        setTeamTotalsProbsState({ home: null, away: null });
        setCleanSheetProbsState({ home: null, away: null });
      try {
        const snap = await getDocs(collection(db, 'matches'));
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Use format-specific history: 1v1 odds from 1v1 matches only (player goals/assists in 1v1), 2v2 from 2v2 only.
        const homePlayers = homeTeam?.playerData || [];
        const awayPlayers = awayTeam?.playerData || [];
        const is1v1 = homePlayers.length === 1 && awayPlayers.length === 1;
        const allFiltered = filterMatchesByFormat(all, is1v1);

        const getTeamStats = (team, matchList) => {
          const list = matchList || allFiltered;
          const teamMatches = list.filter(m =>
            matchTeamToMatch(team, m, 'home') || matchTeamToMatch(team, m, 'away')
          );
          let goalsFor = 0, goalsAgainst = 0;
          teamMatches.forEach((m) => {
            const isHome = matchTeamToMatch(team, m, 'home');
            const scored = isHome ? (Number(m.homeScore) || 0) : (Number(m.awayScore) || 0);
            const conceded = isHome ? (Number(m.awayScore) || 0) : (Number(m.homeScore) || 0);
            goalsFor += scored;
            goalsAgainst += conceded;
          });
          return { games: teamMatches.length, goalsFor, goalsAgainst };
        };

        const homeStats = getTeamStats(homeTeam, allFiltered);
        const awayStats = getTeamStats(awayTeam, allFiltered);
        const poissonProbs = computePoissonProbabilities(homeStats, awayStats);

        // Player quality (goals + assists): use ALL matches (1v1 + 2v2) so players who play both formats have combined stats.
        const playerStatsMap = buildPlayerStatsFromMatches(all);
        const playerProbs = computePlayerStrengthProbabilities(homeTeam, awayTeam, playerStatsMap);

        // 1v1: weight player stats (goals in 1v1) more so odds fit “likely → low odds, unlikely → high odds”.
        const blendWeight = is1v1 ? 0.92 : 0.85;
        let probs;
        if (playerProbs != null) {
          if (playerProbs.home === 100 || playerProbs.away === 100) {
            probs = playerProbs;
          } else {
            probs = blendProbabilities(playerProbs, poissonProbs, blendWeight);
          }
        } else {
          probs = poissonProbs;
        }

        // Totals, half-time, team totals, clean sheet: all from format-specific history (1v1 or 2v2).
        const totalsLines = computeTotalsProbsFromHistory(allFiltered, homeTeam, awayTeam, homeStats, awayStats);
        const halfTimeProbs = computeHalfTimeProbsFromHistory(allFiltered, homeTeam, awayTeam, homeStats, awayStats);
        const playerScoringProbs = computePlayerScoringProbs(homeTeam, awayTeam, playerStatsMap, homeStats, awayStats);
        const homeTeamTotalsProbs = computeTeamTotalsProbsFromHistory(allFiltered, homeTeam, homeStats);
        const awayTeamTotalsProbs = computeTeamTotalsProbsFromHistory(allFiltered, awayTeam, awayStats);
        const cleanSheetProbs = computeCleanSheetProbsFromHistory(allFiltered, homeTeam, awayTeam, homeStats, awayStats);

        if (!cancelled) {
          setProbState({ loading: false, home: probs.home, draw: probs.draw, away: probs.away });
          setTotalsProbsState({ loading: false, lines: totalsLines });
          setHalfTimeProbsState({ loading: false, data: halfTimeProbs });
          setPlayerScoringProbsState(playerScoringProbs);
          setTeamTotalsProbsState({ home: homeTeamTotalsProbs, away: awayTeamTotalsProbs });
          setCleanSheetProbsState(cleanSheetProbs);
        }
      } catch (e) {
        console.error('Failed to load probability data', e);
        if (!cancelled) {
          setProbState({ loading: false, home: null, draw: null, away: null });
          setTotalsProbsState({ loading: false, lines: null });
          setHalfTimeProbsState({ loading: false, data: null });
          setPlayerScoringProbsState(null);
          setTeamTotalsProbsState({ home: null, away: null });
          setCleanSheetProbsState({ home: null, away: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailMatch]);

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
            probState={probState}
            totalsProbs={totalsProbsState?.lines}
            halfTimeProbs={halfTimeProbsState?.data}
            teamTotalsProbs={teamTotalsProbsState}
            cleanSheetProbs={cleanSheetProbsState}
            playerScoringProbs={playerScoringProbsState}
            betslip={betslip}
            stake={stake}
            totals={totals}
            onToggleSelection={toggleSelection}
            onStakeChange={setStake}
            onClearAll={() => setBetslip([])}
            onBack={() => {
              setDetailMatch(null);
              setDetailTournament(null);
              setDetailTab('preview');
            }}
            h2hState={h2hState}
            refreshFixtureStatsTrigger={refreshFixtureStatsTrigger}
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
  probState,
  totalsProbs,
  halfTimeProbs,
  teamTotalsProbs,
  cleanSheetProbs,
  playerScoringProbs,
  betslip,
  stake,
  totals,
  onToggleSelection,
  onStakeChange,
  onClearAll,
  refreshFixtureStatsTrigger,
}) {
  const fixtureId = getFixtureId(match);
  const [fixtureStats, setFixtureStats] = useState({ viewCount: 0, betCount: 0, totalStaked: 0, commentCount: 0 });
  const [showCommentPanel, setShowCommentPanel] = useState(false);

  // Load fixture doc (views, bet count, total staked, comment count) and record view once per session. Refetch when refreshFixtureStatsTrigger changes (e.g. after Confirm slip).
  useEffect(() => {
    if (!fixtureId) return;
    let cancelled = false;
    (async () => {
      try {
        const ref = doc(db, BETTING_FIXTURES, fixtureId);
        const snap = await getDoc(ref);
        if (cancelled) return;
        const data = snap.data() || {};
        setFixtureStats({
          viewCount: data.viewCount ?? 0,
          betCount: data.betCount ?? 0,
          totalStaked: Number(data.totalStaked) ?? 0,
          commentCount: data.commentCount ?? 0,
        });
        const viewedKey = BETTING_VIEWED_KEY + fixtureId;
        if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(viewedKey)) {
          sessionStorage.setItem(viewedKey, '1');
          if (snap.exists()) {
            await updateDoc(ref, { viewCount: increment(1) });
          } else {
            await setDoc(ref, { viewCount: 1, betCount: 0, totalStaked: 0, commentCount: 0 });
          }
          if (!cancelled) setFixtureStats(prev => ({ ...prev, viewCount: snap.exists() ? (snap.data()?.viewCount ?? 0) + 1 : 1 }));
        }
      } catch (e) {
        if (!cancelled) setFixtureStats({ viewCount: 0, betCount: 0, totalStaked: 0, commentCount: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [fixtureId, refreshFixtureStatsTrigger]);

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

  const probabilities =
    probState && probState.home != null && !probState.loading
      ? { home: probState.home, draw: probState.draw, away: probState.away }
      : computeWinProbabilities(match);
  const homeForm = formState?.homeForm || '';
  const awayForm = formState?.awayForm || '';

  const homePlayers = match.homeTeamObj?.playerData || [];
  const awayPlayers = match.awayTeamObj?.playerData || [];
  const is1v1Match = homePlayers.length === 1 && awayPlayers.length === 1;

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
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-[#050509]/95 p-4 text-sm text-gray-200">
              <p className="font-semibold text-[13px] mb-2">
                Preview for <span className="text-yellow-300">{match.home}</span> vs{' '}
                <span className="text-yellow-300">{match.away}</span>
              </p>
              <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
                This is a fun-only Banana FC matchup. Use the tabs above to explore win probabilities,
                recent form, head-to-head meetings, and betting-style odds. No real money, no prizes –
                just hype for the fixture.
              </p>

              {/* View count + trending/hot */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] font-semibold text-gray-300">
                  <Eye className="w-3.5 h-3.5 text-yellow-500" />
                  {formatCountShort(fixtureStats.viewCount)} views
                </span>
                {fixtureStats.viewCount >= 50 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/50 text-[11px] font-bold text-amber-300 uppercase tracking-wider">
                    <TrendingUp className="w-3.5 h-3.5" /> Trending
                  </span>
                )}
                {fixtureStats.viewCount >= 10 && fixtureStats.viewCount < 50 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-500/20 border border-orange-400/50 text-[11px] font-bold text-orange-300 uppercase tracking-wider">
                    <Flame className="w-3.5 h-3.5" /> Hot
                  </span>
                )}
              </div>

              {/* Bet count + total staked */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="flex items-center gap-1.5 text-gray-400 text-[10px] uppercase tracking-wider mb-0.5">
                    <Users className="w-3.5 h-3.5" /> Bettors
                  </div>
                  <p className="text-lg font-black text-white">{fixtureStats.betCount}</p>
                  <p className="text-[10px] text-gray-500">people have bet on this game</p>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="flex items-center gap-1.5 text-gray-400 text-[10px] uppercase tracking-wider mb-0.5">
                    <Coins className="w-3.5 h-3.5 text-yellow-500" /> Total staked
                  </div>
                  <p className="text-lg font-black text-yellow-400">${fixtureStats.totalStaked.toLocaleString()}</p>
                  <p className="text-[10px] text-gray-500">money bet on this game</p>
                </div>
              </div>

              {/* Place bet: go straight to Bet tab */}
              <div className="flex flex-wrap items-center gap-2">
                <motion.button
                  type="button"
                  onClick={() => setTab('bet')}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-yellow-500 text-black font-bold text-sm"
                >
                  <TicketPercent className="w-4 h-4" />
                  Place bet
                </motion.button>
              </div>
            </div>

            {/* Comments */}
            <div className="rounded-2xl border border-white/10 bg-[#050509]/95 p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[13px] font-bold text-white uppercase tracking-wider">Comments</h4>
                <button
                  type="button"
                  onClick={() => setShowCommentPanel(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-[11px] font-semibold hover:bg-yellow-500/30"
                >
                  <MessageCircle className="w-4 h-4" />
                  {fixtureStats.commentCount > 0 ? formatCountShort(fixtureStats.commentCount) : 'Add comment'}
                </button>
              </div>
              <p className="text-[11px] text-gray-500">
                Share your prediction or hype. You’ll appear with a random username.
              </p>
            </div>
            <AnimatePresence>
              {showCommentPanel && (
                <BettingCommentPanel
                  key="betting-comment-panel"
                  fixtureId={fixtureId}
                  commentCount={fixtureStats.commentCount}
                  onClose={() => setShowCommentPanel(false)}
                  onCommentAdded={() => setFixtureStats(prev => ({ ...prev, commentCount: prev.commentCount + 1 }))}
                />
              )}
            </AnimatePresence>
          </div>
        )}

        {tab === 'probability' && (
          <>
            {probState?.loading && (
              <div className="rounded-2xl border border-white/10 bg-[#050509]/95 px-4 py-2 text-[11px] text-gray-400">
                Loading probability from match history…
              </div>
            )}
            <ProbabilityPanel
              match={match}
              probabilities={probabilities}
            />
          </>
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
              emptyMessage={is1v1Match ? 'No 1v1 matches yet' : 'No 2v2 matches yet'}
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
            probState={probState}
            totalsProbs={totalsProbs}
            halfTimeProbs={halfTimeProbs}
            cleanSheetProbs={cleanSheetProbs}
            teamTotalsProbs={teamTotalsProbs}
            playerScoringProbs={playerScoringProbs}
            betslip={betslip}
            stake={stake}
            totals={totals}
            onToggleSelection={onToggleSelection}
            onStakeChange={onStakeChange}
            onClearAll={onClearAll}
          />
        )}
      </div>
    </div>
  );
}

function BetMarketsPanel({ match, probState, totalsProbs, halfTimeProbs, cleanSheetProbs, teamTotalsProbs, playerScoringProbs, betslip, stake, totals, onToggleSelection, onStakeChange, onClearAll }) {
  const home = match.home || 'Home';
  const away = match.away || 'Away';
  const homePlayers = match.homeTeamObj?.playerData || [];
  const awayPlayers = match.awayTeamObj?.playerData || [];
  const is2v2 = homePlayers.length === 2 && awayPlayers.length === 2;

  const hasProbs = probState && !probState.loading && probState.home != null;
  const hasTotalsProbs = totalsProbs && typeof totalsProbs['1.5'] === 'number';
  const hasHalfTimeProbs = halfTimeProbs && halfTimeProbs.firstHalf && halfTimeProbs.result;
  const hasCleanSheetProbs = cleanSheetProbs && typeof cleanSheetProbs.home === 'number' && typeof cleanSheetProbs.away === 'number';
  const hasTeamTotalsProbs = teamTotalsProbs && teamTotalsProbs.home && teamTotalsProbs.away;
  const hasPlayerScoringProbs = playerScoringProbs && playerScoringProbs.firstToScore?.length > 0;
  const homeOdds = hasProbs ? probabilityToAmericanOdds(probState.home) : -110;
  const drawOdds = hasProbs ? probabilityToAmericanOdds(probState.draw) : 275;
  const awayOdds = hasProbs ? probabilityToAmericanOdds(probState.away) : 210;
  const homeWinShare = hasProbs && (probState.home + probState.away) > 0
    ? probState.home / (probState.home + probState.away)
    : 0.5;
  const drawNoBetHomeOdds = hasProbs ? probabilityToAmericanOdds(homeWinShare * 100) : -190;
  const drawNoBetAwayOdds = hasProbs ? probabilityToAmericanOdds((1 - homeWinShare) * 100) : 155;

  const makeKey = (marketLabel, optionLabel) =>
    `${match.id || match.kickoff}-${marketLabel}-${optionLabel}`;

  const isSelected = (marketLabel, optionLabel) => {
    const key = makeKey(marketLabel, optionLabel);
    return betslip.some(sel => sel.key === key);
  };

  // Correct Score: split into Home | Draw | Away columns for clean tabular layout
  const scoreToOdds = (h, a) => {
    const total = h + a;
    const baseOdds = total <= 2 ? 400 : total <= 4 ? 500 + total * 80 : 600 + total * 100;
    return baseOdds + Math.abs(h - a) * 20;
  };
  const correctScoreHome = [];
  const correctScoreDraw = [];
  const correctScoreAway = [];
  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const label = `${h} - ${a}`;
      const odds = scoreToOdds(h, a);
      if (h > a) correctScoreHome.push({ label, odds });
      else if (h === a) correctScoreDraw.push({ label, odds });
      else correctScoreAway.push({ label, odds });
    }
  }
  // Sort by total goals then by score
  const sortScores = (arr) =>
    arr.sort((x, y) => {
      const [xh, xa] = x.label.split(' - ').map(Number);
      const [yh, ya] = y.label.split(' - ').map(Number);
      const xt = xh + xa;
      const yt = yh + ya;
      if (xt !== yt) return xt - yt;
      return xh - yh;
    });
  sortScores(correctScoreHome);
  sortScores(correctScoreDraw);
  sortScores(correctScoreAway);

  const correctScoreMarket = {
    label: 'Correct Score (Full Time)',
    layout: 'correctScore',
    homeCol: correctScoreHome,
    drawCol: correctScoreDraw,
    awayCol: correctScoreAway,
    homeTeam: home,
    awayTeam: away,
    anyOtherOdds: 350,
  };

  const coreMarkets = [
    {
      label: 'Match Winner (3-Way / 1X2)',
      options: [
        { label: home, odds: homeOdds },
        { label: 'Draw', odds: drawOdds },
        { label: away, odds: awayOdds },
      ],
    },
    {
      label: 'Draw No Bet',
      options: [
        { label: home, odds: drawNoBetHomeOdds },
        { label: away, odds: drawNoBetAwayOdds },
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

  // Goal totals: odds from past data. High probability of Over → lower payout (negative odds); low probability → higher payout.
  const totalsMarkets = [
    '1.5',
    '2.5',
    '3.5',
    '4.5',
    '5.5',
    '6.5',
  ].map((line, idx) => {
    let overOdds, underOdds;
    if (hasTotalsProbs && totalsProbs[line] != null) {
      const pOver = Math.max(0.01, Math.min(0.99, totalsProbs[line]));
      overOdds = probabilityToAmericanOdds(pOver * 100);
      underOdds = probabilityToAmericanOdds((1 - pOver) * 100);
    } else {
      overOdds = idx < 2 ? -135 : +120 + idx * 10;
      underOdds = +115 + idx * 10;
    }
    return {
      label: `Total Goals - Over/Under ${line}`,
      options: [
        { label: `Over ${line}`, odds: overOdds },
        { label: `Under ${line}`, odds: underOdds },
      ],
    };
  });

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

  // Half-time odds from DB: team/player goal history → assume 50/50 split per half. High total → high chance >1.5 per half → lower odds.
  const htResult = hasHalfTimeProbs ? halfTimeProbs.result : { home: 34, draw: 33, away: 33 };
  const htHomeOdds = hasHalfTimeProbs ? probabilityToAmericanOdds(htResult.home) : +120;
  const htDrawOdds = hasHalfTimeProbs ? probabilityToAmericanOdds(htResult.draw) : +115;
  const htAwayOdds = hasHalfTimeProbs ? probabilityToAmericanOdds(htResult.away) : +260;

  const firstHalfLineOdds = (line) => {
    if (hasHalfTimeProbs && halfTimeProbs.firstHalf[line] != null) {
      const pOver = Math.max(0.01, Math.min(0.99, halfTimeProbs.firstHalf[line]));
      return { over: probabilityToAmericanOdds(pOver * 100), under: probabilityToAmericanOdds((1 - pOver) * 100) };
    }
    if (line === '0.5') return { over: -220, under: +185 };
    if (line === '1.5') return { over: +115, under: -135 };
    return { over: +360, under: -475 };
  };
  const secondHalfLineOdds = (line) => {
    if (hasHalfTimeProbs && halfTimeProbs.secondHalf[line] != null) {
      const pOver = Math.max(0.01, Math.min(0.99, halfTimeProbs.secondHalf[line]));
      return { over: probabilityToAmericanOdds(pOver * 100), under: probabilityToAmericanOdds((1 - pOver) * 100) };
    }
    if (line === '0.5') return { over: -260, under: +210 };
    if (line === '1.5') return { over: +110, under: -130 };
    return { over: +140, under: -165 };
  };

  const halfTimeMarkets = [
    {
      label: 'Half Time Result (1X2)',
      options: [
        { label: home, odds: htHomeOdds },
        { label: 'Draw', odds: htDrawOdds },
        { label: away, odds: htAwayOdds },
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
        { label: 'Over 0.5', odds: firstHalfLineOdds('0.5').over },
        { label: 'Under 0.5', odds: firstHalfLineOdds('0.5').under },
      ],
    },
    {
      label: 'First Half - Total Goals Over/Under 1.5',
      options: [
        { label: 'Over 1.5', odds: firstHalfLineOdds('1.5').over },
        { label: 'Under 1.5', odds: firstHalfLineOdds('1.5').under },
      ],
    },
    {
      label: 'First Half - Total Goals Over/Under 2.5',
      options: [
        { label: 'Over 2.5', odds: firstHalfLineOdds('2.5').over },
        { label: 'Under 2.5', odds: firstHalfLineOdds('2.5').under },
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
        { label: home, odds: htHomeOdds },
        { label: 'Draw', odds: htDrawOdds },
        { label: away, odds: htAwayOdds },
      ],
    },
    {
      label: 'Second Half - Total Goals Over/Under 0.5',
      options: [
        { label: 'Over 0.5', odds: secondHalfLineOdds('0.5').over },
        { label: 'Under 0.5', odds: secondHalfLineOdds('0.5').under },
      ],
    },
    {
      label: 'Second Half - Total Goals Over/Under 1.5',
      options: [
        { label: 'Over 1.5', odds: secondHalfLineOdds('1.5').over },
        { label: 'Under 1.5', odds: secondHalfLineOdds('1.5').under },
      ],
    },
    {
      label: 'Second Half - Total Goals Over/Under 2.5',
      options: [
        { label: 'Over 2.5', odds: secondHalfLineOdds('2.5').over },
        { label: 'Under 2.5', odds: secondHalfLineOdds('2.5').under },
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

  // First/Last to Score: odds from past goals; top scorer gets LOWEST odds (favourite). Combined vig ~-105.
  const firstToScoreOptions = (() => {
    if (is2v2 && hasPlayerScoringProbs) {
      const probs = [
        ...playerScoringProbs.firstToScore.map((x) => x.prob),
        playerScoringProbs.noGoalsProb ?? 0,
      ];
      const oddsArr = playerScoringProbsToOddsWithVig(probs);
      const labels = [...playerScoringProbs.firstToScore.map((x) => x.name), 'No Goals'];
      return labels.map((label, i) => ({ label, odds: oddsArr[i] }));
    }
    if (hasPlayerScoringProbs && playerScoringProbs.firstToScore.length >= 1) {
      const probs = [
        playerScoringProbs.firstToScore[0]?.prob ?? 0.4,
        playerScoringProbs.firstToScore[1]?.prob ?? 0.35,
        playerScoringProbs.noGoalsProb ?? 0.25,
      ];
      const oddsArr = playerScoringProbsToOddsWithVig(probs);
      return [
        { label: home, odds: oddsArr[0] },
        { label: away, odds: oddsArr[1] },
        { label: 'No Goals', odds: oddsArr[2] },
      ];
    }
    const fallbackProbs = [0.4, 0.35, 0.25];
    const oddsArr = playerScoringProbsToOddsWithVig(fallbackProbs);
    return [
      { label: home, odds: oddsArr[0] },
      { label: away, odds: oddsArr[1] },
      { label: 'No Goals', odds: oddsArr[2] },
    ];
  })();
  const lastToScoreOptions = (() => {
    if (is2v2 && hasPlayerScoringProbs) {
      const probs = [
        ...playerScoringProbs.lastToScore.map((x) => x.prob),
        playerScoringProbs.noGoalsProb ?? 0,
      ];
      const oddsArr = playerScoringProbsToOddsWithVig(probs);
      const labels = [...playerScoringProbs.lastToScore.map((x) => x.name), 'No Goals'];
      return labels.map((label, i) => ({ label, odds: oddsArr[i] }));
    }
    if (hasPlayerScoringProbs && playerScoringProbs.lastToScore.length >= 1) {
      const probs = [
        playerScoringProbs.lastToScore[0]?.prob ?? 0.4,
        playerScoringProbs.lastToScore[1]?.prob ?? 0.35,
        playerScoringProbs.noGoalsProb ?? 0.25,
      ];
      const oddsArr = playerScoringProbsToOddsWithVig(probs);
      return [
        { label: home, odds: oddsArr[0] },
        { label: away, odds: oddsArr[1] },
        { label: 'No Goals', odds: oddsArr[2] },
      ];
    }
    const fallbackProbs = [0.4, 0.35, 0.25];
    const oddsArr = playerScoringProbsToOddsWithVig(fallbackProbs);
    return [
      { label: home, odds: oddsArr[0] },
      { label: away, odds: oddsArr[1] },
      { label: 'No Goals', odds: oddsArr[2] },
    ];
  })();

  const playerProps = [
    {
      label: 'First Player to Score',
      options: firstToScoreOptions,
    },
    {
      label: 'Last Player to Score',
      options: lastToScoreOptions,
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
      options: (() => {
        if (hasCleanSheetProbs) {
          const clampP = (p) => Math.max(0.01, Math.min(0.99, p ?? 0));
          const pHomeCs = clampP(cleanSheetProbs.home);
          const pAwayCs = clampP(cleanSheetProbs.away);
          return [
            { label: `${home} – Yes`, odds: probabilityToAmericanOdds(pHomeCs * 100) },
            { label: `${home} – No`, odds: probabilityToAmericanOdds((1 - pHomeCs) * 100) },
            { label: `${away} – Yes`, odds: probabilityToAmericanOdds(pAwayCs * 100) },
            { label: `${away} – No`, odds: probabilityToAmericanOdds((1 - pAwayCs) * 100) },
          ];
        }
        return [
          { label: `${home} – Yes`, odds: +260 },
          { label: `${home} – No`, odds: -360 },
          { label: `${away} – Yes`, odds: +400 },
          { label: `${away} – No`, odds: -600 },
        ];
      })(),
    },
  ];

  // Combo odds from past data: P(winner) × P(total) so likely combos (e.g. strong team + high total) get low odds.
  const pHome = hasProbs ? probState.home / 100 : 0.4;
  const pAway = hasProbs ? probState.away / 100 : 0.35;
  const pDraw = hasProbs ? probState.draw / 100 : 0.25;
  const pOver = (line) => (hasTotalsProbs && totalsProbs[line] != null ? Math.max(0.01, Math.min(0.99, totalsProbs[line])) : 0.5);
  const pBttsYes = hasTeamTotalsProbs
    ? Math.max(0.05, Math.min(0.95, (teamTotalsProbs.home['0.5'] || 0.7) * (teamTotalsProbs.away['0.5'] || 0.65)))
    : 0.55;
  const comboLineToKey = (s) => s.replace('Over ', '').replace('Under ', '');
  const comboMarkets = [
    'Over 1.5',
    'Over 2.5',
    'Over 3.5',
    'Under 1.5',
    'Under 2.5',
    'Under 3.5',
  ].map((totalStr) => {
    const isOver = totalStr.startsWith('Over');
    const line = comboLineToKey(totalStr);
    const pTotal = isOver ? pOver(line) : 1 - pOver(line);
    const pHomeCombo = pHome * pTotal;
    const pAwayCombo = pAway * pTotal;
    return {
      label: `Match Winner + ${totalStr}`,
      options: [
        { label: `${home} & ${totalStr}`, odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, pHomeCombo * 100))) },
        { label: `${away} & ${totalStr}`, odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, pAwayCombo * 100))) },
      ],
    };
  }).concat([
    {
      label: 'Match Winner + BTTS (Yes)',
      options: [
        { label: `${home} & BTTS Yes`, odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, pHome * pBttsYes * 100))) },
        { label: `${away} & BTTS Yes`, odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, pAway * pBttsYes * 100))) },
      ],
    },
    {
      label: 'Match Winner + BTTS (No)',
      options: [
        { label: `${home} & BTTS No`, odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, pHome * (1 - pBttsYes) * 100))) },
        { label: `${away} & BTTS No`, odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, pAway * (1 - pBttsYes) * 100))) },
      ],
    },
    {
      label: 'Draw + BTTS',
      options: [
        { label: 'Draw & BTTS Yes', odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, pDraw * pBttsYes * 100))) },
        { label: 'Draw & BTTS No', odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, pDraw * (1 - pBttsYes) * 100))) },
      ],
    },
    {
      label: 'Draw + Over/Under 2.5 Goals',
      options: [
        { label: 'Draw & Over 2.5', odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, pDraw * pOver('2.5') * 100))) },
        { label: 'Draw & Under 2.5', odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, pDraw * (1 - pOver('2.5')) * 100))) },
      ],
    },
    {
      label: 'Double Chance + Total Goals',
      options: [
        { label: `${home} or Draw & Over 1.5`, odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, (pHome + pDraw) * pOver('1.5') * 100))) },
        { label: `${away} or Draw & Over 1.5`, odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, (pAway + pDraw) * pOver('1.5') * 100))) },
        { label: `${home} or ${away} & Over 2.5`, odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, (pHome + pAway) * pOver('2.5') * 100))) },
      ],
    },
    {
      label: 'Double Chance + BTTS',
      options: [
        { label: `${home} or Draw & BTTS Yes`, odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, (pHome + pDraw) * pBttsYes * 100))) },
        { label: `${away} or Draw & BTTS Yes`, odds: probabilityToAmericanOdds(Math.max(6, Math.min(94, (pAway + pDraw) * pBttsYes * 100))) },
      ],
    },
  ]);

  // Individual team totals from past goals: team that usually scores 3+ gets low odds for Over 2.5 (almost sure).
  const teamLineOdds = (teamProbs) => {
    if (!hasTeamTotalsProbs || !teamProbs) {
      const fallbacks = { '0.5': 0.7, '1.5': 0.4, '2.5': 0.2, '3.5': 0.08 };
      return TEAM_TOTAL_LINES.flatMap((line) => {
        const pOver = fallbacks[line];
        return [
          { label: `Over ${line}`, odds: probabilityToAmericanOdds(pOver * 100) },
          { label: `Under ${line}`, odds: probabilityToAmericanOdds((1 - pOver) * 100) },
        ];
      });
    }
    return TEAM_TOTAL_LINES.flatMap((line) => {
      const pOver = Math.max(0.01, Math.min(0.99, teamProbs[line] ?? 0.5));
      return [
        { label: `Over ${line}`, odds: probabilityToAmericanOdds(pOver * 100) },
        { label: `Under ${line}`, odds: probabilityToAmericanOdds((1 - pOver) * 100) },
      ];
    });
  };
  const exactGoalsFromTeamProbs = (teamProbs) => {
    if (!teamProbs) return [{ label: '0', odds: +210 }, { label: '1', odds: +250 }, { label: '2', odds: +320 }, { label: '3+', odds: +475 }];
    const p0 = 1 - (teamProbs['0.5'] ?? 0.7);
    const p1 = (teamProbs['0.5'] ?? 0.7) - (teamProbs['1.5'] ?? 0.4);
    const p2 = (teamProbs['1.5'] ?? 0.4) - (teamProbs['2.5'] ?? 0.2);
    const p3Plus = teamProbs['2.5'] ?? 0.2;
    return [
      { label: '0', odds: probabilityToAmericanOdds(Math.max(4, Math.min(96, p0 * 100))) },
      { label: '1', odds: probabilityToAmericanOdds(Math.max(4, Math.min(96, p1 * 100))) },
      { label: '2', odds: probabilityToAmericanOdds(Math.max(4, Math.min(96, p2 * 100))) },
      { label: '3+', odds: probabilityToAmericanOdds(Math.max(4, Math.min(96, p3Plus * 100))) },
    ];
  };
  const individualTotals = [
    {
      label: `${home} - Total Goals`,
      options: teamLineOdds(teamTotalsProbs?.home),
    },
    {
      label: `${away} - Total Goals`,
      options: teamLineOdds(teamTotalsProbs?.away),
    },
    {
      label: `${home} - Exact Goals`,
      options: exactGoalsFromTeamProbs(teamTotalsProbs?.home),
    },
    {
      label: `${away} - Exact Goals`,
      options: exactGoalsFromTeamProbs(teamTotalsProbs?.away),
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
    {
      key: 'correct-score',
      title: 'Correct Score (Full Time)',
      markets: [correctScoreMarket],
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
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-yellow-200">
                  {section.title}
                </p>
                <p className="text-xs text-gray-400">
                  Tap odds to add or remove fun picks.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm sm:text-base text-gray-100">
                <tbody>
                  {section.markets.map((mkt, idx) => {
                    const marketLabel = `${section.title} · ${mkt.label}`;
                    if (mkt.layout === 'correctScore') {
                      const maxRows = Math.max(
                        (mkt.homeCol?.length || 0),
                        (mkt.drawCol?.length || 0),
                        (mkt.awayCol?.length || 0)
                      );
                      return (
                        <tr key={`${section.key}-${idx}`} className="bg-black/30">
                          <td colSpan={2} className="p-0 border-t border-white/5 align-top">
                            <div className="px-3 sm:px-4 py-3">
                              <p className="font-medium text-sm text-gray-100 mb-3">
                                {mkt.label}
                              </p>
                              <table className="w-full border-collapse text-sm">
                                <thead>
                                  <tr className="bg-white/5 border-b border-white/10">
                                    <th className="px-3 py-2.5 text-left font-semibold text-gray-200 w-1/3 text-sm sm:text-base">
                                      {mkt.homeTeam}
                                    </th>
                                    <th className="px-3 py-2.5 text-left font-semibold text-gray-200 w-1/3 text-sm sm:text-base">
                                      Draw
                                    </th>
                                    <th className="px-3 py-2.5 text-left font-semibold text-gray-200 w-1/3 text-sm sm:text-base">
                                      {mkt.awayTeam}
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Array.from({ length: maxRows }).map((_, r) => (
                                    <tr key={r} className="border-b border-white/5 hover:bg-white/5">
                                      <td className="px-3 py-1.5 align-middle">
                                        {mkt.homeCol[r] ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              onToggleSelection(match, marketLabel, mkt.homeCol[r].label, mkt.homeCol[r].odds)
                                            }
                                            className={`w-full flex items-center justify-between gap-2 py-1 px-2 rounded transition-all text-left ${
                                              isSelected(marketLabel, mkt.homeCol[r].label)
                                                ? 'bg-yellow-500/30 border border-yellow-400'
                                                : 'hover:bg-white/5'
                                            }`}
                                          >
                                            <span className="text-gray-100 text-sm sm:text-base">{mkt.homeCol[r].label}</span>
                                            <span className="font-mono font-bold text-yellow-300 text-sm sm:text-base">
                                              {formatAmericanOdds(mkt.homeCol[r].odds)}
                                            </span>
                                          </button>
                                        ) : null}
                                      </td>
                                      <td className="px-3 py-1.5 align-middle">
                                        {mkt.drawCol[r] ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              onToggleSelection(match, marketLabel, mkt.drawCol[r].label, mkt.drawCol[r].odds)
                                            }
                                            className={`w-full flex items-center justify-between gap-2 py-1 px-2 rounded transition-all text-left ${
                                              isSelected(marketLabel, mkt.drawCol[r].label)
                                                ? 'bg-yellow-500/30 border border-yellow-400'
                                                : 'hover:bg-white/5'
                                            }`}
                                          >
                                            <span className="text-gray-100 text-sm sm:text-base">{mkt.drawCol[r].label}</span>
                                            <span className="font-mono font-bold text-yellow-300 text-sm sm:text-base">
                                              {formatAmericanOdds(mkt.drawCol[r].odds)}
                                            </span>
                                          </button>
                                        ) : null}
                                      </td>
                                      <td className="px-3 py-1.5 align-middle">
                                        {mkt.awayCol[r] ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              onToggleSelection(match, marketLabel, mkt.awayCol[r].label, mkt.awayCol[r].odds)
                                            }
                                            className={`w-full flex items-center justify-between gap-2 py-1 px-2 rounded transition-all text-left ${
                                              isSelected(marketLabel, mkt.awayCol[r].label)
                                                ? 'bg-yellow-500/30 border border-yellow-400'
                                                : 'hover:bg-white/5'
                                            }`}
                                          >
                                            <span className="text-gray-100 text-sm sm:text-base">{mkt.awayCol[r].label}</span>
                                            <span className="font-mono font-bold text-yellow-300 text-sm sm:text-base">
                                              {formatAmericanOdds(mkt.awayCol[r].odds)}
                                            </span>
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  ))}
                                  {mkt.anyOtherOdds != null && (
                                    <tr className="border-t border-white/10 bg-white/5">
                                      <td colSpan={3} className="px-3 py-2">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onToggleSelection(match, marketLabel, 'Any Other', mkt.anyOtherOdds)
                                          }
                                          className={`w-full flex items-center justify-between gap-2 py-1.5 px-2 rounded transition-all text-left ${
                                            isSelected(marketLabel, 'Any Other')
                                              ? 'bg-yellow-500/30 border border-yellow-400'
                                              : 'hover:bg-white/5'
                                          }`}
                                        >
                                          <span className="text-gray-100 font-medium">Any Other</span>
                                          <span className="font-mono font-bold text-yellow-300 text-sm sm:text-base">
                                            {formatAmericanOdds(mkt.anyOtherOdds)}
                                          </span>
                                        </button>
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    // Only show options that are bettable (not near 0% or 100% certainty)
                    const optionsWithProb = (mkt.options || []).map((opt) => ({
                      ...opt,
                      impliedProb: americanOddsToImpliedProb(opt.odds),
                    }));
                    const bettableOptions = optionsWithProb.filter(
                      (opt) =>
                        opt.impliedProb >= BETTABLE_PROB_MIN &&
                        opt.impliedProb <= BETTABLE_PROB_MAX
                    );
                    if (bettableOptions.length === 0) return null;

                    return (
                      <tr
                        key={`${section.key}-${idx}`}
                        className={idx % 2 === 0 ? 'bg-black/40' : 'bg-black/20'}
                      >
                        <td className="align-top px-3 sm:px-4 py-2.5 border-t border-white/5 w-56">
                          <div className="flex flex-col">
                            <span className="font-medium text-sm text-gray-100">
                              {mkt.label}
                            </span>
                            {mkt.description && (
                              <span className="text-xs text-gray-500">
                                {mkt.description}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="align-top px-3 sm:px-4 py-2.5 border-t border-white/5">
                          <div className="flex flex-wrap gap-1.5">
                            {bettableOptions.map((opt, i) => {
                              const selected = isSelected(marketLabel, opt.label);
                              const p = opt.impliedProb;
                              const styleBand =
                                p >= 55 ? 'favorite' : p <= 45 ? 'underdog' : 'even';
                              const styleClass =
                                styleBand === 'favorite'
                                  ? 'border-emerald-500/50 bg-emerald-500/10 hover:border-emerald-400/70'
                                  : styleBand === 'underdog'
                                    ? 'border-rose-500/40 bg-rose-500/5 hover:border-rose-400/60'
                                    : 'border-white/10 bg-white/5 hover:border-yellow-400/70 hover:bg-yellow-500/10';
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() =>
                                    onToggleSelection(match, marketLabel, opt.label, opt.odds)
                                  }
                                  className={`inline-flex items-center justify-between gap-2 rounded-full border px-3 py-1.5 transition-all ${
                                    selected
                                      ? 'border-yellow-400 bg-yellow-500/30 shadow-[0_0_20px_rgba(250,204,21,0.45)] scale-[0.98]'
                                      : styleClass
                                  }`}
                                >
                                  <span className="text-xs sm:text-sm font-medium text-gray-100 text-left whitespace-normal break-words">
                                    {opt.label}
                                  </span>
                                  <span
                                    className={`text-sm font-bold font-mono ${
                                      styleBand === 'favorite'
                                        ? 'text-emerald-300'
                                        : styleBand === 'underdog'
                                          ? 'text-rose-300'
                                          : 'text-yellow-300'
                                    }`}
                                  >
                                    {formatAmericanOdds(opt.odds)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Bet slip: only appears when you have picks — materializes out of the air */}
      <AnimatePresence mode="wait">
        {betslip.length > 0 && (
          <motion.div
            key="bet-slip"
            initial={{ opacity: 0, scale: 0.6, y: 16, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.88, filter: 'blur(4px)' }}
            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            className="mt-4 w-full max-w-sm lg:mt-0 lg:fixed lg:top-4 lg:right-8 lg:w-80 lg:max-w-xs lg:max-h-[calc(100vh-2rem)] z-[100] scroll-mt-4"
            id="bet-slip-section"
          >
            <motion.div
              initial={{ boxShadow: '0 0 0 0 rgba(34, 211, 238, 0)' }}
              animate={{ boxShadow: '0 0 50px 2px rgba(34, 211, 238, 0.35), 0 0 90px 4px rgba(244, 63, 94, 0.15)' }}
              transition={{ delay: 0.15, duration: 0.4 }}
              className="rounded-2xl"
            >
              <BetSlipCard
                betslip={betslip}
                stake={stake}
                totals={totals}
                onToggleSelection={onToggleSelection}
                onStakeChange={onStakeChange}
                onClearAll={onClearAll}
                onConfirmSlip={handleConfirmSlip}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile: floating pill to jump to bet slip when you have picks */}
      <AnimatePresence>
        {betslip.length > 0 && (
          <motion.button
            key="slip-pill"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            onClick={() => document.getElementById('bet-slip-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="lg:hidden fixed bottom-36 right-4 z-[105] rounded-full bg-gradient-to-br from-cyan-500 to-cyan-700 shadow-[0_4px_20px_rgba(34,211,238,0.5)] border border-cyan-300/50 flex items-center justify-center gap-1.5 px-3 py-2.5 text-white font-black uppercase text-[10px] tracking-wider"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            aria-label="Go to bet slip"
          >
            <TicketPercent className="w-4 h-4 shrink-0" />
            <span>Slip</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function BetSlipCard({ betslip, stake, totals, onToggleSelection, onStakeChange, onClearAll, onConfirmSlip }) {
  const [localStakes, setLocalStakes] = useState({});
  const [winDraft, setWinDraft] = useState({}); // raw Win input while typing to avoid overwriting mid-edit
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    if (!onConfirmSlip || confirming) return;
    setConfirming(true);
    try {
      await onConfirmSlip(betslip, localStakes);
      onClearAll?.();
      setLocalStakes({});
      setWinDraft({});
    } catch (e) {
      console.error('Confirm slip error', e);
    }
    setConfirming(false);
  };

  return (
    <div className="rounded-2xl border border-cyan-400/60 bg-gradient-to-br from-[#020617] via-[#020617] to-[#0f172a] shadow-[0_0_45px_rgba(34,211,238,0.45)] p-3 relative overflow-hidden flex flex-col min-h-0 max-h-[min(calc(100vh-5rem),32rem)] text-xs font-sans">
      <div className="pointer-events-none absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.45),transparent_55%),radial-gradient(circle_at_bottom,_rgba(244,63,94,0.45),transparent_55%)]" />
      <div className="relative flex flex-col min-h-0 flex-1 flex">
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <div className="absolute inset-0 blur-md bg-cyan-400/60 rounded-full" />
              <Coins className="relative w-4 h-4 text-cyan-200 drop-shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-cyan-100 drop-shadow-[0_0_10px_rgba(34,211,238,0.9)]">
                Bet Slip
              </h3>
              <p className="text-[10px] text-cyan-300/80 uppercase tracking-wider">
                Fun only
              </p>
            </div>
          </div>
          {betslip.length > 0 && (
            <span className="text-[10px] font-bold text-fuchsia-300 uppercase tracking-wider bg-fuchsia-500/10 border border-fuchsia-400/40 rounded-full px-1.5 py-0.5">
              {betslip.length} picks
            </span>
          )}
        </div>

        {betslip.length === 0 ? (
          <p className="text-xs text-cyan-100/80">
            Tap any odds on the left to add a selection.
          </p>
        ) : (
          (() => {
            let totalStake = 0;
            let totalWin = 0;

            const renderedSelections = betslip.map((sel) => {
              const riskRaw = localStakes[sel.key] ?? '';
              const riskNum = Number(riskRaw) || 0;
              const { win } = getPayout(riskNum || 0, sel.odds);
              totalStake += riskNum;
              totalWin += win;
              return (
                <div
                  key={sel.key}
                  className="relative rounded-xl border border-cyan-500/40 bg-slate-950/75 px-2 py-1.5 shadow-[0_0_22px_rgba(15,23,42,0.95)]"
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
                    className="absolute -top-0.5 -right-0.5 text-[10px] leading-none text-cyan-200 hover:text-white bg-slate-900/80 border border-cyan-400/60 rounded-full w-4 h-4 flex items-center justify-center p-0"
                  >
                    ×
                  </button>
                  <p className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider mb-0.5 truncate">
                    {sel.market}
                  </p>
                  <p className="text-xs font-semibold text-slate-50 mb-0 line-clamp-1">
                    {sel.matchLabel}
                  </p>
                  <div className="flex items-center justify-between text-xs text-slate-200 mt-0">
                    <span className="truncate mr-1">{sel.selection}</span>
                    <span className="font-semibold text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] shrink-0">
                      {formatAmericanOdds(sel.odds)}
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <div className="flex flex-col gap-0">
                      <span className="text-[10px] font-bold text-cyan-300/80 uppercase tracking-wider">Risk</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={riskRaw}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.]/g, '');
                          setLocalStakes((prev) => ({ ...prev, [sel.key]: v }));
                        }}
                        className="w-full min-w-0 rounded-lg bg-slate-900/80 border border-cyan-500/50 px-2 py-1 text-xs text-cyan-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div className="flex flex-col gap-0">
                      <span className="text-[10px] font-bold text-emerald-300/80 uppercase tracking-wider">Win</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={winDraft[sel.key] ?? (riskNum ? win.toFixed(2) : '')}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.]/g, '');
                          setWinDraft((prev) => ({ ...prev, [sel.key]: v }));
                          const risk = getRiskFromWin(v, sel.odds);
                          setLocalStakes((prev) => ({ ...prev, [sel.key]: v ? String(risk.toFixed(2)) : '' }));
                        }}
                        onBlur={() => setWinDraft((prev) => {
                          const next = { ...prev };
                          delete next[sel.key];
                          return next;
                        })}
                        className="w-full min-w-0 rounded-lg bg-slate-900/80 border border-emerald-400/50 px-2 py-1 text-xs text-emerald-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                      />
                    </div>
                  </div>
                </div>
              );
            });

            return (
              <>
                <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar-thin mb-2">
                  {renderedSelections}
                </div>

                <div className="space-y-1.5 border-t border-cyan-500/40 pt-2 flex-shrink-0">
                  <div className="flex items-center justify-between text-xs text-slate-200">
                    <span>Total amount placed</span>
                    <span className="font-bold text-cyan-200">
                      {totalStake ? totalStake.toFixed(2) : '--'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-200">
                    <span>Total potential win</span>
                    <span className="font-bold text-emerald-300">
                      {totalWin ? totalWin.toFixed(2) : '--'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-200">
                    <span>Total return</span>
                    <span className="font-bold text-emerald-200">
                      {totalStake || totalWin ? (totalStake + totalWin).toFixed(2) : '--'}
                    </span>
                  </div>
                  <motion.button
                    type="button"
                    onClick={() => { onClearAll?.(); setLocalStakes({}); setWinDraft({}); }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full mt-0.5 py-1.5 rounded-lg border border-red-400/60 bg-red-500/10 text-red-300 text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1 hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear selection
                  </motion.button>
                  <motion.button
                    onClick={handleConfirm}
                    disabled={confirming}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full mt-0.5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-emerald-400 text-black text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1 shadow-[0_0_26px_rgba(6,182,212,0.75)] disabled:opacity-70"
                    type="button"
                  >
                    {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Percent className="w-3 h-3" />}
                    {confirming ? 'Placing…' : 'Confirm Slip'}
                  </motion.button>
                  <p className="text-[10px] text-cyan-200/80 leading-snug">
                    For entertainment only. No real bets.
                  </p>
                </div>
              </>
            );
          })()
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

