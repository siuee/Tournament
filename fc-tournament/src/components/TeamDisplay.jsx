import { toTitleCase } from '../lib/utils';

/**
 * Renders team name and player names with distinct styling for clear visual hierarchy.
 * Team name: bold, prominent. Player names: smaller, muted, different font.
 */
export function TeamDisplay({ team, className = '', teamNameClass = '', playersClass = '' }) {
  if (!team) return null;
  const name = team.name || '';
  const players = team.playerData?.map(p => toTitleCase((p?.name || '').split(' ')[0] || '')).filter(Boolean) || [];

  return (
    <span className={className}>
      <span className={teamNameClass || 'font-sport font-bold text-white tracking-wide'}>
        {toTitleCase(name)}
      </span>
      {players.length > 0 && (
        <span className={playersClass || 'font-sans text-[11px] font-medium text-gray-500 ml-1.5 tracking-wider'}>
          {players.join(' · ')}
        </span>
      )}
    </span>
  );
}
