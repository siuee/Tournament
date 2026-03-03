/**
 * Simple className merger for Tailwind/shadcn-style components.
 * For full Tailwind class merging, install: clsx tailwind-merge
 */
export function cn(...inputs) {
  return inputs.filter(Boolean).join(' ');
}

/** Title case: first letter uppercase, rest lowercase per word. */
export function toTitleCase(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Get sorted player IDs for a team (stable identifier for matching after renames). */
export function getTeamPlayerIds(team) {
  const ids = (team?.playerData || []).map(p => p?.id).filter(Boolean);
  return [...ids].sort();
}

/** Check if a match's home/away team matches a tournament team by player IDs or name. */
export function matchTeamToMatch(team, match, side) {
  const teamIds = getTeamPlayerIds(team).join(',');
  const matchIds = (side === 'home' ? match.homeTeamPlayerIds : match.awayTeamPlayerIds) || [];
  const matchIdsStr = [...matchIds].sort().join(',');
  if (matchIdsStr && teamIds) return teamIds === matchIdsStr;
  const matchName = (side === 'home' ? match.homeTeam : match.awayTeam) || '';
  const teamName = (team?.name || '').trim();
  return matchName.trim() === teamName;
}

/** Calculate OVR and stats from goals/assists (same as LockerRoom algorithm). */
export function calculateOvrFromGoalsAssists(goals, assists) {
  const g = Number(goals) || 0;
  const a = Number(assists) || 0;
  const ovr = Math.min(99, Math.max(75, 75 + Math.floor((g * 0.25) + (a * 0.15))));
  return {
    ovr,
    pac: Math.min(99, 75 + Math.floor((g + a) * 0.15)),
    sho: Math.min(99, 70 + Math.floor(g * 0.3)),
    pas: Math.min(99, 72 + Math.floor(a * 0.4)),
    dri: Math.min(99, 76 + Math.floor((g + a) * 0.1)),
    def: Math.min(99, 45 + Math.floor(a * 0.2)),
    phy: Math.min(99, 70 + Math.floor(g * 0.15))
  };
}

/** Format team for match history: team name only, or "Player1 & Player2" if no name. */
export function formatMatchHistoryTeam(team, fallbackName = '') {
  if (!team) return toTitleCase(fallbackName || '');
  const name = (team.name || '').trim();
  if (name) return toTitleCase(name);
  const players = team.playerData?.map(p => toTitleCase((p?.name || '').split(' ')[0] || '')).filter(Boolean) || [];
  return players.length > 0 ? players.join(' & ') : toTitleCase(fallbackName || '');
}

/** Format team for display: TeamName (Player1 & Player2) */
export function formatTeamDisplay(team) {
  if (!team) return '';
  const name = team.name || '';
  const players = team.playerData?.map(p => toTitleCase((p?.name || '').split(' ')[0] || '')).filter(Boolean) || [];
  const bracket = players.length > 0 ? ` (${players.join(' & ')})` : '';
  return toTitleCase(name) + bracket;
}
