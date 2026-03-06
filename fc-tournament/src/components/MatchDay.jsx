import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom'; // <--- The magic fix!
import { db } from '../firebase';
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, query, where, orderBy, limit, writeBatch } from 'firebase/firestore';
import { Plus, Users, User, X, Trash2, Goal, Star, Trophy, Sword, AlertCircle, History, UserPlus, Edit2, Loader2 } from 'lucide-react';
import { AnimatedDropdown } from './ui/dropdown-01';
import { motion, AnimatePresence } from 'framer-motion';
import { toTitleCase, formatTeamDisplay, formatMatchHistoryTeam, formatMatchDateTime, matchTeamToMatch, getTeamPlayerIds, calculateOvrFromGoalsAssists } from '../lib/utils';
import { TeamDisplay } from './TeamDisplay';
import { verifyDeletePassword } from '../lib/security';

export default function MatchDay({ onGoalScored }) {
  const [players, setPlayers] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [matches, setMatches] = useState([]);
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  
  const [wizardStep, setWizardStep] = useState(1);
  const [screenShake, setScreenShake] = useState(false);
  
  const [activeTournament, setActiveTournament] = useState(null);
  const [editingTournament, setEditingTournament] = useState(null);
  
  const [matchData, setMatchData] = useState({ 
    homeTeam: null, awayTeam: null, homeScore: '', awayScore: '', playerGoals: {} 
  });

  const [newTournament, setNewTournament] = useState({ type: '', format: '2v2', durationDays: 30, teams: [] });
  const [selectedForTeam, setSelectedForTeam] = useState([]);
  const [teamNameInput, setTeamNameInput] = useState('');
  const [editingTeamName, setEditingTeamName] = useState(null);
  const [editTeamNameInput, setEditTeamNameInput] = useState('');
  const [deletingTournament, setDeletingTournament] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const clickOriginRef = useRef({ x: 0, y: 0 });

  const strikeSound = useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3'));

  const openWithClick = (handler, e) => {
    if (e?.clientX != null && e?.clientY != null) {
      clickOriginRef.current = { x: e.clientX, y: e.clientY };
    }
    handler?.();
  };

  const getClickOriginVariant = () => {
    const o = clickOriginRef.current;
    if (typeof window === 'undefined') return { scale: 0, opacity: 0, x: 0, y: 0 };
    return { scale: 0, opacity: 0, x: o.x - window.innerWidth / 2, y: o.y - window.innerHeight / 2 };
  };

  const leagues = [
    { name: 'ePremier League', logo: '/assets/leagues/pl.svg' },
    { name: 'eLaLiga', logo: '/assets/leagues/laliga.svg' },
    { name: 'eSerie A', logo: '/assets/leagues/seriea.png' },
    { name: 'eLigue 1', logo: '/assets/leagues/ligue1.png' },
    { name: 'eInternational', logo: '/assets/leagues/nepal.svg' },
    { name: 'eChampions League', logo: '/assets/leagues/ucl.jpg' }
  ];

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const pSnap = await getDocs(collection(db, "players"));
      const tSnap = await getDocs(collection(db, "tournaments"));
      const mQuery = query(collection(db, "matches"), orderBy("createdAt", "desc"), limit(10));
      const mSnap = await getDocs(mQuery);

      setPlayers(pSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setTournaments(tSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setMatches(mSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) { console.error("Error fetching data:", error); }
  };

  const isScoreValid = () => {
    if (!matchData.homeTeam || !matchData.awayTeam) return false;
    if (matchData.homeScore === '' || matchData.awayScore === '') return false;

    if (activeTournament?.format === '1v1') return true;

    const getTeamGoalSum = (team) => team.playerData.reduce((sum, p) => sum + (parseInt(matchData.playerGoals[p.id]) || 0), 0);
    return getTeamGoalSum(matchData.homeTeam) === parseInt(matchData.homeScore) && 
           getTeamGoalSum(matchData.awayTeam) === parseInt(matchData.awayScore);
  };

  const handleUpdateScore = async () => {
    if (!isScoreValid()) return;

    const homeS = parseInt(matchData.homeScore) || 0;
    const awayS = parseInt(matchData.awayScore) || 0;

    const homeIds = getTeamPlayerIds(matchData.homeTeam);
    const awayIds = getTeamPlayerIds(matchData.awayTeam);
    const updatedTeams = activeTournament.teams.map(team => {
      let teamCopy = { ...team };
      const teamIds = getTeamPlayerIds(team);
      const teamKey = teamIds.join(',');
      const isHome = teamKey && homeIds.length && teamKey === homeIds.join(',');
      const isAway = teamKey && awayIds.length && teamKey === awayIds.join(',');

      if (isHome || isAway) {
        const score = isHome ? homeS : awayS;
        const oppScore = isHome ? awayS : homeS;
        teamCopy.totalGoals += score;
        
        if (score > oppScore) teamCopy.pts += 3;
        else if (score === oppScore) teamCopy.pts += 1;

        teamCopy.playerData = teamCopy.playerData.map((p, idx, arr) => {
          let goals = 0;
          let assists = 0;

          if (activeTournament.format === '1v1') {
            goals = score;
            assists = 0;
          } else {
            goals = parseInt(matchData.playerGoals[p.id]) || 0;
            const partner = arr[idx === 0 ? 1 : 0];
            assists = parseInt(matchData.playerGoals[partner.id]) || 0;
          }

          return { 
            ...p, 
            tournamentGoals: (p.tournamentGoals || 0) + goals, 
            tournamentAssists: (p.tournamentAssists || 0) + assists 
          };
        });
      }
      return teamCopy;
    });

    const homePlayerGoals = matchData.homeTeam.playerData?.map(p => ({
      name: p.name,
      goals: activeTournament.format === '1v1' ? homeS : (parseInt(matchData.playerGoals[p.id]) || 0)
    })) ?? [];
    const awayPlayerGoals = matchData.awayTeam.playerData?.map(p => ({
      name: p.name,
      goals: activeTournament.format === '1v1' ? awayS : (parseInt(matchData.playerGoals[p.id]) || 0)
    })) ?? [];

    try {
      await updateDoc(doc(db, "tournaments", activeTournament.id), { teams: updatedTeams });
      const homeTeamPlayerIds = (matchData.homeTeam.playerData || []).map(p => p.id).filter(Boolean).sort();
      const awayTeamPlayerIds = (matchData.awayTeam.playerData || []).map(p => p.id).filter(Boolean).sort();

      // Determine league-relative match number for this tournament (1,2,3...) based on existing matches.
      let nextMatchNumber = 1;
      try {
        const existingForTournamentQuery = query(
          collection(db, "matches"),
          where("tournamentId", "==", activeTournament.id)
        );
        const existingSnap = await getDocs(existingForTournamentQuery);
        nextMatchNumber = existingSnap.size + 1;
      } catch (e) {
        console.error("Failed to compute next match number; defaulting to 1", e);
      }

      await addDoc(collection(db, "matches"), {
        tournamentId: activeTournament.id,
        tournamentType: activeTournament.type,
        homeTeam: matchData.homeTeam.name, awayTeam: matchData.awayTeam.name,
        homeTeamPlayerIds, awayTeamPlayerIds,
        homeScore: homeS, awayScore: awayS,
        homePlayerGoals, awayPlayerGoals,
        createdAt: new Date(),
        matchNumber: nextMatchNumber,
      });
      setShowMatchModal(false);
      setMatchData({ homeTeam: null, awayTeam: null, homeScore: '', awayScore: '', playerGoals: {} });
      fetchData();
    } catch (e) { console.error(e); }
  };

  const handleForge = async () => {
    strikeSound.current.play().catch(() => {});
    setScreenShake(true);
    setTimeout(() => setScreenShake(false), 400);
    try {
      const createdAt = new Date();
      await addDoc(collection(db, "tournaments"), {
        ...newTournament,
        durationDays: newTournament.durationDays ?? 30,
        status: 'active',
        createdAt,
      });
      setShowCreateModal(false);
      setWizardStep(1);
      setNewTournament({ type: '', format: '2v2', durationDays: 30, teams: [] });
      setTeamNameInput('');
      fetchData();
    } catch (e) { console.error(e); }
  };

  const handleAddTeamToExisting = async () => {
    const fallbackName = selectedForTeam.map(p => p.name).join(' & ');
    const teamName = (teamNameInput?.trim() || fallbackName);
    const tournamentPlayerData = selectedForTeam.map(p => ({ id: p.id, name: p.name, videoUrl: p.videoUrl, tournamentGoals: 0, tournamentAssists: 0 }));
    const newTeam = { name: teamName, playerData: tournamentPlayerData, pts: 0, totalGoals: 0 };
    
    const updatedTeams = [...editingTournament.teams, newTeam];

    try {
      await updateDoc(doc(db, "tournaments", editingTournament.id), { teams: updatedTeams });
      setShowEditModal(false);
      setEditingTournament(null);
      setSelectedForTeam([]);
      setTeamNameInput('');
      fetchData();
    } catch (e) { console.error(e); }
  };

  const handlePlayerClick = (p, limitNum) => {
    if (selectedForTeam.find(pl => pl.id === p.id)) { 
        setSelectedForTeam(selectedForTeam.filter(pl => pl.id !== p.id)); 
        return; 
    }
    if (selectedForTeam.length < limitNum) setSelectedForTeam([...selectedForTeam, p]);
  };

  const addTeamToTournament = () => {
    const fallbackName = selectedForTeam.map(p => p.name).join(' & ');
    const teamName = (teamNameInput?.trim() || fallbackName);
    const tournamentPlayerData = selectedForTeam.map(p => ({ id: p.id, name: p.name, videoUrl: p.videoUrl, tournamentGoals: 0, tournamentAssists: 0 }));
    setNewTournament({ ...newTournament, teams: [...newTournament.teams, { name: teamName, playerData: tournamentPlayerData, pts: 0, totalGoals: 0 }] });
    setSelectedForTeam([]);
    setTeamNameInput('');
  };

  const openEditTeamName = (tournament, team) => {
    const teamIndex = tournament.teams?.findIndex(tm => tm === team) ?? -1;
    setEditingTeamName({ tournament, teamIndex });
    setEditTeamNameInput(team.name || '');
  };

  const saveEditTeamName = async () => {
    if (!editingTeamName) return;
    const trimmed = editTeamNameInput?.trim();
    if (!trimmed) return;
    const { tournament, teamIndex } = editingTeamName;
    if (teamIndex < 0 || teamIndex >= (tournament.teams?.length ?? 0)) return;
    try {
      const updatedTeams = tournament.teams.map((tm, idx) =>
        idx === teamIndex ? { ...tm, name: trimmed } : tm
      );
      await updateDoc(doc(db, 'tournaments', tournament.id), { teams: updatedTeams });
      setEditingTeamName(null);
      setEditTeamNameInput('');
      fetchData();
    } catch (e) {
      console.error('Failed to update team name:', e);
    }
  };

  const openDeleteModal = (t) => {
    setDeletingTournament(t);
    setDeletePassword('');
    setDeleteError('');
  };

  const closeDeleteModal = () => {
    setDeletingTournament(null);
    setDeletePassword('');
    setDeleteError('');
    setDeleteLoading(false);
  };

  const executeDeleteTournament = async () => {
    if (!deletingTournament) return;
    const password = deletePassword?.trim();
    if (!password) {
      setDeleteError("Please enter the admin password.");
      return;
    }

    const ok = await verifyDeletePassword(password);
    if (!ok) {
      setDeleteError("Incorrect password.");
      return;
    }

    setDeleteError('');
    setDeleteLoading(true);
    const t = deletingTournament;
    const id = t.id;

    try {
      // 1. Delete all matches for this tournament (by tournamentId or legacy: tournamentType + team match)
      const matchesQuery = query(collection(db, "matches"), where("tournamentType", "==", t.type));
      const mSnap = await getDocs(matchesQuery);
      const toDelete = mSnap.docs.filter(d => {
        const data = d.data();
        if (data.tournamentId === id) return true;
        if (!data.tournamentId) {
          const homeMatch = t.teams?.some(tm => matchTeamToMatch(tm, data, "home"));
          const awayMatch = t.teams?.some(tm => matchTeamToMatch(tm, data, "away"));
          return homeMatch && awayMatch;
        }
        return false;
      });
      for (let i = 0; i < toDelete.length; i += 500) {
        const chunk = toDelete.slice(i, i + 500);
        const batch = writeBatch(db);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      // 2. Reduce player career stats (monthlyGoals, monthlyAssists, ovr) if tournament is from current month
      const currentMonth = new Date().toISOString().slice(0, 7);
      let tMonth = "";
      if (t.createdAt) {
        const tDate = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt);
        tMonth = tDate.toISOString().slice(0, 7);
      }
      if (tMonth === currentMonth && t.teams?.length) {
        const playerDeltas = {};
        t.teams.forEach(team => {
          (team.playerData || []).forEach(pd => {
            if (!playerDeltas[pd.id]) playerDeltas[pd.id] = { goals: 0, assists: 0 };
            playerDeltas[pd.id].goals += Number(pd.tournamentGoals) || 0;
            playerDeltas[pd.id].assists += Number(pd.tournamentAssists) || 0;
          });
        });
        const pIds = Object.keys(playerDeltas);
        if (pIds.length > 0) {
          const pSnap = await getDocs(collection(db, "players"));
          const batch2 = writeBatch(db);
          pSnap.docs.forEach(d => {
            const delta = playerDeltas[d.id];
            if (!delta || (delta.goals === 0 && delta.assists === 0)) return;
            const data = d.data();
            const curGoals = Number(data.monthlyGoals) || 0;
            const curAssists = Number(data.monthlyAssists) || 0;
            const newGoals = Math.max(0, curGoals - delta.goals);
            const newAssists = Math.max(0, curAssists - delta.assists);
            const stats = calculateOvrFromGoalsAssists(newGoals, newAssists);
            batch2.update(d.ref, {
              monthlyGoals: newGoals,
              monthlyAssists: newAssists,
              ovr: stats.ovr,
              lastResetMonth: currentMonth
            });
          });
          await batch2.commit();
        }
      }

      // 3. Delete the tournament
      await deleteDoc(doc(db, "tournaments", id));
      closeDeleteModal();
      fetchData();
    } catch (e) {
      console.error("Failed to delete league:", e);
      setDeleteError("Something went wrong. Please try again.");
      setDeleteLoading(false);
    }
  };

  return (
    <motion.div
      animate={screenShake ? { x: [-10, 10, -10, 10, 0] } : {}}
      className="space-y-12 p-4 md:p-8 min-h-screen relative text-white overflow-hidden"
    >
      {/* Header - Stacks on mobile, inline on desktop */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-10 border-b border-yellow-500/20 pb-6">
        <div className="min-w-0 flex-1 pr-2">
           <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-yellow-200 to-yellow-600 drop-shadow-[0_0_15px_rgba(234,179,8,0.3)] pr-2">Match Day</h2>
           <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-2">Manage Tournaments & Record Scores</p>
        </div>
        <motion.button 
          onClick={(e) => openWithClick(() => { setWizardStep(1); setTeamNameInput(''); setShowCreateModal(true); }, e)} 
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="w-full sm:w-auto bg-gradient-to-r from-yellow-600 to-yellow-500 px-8 py-4 rounded-2xl font-black uppercase text-xs tracking-widest text-black shadow-[0_0_20px_rgba(234,179,8,0.4)] z-20 flex items-center justify-center gap-2"
        >
          <Trophy className="w-4 h-4" /> Create Tournament
        </motion.button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {tournaments.map(t => (
          <div key={t.id} className="relative bg-[#0a0a0c]/80 border border-yellow-500/30 rounded-[30px] p-6 sm:p-8 overflow-hidden group shadow-[0_0_20px_rgba(0,0,0,0.5)]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/5 rounded-full blur-3xl pointer-events-none" />
            
            <div className="flex justify-between items-start mb-8 relative z-10">
              <div>
                <h3 className="text-2xl sm:text-3xl font-black italic tracking-tighter uppercase leading-none text-transparent bg-clip-text bg-gradient-to-r from-neonBlue to-[#00ff88] pr-2">
                  <span className="text-neonBlue lowercase italic font-black mr-1">e</span>{t.type.replace(/^e/, '')}
                </h3>
                <span className="inline-block mt-2 text-[9px] font-black uppercase tracking-widest bg-[#00ff88]/10 text-[#00ff88] px-2 py-1 rounded border border-[#00ff88]/20">{t.format}</span>
                
                {/* Action Buttons - Left side, away from logo */}
                <div className="flex flex-wrap gap-2 mt-5">
                  <motion.button onClick={(e) => openWithClick(() => { setActiveTournament(t); setShowMatchModal(true); }, e)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="flex items-center gap-2 text-[10px] font-black uppercase bg-yellow-500 text-black px-4 py-2.5 rounded-xl shadow-[0_0_10px_rgba(234,179,8,0.3)]">
                    <Sword className="w-3 h-3" /> Play Match
                  </motion.button>
                  <motion.button onClick={(e) => openWithClick(() => { setEditingTournament(t); setSelectedForTeam([]); setTeamNameInput(''); setShowEditModal(true); }, e)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="flex items-center gap-2 text-[10px] font-black uppercase bg-white/5 text-gray-300 px-4 py-2.5 rounded-xl border border-white/10 hover:border-yellow-500 hover:text-yellow-500">
                    <UserPlus className="w-3 h-3" /> Add Team
                  </motion.button>
                  <motion.button 
                    onClick={() => openDeleteModal(t)}
                    whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    className="flex items-center gap-2 text-[10px] font-black uppercase bg-white/5 text-gray-400 px-4 py-2.5 rounded-xl border border-white/10 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                    title="Delete league"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </motion.button>
                </div>
              </div>
              <img src={leagues.find(l => l.name === t.type)?.logo} className="w-14 h-14 sm:w-16 sm:h-16 object-contain filter brightness-125 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]" />
            </div>

            <div className="space-y-3 relative z-10">
              {t.teams?.sort((a,b) => b.pts - a.pts).map((team, i) => (
                <div key={i} className="bg-black/50 p-4 rounded-2xl border border-white/5 hover:border-yellow-500/30 transition-colors">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-3 w-[70%]">
                      <div className="flex -space-x-3 shrink-0">
                        {team.playerData?.map((p, idx) => (
                          <div key={idx} className="w-10 h-10 rounded-full border-2 border-[#121212] overflow-hidden bg-black shadow-lg">
                            <video src={p.videoUrl} autoPlay loop muted playsInline preload="metadata" className="w-full h-full object-cover scale-110" />
                          </div>
                        ))}
                      </div>
                      <span className="group/team truncate drop-shadow-[0_0_8px_rgba(234,179,8,0.3)] cursor-default">
                        <TeamDisplay team={team} teamNameClass="font-sport text-base sm:text-lg font-bold text-white tracking-wide group-hover/team:text-yellow-500 transition-colors" playersClass="font-sans text-[11px] font-medium text-gray-500 ml-1.5 tracking-wider" />
                      </span>
                      <motion.button
                        onClick={() => openEditTeamName(t, team)}
                        whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-yellow-500 hover:bg-yellow-500/10 transition-colors shrink-0"
                        title="Edit team name"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </motion.button>
                    </div>
                    <div className="text-xl sm:text-2xl font-black text-yellow-500 italic drop-shadow-md shrink-0">{team.pts} <span className="text-[8px] sm:text-[9px] not-italic text-gray-500 ml-0.5">PTS</span></div>
                  </div>
                  <div className="flex flex-wrap gap-4 border-t border-white/5 pt-3">
                    {team.playerData?.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="font-sport text-xs sm:text-sm font-semibold text-yellow-500">{toTitleCase(p?.name || '').split(' ')[0]}</span>
                        <span className="text-[9px] font-bold text-gray-400 flex items-center gap-1"><span className="text-[10px] leading-none">⚽</span> {p.tournamentGoals || 0}</span>
                        <span className="text-[9px] font-bold text-gray-400 flex items-center gap-1"><span className="text-[10px] leading-none">👟</span> {p.tournamentAssists || 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* MATCH HISTORY - YELLOW VIBE */}
      <div className="mt-16 bg-[#0a0a0c]/80 rounded-[30px] sm:rounded-[40px] p-6 sm:p-8 border border-yellow-500/20 shadow-[0_0_30px_rgba(0,0,0,0.5)] relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1 bg-gradient-to-r from-transparent via-yellow-500 to-transparent opacity-30" />
        
        <div className="flex items-center gap-3 mb-8 sm:mb-10 min-w-0">
           <History className="text-yellow-500 w-6 h-6 sm:w-7 sm:h-7 shrink-0" />
           <h3 className="text-3xl md:text-4xl font-black italic uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-yellow-200 to-yellow-600 drop-shadow-[0_0_15px_rgba(234,179,8,0.3)] pr-2">
             Match History
           </h3>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {matches.length > 0 ? matches.map(m => {
            const homeScore = Number(m.homeScore) || 0;
            const awayScore = Number(m.awayScore) || 0;
            const isHomeWinner = homeScore > awayScore;
            const isAwayWinner = awayScore > homeScore;
            const baseNameClasses = "font-sport text-base sm:text-lg font-semibold tracking-wide text-center sm:text-left leading-tight transition-colors drop-shadow-md";
            const homeNameClasses = `${baseNameClasses} ${isHomeWinner ? 'text-emerald-400' : isAwayWinner ? 'text-red-400' : 'text-white'}`;
            const awayNameClasses = `${baseNameClasses} ${isAwayWinner ? 'text-emerald-400' : isHomeWinner ? 'text-red-400' : 'text-white'}`;

            // Resolve teams by player IDs (survives renames) or by name (legacy matches)
            const tournament = tournaments.find(t =>
              t.type === m.tournamentType &&
              t.teams?.some(tm => matchTeamToMatch(tm, m, 'home')) &&
              t.teams?.some(tm => matchTeamToMatch(tm, m, 'away'))
            );
            const homeTeamObj = tournament?.teams?.find(tm => matchTeamToMatch(tm, m, 'home')) ?? null;
            const awayTeamObj = tournament?.teams?.find(tm => matchTeamToMatch(tm, m, 'away')) ?? null;
            let homePlayers = m.homePlayerGoals;
            let awayPlayers = m.awayPlayerGoals;
            if (!homePlayers?.length || !awayPlayers?.length) {
              if (!homePlayers?.length && homeTeamObj?.playerData?.length) {
                homePlayers = homeTeamObj.playerData.map(p => ({
                  name: p.name,
                  goals: homeTeamObj.playerData.length === 1 ? homeScore : undefined
                }));
              }
              if (!awayPlayers?.length && awayTeamObj?.playerData?.length) {
                awayPlayers = awayTeamObj.playerData.map(p => ({
                  name: p.name,
                  goals: awayTeamObj.playerData.length === 1 ? awayScore : undefined
                }));
              }
            }
            if (!homePlayers?.length) homePlayers = [];
            if (!awayPlayers?.length) awayPlayers = [];

            const displayMatchNumber = typeof m.matchNumber === 'number' ? m.matchNumber : undefined;

            return (
              <div key={m.id} className="bg-black p-5 sm:p-6 rounded-3xl border border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4 hover:border-yellow-500/40 transition-all group relative overflow-hidden">
                <img 
                  src={leagues.find(l => l.name === m.tournamentType)?.logo} 
                  className="absolute -right-2 -bottom-2 w-16 h-16 sm:w-20 sm:h-20 object-contain opacity-[0.02] group-hover:opacity-[0.08] transition-opacity pointer-events-none" 
                />
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto relative z-10 flex-1">
                  <div className="flex flex-col items-center sm:items-start gap-1 min-w-0 group/team">
                    <span className={`${homeNameClasses} group-hover/team:text-yellow-500 transition-colors cursor-default`}>
                      {formatMatchHistoryTeam(homeTeamObj, m.homeTeam)}
                    </span>
                    {homePlayers.length > 0 && (
                      <div className="flex flex-col gap-y-1 justify-center sm:justify-start text-[9px] sm:text-[10px]">
                        {homePlayers.map((p, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-gray-400 font-semibold tracking-wide">
                            <span className="text-yellow-500/90">{toTitleCase(p.name?.split(' ')[0] || '')}</span>
                            {p.goals != null && (
                              <>
                                <span className="text-yellow-500/70">×</span>
                                <span className="text-[10px] leading-none" title="Goals">⚽</span>
                                <span className="text-yellow-400 font-black">{p.goals}</span>
                              </>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-8 sm:w-4 h-[1px] bg-white/10 sm:hidden" />
                    <span className="text-[8px] sm:text-[9px] font-black italic tracking-widest text-yellow-500 px-2.5 py-1 bg-yellow-500/10 rounded-md border border-yellow-500/20">
                      VS
                    </span>
                    <div className="w-8 sm:w-4 h-[1px] bg-white/10 sm:hidden" />
                  </div>
                  <div className="flex flex-col items-center sm:items-end gap-1 min-w-0 group/team">
                    <span className={`${awayNameClasses} group-hover/team:text-yellow-500 transition-colors cursor-default`}>
                      {formatMatchHistoryTeam(awayTeamObj, m.awayTeam)}
                    </span>
                    {awayPlayers.length > 0 && (
                      <div className="flex flex-col gap-y-1 justify-center sm:justify-end text-[9px] sm:text-[10px]">
                        {awayPlayers.map((p, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-gray-400 font-semibold tracking-wide">
                            <span className="text-yellow-500/90">{toTitleCase(p.name?.split(' ')[0] || '')}</span>
                            {p.goals != null && (
                              <>
                                <span className="text-yellow-500/70">×</span>
                                <span className="text-[10px] leading-none" title="Goals">⚽</span>
                                <span className="text-yellow-400 font-black">{p.goals}</span>
                              </>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-center relative z-10 w-full sm:w-auto">
                  <div className="w-full sm:w-auto text-center bg-[#121212] px-6 py-2.5 sm:py-3 rounded-2xl border border-white/10 shadow-xl min-w-[110px] group-hover:border-yellow-500/50 transition-colors">
                    <span className="text-2xl sm:text-3xl font-black italic text-white tracking-tighter drop-shadow-md">
                      {m.homeScore} <span className="text-yellow-500 mx-1">:</span> {m.awayScore}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-col items-center gap-1">
                    <p className="text-[8px] sm:text-[9px] font-black text-gray-500 uppercase tracking-[0.2em]">
                      {m.tournamentType.replace('e', '')}
                    </p>
                    {displayMatchNumber != null && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-400/60 text-[8px] sm:text-[9px] font-semibold uppercase tracking-[0.22em] text-yellow-300">
                        Match #{displayMatchNumber}
                      </span>
                    )}
                    {m.createdAt && (
                      <p className="text-[8px] sm:text-[9px] font-semibold text-gray-600 uppercase tracking-widest">
                        {formatMatchDateTime(m.createdAt)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          }) : (
            <p className="text-gray-500 text-xs font-black uppercase tracking-widest italic">No matches recorded yet...</p>
          )}
        </div>
      </div>

      {/* ========================================================= 
          TELEPORTED MODALS (Guaranteed to be centered on screen) 
          ========================================================= */}
      {typeof document !== 'undefined' && createPortal(
        <div className="relative z-[99999]">
          
          {/* CREATE TOURNAMENT MODAL */}
          <AnimatePresence>
            {showCreateModal && (
              <div className="fixed inset-0 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
                <motion.div
                  initial={getClickOriginVariant()}
                  animate={{ scale: 1, opacity: 1, x: 0, y: 0 }}
                  exit={getClickOriginVariant()}
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                  className="bg-[#0a0a0c] border border-yellow-500/30 w-full max-w-2xl p-6 sm:p-10 rounded-[30px] sm:rounded-[40px] shadow-[0_0_50px_rgba(234,179,8,0.15)] relative max-h-[90vh] overflow-y-auto custom-scrollbar"
                >
                  <button onClick={() => { setShowCreateModal(false); setTeamNameInput(''); }} className="absolute top-6 right-6 sm:top-8 sm:right-8 text-gray-500 hover:text-white transition-colors"><X /></button>
                  <div className="mb-8 sm:mb-12 text-center mt-4 sm:mt-0">
                    <p className="text-yellow-500 text-[10px] font-black tracking-widest uppercase mb-1 sm:mb-2">Tournament Builder</p>
                    <h2 className="text-3xl sm:text-4xl font-black italic uppercase tracking-tighter text-white drop-shadow-md">
                      {wizardStep === 1 ? 'Select League' : wizardStep === 2 ? 'Format' : wizardStep === 3 ? 'League Duration' : 'Draft Teams'}
                    </h2>
                  </div>

                  {wizardStep === 1 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
                      {leagues.map(l => (
                        <motion.button key={l.name} onClick={() => { setNewTournament({...newTournament, type: l.name}); setWizardStep(2); }} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="p-6 sm:p-8 rounded-[24px] sm:rounded-[32px] bg-black border border-white/5 flex flex-col items-center hover:border-yellow-500 hover:shadow-[0_0_20px_rgba(234,179,8,0.2)] group">
                          <div className="w-12 h-12 sm:w-16 sm:h-16 mb-3 sm:mb-4 flex items-center justify-center">
                            <img src={l.logo} className="w-full h-full object-contain group-hover:scale-110 transition-transform" />
                          </div>
                          <p className="text-[9px] sm:text-[10px] font-black uppercase text-center text-gray-300 tracking-widest group-hover:text-yellow-400">{l.name}</p>
                        </motion.button>
                      ))}
                    </div>
                  )}

                  {wizardStep === 2 && (
                    <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
                      <motion.button onClick={() => {setNewTournament({...newTournament, format: '1v1'}); setWizardStep(3)}} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="flex-1 p-10 sm:p-16 rounded-[30px] sm:rounded-[40px] bg-black border border-white/5 hover:border-yellow-500 hover:shadow-[0_0_20px_rgba(234,179,8,0.2)] group text-center">
                        <User className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-4 sm:mb-6 text-gray-600 group-hover:text-yellow-500 transition-colors" />
                        <p className="text-4xl sm:text-5xl font-black uppercase italic tracking-tighter text-white">1 <span className="text-yellow-500">v</span> 1</p>
                      </motion.button>
                      <motion.button onClick={() => {setNewTournament({...newTournament, format: '2v2'}); setWizardStep(3)}} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="flex-1 p-10 sm:p-16 rounded-[30px] sm:rounded-[40px] bg-black border border-white/5 hover:border-yellow-500 hover:shadow-[0_0_20px_rgba(234,179,8,0.2)] group text-center">
                        <Users className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-4 sm:mb-6 text-gray-600 group-hover:text-yellow-500 transition-colors" />
                        <p className="text-4xl sm:text-5xl font-black uppercase italic tracking-tighter text-white">2 <span className="text-yellow-500">v</span> 2</p>
                      </motion.button>
                    </div>
                  )}

                  {wizardStep === 3 && (
                    <div className="space-y-4">
                      <p className="text-sm text-gray-400 text-center">How many days will the league run? Fixtures will cycle through all team pairings until the end.</p>
                      <div className="grid grid-cols-3 gap-3 sm:gap-4">
                        {[30, 60, 90].map((days) => (
                          <motion.button
                            key={days}
                            onClick={() => { setNewTournament({ ...newTournament, durationDays: days }); setWizardStep(4); }}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className={`p-6 sm:p-8 rounded-2xl sm:rounded-3xl border flex flex-col items-center justify-center ${newTournament.durationDays === days ? 'bg-yellow-500/10 border-yellow-500 text-yellow-500' : 'bg-black border-white/5 hover:border-yellow-500/50 text-gray-300'}`}
                          >
                            <span className="text-2xl sm:text-3xl font-black">{days}</span>
                            <span className="text-[10px] font-bold uppercase tracking-wider mt-1">days</span>
                          </motion.button>
                        ))}
                      </div>
                      <div className="flex justify-center pt-2">
                        <button
                          type="button"
                          onClick={() => setWizardStep(2)}
                          className="text-xs text-gray-500 hover:text-yellow-500 uppercase tracking-wider"
                        >
                          Back
                        </button>
                      </div>
                    </div>
                  )}

                  {wizardStep === 4 && (
                    <div className="space-y-6 sm:space-y-8">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-h-64 sm:max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                        {players.map(p => {
                          const isSelected = selectedForTeam.find(s => s.id === p.id);
                          const isAlreadyTaken = newTournament.teams.some(team => team.playerData?.some(pd => pd.id === p.id));
                          return (
                            <button key={p.id} disabled={isAlreadyTaken} onClick={() => handlePlayerClick(p, newTournament.format === '2v2' ? 2 : 1)} className={`p-3 sm:p-4 rounded-2xl sm:rounded-3xl border flex items-center gap-3 sm:gap-4 transition-all ${isSelected ? 'bg-yellow-500/10 border-yellow-500 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.2)]' : 'bg-black border-white/5 text-gray-300 hover:border-white/20'} ${isAlreadyTaken ? 'opacity-20 grayscale cursor-not-allowed' : 'active:scale-95'}`}>
                              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full overflow-hidden bg-[#121212] border border-white/10 shrink-0">
                                <video src={p.videoUrl} autoPlay loop muted playsInline preload="metadata" className="w-full h-full object-cover scale-110" />
                              </div>
                              <span className="font-sport text-base sm:text-lg font-semibold tracking-wide text-left leading-none">{toTitleCase(p?.name || '')}</span>
                            </button>
                          );
                        })}
                      </div>
                      {selectedForTeam.length >= (newTournament.format === '2v2' ? 2 : 1) && (
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Team Name <span className="text-gray-500 font-normal normal-case">(optional)</span></label>
                          <input
                            type="text"
                            value={teamNameInput}
                            onChange={(e) => setTeamNameInput(e.target.value)}
                            placeholder={selectedForTeam.map(p => toTitleCase(p?.name || '')).join(' & ')}
                            className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white font-sport font-semibold placeholder:text-gray-600 focus:border-yellow-500 focus:outline-none transition-colors"
                          />
                        </div>
                      )}
                      <div className="flex justify-center pb-1">
                        <button type="button" onClick={() => setWizardStep(3)} className="text-xs text-gray-500 hover:text-yellow-500 uppercase tracking-wider">Back</button>
                      </div>
                      <div className="flex flex-col gap-3 sm:gap-4">
                        <motion.button disabled={selectedForTeam.length < (newTournament.format === '2v2' ? 2 : 1)} onClick={addTeamToTournament} whileHover={{ scale: selectedForTeam.length >= (newTournament.format === '2v2' ? 2 : 1) ? 1.02 : 1 }} whileTap={{ scale: 0.98 }} className="w-full py-4 sm:py-5 bg-black border border-white/10 rounded-[20px] font-black text-[10px] sm:text-xs uppercase tracking-widest text-white hover:bg-yellow-500/10 hover:border-yellow-500 hover:text-yellow-500 disabled:opacity-30">
                          Lock Team ({newTournament.teams.length} Added)
                        </motion.button>
                        <motion.button onClick={handleForge} disabled={newTournament.teams.length < 2} whileHover={{ scale: newTournament.teams.length >= 2 ? 1.02 : 1 }} whileTap={{ scale: 0.98 }} className="w-full py-5 sm:py-6 bg-gradient-to-r from-yellow-600 to-yellow-500 text-black rounded-[20px] font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-xs sm:text-sm shadow-[0_0_20px_rgba(234,179,8,0.4)] flex items-center justify-center gap-3 disabled:opacity-50 disabled:grayscale">
                          <Trophy className="w-4 h-4 sm:w-5 sm:h-5" /> Forge League
                        </motion.button>
                      </div>
                    </div>
                  )}
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* ADD TEAM TO EXISTING TOURNAMENT MODAL */}
          <AnimatePresence>
            {showEditModal && editingTournament && (
              <div className="fixed inset-0 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
                <motion.div
                  initial={getClickOriginVariant()}
                  animate={{ scale: 1, opacity: 1, x: 0, y: 0 }}
                  exit={getClickOriginVariant()}
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                  className="bg-[#0a0a0c] border border-yellow-500/30 w-full max-w-2xl p-6 sm:p-10 rounded-[30px] sm:rounded-[40px] shadow-[0_0_50px_rgba(234,179,8,0.15)] relative max-h-[90vh] overflow-y-auto custom-scrollbar"
                >
                  <button onClick={() => { setShowEditModal(false); setEditingTournament(null); }} className="absolute top-6 right-6 sm:top-8 sm:right-8 text-gray-500 hover:text-white transition-colors"><X /></button>
                  <div className="mb-8 sm:mb-10 text-center mt-4 sm:mt-0">
                    <p className="text-yellow-500 text-[10px] font-black tracking-widest uppercase mb-1 sm:mb-2">Late Entry</p>
                    <h2 className="text-3xl sm:text-4xl font-black italic uppercase tracking-tighter text-white drop-shadow-md">
                      Draft New Team
                    </h2>
                    <p className="text-[9px] sm:text-[10px] text-gray-400 mt-2 font-bold uppercase tracking-widest">Format: {editingTournament.format}</p>
                  </div>

                  <div className="space-y-6 sm:space-y-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-h-64 sm:max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                      {players.map(p => {
                        const isSelected = selectedForTeam.find(s => s.id === p.id);
                        const isAlreadyTaken = editingTournament.teams.some(team => team.playerData?.some(pd => pd.id === p.id));
                        return (
                          <button key={p.id} disabled={isAlreadyTaken} onClick={() => handlePlayerClick(p, editingTournament.format === '2v2' ? 2 : 1)} className={`p-3 sm:p-4 rounded-2xl sm:rounded-3xl border flex items-center gap-3 sm:gap-4 transition-all ${isSelected ? 'bg-yellow-500/10 border-yellow-500 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.2)]' : 'bg-black border-white/5 text-gray-300 hover:border-white/20'} ${isAlreadyTaken ? 'opacity-20 grayscale cursor-not-allowed' : 'active:scale-95'}`}>
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full overflow-hidden bg-[#121212] border border-white/10 shrink-0">
                              <video src={p.videoUrl} autoPlay loop muted playsInline preload="metadata" className="w-full h-full object-cover scale-110" />
                            </div>
                            <span className="font-sport text-base sm:text-lg font-semibold tracking-wide text-left leading-none">{toTitleCase(p?.name || '')}</span>
                          </button>
                        );
                      })}
                    </div>
                    {selectedForTeam.length >= (editingTournament.format === '2v2' ? 2 : 1) && (
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Team Name <span className="text-gray-500 font-normal normal-case">(optional)</span></label>
                        <input
                          type="text"
                          value={teamNameInput}
                          onChange={(e) => setTeamNameInput(e.target.value)}
                          placeholder={selectedForTeam.map(p => toTitleCase(p?.name || '')).join(' & ')}
                          className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white font-sport font-semibold placeholder:text-gray-600 focus:border-yellow-500 focus:outline-none transition-colors"
                        />
                      </div>
                    )}
                    <motion.button disabled={selectedForTeam.length < (editingTournament.format === '2v2' ? 2 : 1)} onClick={handleAddTeamToExisting} whileHover={{ scale: selectedForTeam.length >= (editingTournament.format === '2v2' ? 2 : 1) ? 1.02 : 1 }} whileTap={{ scale: 0.98 }} className="w-full py-5 sm:py-6 bg-gradient-to-r from-yellow-600 to-yellow-500 text-black rounded-[20px] font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-xs sm:text-sm shadow-[0_0_20px_rgba(234,179,8,0.4)] flex items-center justify-center gap-3 disabled:opacity-50 disabled:grayscale">
                      <UserPlus className="w-4 h-4 sm:w-5 sm:h-5" /> Add Team to League
                    </motion.button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* RECORD MATCH SCORE MODAL */}
          <AnimatePresence>
            {showMatchModal && (
              <div className="fixed inset-0 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
                <motion.div
                  initial={getClickOriginVariant()}
                  animate={{ scale: 1, opacity: 1, x: 0, y: 0 }}
                  exit={getClickOriginVariant()}
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                  className="bg-[#0a0a0c] border border-yellow-500/30 w-full max-w-2xl p-6 sm:p-10 rounded-[30px] sm:rounded-[40px] relative shadow-[0_0_50px_rgba(234,179,8,0.15)] max-h-[90vh] overflow-y-auto custom-scrollbar"
                >
                  <button onClick={() => setShowMatchModal(false)} className="absolute top-6 right-6 sm:top-8 sm:right-8 text-gray-500 hover:text-white transition-colors"><X /></button>
                  <div className="text-center mb-8 sm:mb-10 mt-4 sm:mt-0">
                    <p className="text-yellow-500 text-[10px] font-black tracking-widest uppercase mb-1 sm:mb-2">Final Whistle</p>
                    <h2 className="text-2xl sm:text-3xl font-black italic uppercase text-white drop-shadow-md">Record Result</h2>
                  </div>
                  
                  <div className="space-y-6 sm:space-y-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      <AnimatedDropdown
                        options={activeTournament.teams.map(team => ({ value: team.name, label: formatTeamDisplay(team), raw: team }))}
                        value={matchData.homeTeam ? { value: matchData.homeTeam.name, label: formatTeamDisplay(matchData.homeTeam), raw: matchData.homeTeam } : null}
                        onChange={(opt) => setMatchData({...matchData, homeTeam: opt.raw})}
                        placeholder="Select Home Side"
                        isDisabled={(opt) => matchData.awayTeam?.name === opt.raw?.name}
                        isDark={true}
                      />
                      <AnimatedDropdown
                        options={activeTournament.teams.map(team => ({ value: team.name, label: formatTeamDisplay(team), raw: team }))}
                        value={matchData.awayTeam ? { value: matchData.awayTeam.name, label: formatTeamDisplay(matchData.awayTeam), raw: matchData.awayTeam } : null}
                        onChange={(opt) => setMatchData({...matchData, awayTeam: opt.raw})}
                        placeholder="Select Away Side"
                        isDisabled={(opt) => matchData.homeTeam?.name === opt.raw?.name}
                        isDark={true}
                      />
                    </div>

                    <div className="flex items-center justify-center gap-6 sm:gap-10 bg-black/50 p-6 sm:p-8 rounded-[24px] sm:rounded-3xl border border-white/5">
                      <input 
                        type="number" placeholder="-" 
                        value={matchData.homeScore} 
                        onChange={(e) => setMatchData({...matchData, homeScore: e.target.value === '' ? '' : parseInt(e.target.value)})} 
                        className="w-20 h-20 sm:w-24 sm:h-24 bg-[#121212] border-2 border-yellow-500/50 focus:border-yellow-500 rounded-2xl sm:rounded-3xl text-center text-4xl sm:text-5xl font-black text-white outline-none placeholder:text-gray-800 transition-colors shadow-[0_0_20px_rgba(234,179,8,0.1)] no-spinners" 
                      />
                      <span className="text-xl sm:text-2xl font-black italic text-gray-600">VS</span>
                      <input 
                        type="number" placeholder="-" 
                        value={matchData.awayScore} 
                        onChange={(e) => setMatchData({...matchData, awayScore: e.target.value === '' ? '' : parseInt(e.target.value)})} 
                        className="w-20 h-20 sm:w-24 sm:h-24 bg-[#121212] border-2 border-yellow-500/50 focus:border-yellow-500 rounded-2xl sm:rounded-3xl text-center text-4xl sm:text-5xl font-black text-white outline-none placeholder:text-gray-800 transition-colors shadow-[0_0_20px_rgba(234,179,8,0.1)] no-spinners" 
                      />
                    </div>

                    {/* INDIVIDUAL PLAYER GOALS - ONLY SHOW FOR 2V2 */}
                    {activeTournament?.format === '2v2' && (matchData.homeTeam || matchData.awayTeam) && (
                      <div className="space-y-4 sm:space-y-6 pt-4 sm:pt-6 border-t border-white/5">
                        <p className="text-[10px] font-black text-yellow-500 uppercase tracking-widest text-center">Assign Individual Goals</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
                          {[matchData.homeTeam, matchData.awayTeam].map((team, tIdx) => (
                            team && (
                              <div key={tIdx} className="space-y-3 sm:space-y-4 bg-black/40 p-4 sm:p-5 rounded-2xl border border-white/5">
                                <p className="border-b border-white/10 pb-2 mb-3 sm:mb-4 tracking-wide">
                      <TeamDisplay team={team} teamNameClass="font-sport text-base sm:text-lg font-bold text-white" playersClass="font-sans text-[11px] font-medium text-gray-500 ml-1.5" />
                    </p>
                                {team.playerData?.map(p => (
                                  <div key={p.id} className="flex items-center justify-between gap-3">
                                    <span className="font-sport text-sm font-semibold text-gray-300 truncate flex-1">{toTitleCase(p?.name || '').split(' ')[0]}</span>
                                    <input 
                                      type="number" placeholder="0" 
                                      value={matchData.playerGoals[p.id] || ''} 
                                      onChange={(e) => setMatchData(prev => ({...prev, playerGoals: {...prev.playerGoals, [p.id]: e.target.value === '' ? '' : parseInt(e.target.value)}}))} 
                                      className="w-14 sm:w-16 h-10 bg-[#121212] border border-white/10 focus:border-yellow-500 rounded-lg text-center text-sm font-black text-yellow-500 placeholder:text-gray-700 outline-none transition-colors no-spinners" 
                                    />
                                  </div>
                                ))}
                              </div>
                            )
                          ))}
                        </div>
                        {!isScoreValid() && (
                          <div className="flex items-center justify-center gap-2 text-red-500 bg-red-500/10 p-3 sm:p-4 rounded-xl border border-red-500/20">
                            <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-center leading-tight">Individual goals must equal the team score!</span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    <motion.button 
                      disabled={!isScoreValid()} 
                      onClick={handleUpdateScore}
                      whileHover={{ scale: isScoreValid() ? 1.02 : 1 }}
                      whileTap={{ scale: 0.98 }}
                      className={`w-full py-5 sm:py-6 rounded-2xl font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-xs sm:text-sm transition-all mt-2 sm:mt-0 ${isScoreValid() ? 'bg-gradient-to-r from-yellow-600 to-yellow-500 text-black shadow-[0_0_20px_rgba(234,179,8,0.4)]' : 'bg-[#121212] text-gray-600 border border-white/5 cursor-not-allowed'}`}
                    >
                      Submit Match Result
                    </motion.button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* DELETE LEAGUE MODAL */}
          <AnimatePresence>
            {deletingTournament && (
              <div className="fixed inset-0 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                  className="bg-[#0a0a0c] border border-yellow-500/30 w-full max-w-md p-6 sm:p-8 rounded-[24px] sm:rounded-[30px] shadow-[0_0_50px_rgba(234,179,8,0.15)] relative"
                >
                  <button
                    onClick={closeDeleteModal}
                    disabled={deleteLoading}
                    className="absolute top-4 right-4 sm:top-5 sm:right-5 text-gray-500 hover:text-white transition-colors disabled:opacity-50"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <div className="mb-6">
                    <p className="text-yellow-500 text-[10px] font-black tracking-widest uppercase mb-1">Delete League</p>
                    <h2 className="text-xl sm:text-2xl font-black italic uppercase tracking-tighter text-white drop-shadow-md">
                      Permanently Delete?
                    </h2>
                  </div>
                  <p className="text-sm text-gray-400 mb-6">
                    Deleting <span className="text-yellow-500 font-semibold">{deletingTournament.type?.replace(/^e/, '')}</span> will remove all matches and related stats. This cannot be undone.
                  </p>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Admin Password</label>
                      <input
                        type="password"
                        value={deletePassword}
                        onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(''); }}
                        placeholder="Enter password to confirm"
                        disabled={deleteLoading}
                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white font-sport font-semibold placeholder:text-gray-600 focus:border-yellow-500 focus:outline-none transition-colors disabled:opacity-50"
                        autoFocus
                      />
                    </div>
                    {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}
                    <div className="flex gap-3 pt-2">
                      <motion.button
                        onClick={closeDeleteModal}
                        disabled={deleteLoading}
                        whileHover={{ scale: deleteLoading ? 1 : 1.02 }} whileTap={{ scale: 0.98 }}
                        className="flex-1 py-3 rounded-xl font-black text-[10px] sm:text-xs uppercase tracking-widest bg-white/5 text-gray-400 border border-white/10 hover:border-white/20 hover:text-white transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </motion.button>
                      <motion.button
                        onClick={executeDeleteTournament}
                        disabled={deleteLoading || !deletePassword?.trim()}
                        whileHover={{ scale: deleteLoading || !deletePassword?.trim() ? 1 : 1.02 }} whileTap={{ scale: 0.98 }}
                        className="flex-1 py-3 rounded-xl font-black text-[10px] sm:text-xs uppercase tracking-widest bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 hover:border-red-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {deleteLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting...</> : <>Delete League</>}
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* EDIT TEAM NAME MODAL */}
          <AnimatePresence>
            {editingTeamName && (
              <div className="fixed inset-0 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                  className="bg-[#0a0a0c] border border-yellow-500/30 w-full max-w-md p-6 sm:p-8 rounded-[24px] sm:rounded-[30px] shadow-[0_0_50px_rgba(234,179,8,0.15)] relative"
                >
                  <button
                    onClick={() => { setEditingTeamName(null); setEditTeamNameInput(''); }}
                    className="absolute top-4 right-4 sm:top-5 sm:right-5 text-gray-500 hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <div className="mb-6">
                    <p className="text-yellow-500 text-[10px] font-black tracking-widest uppercase mb-1">Rename Team</p>
                    <h2 className="text-xl sm:text-2xl font-black italic uppercase tracking-tighter text-white drop-shadow-md">
                      Edit Team Name
                    </h2>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Team Name</label>
                      <input
                        type="text"
                        value={editTeamNameInput}
                        onChange={(e) => setEditTeamNameInput(e.target.value)}
                        placeholder="Enter team name"
                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white font-sport font-semibold placeholder:text-gray-600 focus:border-yellow-500 focus:outline-none transition-colors"
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-3 pt-2">
                      <motion.button
                        onClick={() => { setEditingTeamName(null); setEditTeamNameInput(''); }}
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        className="flex-1 py-3 rounded-xl font-black text-[10px] sm:text-xs uppercase tracking-widest bg-white/5 text-gray-400 border border-white/10 hover:border-white/20 hover:text-white transition-colors"
                      >
                        Cancel
                      </motion.button>
                      <motion.button
                        onClick={saveEditTeamName}
                        disabled={!editTeamNameInput?.trim()}
                        whileHover={{ scale: editTeamNameInput?.trim() ? 1.02 : 1 }} whileTap={{ scale: 0.98 }}
                        className="flex-1 py-3 rounded-xl font-black text-[10px] sm:text-xs uppercase tracking-widest bg-gradient-to-r from-yellow-600 to-yellow-500 text-black shadow-[0_0_20px_rgba(234,179,8,0.3)] disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Save
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>,
        document.body
      )}

      {/* Global CSS overrides safely injected without Next.js jsx tag */}
      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.02); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(234, 179, 8, 0.5); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(234, 179, 8, 0.8); }
        
        /* Stop iOS Safari zoom on input focus */
        input[type="number"], select { font-size: 16px !important; }

        /* Hide HTML number input arrows */
        .no-spinners::-webkit-outer-spin-button,
        .no-spinners::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .no-spinners {
          -moz-appearance: textfield;
        }
      `}} />
    </motion.div>
  );
}