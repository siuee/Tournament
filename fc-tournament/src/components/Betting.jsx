import { useEffect, useLayoutEffect, useState, useMemo, useRef } from 'react';
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
import { collection, getDocs, getDoc, doc, setDoc, updateDoc, addDoc, increment, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { formatMatchHistoryTeam, formatMatchDateTime, matchTeamToMatch } from '../lib/utils';
import { formatCountShort } from '../lib/utils';
import { ProbabilityPanel, FormPanel } from './BettingExtras';
import { H2HPanel } from './BettingH2H';
import {
  ExpandableChat,
  ExpandableChatBody,
  useExpandableChat,
} from './ui/expandable-chat';
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
      const matchNumber = idx + 1; // league-relative match number (1,2,3...) within this tournament
      const id = `${makeTeamId(home, i)}-vs-${makeTeamId(away, j)}-${idx}`;
      const homeShort = teamLabel(home);
      const awayShort = teamLabel(away);
      fixtures.push({
        id,
        matchNumber,
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

/** Ordered pairings (home, away) in same order as generateLeagueFixtures: (0,1), (0,2), (1,2), ... */
function getLeaguePairings(tournament) {
  const teams = tournament.teams || [];
  const pairings = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      pairings.push({ home: teams[i], away: teams[j], homeIdx: i, awayIdx: j });
    }
  }
  return pairings;
}

/**
 * Upcoming fixtures for a tournament: next N fixtures by match number (round-robin cycle).
 * Once a fixture's score is posted, it drops off and the next pairing in cycle appears.
 * Respects tournament duration: no fixtures after endDate (createdAt + durationDays).
 */
function getUpcomingFixtures(tournament, playedMatches, selectedDate, maxFixtures = 30) {
  const pairings = getLeaguePairings(tournament);
  if (pairings.length === 0) return [];

  const playedForT = Array.isArray(playedMatches)
    ? playedMatches.filter((m) => m.tournamentId === tournament.id)
    : [];
  let nextMatchNumber = 1;
  playedForT.forEach((m) => {
    const n = Number(m.matchNumber);
    if (!Number.isNaN(n) && n >= nextMatchNumber) nextMatchNumber = n + 1;
  });

  const durationDays = Number(tournament.durationDays);
  const createdAtRaw = tournament.createdAt;
  const createdAt = createdAtRaw?.toDate ? createdAtRaw.toDate() : createdAtRaw ? new Date(createdAtRaw) : null;
  if (createdAt && !Number.isNaN(createdAt.getTime()) && durationDays > 0) {
    const endDate = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
    endDate.setDate(endDate.getDate() + durationDays);
    const selDay = selectedDate instanceof Date ? selectedDate : new Date(selectedDate);
    const selNorm = new Date(selDay.getFullYear(), selDay.getMonth(), selDay.getDate());
    if (selNorm.getTime() > endDate.getTime()) return [];
  }

  const baseDate = selectedDate instanceof Date ? selectedDate : new Date();
  const base =
    new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      12,
      0,
      0,
      0,
    ).getTime() + 1000 * 60 * 30;
  const fixtures = [];
  for (let k = 0; k < maxFixtures; k++) {
    const matchNum = nextMatchNumber + k;
    const pairingIndex = (matchNum - 1) % pairings.length;
    const { home, away } = pairings[pairingIndex];
    const homeShort = teamLabel(home);
    const awayShort = teamLabel(away);
    const id = `${makeTeamId(home, pairings[pairingIndex].homeIdx)}-vs-${makeTeamId(away, pairings[pairingIndex].awayIdx)}-${matchNum}`;
    const kickoff = new Date(base + k * 1000 * 60 * 45);
    fixtures.push({
      id,
      matchNumber: matchNum,
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

/**
 * Ray Hudson–style preview: hyperbolic, poetic, art-infused, with 5+ sentences per fixture.
 * Uses form, probabilities, 1v1 player names, and fixture hype. Each fixture gets a unique
 * combination via deterministic hash from fixtureSeed + team names.
 */
function generateCommentatorPreview({
  homeName,
  awayName,
  homeForm = '',
  awayForm = '',
  homeProb = null,
  drawProb = null,
  awayProb = null,
  is1v1 = false,
  homePlayersLine = '',
  awayPlayersLine = '',
  isFinished = false,
  viewCount = 0,
  betCount = 0,
  fixtureSeed = '',
}) {
  const base = `${fixtureSeed}-${homeName}-${awayName}`;
  const hash = (s) => {
    let h = 0;
    for (let i = 0; i < (s || '').length; i++) h = ((h << 5) - h) + (s || '').charCodeAt(i) | 0;
    return Math.abs(h);
  };
  const pick = (arr, salt = '') => arr[hash(base + salt) % (arr.length || 1)];
  const pickN = (arr, n, salt) => {
    const out = [];
    const len = arr.length;
    if (len === 0 || n <= 0) return out;
    for (let i = 0; i < n; i++) {
      out.push(arr[(hash(base + salt + i) + i * 7) % len]);
    }
    return [...new Set(out)];
  };

  const hasForm = (f) => typeof f === 'string' && f.length > 0;
  const homeW = (homeForm.match(/W/g) || []).length;
  const awayW = (awayForm.match(/W/g) || []).length;
  const homeL = (homeForm.match(/L/g) || []).length;
  const awayL = (awayForm.match(/L/g) || []).length;
  const homeOnFire = hasForm(homeForm) && homeW >= 3 && homeL === 0;
  const awayOnFire = hasForm(awayForm) && awayW >= 3 && awayL === 0;
  const homeStruggling = hasForm(homeForm) && homeL >= 2 && homeW <= 1;
  const awayStruggling = hasForm(awayForm) && awayL >= 2 && awayW <= 1;
  const favourite = homeProb != null && awayProb != null
    ? (homeProb >= awayProb + 15 ? 'home' : awayProb >= homeProb + 15 ? 'away' : null)
    : null;
  const drawHeavy = drawProb != null && drawProb >= 32;
  const bigOccasion = viewCount >= 30 || betCount >= 15;

  const lines = [];

  // Opening – Ray Hudson drama
  const openings = [
    `Ohhh, what a fixture we have here! ${homeName} and ${awayName} — the stage is set for something magisterial!`,
    `Ladies and gentlemen, strap in! When ${homeName} meet ${awayName}, it's poetry in motion waiting to happen.`,
    `The theatre of Minions FC is calling! ${homeName} versus ${awayName} — this is the kind of football that makes your soul sing.`,
    `Here we go! ${homeName} and ${awayName} — two sides ready to paint this pitch with their artistry.`,
    `What a collision we have in store! ${homeName} against ${awayName} — this is football at its most delicious.`,
  ];
  lines.push(pick(openings, 'op'));

  // Form/stats – Ray Hudson on momentum
  if (homeOnFire && !awayOnFire) {
    const fire = [
      `${homeName} arrive in red-hot form — ${homeForm} — and they're onto it like Dracula with a plate of liver!`,
      `Form? ${homeName} have got it in spades: ${homeForm}. The momentum is absolutely delicious.`,
      `Look at ${homeName}: ${homeForm}. They're flying in with the coolness of a Greyhound's nose!`,
    ];
    lines.push(pick(fire, 'hf'));
  } else if (awayOnFire && !homeOnFire) {
    const fire = [
      `${awayName} are on fire — ${awayForm} — and they'll fear no one. Pure poetry!`,
      `It's ${awayName} with the form: ${awayForm}. A terabyte of skill waiting to explode!`,
      `${awayName} arrive in blistering form: ${awayForm}. ${homeName} must be ready for the maestro.`,
    ];
    lines.push(pick(fire, 'af'));
  } else if (homeStruggling && awayStruggling) {
    lines.push(pick([
      "Two sides searching for a spark. Something has to give — and when it does, it'll be magisterial!",
      'Neither has had it easy of late. A chance for one to turn the tide and write their own legend.',
    ], 'both'));
  } else if (homeStruggling) {
    lines.push(pick([
      `${homeName} will look to turn the tide after a difficult run. The character test awaits — and character is what separates the greats.`,
      `${homeName} need a result here. When the chips are down, that's when the artists emerge.`,
    ], 'hs'));
  } else if (awayStruggling) {
    lines.push(pick([
      `${awayName} will be desperate to stop the rot. Desperation can breed genius on the pitch!`,
      `${awayName} need to find their spark again. This is the stage. The stage where legends are made.`,
    ], 'as'));
  } else if (hasForm(homeForm) || hasForm(awayForm)) {
    lines.push(pick([
      `Form tells a story: ${homeForm} for ${homeName}, ${awayForm} for ${awayName}. Two narratives about to collide.`,
      `Recent form: ${homeName} ${homeForm || '—'} ${awayName} ${awayForm || '—'}. The stage is set for the artists to shine.`,
    ], 'form'));

  }

  // 1v1 duel – Ray Hudson on individual battles
  if (is1v1 && homePlayersLine && awayPlayersLine) {
    const duel = [
      `One on one. No hiding. ${homePlayersLine} versus ${awayPlayersLine} — man against man, like a ballet dancer against a bull!`,
      `A duel for the ages: ${homePlayersLine} against ${awayPlayersLine}. The maestro meets the magician. This is personal!`,
      `When ${homePlayersLine} meets ${awayPlayersLine}, it's not just a match — it's a statement. Two artists with a football at their feet.`,
    ];
    lines.push(pick(duel, 'duel'));
  }

  // Probability / odds – Ray Hudson flair
  if (favourite === 'home' && homeProb != null) {
    lines.push(pick([
      `The numbers favour ${homeName} — but the pitch writes its own script. Football, like a Picasso, loves to surprise.`,
      `All the stats point one way. But football, the beautiful game, loves an underdog. It's what makes it sublime!`,
    ], 'fav'));
  } else if (favourite === 'away' && awayProb != null) {
    lines.push(pick([
      `The book says ${awayName}. The game says: we shall see. And that's the beauty of it!`,
      `Form and probability lean towards ${awayName}. But nothing is given. Nothing! This is football, not maths.`,
    ], 'fav'));
  } else if (favourite === null && (homeProb != null || drawProb != null)) {
    lines.push(pick([
      'Too close to call. The finest of margins. A single moment of genius could decide everything — magisterial!',
      "Nothing in it. Nothing! A single moment could decide everything. That's the poetry of the game.",
      'Evenly matched. This one could go any which way. Like a Mozart symphony — unpredictable, breathtaking.',
    ], 'even'));
  }

  if (drawHeavy) {
    lines.push(pick([
      'The draw lurks in every shadow of this one. A share of the spoils would surprise no one — and sometimes a draw is a work of art.',
      'A share of the spoils would surprise no one. Two sides cancelling each other out in the most beautiful way.',
    ], 'draw'));
  }

  // Ray Hudson signature – artistry, hyperbole
  const artistry = [
    'The stage is set for moments of pure genius. The kind that make you stand up and applaud.',
    'This is football as art. The pitch is the canvas, the ball is the brush. Expect the sublime.',
    "When the beautiful game meets the beautiful game, anything can happen. That's the magic.",
    'We could see moments of magic here. The kind that belong in a museum — or a highlight reel forever.',
    'Like watching a Picasso painting come to life. Every touch, every pass — a stroke of genius.',
  ];
  lines.push(...pickN(artistry, 2, 'art'));

  if (bigOccasion) {
    lines.push(pick([
      'The eyes of Minions FC are upon this one. A fixture that has captured the imagination. Magnificent!',
      "This is the one everyone's been talking about. The build-up has been delicious — now for the main course.",
    ], 'big'));
  }

  // Closing – Ray Hudson crescendo
  const closings = [
    'The pitch will decide. Ninety minutes to write the story. Let the artists paint!',
    'Expect drama. Expect genius. This is why we watch. This is football!',
    'Let the game begin. And may the best artist win. Magisterial!',
    'Ninety minutes to write the story. The kind of story that gets told for years. Here we go!',
  ];
  if (!isFinished) lines.push(pick(closings, 'close'));

  // Ensure at least 5 sentences – pad with more Ray Hudson flair if needed
  const extra = [
    `${homeName} and ${awayName} — two sides ready to paint this pitch with moments of pure genius.`,
    'This is the beautiful game at its finest. Expect the unexpected. Expect the sublime.',
    'When talent meets talent, magic happens. That is the promise of this fixture.',
    'The kind of fixture that separates the good from the great. Magisterial!',
    'Football as art. The pitch as canvas. Let the artists show us what they have.',
  ];
  const seen = new Set(lines);
  for (let i = 0; lines.length < 5 && i < extra.length * 2; i++) {
    const s = extra[hash(base + 'pad' + i) % extra.length];
    if (!seen.has(s)) {
      seen.add(s);
      lines.push(s);
    }
  }

  return lines.slice(0, 8);
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
const BETTING_VIEWED_KEY = 'minions-betting-viewed-';

// Persist detail view + inner tab so refresh keeps user on the same match + tab (localStorage = survives refresh)
const BETTING_DETAIL_STATE_KEY = 'minions-betting-detail-state-v2';

function getBettingDetailStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(BETTING_DETAIL_STATE_KEY) || sessionStorage.getItem(BETTING_DETAIL_STATE_KEY);
  } catch {
    return null;
  }
}
function setBettingDetailStorage(val) {
  if (typeof window === 'undefined') return;
  try {
    if (val) {
      localStorage.setItem(BETTING_DETAIL_STATE_KEY, val);
      sessionStorage.setItem(BETTING_DETAIL_STATE_KEY, val);
    } else {
      localStorage.removeItem(BETTING_DETAIL_STATE_KEY);
      sessionStorage.removeItem(BETTING_DETAIL_STATE_KEY);
    }
  } catch {}
}

// Persist selected date on betting landing page
const BETTING_SELECTED_DATE_KEY = 'minions-betting-selected-date-v1';

function getFixtureId(match) {
  if (match?.id) return String(match.id);
  const t = match?.kickoff ? new Date(match.kickoff).getTime() : 0;
  return `${slug(match?.home || 'home')}-vs-${slug(match?.away || 'away')}-${t}`;
}

/** Build the same fixture id that getUpcomingFixtures would assign for this played match (for finishedFixtureIds). */
function getFixtureIdFromPlayedMatch(playedMatch, tournament) {
  if (!playedMatch?.tournamentId || !tournament?.id || playedMatch.tournamentId !== tournament.id) return null;
  const pairings = getLeaguePairings(tournament);
  if (pairings.length === 0) return null;
  const matchNum = Number(playedMatch.matchNumber);
  if (Number.isNaN(matchNum)) return null;
  const pairingIndex = (matchNum - 1) % pairings.length;
  const { home, away, homeIdx, awayIdx } = pairings[pairingIndex];
  return `${makeTeamId(home, homeIdx)}-vs-${makeTeamId(away, awayIdx)}-${matchNum}`;
}

/** Find a played match from Firestore (MatchDay results) that matches this betting fixture (same tournament + same home/away teams + same match number when present). */
function findPlayedMatchForFixture(fixture, tournament, playedMatches) {
  if (!fixture?.homeTeamObj || !fixture?.awayTeamObj || !tournament?.id || !Array.isArray(playedMatches)) return null;
  return playedMatches.find(
    (m) => {
      if (m.tournamentId !== tournament.id) return false;
      if (!matchTeamToMatch(fixture.homeTeamObj, m, 'home') || !matchTeamToMatch(fixture.awayTeamObj, m, 'away')) return false;
      if (fixture.matchNumber != null && m.matchNumber != null) return Number(m.matchNumber) === Number(fixture.matchNumber);
      return true;
    }
  ) || null;
}

/** Normalize string for comparison (trim, lower). */
function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

/** Evaluate a single selection against full-time result. Returns 'won' | 'lost' | 'push'. */
function evaluateSelection(market, selection, homeScore, awayScore, homeName, awayName) {
  const h = Number(homeScore);
  const a = Number(awayScore);
  const total = h + a;
  const homeWins = h > a;
  const awayWins = a > h;
  const draw = h === a;
  const sel = norm(selection);
  const home = norm(homeName);
  const away = norm(awayName);

  const marketLower = norm(market);

  // Match Winner (3-Way / 1X2)
  if (marketLower.includes('match winner') || marketLower.includes('1x2')) {
    if (homeWins && (sel === home || selection === homeName)) return 'won';
    if (awayWins && (sel === away || selection === awayName)) return 'won';
    if (draw && (sel === 'draw' || selection === 'Draw')) return 'won';
    return 'lost';
  }

  // Draw No Bet
  if (marketLower.includes('draw no bet')) {
    if (draw) return 'push';
    if (homeWins && (sel === home || selection === homeName)) return 'won';
    if (awayWins && (sel === away || selection === awayName)) return 'won';
    return 'lost';
  }

  // Double Chance
  if (marketLower.includes('double chance')) {
    const homeOrDraw = `${homeName} or Draw`.trim().toLowerCase();
    const awayOrDraw = `${awayName} or Draw`.trim().toLowerCase();
    const homeOrAway = `${homeName} or ${awayName}`.trim().toLowerCase();
    if (sel === homeOrDraw && (homeWins || draw)) return 'won';
    if (sel === awayOrDraw && (awayWins || draw)) return 'won';
    if (sel === homeOrAway && !draw) return 'won';
    return 'lost';
  }

  // BTTS
  if (marketLower.includes('both') && (marketLower.includes('score') || marketLower.includes('btts'))) {
    const bothScored = h > 0 && a > 0;
    if ((sel === 'yes' || selection === 'Yes') && bothScored) return 'won';
    if ((sel === 'no' || selection === 'No') && !bothScored) return 'won';
    return 'lost';
  }

  // Total Goals - Over/Under X.X
  if (marketLower.includes('over/under') || (marketLower.includes('total goals') && marketLower.includes('over'))) {
    const match = selection.match(/over\s*(\d+(?:\.\d+)?)/i) || selection.match(/(\d+(?:\.\d+)?)\s*over/i);
    const line = match ? parseFloat(match[1]) : null;
    if (line != null) {
      if (total > line) return (sel.includes('over') || selection.startsWith('Over')) ? 'won' : 'lost';
      if (total < line) return (sel.includes('under') || selection.startsWith('Under')) ? 'won' : 'lost';
      return 'push';
    }
    // Fallback: "Over 2.5" / "Under 2.5" from label
    const overMatch = selection.match(/over\s*(\d+\.?\d*)/i);
    const underMatch = selection.match(/under\s*(\d+\.?\d*)/i);
    if (overMatch) {
      const lineVal = parseFloat(overMatch[1]);
      if (total > lineVal) return 'won';
      if (total < lineVal) return 'lost';
      return 'push';
    }
    if (underMatch) {
      const lineVal = parseFloat(underMatch[1]);
      if (total < lineVal) return 'won';
      if (total > lineVal) return 'lost';
      return 'push';
    }
    return 'lost';
  }

  // Correct Score (Full Time)
  if (marketLower.includes('correct score')) {
    const parts = selection.split(/\s*[-–]\s*/);
    if (parts.length >= 2) {
      const sh = parseInt(parts[0], 10);
      const sa = parseInt(parts[1], 10);
      if (Number.isFinite(sh) && Number.isFinite(sa) && sh === h && sa === a) return 'won';
    }
    return 'lost';
  }

  // Total Goals - Odd/Even
  if (marketLower.includes('odd') && marketLower.includes('even')) {
    const isOdd = total % 2 === 1;
    if ((sel === 'odd' || selection === 'Odd') && isOdd) return 'won';
    if ((sel === 'even' || selection === 'Even') && !isOdd) return 'won';
    return 'lost';
  }

  // Exact Number of Goals
  if (marketLower.includes('exact number of goals')) {
    const num = parseInt(selection.trim(), 10);
    if (selection.trim() === '5+') return total >= 5 ? 'won' : 'lost';
    if (Number.isFinite(num) && total === num) return 'won';
    return 'lost';
  }

  // Method of Victory (Normal Time only for league)
  if (marketLower.includes('method of victory')) {
    if (draw) return 'lost';
    if ((sel.includes(home) || selection.includes(homeName)) && selection.toLowerCase().includes('normal time') && homeWins) return 'won';
    if ((sel.includes(away) || selection.includes(awayName)) && selection.toLowerCase().includes('normal time') && awayWins) return 'won';
    return 'lost';
  }

  // Extra Time / Penalties (league = no)
  if (marketLower.includes('extra time') || marketLower.includes('penalties')) {
    const isYes = sel === 'yes' || selection === 'Yes';
    return isYes ? 'lost' : 'won';
  }

  // Asian Handicap: "Team -0.5" means team must win; "+0.5" means draw or win. We only have full-time result.
  if (marketLower.includes('asian handicap')) {
    const homeMinus = selection.trim().startsWith(homeName) && selection.includes('-0.5');
    const awayPlus = selection.trim().startsWith(awayName) && selection.includes('+0.5');
    const homePlus = selection.trim().startsWith(homeName) && selection.includes('+0.5');
    const awayMinus = selection.trim().startsWith(awayName) && selection.includes('-0.5');
    if (homeMinus) return homeWins ? 'won' : 'lost';
    if (awayPlus) return awayWins || draw ? 'won' : 'lost';
    if (awayMinus) return awayWins ? 'won' : 'lost';
    if (homePlus) return homeWins || draw ? 'won' : 'lost';
    // -1.5 / +1.5 etc.
    const homeHandicap = selection.includes(homeName) && selection.match(/-(\d+\.?\d*)/);
    const awayHandicap = selection.includes(awayName) && selection.match(/\+(\d+\.?\d*)/);
    if (homeHandicap) {
      const line = parseFloat(homeHandicap[1]);
      return (h - a) > line ? 'won' : 'lost';
    }
    if (awayHandicap) {
      const line = parseFloat(awayHandicap[1]);
      return (a - h) > line ? 'won' : 'lost';
    }
    return 'lost';
  }

  // Exact Winning Margin
  if (marketLower.includes('winning margin')) {
    if (draw) return 'lost';
    const margin = Math.abs(h - a);
    if (selection.includes('exactly 1') && margin === 1) {
      return (homeWins && selection.includes(homeName)) || (awayWins && selection.includes(awayName)) ? 'won' : 'lost';
    }
    if (selection.includes('exactly 2') && margin === 2) {
      return (homeWins && selection.includes(homeName)) || (awayWins && selection.includes(awayName)) ? 'won' : 'lost';
    }
    if (selection.includes('3+') && margin >= 3) {
      return (homeWins && selection.includes(homeName)) || (awayWins && selection.includes(awayName)) ? 'won' : 'lost';
    }
    return 'lost';
  }

  // Half-time / First half / Second half: we don't have HT result in match doc → treat as lost (unknown)
  if (marketLower.includes('half') || marketLower.includes('first half') || marketLower.includes('second half')) {
    return 'lost';
  }

  // First scorer / player props: no scorer data in result → lost
  if (marketLower.includes('first') && (marketLower.includes('score') || marketLower.includes('scorer'))) {
    return 'lost';
  }

  // Default: compare selection to result (e.g. team name = winner)
  if (homeWins && (sel === home || selection === homeName)) return 'won';
  if (awayWins && (sel === away || selection === awayName)) return 'won';
  if (draw && (sel === 'draw' || selection === 'Draw')) return 'won';
  return 'lost';
}

/** Evaluate a full bet (all selections must win for bet to win; any push = stake back for that leg, treat as won for that leg). Returns { won, winningAmount }. */
function evaluateBet(selections, result, homeName, awayName) {
  const homeScore = Number(result?.homeScore) ?? 0;
  const awayScore = Number(result?.awayScore) ?? 0;
  if (!Array.isArray(selections) || selections.length === 0) {
    return { won: false, winningAmount: 0 };
  }
  let allWonOrPush = true;
  let totalWin = 0;
  for (const sel of selections) {
    const outcome = evaluateSelection(
      sel.market,
      sel.selection,
      homeScore,
      awayScore,
      homeName,
      awayName
    );
    if (outcome === 'lost') {
      allWonOrPush = false;
      break;
    }
    if (outcome === 'won') totalWin += Number(sel.win) || 0;
    if (outcome === 'push') totalWin += Number(sel.risk) || 0; // stake returned
  }
  const totalStake = selections.reduce((sum, s) => sum + (Number(s.risk) || 0), 0);
  if (!allWonOrPush) return { won: false, winningAmount: 0 };
  return { won: true, winningAmount: totalWin };
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
      logo: '/assets/leagues/ucl.jpg',
      short: 'UCL',
      display: 'eChampions League',
    };
  }

  if (lower.includes('laliga') || lower.includes('la liga')) {
    return {
      logo: '/assets/leagues/laliga.svg',
      short: 'LaLiga',
      display: 'eLaLiga',
    };
  }

  if (lower.includes('premier')) {
    return {
      logo: '/assets/leagues/pl.svg',
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
        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
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
  // Default to today; restore last selected date from sessionStorage when on fixtures list (no fixture open)
  const [selectedDate, setSelectedDate] = useState(() => {
    try {
      if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
        const stored = sessionStorage.getItem(BETTING_SELECTED_DATE_KEY);
        if (stored) {
          const parsed = new Date(stored);
          if (!Number.isNaN(parsed.getTime())) {
            parsed.setHours(0, 0, 0, 0);
            return parsed;
          }
        }
      }
    } catch {}
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
  const [playedMatches, setPlayedMatches] = useState([]);

  // Subscribe to played matches from Firestore (MatchDay results) so new results appear without refresh
  useEffect(() => {
    const q = query(
      collection(db, 'matches'),
      orderBy('createdAt', 'desc'),
      limit(300)
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPlayedMatches(list);
      },
      (e) => {
        console.error('Failed to load played matches for betting:', e);
        setPlayedMatches([]);
      }
    );
    return () => unsubscribe();
  }, []);

  // Set of fixture IDs that have a final result (from MatchDay) so we lock betting for them
  const finishedFixtureIds = useMemo(() => {
    const set = new Set();
    if (!Array.isArray(playedMatches) || playedMatches.length === 0) return set;
    playedMatches.forEach((pm) => {
      const t = tournaments.find((x) => x.id === pm.tournamentId);
      if (!t) return;
      const fid = getFixtureIdFromPlayedMatch(pm, t);
      if (fid) set.add(fid);
    });
    return set;
  }, [tournaments, playedMatches]);

  // Matches whose result was published on the selected date (for "results" view below calendar)
  const playedMatchesOnSelectedDate = useMemo(() => {
    if (!selectedDate || !Array.isArray(playedMatches)) return [];
    const sel = new Date(selectedDate);
    sel.setHours(0, 0, 0, 0);
    const selTime = sel.getTime();
    return playedMatches.filter((m) => {
      const raw = m.createdAt;
      const d = raw?.toDate ? raw.toDate() : (raw ? new Date(raw) : null);
      if (!d || Number.isNaN(d.getTime())) return false;
      const matchDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      return matchDay.getTime() === selTime;
    });
  }, [selectedDate, playedMatches]);

  const matchesByTournamentOnSelectedDate = useMemo(() => {
    const map = {};
    playedMatchesOnSelectedDate.forEach((m) => {
      const tid = m.tournamentId;
      if (!tid) return;
      if (!map[tid]) map[tid] = [];
      map[tid].push(m);
    });
    return map;
  }, [playedMatchesOnSelectedDate]);

  const hasResultsOnSelectedDate = playedMatchesOnSelectedDate.length > 0;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const isSelectedDateToday = selectedDate && today && (
    selectedDate.getFullYear() === today.getFullYear() &&
    selectedDate.getMonth() === today.getMonth() &&
    selectedDate.getDate() === today.getDate()
  );

  const hadDetailRef = useRef(false);
  const restoreAttemptedRef = useRef(false);
  // Capture restore payload once on first render so no effect can clear storage before we use it
  const pendingRestorePayloadRef = useRef(null);
  if (pendingRestorePayloadRef.current === null && typeof window !== 'undefined') {
    try {
      const raw = getBettingDetailStorage();
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.matchId && p?.tournamentId) pendingRestorePayloadRef.current = p;
      }
    } catch {}
  }

  const [isRestoring, setIsRestoring] = useState(() => !!pendingRestorePayloadRef.current);

  // Persist match + inner tab + date to localStorage (survives refresh) so we never lose fixture state
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (!detailMatch || !detailTournament) {
        if (hadDetailRef.current) {
          setBettingDetailStorage(null);
        }
        return;
      }
      hadDetailRef.current = true;
      const dateIso = selectedDate instanceof Date ? selectedDate.toISOString().slice(0, 10) : null;
      setBettingDetailStorage(JSON.stringify({
        matchId: detailMatch.id,
        tournamentId: detailTournament.id,
        tab: detailTab,
        selectedDate: dateIso,
      }));
    } catch {}
  }, [detailMatch, detailTournament, detailTab, selectedDate]);

  // Persist selected date whenever it changes so a full page refresh keeps the same day
  useEffect(() => {
    try {
      if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
      if (!(selectedDate instanceof Date)) return;
      const toStore = new Date(selectedDate);
      toStore.setHours(0, 0, 0, 0);
      sessionStorage.setItem(BETTING_SELECTED_DATE_KEY, toStore.toISOString());
    } catch (e) {
      // ignore storage failures
    }
  }, [selectedDate]);

  const handleConfirmSlip = async (slip, localStakes) => {
    if (!slip?.length) return;
    // Reject if any selection is for a finished match (result already entered in MatchDay)
    if (slip.some((sel) => finishedFixtureIds.has(sel.matchId))) return;
    const byMatch = {};
    slip.forEach((sel) => {
      const fid = sel.matchId; // fixture id per match (counted separately per match)
      if (!fid) return;
      if (finishedFixtureIds.has(fid)) return;
      const rawStake = Number(localStakes?.[sel.key]);
      const risk = Number.isFinite(rawStake) ? rawStake : 0;
      // Extra safety: ignore selections that don't meet the $1 minimum per selection.
      if (risk < 1) return;
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

  // When a fixture is opened from the betting home page, navigate to the detail
  // view and record a "view" in Firestore for that fixture.
  const handleOpenMatch = async (match, tournament) => {
    setDetailMatch(match);
    setDetailTournament(tournament);
    const played = findPlayedMatchForFixture(match, tournament, playedMatches);
    setDetailTab(played ? 'bets-placed' : 'preview');
    try {
      const fixtureId = getFixtureId(match);
      const ref = doc(db, BETTING_FIXTURES, fixtureId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, { viewCount: increment(1) });
      } else {
        await setDoc(ref, {
          viewCount: 1,
          betCount: 0,
          totalStaked: 0,
          commentCount: 0,
        });
      }
      // Trigger a refresh so MatchDetailView sees the latest stats.
      setRefreshFixtureStatsTrigger((t) => t + 1);
    } catch (e) {
      console.error('Failed to record betting fixture view:', e);
    }
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
            let region = `${rawType || sourceName || 'Minions FC'} · ${String(t.format || '').toUpperCase()}`.trim();
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

  // Restore fixture + tab from localStorage before paint (useLayoutEffect) so we never flash landing
  useLayoutEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (!tournaments.length) return;
      if (detailMatch) {
        setIsRestoring(false);
        return;
      }
      if (restoreAttemptedRef.current) {
        setIsRestoring(false);
        return;
      }

      const parsed = pendingRestorePayloadRef.current || (() => {
        try {
          const raw = getBettingDetailStorage();
          if (!raw) return null;
          const p = JSON.parse(raw);
          return p?.matchId && p?.tournamentId ? p : null;
        } catch {
          return null;
        }
      })();
      if (!parsed?.matchId || !parsed?.tournamentId) {
        setIsRestoring(false);
        return;
      }

      const tournament = tournaments.find(t => String(t.id) === String(parsed.tournamentId));
      if (!tournament) {
        setIsRestoring(false);
        return;
      }

      let restoreDate = null;
      if (parsed.selectedDate) {
        const parts = String(parsed.selectedDate).split('-').map(Number);
        if (parts.length === 3 && parts.every(Number.isFinite)) {
          restoreDate = new Date(parts[0], parts[1] - 1, parts[2]);
          restoreDate.setHours(0, 0, 0, 0);
        }
      }
      const dateForFixtures = restoreDate && !Number.isNaN(restoreDate.getTime()) ? restoreDate : selectedDate;
      // Fixture list can come from generateLeagueFixtures (calendar date) or getUpcomingFixtures (today);
      // ids differ (idx 0,1,2 vs matchNum 1,2,3), so look in both.
      let match =
        generateLeagueFixtures(tournament, dateForFixtures).find(m => String(m.id) === String(parsed.matchId)) ||
        getUpcomingFixtures(tournament, playedMatches, dateForFixtures).find(m => String(m.id) === String(parsed.matchId));
      if (!match) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        match =
          generateLeagueFixtures(tournament, today).find(m => String(m.id) === String(parsed.matchId)) ||
          getUpcomingFixtures(tournament, playedMatches, today).find(m => String(m.id) === String(parsed.matchId));
      }
      if (!match) {
        setIsRestoring(false);
        return;
      }

      restoreAttemptedRef.current = true;
      if (restoreDate && !Number.isNaN(restoreDate.getTime())) {
        setSelectedDate(restoreDate);
      }
      setDetailTournament(tournament);
      setDetailMatch(match);
      setDetailTab(['preview', 'probability', 'form', 'h2h', 'bet', 'bets-placed'].includes(parsed.tab) ? parsed.tab : 'preview');
      setIsRestoring(false);
    } catch {
      setIsRestoring(false);
    }
  }, [tournaments, selectedDate, detailMatch, playedMatches]);

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

  // Broadcast bet slip count to App so mobile FAB can show the badge
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('bet-slip-count', { detail: betslip.length }));
  }, [betslip.length]);

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
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center justify-between gap-4 mb-2 flex-shrink-0"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
          <motion.div
            animate={{ opacity: [1, 0.85, 1] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            className="p-2 rounded-2xl bg-yellow-500/10 border border-yellow-500/40 shadow-[0_0_24px_rgba(250,204,21,0.35)] shrink-0"
          >
            <TicketPercent className="w-6 h-6 text-yellow-400" />
          </motion.div>
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-yellow-200 to-yellow-500 pr-2">
              Minions Betting Zone
            </h1>
            <p className="text-[11px] text-gray-400 font-medium">
              Fixtures from your tournaments for hype only – no real money, just Minions FC drama.
            </p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-gray-400">
          <Flame className="w-4 h-4 text-yellow-400" />
          <span>Upcoming fixtures · Minions FC</span>
        </div>
      </motion.div>

      {/* Main content: schedule or match detail – flows with page (no inner scrollbar) */}
      <div className="space-y-4 w-full">
        {isRestoring && !detailMatch ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 rounded-3xl border border-white/10 bg-[#050509]/95">
            <Loader2 className="w-10 h-10 text-yellow-500 animate-spin" />
            <p className="text-sm text-gray-400">Restoring your fixture…</p>
          </div>
        ) : detailMatch ? (
          <MatchDetailView
            match={detailMatch}
            tournament={detailTournament}
            isFinished={!!(detailMatch && detailTournament && findPlayedMatchForFixture(detailMatch, detailTournament, playedMatches))}
            result={(() => {
              const played = detailMatch && detailTournament ? findPlayedMatchForFixture(detailMatch, detailTournament, playedMatches) : null;
              return played != null ? { homeScore: played.homeScore, awayScore: played.awayScore } : null;
            })()}
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
            onConfirmSlip={handleConfirmSlip}
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
            {/* Date selector / calendar bar — centered */}
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-2 rounded-3xl border border-white/10 bg-[#050509]/80 px-3 sm:px-4 py-2.5 shadow-[0_0_24px_rgba(0,0,0,0.55)]"
            >
              <div className="flex items-center justify-center gap-3">
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
                  <span>
                    {isSelectedDateToday
                      ? 'Calendar'
                      : selectedDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })}
                  </span>
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

              {showCalendar && (
                <div className="flex justify-center w-full">
                  <div className="w-full max-w-sm mx-auto">
                    <CalendarGrid
                      selectedDate={selectedDate}
                      tournaments={tournaments}
                      playedMatches={playedMatches}
                      onSelectDate={(date) => {
                        const d = new Date(date);
                        d.setHours(0, 0, 0, 0);
                        setSelectedDate(d);
                        setShowCalendar(false);
                      }}
                    />
                  </div>
                </div>
              )}
            </motion.div>

            {/* Today: show upcoming fixtures. Other dates: show results for that day or "no results" */}
            <div className="space-y-4">
              {isSelectedDateToday ? (
                tournaments.length === 0 ? (
                  <div className="rounded-3xl border border-white/10 bg-[#050509]/90 p-8 text-center shadow-[0_0_32px_rgba(0,0,0,0.65)]">
                    <p className="text-white font-semibold mb-2">No tournaments yet</p>
                    <p className="text-gray-400 text-sm">
                      Create a tournament in Match Day, then come back here to see upcoming fixtures.
                    </p>
                  </div>
                ) : (
                  tournaments.map((t) => {
                    const expanded = expandedIds.has(t.id);
                    const upcomingMatches = getUpcomingFixtures(t, playedMatches, selectedDate);
                    const completedToday = (playedMatchesOnSelectedDate || []).filter((m) => m.tournamentId === t.id);
                    const sortedCompletedToday = [...completedToday].sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0));
                    const hasCompletedToday = sortedCompletedToday.length > 0;
                    const hasUpcoming = upcomingMatches.length > 0;
                    const meta = getLeagueMeta(t);

                    return (
                      <motion.section
                        key={t.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, ease: 'easeOut' }}
                        className="rounded-3xl overflow-hidden bg-[#050509]/95 border border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.7)]"
                      >
                        <button
                          onClick={() => toggleTournament(t.id)}
                          className="w-full flex items-center justify-between px-4 sm:px-6 py-3 bg-white/5 hover:bg-white/10 text-white transition-colors"
                        >
                          <div className="flex items-center gap-3 text-left">
                            <div className="w-8 h-8 rounded-full bg-yellow-500/10 border border-yellow-500/40 flex items-center justify-center overflow-hidden shadow-sm">
                              {meta.logo ? (
                                <img src={meta.logo} alt={meta.short} className="w-7 h-7 object-contain" />
                              ) : (
                                <Trophy className="w-4 h-4 text-yellow-400" />
                              )}
                            </div>
                            <h2 className="text-xs sm:text-sm md:text-base font-black tracking-[0.18em] uppercase text-white">
                              {meta.display}
                            </h2>
                          </div>
                          <div className="flex items-center gap-2 text-gray-400 text-xs">
                            <span>
                              {hasCompletedToday && hasUpcoming
                                ? `${sortedCompletedToday.length} result${sortedCompletedToday.length !== 1 ? 's' : ''}, ${upcomingMatches.length} upcoming`
                                : hasCompletedToday
                                  ? `${sortedCompletedToday.length} result${sortedCompletedToday.length !== 1 ? 's' : ''} today`
                                  : hasUpcoming
                                    ? `${upcomingMatches.length} fixtures`
                                    : 'No upcoming'}
                            </span>
                            {expanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </div>
                        </button>
                        {expanded && (hasCompletedToday || hasUpcoming) && (
                          <div className="bg-black/40 divide-y divide-white/5">
                            {sortedCompletedToday.map((playedMatch) => {
                              const homeTeamObj = t.teams?.find((tm) => matchTeamToMatch(tm, playedMatch, 'home')) ?? null;
                              const awayTeamObj = t.teams?.find((tm) => matchTeamToMatch(tm, playedMatch, 'away')) ?? null;
                              const matchForRow = {
                                id: getFixtureIdFromPlayedMatch(playedMatch, t) || playedMatch.id,
                                home: teamLabel(homeTeamObj),
                                away: teamLabel(awayTeamObj),
                                homeTeamObj,
                                awayTeamObj,
                                kickoff: playedMatch.createdAt?.toDate?.() ?? playedMatch.createdAt ?? selectedDate,
                                matchNumber: playedMatch.matchNumber,
                              };
                              return (
                                <MatchRow
                                  key={playedMatch.id}
                                  match={matchForRow}
                                  finishedMatch={playedMatch}
                                  onOpen={() => handleOpenMatch(matchForRow, t)}
                                />
                              );
                            })}
                            {upcomingMatches.map((m) => (
                              <MatchRow
                                key={m.id}
                                match={m}
                                finishedMatch={findPlayedMatchForFixture(m, t, playedMatches)}
                                onOpen={() => handleOpenMatch(m, t)}
                              />
                            ))}
                          </div>
                        )}
                        {expanded && !hasCompletedToday && !hasUpcoming && (
                          <div className="bg-black/40 px-4 py-6 text-center text-gray-500 text-sm">
                            No results posted today and no upcoming fixtures. League may have ended or no matches scheduled yet.
                          </div>
                        )}
                      </motion.section>
                    );
                  })
                )
              ) : hasResultsOnSelectedDate ? (
                Object.keys(matchesByTournamentOnSelectedDate).map((tournamentId) => {
                  const t = tournaments.find((x) => x.id === tournamentId);
                  if (!t) return null;
                  const leagueMatches = matchesByTournamentOnSelectedDate[tournamentId];
                  if (!leagueMatches || leagueMatches.length === 0) return null;
                  const meta = getLeagueMeta(t);
                  const fixtures = generateLeagueFixtures(t, selectedDate);
                  const sortedMatches = [...leagueMatches].sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0));

                  return (
                    <motion.section
                      key={t.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-3xl overflow-hidden bg-[#050509]/95 border border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.7)]"
                    >
                      <div className="w-full flex items-center justify-between px-4 sm:px-6 py-3 bg-white/5 text-white">
                        <div className="flex items-center gap-3 text-left">
                          <div className="w-8 h-8 rounded-full bg-yellow-500/10 border border-yellow-500/40 flex items-center justify-center overflow-hidden shadow-sm">
                            {meta.logo ? (
                              <img src={meta.logo} alt={meta.short} className="w-7 h-7 object-contain" />
                            ) : (
                              <Trophy className="w-4 h-4 text-yellow-400" />
                            )}
                          </div>
                          <h2 className="text-xs sm:text-sm md:text-base font-black tracking-[0.18em] uppercase text-white">
                            {meta.display}
                          </h2>
                        </div>
                        <span className="text-gray-400 text-xs">
                          {leagueMatches.length} {leagueMatches.length === 1 ? 'match' : 'matches'}
                        </span>
                      </div>
                      <div className="bg-black/40 divide-y divide-white/5">
                        {sortedMatches.map((playedMatch) => {
                          const homeTeamObj = t.teams?.find((tm) => matchTeamToMatch(tm, playedMatch, 'home')) ?? null;
                          const awayTeamObj = t.teams?.find((tm) => matchTeamToMatch(tm, playedMatch, 'away')) ?? null;
                          const fixture = fixtures.find(
                            (f) =>
                              matchTeamToMatch(f.homeTeamObj, playedMatch, 'home') &&
                              matchTeamToMatch(f.awayTeamObj, playedMatch, 'away')
                          );
                          const matchForRow = fixture ?? {
                            id: playedMatch.id,
                            home: teamLabel(homeTeamObj),
                            away: teamLabel(awayTeamObj),
                            homeTeamObj,
                            awayTeamObj,
                            kickoff: playedMatch.createdAt?.toDate?.() ?? playedMatch.createdAt ?? selectedDate,
                            matchNumber: playedMatch.matchNumber,
                          };
                          return (
                            <MatchRow
                              key={playedMatch.id}
                              match={matchForRow}
                              finishedMatch={playedMatch}
                              onOpen={() => handleOpenMatch(matchForRow, t)}
                            />
                          );
                        })}
                      </div>
                    </motion.section>
                  );
                })
              ) : tournaments.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-[#050509]/90 p-8 text-center shadow-[0_0_32px_rgba(0,0,0,0.65)]">
                  <p className="text-white font-semibold mb-2">No tournaments yet</p>
                  <p className="text-gray-400 text-sm">
                    Create a tournament in Match Day, then come back here to see results.
                  </p>
                </div>
              ) : (
                <div className="rounded-3xl border border-white/10 bg-[#050509]/90 p-8 text-center shadow-[0_0_32px_rgba(0,0,0,0.65)]">
                  <p className="text-white font-semibold mb-2">No results for this day</p>
                  <p className="text-gray-400 text-sm">
                    Select a date with a • on the calendar to see matches and final scores from that day.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MatchRow({ match, finishedMatch, onOpen }) {
  const homePlayersArr = match.homeTeamObj?.playerData || [];
  const awayPlayersArr = match.awayTeamObj?.playerData || [];
  const isFinished = finishedMatch != null;
  const homeScore = isFinished ? Number(finishedMatch.homeScore) : null;
  const awayScore = isFinished ? Number(finishedMatch.awayScore) : null;
  const scoreLabel =
    isFinished && Number.isFinite(homeScore) && Number.isFinite(awayScore)
      ? `${homeScore} – ${awayScore}`
      : null;

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
      {typeof match.matchNumber === 'number' && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-yellow-500/90 mr-2 shrink-0">#{match.matchNumber}</span>
      )}
      <span className="flex-1 flex items-center justify-center gap-4 text-center min-w-0">
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
        <span className="text-[11px] uppercase tracking-[0.18em] text-gray-500 flex flex-col items-center gap-0.5">
          {scoreLabel != null ? (
            <>
              <span className="font-bold text-yellow-400 tabular-nums">{scoreLabel}</span>
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400/90">FT</span>
            </>
          ) : (
            'vs'
          )}
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
        {isFinished ? 'Full time' : formatKickoffTime(match.kickoff)}
      </span>
    </button>
  );
}

function MatchDetailView({
  match,
  tournament,
  isFinished = false,
  result = null,
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
  onConfirmSlip,
  refreshFixtureStatsTrigger,
}) {
  const fixtureId = getFixtureId(match);
  const [fixtureStats, setFixtureStats] = useState({ viewCount: 0, betCount: 0, totalStaked: 0, commentCount: 0 });
  const [showCommentPanel, setShowCommentPanel] = useState(false);
  const [betsPlaced, setBetsPlaced] = useState([]);
  const [betsPlacedLoading, setBetsPlacedLoading] = useState(false);
  const [betsPlacedError, setBetsPlacedError] = useState(null);
  const [betsSortKey, setBetsSortKey] = useState('potentialWin'); // 'potentialWin' | 'stake'
  const [betsOutcomeOrder, setBetsOutcomeOrder] = useState('default'); // 'default' | 'won-first' | 'lost-first'

  const sortedBetsPlaced = useMemo(() => {
    if (!Array.isArray(betsPlaced) || betsPlaced.length === 0) return [];
    const sortByKey = (arr) => {
      const out = [...arr];
      out.sort((a, b) => {
        const aStake = Number(a.totalStake) || 0;
        const bStake = Number(b.totalStake) || 0;
        if (betsSortKey === 'stake') {
          if (bStake !== aStake) return bStake - aStake;
          const winA = (Number(a.potentialWin) ?? Number(a.winningAmount)) || 0;
          const winB = (Number(b.potentialWin) ?? Number(b.winningAmount)) || 0;
          return winB - winA;
        }
        const winA = (Number(a.potentialWin) ?? Number(a.winningAmount)) || 0;
        const winB = (Number(b.potentialWin) ?? Number(b.winningAmount)) || 0;
        if (winB !== winA) return winB - winA;
        return bStake - aStake;
      });
      return out;
    };
    if (betsOutcomeOrder === 'default') {
      return sortByKey(betsPlaced);
    }
    const won = betsPlaced.filter((b) => b.finalized && b.won);
    const lost = betsPlaced.filter((b) => b.finalized && !b.won);
    const pending = betsPlaced.filter((b) => !b.finalized);
    const ordered =
      betsOutcomeOrder === 'won-first'
        ? [...sortByKey(won), ...sortByKey(lost), ...sortByKey(pending)]
        : [...sortByKey(lost), ...sortByKey(won), ...sortByKey(pending)];
    return ordered;
  }, [betsPlaced, betsSortKey, betsOutcomeOrder]);

  // Load fixture doc (views, bet count, total staked, comment count).
  // Actual view increments are recorded when a fixture is opened from the betting home page.
  useEffect(() => {
    if (!fixtureId) return;
    let cancelled = false;
    (async () => {
      try {
        const ref = doc(db, BETTING_FIXTURES, fixtureId);
        const snap = await getDoc(ref);
        if (cancelled) return;
        const data = snap.data() || {};

        const viewCount = data.viewCount ?? 0;
        const betCount = data.betCount ?? 0;
        const totalStaked = Number(data.totalStaked ?? 0) || 0;
        const commentCount = data.commentCount ?? 0;

        if (!cancelled) {
          setFixtureStats({
            viewCount,
            betCount,
            totalStaked,
            commentCount,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setFixtureStats({ viewCount: 0, betCount: 0, totalStaked: 0, commentCount: 0 });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [fixtureId, refreshFixtureStatsTrigger]);

  // Load all bets for this fixture; when match is finished, finalize any unfinalized bets (won/lost) and update Firestore.
  useEffect(() => {
    if (!fixtureId) return;
    let cancelled = false;
    const homeName = match?.home || 'Home';
    const awayName = match?.away || 'Away';
    (async () => {
      try {
        setBetsPlacedLoading(true);
        setBetsPlacedError(null);
        const qRef = query(
          collection(db, BETTING_FIXTURES, fixtureId, 'bets'),
          orderBy('createdAt', 'desc'),
        );
        const snap = await getDocs(qRef);
        if (cancelled) return;
        let rows = snap.docs.map((d) => {
          const data = d.data() || {};
          let createdAt = data.createdAt;
          if (createdAt?.toDate) {
            createdAt = createdAt.toDate();
          } else if (typeof createdAt === 'string' || typeof createdAt === 'number') {
            createdAt = new Date(createdAt);
          } else {
            createdAt = null;
          }
          return {
            id: d.id,
            totalStake: Number(data.totalStake) || 0,
            potentialWin: Number(data.potentialWin) || 0,
            selections: Array.isArray(data.selections) ? data.selections : [],
            createdAt,
            finalized: !!data.finalized,
            won: data.won === true,
            winningAmount: Number(data.winningAmount) || 0,
          };
        });

        // If match is finished, evaluate and finalize any bet that isn't yet finalized
        if (isFinished && result != null && Number.isFinite(result.homeScore) && Number.isFinite(result.awayScore)) {
          for (let i = 0; i < snap.docs.length; i++) {
            const d = snap.docs[i];
            const data = d.data() || {};
            if (data.finalized === true) continue;
            const outcome = evaluateBet(rows[i].selections, result, homeName, awayName);
            rows[i] = { ...rows[i], finalized: true, won: outcome.won, winningAmount: outcome.winningAmount };
            try {
              await updateDoc(d.ref, {
                finalized: true,
                won: outcome.won,
                winningAmount: outcome.winningAmount,
              });
            } catch (err) {
              console.error('Failed to finalize bet', d.id, err);
            }
            if (cancelled) return;
          }
        }
        setBetsPlaced(rows);
      } catch (e) {
        if (!cancelled) {
          setBetsPlacedError('Could not load bets placed for this game.');
          setBetsPlaced([]);
        }
      } finally {
        if (!cancelled) setBetsPlacedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fixtureId, refreshFixtureStatsTrigger, isFinished, result, match?.home, match?.away]);

  const kickoff = match.kickoff instanceof Date ? match.kickoff : new Date(match.kickoff);
  const kickoffText = kickoff.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateText = kickoff.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const allTabs = [
    { id: 'preview', label: 'Preview' },
    { id: 'probability', label: 'Probability' },
    { id: 'form', label: 'Form' },
    { id: 'h2h', label: 'Head to Head' },
    { id: 'bet', label: 'Bet' },
    { id: 'bets-placed', label: 'Bets placed' },
  ];
  const tabs = isFinished ? allTabs.filter((t) => t.id !== 'bet') : allTabs;
  const scoreLabel =
    isFinished && result != null && Number.isFinite(result.homeScore) && Number.isFinite(result.awayScore)
      ? `${result.homeScore} – ${result.awayScore}`
      : null;

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

  const commentatorLines = useMemo(
    () =>
      generateCommentatorPreview({
        homeName: match?.home || 'Home',
        awayName: match?.away || 'Away',
        homeForm,
        awayForm,
        homeProb: probabilities?.home ?? null,
        drawProb: probabilities?.draw ?? null,
        awayProb: probabilities?.away ?? null,
        is1v1: is1v1Match,
        homePlayersLine: homePlayersLine || '',
        awayPlayersLine: awayPlayersLine || '',
        isFinished,
        viewCount: fixtureStats?.viewCount ?? 0,
        betCount: fixtureStats?.betCount ?? 0,
        fixtureSeed: fixtureId || '',
      }),
    [
      match?.home,
      match?.away,
      homeForm,
      awayForm,
      probabilities?.home,
      probabilities?.draw,
      probabilities?.away,
      is1v1Match,
      homePlayersLine,
      awayPlayersLine,
      isFinished,
      fixtureStats?.viewCount,
      fixtureStats?.betCount,
      fixtureId,
    ]
  );

  // If match is finished and user was on Bet tab, switch to Bets placed
  useEffect(() => {
    if (isFinished && tab === 'bet') setTab('bets-placed');
  }, [isFinished, tab, setTab]);

  return (
    <div className="space-y-4">
      {/* Match header like FotMob – gradient border */}
      <div className="relative p-[1px] rounded-3xl betting-gradient-border shadow-[0_0_32px_rgba(0,0,0,0.7)]">
        <div className="rounded-3xl bg-[#050509]/95 px-4 sm:px-6 py-4 border border-white/5">
        <div className="flex items-center justify-between gap-3 text-xs text-gray-400 mb-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-[11px] text-gray-300 hover:text-white"
          >
            <ChevronLeft className="w-3 h-3" />
            <span>Back to schedule</span>
          </button>
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3 text-[11px] sm:text-xs text-gray-400">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="w-3.5 h-3.5 text-yellow-400" />
              <span>{dateText} · {kickoffText}</span>
            </span>
            <span className="inline-flex items-center gap-2 mt-0.5 sm:mt-0">
              {isFinished && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/60 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                  Full time
                </span>
              )}
              {typeof match.matchNumber === 'number' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] uppercase tracking-[0.18em] text-gray-200">
                  Match #{match.matchNumber}
                </span>
              )}
              {tournament?.name && (
                <span className="hidden sm:inline text-[11px] text-gray-500">
                  {tournament.name}
                </span>
              )}
            </span>
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
          <span className="text-lg sm:text-2xl font-black text-white flex flex-col items-center gap-0.5">
            {scoreLabel != null ? (
              <>
                <span className="tabular-nums text-yellow-400">{scoreLabel}</span>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400/90">FT</span>
              </>
            ) : (
              kickoffText
            )}
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
      </div>

      {/* Tab content below header */}
      <div className="space-y-3">
        {tab === 'preview' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-4 text-sm sm:text-base"
          >
            <div className="rounded-2xl border border-white/10 bg-[#050509]/95 p-4 text-current text-gray-200">
              {/* Commentator-style preview lines (Drury/Hudson vibe) */}
              {Array.isArray(commentatorLines) && commentatorLines.length > 0 && (
                <div className="mb-4 pb-4 border-b border-white/10">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-amber-400/90 font-semibold mb-2">
                    The build-up
                  </p>
                  {commentatorLines.map((line, i) => (
                    <p
                      key={i}
                      className="text-sm sm:text-base text-gray-200 leading-relaxed italic"
                      style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                    >
                      “{line}”
                    </p>
                  ))}
                </div>
              )}
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
              <p className="text-xs sm:text-sm text-gray-500">
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
          </motion.div>
        )}

        {tab === 'probability' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-2 text-sm sm:text-base"
          >
            {probState?.loading && (
              <div className="rounded-2xl border border-white/10 bg-[#050509]/95 px-4 py-2 text-sm sm:text-base text-gray-300">
                Loading probability from match history…
              </div>
            )}
            <div className="relative p-[1px] rounded-2xl betting-gradient-border">
              <div className="rounded-2xl bg-[#050509]/95 overflow-y-auto overflow-x-hidden max-h-[min(70vh,480px)] no-scrollbar">
                <div className="text-sm sm:text-base p-1">
                  <ProbabilityPanel
                    match={match}
                    probabilities={probabilities}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {tab === 'form' && (
          <div className="text-sm sm:text-base">
            {formState?.loading ? (
              <div className="rounded-2xl border border-white/10 bg-[#050509]/95 p-4 text-sm sm:text-base text-gray-300">
                Loading recent form from Minions FC matches…
              </div>
            ) : (
              <FormPanel
                homeName={match.home}
                awayName={match.away}
                homeForm={homeForm}
                awayForm={awayForm}
                emptyMessage={is1v1Match ? 'No 1v1 matches yet' : 'No 2v2 matches yet'}
              />
            )}
          </div>
        )}

        {tab === 'h2h' && (
          <div className="text-sm sm:text-base">
            <H2HPanel
              match={match}
              state={h2hState}
            />
          </div>
        )}

        {tab === 'bet' && (
          <BetMarketsPanel
            match={match}
            isFinished={isFinished}
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
            onConfirmSlip={onConfirmSlip}
          />
        )}

        {tab === 'bets-placed' && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-[#050509]/95 p-5 text-sm text-gray-200 shadow-[0_0_30px_rgba(15,23,42,0.9)]">
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="relative">
                    <div className="absolute inset-0 blur-md bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-amber-400 rounded-full opacity-70" />
                    <div className="relative h-8 w-8 rounded-full bg-black/80 border border-cyan-400/70 flex items-center justify-center">
                      <TicketPercent className="w-4 h-4 text-cyan-300" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-black text-white uppercase tracking-[0.22em]">
                      Bets placed
                    </h3>
                    <p className="text-[11px] sm:text-xs text-cyan-200/80">
                      Live slip feed for this fixture.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 border border-white/10">
                    <Users className="w-3.5 h-3.5 text-cyan-300" />
                    <span className="uppercase tracking-[0.18em] text-[9px]">
                      {fixtureStats.betCount} bets
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/60">
                    <Coins className="w-3.5 h-3.5 text-emerald-300" />
                    <span className="uppercase tracking-[0.18em] text-[9px]">
                      ${fixtureStats.totalStaked.toLocaleString()}
                    </span>
                  </span>
                  <div className="flex flex-wrap items-center gap-2 ml-1">
                    <span className="hidden sm:inline text-[10px] text-gray-500 uppercase tracking-[0.16em]">
                      Outcome
                    </span>
                    <div className="inline-flex rounded-full bg-white/5 border border-white/10 p-0.5">
                      <button
                        type="button"
                        onClick={() => setBetsOutcomeOrder(betsOutcomeOrder === 'won-first' ? 'default' : 'won-first')}
                        className={`px-2 py-0.5 rounded-full text-[9px] uppercase tracking-[0.18em] ${
                          betsOutcomeOrder === 'won-first'
                            ? 'bg-emerald-500 text-black font-bold'
                            : 'text-gray-300 hover:text-white'
                        }`}
                      >
                        Won first
                      </button>
                      <button
                        type="button"
                        onClick={() => setBetsOutcomeOrder(betsOutcomeOrder === 'lost-first' ? 'default' : 'lost-first')}
                        className={`px-2 py-0.5 rounded-full text-[9px] uppercase tracking-[0.18em] ${
                          betsOutcomeOrder === 'lost-first'
                            ? 'bg-rose-500 text-black font-bold'
                            : 'text-gray-300 hover:text-white'
                        }`}
                      >
                        Lost first
                      </button>
                    </div>
                    <span className="hidden sm:inline text-[10px] text-gray-500 uppercase tracking-[0.16em]">
                      Sort by
                    </span>
                    <div className="inline-flex rounded-full bg-white/5 border border-white/10 p-0.5">
                      <button
                        type="button"
                        onClick={() => setBetsSortKey('potentialWin')}
                        className={`px-2 py-0.5 rounded-full text-[9px] uppercase tracking-[0.18em] ${
                          betsSortKey === 'potentialWin'
                            ? 'bg-emerald-500 text-black font-bold'
                            : 'text-gray-300 hover:text-white'
                        }`}
                      >
                        Win
                      </button>
                      <button
                        type="button"
                        onClick={() => setBetsSortKey('stake')}
                        className={`px-2 py-0.5 rounded-full text-[9px] uppercase tracking-[0.18em] ${
                          betsSortKey === 'stake'
                            ? 'bg-cyan-400 text-black font-bold'
                            : 'text-gray-300 hover:text-white'
                        }`}
                      >
                        Stake
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {betsPlacedLoading && (
                <p className="text-xs text-gray-300">Loading bets…</p>
              )}

              {!betsPlacedLoading && betsPlacedError && (
                <p className="text-xs text-red-400">{betsPlacedError}</p>
              )}

              {!betsPlacedLoading && !betsPlacedError && betsPlaced.length === 0 && (
                <p className="text-xs text-gray-300">
                  No bets have been placed yet for this game. Head to the <span className="font-semibold text-yellow-300">Bet</span> tab to place the first slip.
                </p>
              )}

              {!betsPlacedLoading && !betsPlacedError && betsPlaced.length > 0 && (
                <div className="mt-3 space-y-3">
                  {sortedBetsPlaced.map((bet, index) => {
                    const created =
                      bet.createdAt instanceof Date && !Number.isNaN(bet.createdAt.getTime())
                        ? bet.createdAt.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                        : 'Just now';
                    const totalStakeLabel = bet.totalStake.toLocaleString();
                    const potentialWinLabel = bet.potentialWin.toLocaleString();
                    const count = bet.selections.length;
                    const isBig = bet.totalStake >= 50;
                    const isFinalized = !!bet.finalized;
                    const isWon = isFinalized && !!bet.won;
                    const winningAmountLabel = (bet.winningAmount ?? 0).toLocaleString();
                    return (
                      <motion.div
                        key={bet.id}
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ delay: index * 0.03 }}
                        whileHover={{
                          scale: 1.02,
                          boxShadow: '0 0 30px rgba(56,189,248,0.55)',
                          borderColor: 'rgba(56,189,248,0.6)',
                        }}
                        className={`rounded-xl bg-gradient-to-br from-slate-900/90 via-slate-950 to-slate-900 border p-3 sm:p-3.5 text-xs sm:text-sm text-gray-100 transition-all duration-150 ${
                          isFinalized ? (isWon ? 'border-emerald-500/50' : 'border-rose-500/40') : 'border-cyan-500/40'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-cyan-500/10 border border-cyan-400/60 text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-cyan-200">
                              <TicketPercent className="w-3.5 h-3.5 text-cyan-300" />
                              {count === 1 ? 'Single bet' : `${count} picks`}
                            </span>
                            {isFinalized && (
                              isWon ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/60 text-[9px] font-black uppercase tracking-[0.2em] text-emerald-300">
                                  <Trophy className="w-3.5 h-3.5" />
                                  Won
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-400/60 text-[9px] font-bold uppercase tracking-[0.2em] text-rose-300">
                                  Lost
                                </span>
                              )
                            )}
                            {isBig && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-fuchsia-600/20 border border-fuchsia-400/60 text-[9px] uppercase tracking-[0.2em] text-fuchsia-200">
                                High roller
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] sm:text-[11px] text-gray-400">
                            {created}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] sm:text-xs text-gray-300">
                              Stake:
                            </span>
                            <span className="text-sm sm:text-base font-bold text-cyan-200">
                              ${totalStakeLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {isFinalized ? (
                              isWon ? (
                                <>
                                  <span className="text-[11px] sm:text-xs text-gray-300">Payout:</span>
                                  <span className="text-sm sm:text-base font-extrabold text-emerald-300">
                                    +${winningAmountLabel}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="text-[11px] sm:text-xs text-gray-300">Result:</span>
                                  <span className="text-sm sm:text-base font-bold text-rose-300">
                                    $0
                                  </span>
                                </>
                              )
                            ) : (
                              <>
                                <span className="text-[11px] sm:text-xs text-gray-300">
                                  To win:
                                </span>
                                <span className="text-sm sm:text-base font-extrabold text-emerald-300">
                                  ${potentialWinLabel}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 space-y-1.5">
                          {bet.selections.map((sel, idx) => (
                            <div
                              key={idx}
                              className="rounded-lg bg-slate-900/80 border border-white/10 px-2.5 py-1.5 flex flex-col gap-0.5 hover:border-cyan-400/60 hover:bg-slate-900 transition-colors"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.22em] text-gray-400">
                                  {sel.market}
                                </span>
                                <span className="text-[11px] sm:text-xs font-semibold text-yellow-300">
                                  {formatAmericanOdds(sel.odds)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs sm:text-[13px] font-medium text-gray-50">
                                  {sel.selection}
                                </span>
                                <span className="text-[10px] sm:text-xs text-gray-300">
                                  ${Number(sel.risk || 0).toLocaleString()} →{' '}
                                  <span className="text-emerald-300 font-semibold">
                                    ${Number(sel.win || 0).toLocaleString()}
                                  </span>
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BetMarketsPanel({
  match,
  isFinished = false,
  probState,
  totalsProbs,
  halfTimeProbs,
  cleanSheetProbs,
  teamTotalsProbs,
  playerScoringProbs,
  betslip,
  stake,
  totals,
  onToggleSelection,
  onStakeChange,
  onClearAll,
  onConfirmSlip,
}) {
  const home = match.home || 'Home';
  const away = match.away || 'Away';

  if (isFinished) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#050509]/95 p-6 text-center">
        <p className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Markets closed</p>
        <p className="text-xs text-gray-500">This match has finished. No new bets can be placed. View the Bets placed tab for existing slips.</p>
      </div>
    );
  }
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
            <div className="overflow-x-auto no-scrollbar">
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

      {/* Bet slip: expandable chat bubble bottom-right. Bubble is always visible on Betting page. */}
      <ExpandableChat
        size="sm"
        position="bottom-right"
        icon={
          <div className="relative flex items-center justify-center">
            <TicketPercent className="h-5 w-5" />
            {betslip.length > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {betslip.length}
              </span>
            )}
          </div>
        }
        autoOpenKey={betslip.length || null}
      >
        <ExpandableChatBody className="p-0 max-h-[70vh]">
          <BetSlipCard
            betslip={betslip}
            stake={stake}
            totals={totals}
            onToggleSelection={onToggleSelection}
            onStakeChange={onStakeChange}
            onClearAll={onClearAll}
            onConfirmSlip={onConfirmSlip}
          />
        </ExpandableChatBody>
      </ExpandableChat>
    </div>
  );
}

function BetSlipCard({ betslip, stake, totals, onToggleSelection, onStakeChange, onClearAll, onConfirmSlip }) {
  const chat = useExpandableChat();
  const [localStakes, setLocalStakes] = useState({});
  const [winDraft, setWinDraft] = useState({}); // raw Win input while typing to avoid overwriting mid-edit
  const [confirming, setConfirming] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!placed) return;
    const t = setTimeout(() => setPlaced(false), 1800);
    return () => clearTimeout(t);
  }, [placed]);

  // Allow external FAB (in App) to toggle this slip via a custom event (mobile Bovada-style behavior)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      if (chat && typeof chat.toggle === 'function') {
        chat.toggle();
      }
    };
    window.addEventListener('bet-slip-toggle', handler);
    return () => window.removeEventListener('bet-slip-toggle', handler);
  }, [chat]);

  // Auto-clear inline error message after a short delay so it feels like a toast.
  useEffect(() => {
    if (!errorMessage) return;
    const t = setTimeout(() => setErrorMessage(''), 2500);
    return () => clearTimeout(t);
  }, [errorMessage]);

  const handleConfirm = async () => {
    if (!onConfirmSlip || confirming) return;

    // Enforce a minimum stake PER SELECTION so you can't leave some picks at $0.
    // Every selection in the slip must have at least $1 risk.
    const invalidSelections = [];
    for (const sel of betslip) {
      const raw = localStakes[sel.key];
      const val = Number(raw);
      if (!Number.isFinite(val) || val < 1) {
        invalidSelections.push(sel);
      }
    }
    if (invalidSelections.length > 0) {
      setErrorMessage('Please enter at least $1 stake on every selection before confirming your slip.');
      return;
    }

    setConfirming(true);
    try {
      await onConfirmSlip(betslip, localStakes);
      setLocalStakes({});
      setWinDraft({});
      setPlaced(true);
      try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3');
        audio.volume = 0.6;
        audio.play().catch(() => {});
      } catch {}
    } catch (e) {
      console.error('Confirm slip error', e);
    }
    setConfirming(false);
  };

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#020617] via-[#020617] to-[#0f172a] shadow-[0_0_45px_rgba(34,211,238,0.45)] p-3 relative overflow-hidden flex flex-col w-full h-[65vh] sm:h-[430px] md:h-[460px] text-xs font-sans">
      <div className="pointer-events-none absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.45),transparent_55%),radial-gradient(circle_at_bottom,_rgba(244,63,94,0.45),transparent_55%)]" />
      <div className="relative flex flex-col flex-1 min-h-0">
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
          {/* Picks chip: show in header on desktop only (mobile already shows count on bubbles/FAB) */}
          {betslip.length > 0 && (
            <span className="hidden sm:inline-flex text-[10px] font-bold text-fuchsia-300 uppercase tracking-wider bg-fuchsia-500/10 border border-fuchsia-400/40 rounded-full px-1.5 py-0.5">
              {betslip.length} picks
            </span>
          )}
        </div>

        {/* Inline themed error toast for validation issues */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div
              key="bet-slip-error"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              className="mb-2 flex items-center gap-2 rounded-xl border border-rose-500/70 bg-rose-500/10 px-3 py-1.5 text-[10px] text-rose-100 shadow-[0_0_24px_rgba(244,63,94,0.5)]"
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-black">
                !
              </span>
              <span className="flex-1">{errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage('')}
                className="ml-1 text-rose-100/70 hover:text-rose-50"
              >
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center-screen confirmation overlay, localized to this slip */}
        <AnimatePresence>
          {placed && (
            <motion.div
              key="bet-placed-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                className="relative flex flex-col items-center gap-3 rounded-3xl bg-[#020617] border border-emerald-400/60 px-10 py-8 shadow-[0_0_60px_rgba(16,185,129,0.7)]"
              >
                <div className="relative mb-1">
                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.05, type: 'spring', stiffness: 260, damping: 16 }}
                    className="h-20 w-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-[0_0_45px_rgba(16,185,129,0.9)]"
                  >
                    <motion.span
                      initial={{ scale: 0.4 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.12, type: 'spring', stiffness: 260, damping: 18 }}
                      className="text-4xl text-black font-black"
                    >
                      ✓
                    </motion.span>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.15 }}
                    className="pointer-events-none absolute inset-0 rounded-full border-4 border-emerald-300/70"
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-emerald-100 uppercase tracking-[0.18em] mb-1">
                    Bet Placed
                  </p>
                  <p className="text-xs text-emerald-100/80">
                    Now follow the match to know the results.
                  </p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top dynamic section + bottom fixed section */}
        {betslip.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-cyan-100/80">
            Tap any odds on the left to add a selection.
          </div>
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
                    className="absolute -top-0.5 -right-0.5 text-[10px] leading-none text-slate-300 hover:text-rose-100 bg-slate-900/90 border border-slate-600/80 hover:border-rose-400/80 rounded-full w-4 h-4 flex items-center justify-center p-0 shadow-[0_0_10px_rgba(15,23,42,0.8)]"
                    aria-label="Remove this selection from bet slip"
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
                {/* TOP: scrollable odds list */}
                <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1 no-scrollbar mb-2">
                  {renderedSelections}
                </div>

                {/* BOTTOM: fixed totals + actions */}
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
                </div>
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}

const CALENDAR_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function CalendarGrid({ selectedDate, tournaments, playedMatches = [], onSelectDate }) {
  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  // View month/year (what the grid displays); sync from selectedDate when it changes
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date(selectedDate);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  useEffect(() => {
    const d = new Date(selectedDate);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    setViewDate(d);
  }, [selectedDate]);

  const viewMonth = viewDate.getMonth();
  const viewYear = viewDate.getFullYear();
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startDay = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startDay; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(viewYear, viewMonth, day));
  }

  // Dot (•) is shown only when at least one fixture's final result was published that day
  // (i.e. admin entered match score in MatchDay → doc saved to `matches` with createdAt that day).
  const playedMatchDates = useMemo(() => {
    const set = new Set();
    if (!Array.isArray(playedMatches)) return set;
    playedMatches.forEach((m) => {
      const raw = m.createdAt;
      const d = raw?.toDate ? raw.toDate() : (raw ? new Date(raw) : null);
      if (d && !Number.isNaN(d.getTime())) {
        const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        set.add(midnight.getTime());
      }
    });
    return set;
  }, [playedMatches]);

  const hasResultPublishedOn = (date) => {
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return playedMatchDates.has(midnight.getTime());
  };

  const goPrevMonth = () => {
    setViewDate(new Date(viewYear, viewMonth - 1, 1));
  };
  const goNextMonth = () => {
    setViewDate(new Date(viewYear, viewMonth + 1, 1));
  };
  const handleMonthChange = (e) => {
    const month = parseInt(e.target.value, 10);
    setViewDate(new Date(viewYear, month, 1));
  };
  const handleYearChange = (e) => {
    const year = parseInt(e.target.value, 10);
    setViewDate(new Date(year, viewMonth, 1));
  };

  const yearRange = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 5; y <= currentYear + 2; y += 1) yearRange.push(y);

  const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="betting-calendar-grid mt-2 rounded-2xl border border-white/10 bg-black/60 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-1 mb-2">
        <button
          type="button"
          onClick={goPrevMonth}
          className="p-1 rounded-full hover:bg-white/10 text-gray-300 hover:text-white"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1 sm:gap-2 flex-1 justify-center min-w-0">
          <select
            value={viewMonth}
            onChange={handleMonthChange}
            className="bg-slate-900 border border-white/20 rounded-lg px-2 py-1 text-[11px] sm:text-xs font-medium text-gray-200 focus:outline-none focus:ring-1 focus:ring-yellow-500/50 [&_option]:bg-slate-900 [&_option]:text-gray-200"
          >
            {CALENDAR_MONTHS.map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={viewYear}
            onChange={handleYearChange}
            className="bg-slate-900 border border-white/20 rounded-lg px-2 py-1 text-[11px] sm:text-xs font-medium text-gray-200 focus:outline-none focus:ring-1 focus:ring-yellow-500/50 [&_option]:bg-slate-900 [&_option]:text-gray-200"
          >
            {yearRange.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={goNextMonth}
          className="p-1 rounded-full hover:bg-white/10 text-gray-300 hover:text-white"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="flex justify-end mb-1">
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
          const hasResultPublished = hasResultPublishedOn(date);

          return (
            <button
              key={date.toISOString()}
              type="button"
              disabled={!hasResultPublished}
              onClick={() => hasResultPublished && onSelectDate(date)}
              title={hasResultPublished ? 'Fixture result published this day' : 'No result published this day'}
              className={`relative flex flex-col items-center justify-center h-9 w-9 rounded-full text-[11px] ${
                !hasResultPublished
                  ? 'cursor-not-allowed opacity-50 text-gray-500 hover:bg-white/5'
                  : selected
                    ? 'bg-yellow-500 text-black font-semibold'
                    : 'bg-white/5 text-gray-200 hover:bg-white/10'
              } ${hasResultPublished ? 'ring-2 ring-yellow-400/80 ring-offset-2 ring-offset-black/60' : ''}`}
            >
              <span>{date.getDate()}</span>
              {hasResultPublished && (
                <span
                  className={`absolute bottom-0 text-lg leading-none font-black ${
                    selected ? 'text-black' : 'text-yellow-400'
                  }`}
                >
                  •
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

