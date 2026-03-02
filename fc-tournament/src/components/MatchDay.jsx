import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom'; // <--- The magic fix!
import { db } from '../firebase';
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, query, orderBy, limit } from 'firebase/firestore';
import { Plus, Users, User, X, Trash2, Goal, Star, Trophy, Sword, AlertCircle, History, UserPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { StarShockwaves } from './ui/star-shockwaves';

export default function MatchDay({ belloMode, onGoalScored }) {
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

  const [newTournament, setNewTournament] = useState({ type: '', format: '2v2', teams: [] });
  const [selectedForTeam, setSelectedForTeam] = useState([]);

  const strikeSound = useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3'));

  const leagues = [
    { name: 'ePremier League', logo: '/assets/leagues/pl.png' },
    { name: 'eLaLiga', logo: '/assets/leagues/laliga.png' },
    { name: 'eSerie A', logo: '/assets/leagues/seriea.png' },
    { name: 'eLigue 1', logo: '/assets/leagues/ligue1.png' },
    { name: 'eInternational', logo: '/assets/leagues/intl.jpg' },
    { name: 'eChampions League', logo: '/assets/leagues/ucl.png' }
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

    const updatedTeams = activeTournament.teams.map(team => {
      let teamCopy = { ...team };
      const isHome = team.name === matchData.homeTeam.name;
      const isAway = team.name === matchData.awayTeam.name;

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

    try {
      await updateDoc(doc(db, "tournaments", activeTournament.id), { teams: updatedTeams });
      await addDoc(collection(db, "matches"), {
        tournamentType: activeTournament.type,
        homeTeam: matchData.homeTeam.name, awayTeam: matchData.awayTeam.name,
        homeScore: homeS, awayScore: awayS,
        createdAt: new Date()
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
      await addDoc(collection(db, "tournaments"), { ...newTournament, status: 'active', createdAt: new Date() });
      setShowCreateModal(false); 
      setWizardStep(1);
      setNewTournament({ type: '', format: '2v2', teams: [] });
      fetchData();
    } catch (e) { console.error(e); }
  };

  const handleAddTeamToExisting = async () => {
    const teamName = selectedForTeam.map(p => p.name).join(' & ');
    const tournamentPlayerData = selectedForTeam.map(p => ({ id: p.id, name: p.name, videoUrl: p.videoUrl, tournamentGoals: 0, tournamentAssists: 0 }));
    const newTeam = { name: teamName, playerData: tournamentPlayerData, pts: 0, totalGoals: 0 };
    
    const updatedTeams = [...editingTournament.teams, newTeam];

    try {
      await updateDoc(doc(db, "tournaments", editingTournament.id), { teams: updatedTeams });
      setShowEditModal(false);
      setEditingTournament(null);
      setSelectedForTeam([]);
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
    const teamName = selectedForTeam.map(p => p.name).join(' & ');
    const tournamentPlayerData = selectedForTeam.map(p => ({ id: p.id, name: p.name, videoUrl: p.videoUrl, tournamentGoals: 0, tournamentAssists: 0 }));
    setNewTournament({ ...newTournament, teams: [...newTournament.teams, { name: teamName, playerData: tournamentPlayerData, pts: 0, totalGoals: 0 }] });
    setSelectedForTeam([]);
  };

  return (
    <motion.div
      animate={screenShake ? { x: [-10, 10, -10, 10, 0] } : {}}
      className="space-y-12 p-4 md:p-8 min-h-screen relative text-white overflow-hidden"
    >
      <div className="fixed inset-0 -z-10">
        <StarShockwaves />
      </div>

      {/* Header - Stacks on mobile, inline on desktop */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-10 border-b border-yellow-500/20 pb-6">
        <div>
           <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-yellow-200 to-yellow-600 drop-shadow-[0_0_15px_rgba(234,179,8,0.3)]">Match Day</h2>
           <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-2">Manage Tournaments & Record Scores</p>
        </div>
        <button 
          onClick={() => { setWizardStep(1); setShowCreateModal(true); }} 
          className="w-full sm:w-auto bg-gradient-to-r from-yellow-600 to-yellow-500 px-8 py-4 rounded-2xl font-black uppercase text-xs tracking-widest text-black shadow-[0_0_20px_rgba(234,179,8,0.4)] hover:scale-105 active:scale-95 transition-all z-20 flex items-center justify-center gap-2"
        >
          <Trophy className="w-4 h-4" /> Create Tournament
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {tournaments.map(t => (
          <div key={t.id} className="relative bg-[#0a0a0c]/80 border border-yellow-500/30 rounded-[30px] p-6 sm:p-8 overflow-hidden group shadow-[0_0_20px_rgba(0,0,0,0.5)]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/5 rounded-full blur-3xl pointer-events-none" />
            
            <div className="flex justify-between items-start mb-8 relative z-10">
              <div>
                <h3 className="text-2xl sm:text-3xl font-black italic uppercase tracking-tighter leading-none text-white drop-shadow-md">
                  <span className="text-yellow-500 lowercase italic font-black mr-1">e</span>{t.type.replace(/^e/, '')}
                </h3>
                <span className="inline-block mt-2 text-[9px] font-black uppercase tracking-widest bg-yellow-500/10 text-yellow-500 px-2 py-1 rounded border border-yellow-500/20">{t.format}</span>
                
                {/* Action Buttons - Stacked on very small screens */}
                <div className="flex flex-wrap gap-2 mt-5">
                  <button onClick={() => { setActiveTournament(t); setShowMatchModal(true); }} className="flex items-center gap-2 text-[10px] font-black uppercase bg-yellow-500 text-black px-4 py-2.5 rounded-xl shadow-[0_0_10px_rgba(234,179,8,0.3)] hover:scale-105 active:scale-95 transition-all">
                    <Sword className="w-3 h-3" /> Play Match
                  </button>
                  <button onClick={() => { setEditingTournament(t); setSelectedForTeam([]); setShowEditModal(true); }} className="flex items-center gap-2 text-[10px] font-black uppercase bg-white/5 text-gray-300 px-4 py-2.5 rounded-xl border border-white/10 hover:border-yellow-500 hover:text-yellow-500 active:scale-95 transition-all">
                    <UserPlus className="w-3 h-3" /> Add Team
                  </button>
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
                            <video src={p.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover scale-110" />
                          </div>
                        ))}
                      </div>
                      <span className="text-xs sm:text-sm font-black text-white uppercase tracking-tight truncate">{team.name}</span>
                    </div>
                    <div className="text-xl sm:text-2xl font-black text-yellow-500 italic drop-shadow-md shrink-0">{team.pts} <span className="text-[8px] sm:text-[9px] not-italic text-gray-500 ml-0.5">PTS</span></div>
                  </div>
                  <div className="flex flex-wrap gap-4 border-t border-white/5 pt-3">
                    {team.playerData?.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-[9px] font-black text-yellow-500 uppercase">{p.name.split(' ')[0]}</span>
                        <span className="text-[9px] font-bold text-gray-400 flex items-center gap-1"><Goal className="w-3 h-3 text-white/40"/> {p.tournamentGoals || 0}</span>
                        <span className="text-[9px] font-bold text-gray-400 flex items-center gap-1"><Star className="w-3 h-3 text-white/40"/> {p.tournamentAssists || 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => {if(confirm("Delete league?")) { deleteDoc(doc(db, "tournaments", t.id)); fetchData(); }}} className="absolute top-4 sm:top-6 right-4 sm:right-6 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 p-2 rounded-lg border border-red-500/30 hover:bg-red-500 hover:text-white"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      {/* MATCH HISTORY - YELLOW VIBE */}
      <div className="mt-16 bg-[#0a0a0c]/80 rounded-[30px] sm:rounded-[40px] p-6 sm:p-8 border border-yellow-500/20 shadow-[0_0_30px_rgba(0,0,0,0.5)] relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1 bg-gradient-to-r from-transparent via-yellow-500 to-transparent opacity-30" />
        
        <div className="flex items-center gap-3 mb-8 sm:mb-10">
           <History className="text-yellow-500 w-6 h-6 sm:w-7 sm:h-7" />
           <h3 className="text-2xl sm:text-3xl font-black italic uppercase tracking-tighter text-white drop-shadow-md">Match History</h3>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {matches.length > 0 ? matches.map(m => (
            <div key={m.id} className="bg-black p-5 sm:p-6 rounded-3xl border border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4 hover:border-yellow-500/40 transition-all group relative overflow-hidden">
              <img 
                src={leagues.find(l => l.name === m.tournamentType)?.logo} 
                className="absolute -right-2 -bottom-2 w-16 h-16 sm:w-20 sm:h-20 object-contain opacity-[0.02] group-hover:opacity-[0.08] transition-opacity pointer-events-none" 
              />
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto relative z-10">
                <span className="text-xs sm:text-sm font-black text-white uppercase tracking-tight text-center sm:text-left leading-tight group-hover:text-yellow-400 transition-colors">
                  {m.homeTeam}
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-8 sm:w-4 h-[1px] bg-white/10 sm:hidden" />
                  <span className="text-[8px] sm:text-[9px] font-black italic tracking-widest text-yellow-500 px-2.5 py-1 bg-yellow-500/10 rounded-md border border-yellow-500/20">
                    VS
                  </span>
                  <div className="w-8 sm:w-4 h-[1px] bg-white/10 sm:hidden" />
                </div>
                <span className="text-xs sm:text-sm font-black text-white uppercase tracking-tight text-center sm:text-left leading-tight group-hover:text-yellow-400 transition-colors">
                  {m.awayTeam}
                </span>
              </div>
              <div className="flex flex-col items-center relative z-10 w-full sm:w-auto">
                <div className="w-full sm:w-auto text-center bg-[#121212] px-6 py-2.5 sm:py-3 rounded-2xl border border-white/10 shadow-xl min-w-[110px] group-hover:border-yellow-500/50 transition-colors">
                  <span className="text-2xl sm:text-3xl font-black italic text-white tracking-tighter drop-shadow-md">
                    {m.homeScore} <span className="text-yellow-500 mx-1">:</span> {m.awayScore}
                  </span>
                </div>
                <p className="text-[8px] sm:text-[9px] font-black text-gray-500 uppercase mt-2 tracking-[0.2em]">
                  {m.tournamentType.replace('e', '')}
                </p>
              </div>
            </div>
          )) : (
            <p className="text-gray-500 text-[10px] font-black uppercase tracking-widest italic">No matches recorded yet...</p>
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
                <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-[#0a0a0c] border border-yellow-500/30 w-full max-w-2xl p-6 sm:p-10 rounded-[30px] sm:rounded-[40px] shadow-[0_0_50px_rgba(234,179,8,0.15)] relative max-h-[90vh] overflow-y-auto custom-scrollbar">
                  <button onClick={() => setShowCreateModal(false)} className="absolute top-6 right-6 sm:top-8 sm:right-8 text-gray-500 hover:text-white transition-colors"><X /></button>
                  <div className="mb-8 sm:mb-12 text-center mt-4 sm:mt-0">
                    <p className="text-yellow-500 text-[10px] font-black tracking-widest uppercase mb-1 sm:mb-2">Tournament Builder</p>
                    <h2 className="text-3xl sm:text-4xl font-black italic uppercase tracking-tighter text-white drop-shadow-md">
                      {wizardStep === 1 ? 'Select League' : wizardStep === 2 ? 'Format' : 'Draft Teams'}
                    </h2>
                  </div>

                  {wizardStep === 1 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
                      {leagues.map(l => (
                        <button key={l.name} onClick={() => { setNewTournament({...newTournament, type: l.name}); setWizardStep(2); }} className="p-6 sm:p-8 rounded-[24px] sm:rounded-[32px] bg-black border border-white/5 flex flex-col items-center hover:border-yellow-500 hover:shadow-[0_0_20px_rgba(234,179,8,0.2)] transition-all group active:scale-95">
                          <div className="w-12 h-12 sm:w-16 sm:h-16 mb-3 sm:mb-4 flex items-center justify-center">
                            <img src={l.logo} className="w-full h-full object-contain group-hover:scale-110 transition-transform" />
                          </div>
                          <p className="text-[9px] sm:text-[10px] font-black uppercase text-center text-gray-300 tracking-widest group-hover:text-yellow-400">{l.name}</p>
                        </button>
                      ))}
                    </div>
                  )}

                  {wizardStep === 2 && (
                    <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
                      <button onClick={() => {setNewTournament({...newTournament, format: '1v1'}); setWizardStep(3)}} className="flex-1 p-10 sm:p-16 rounded-[30px] sm:rounded-[40px] bg-black border border-white/5 hover:border-yellow-500 hover:shadow-[0_0_20px_rgba(234,179,8,0.2)] transition-all group text-center active:scale-95">
                        <User className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-4 sm:mb-6 text-gray-600 group-hover:text-yellow-500 transition-colors" />
                        <p className="text-4xl sm:text-5xl font-black uppercase italic tracking-tighter text-white">1 <span className="text-yellow-500">v</span> 1</p>
                      </button>
                      <button onClick={() => {setNewTournament({...newTournament, format: '2v2'}); setWizardStep(3)}} className="flex-1 p-10 sm:p-16 rounded-[30px] sm:rounded-[40px] bg-black border border-white/5 hover:border-yellow-500 hover:shadow-[0_0_20px_rgba(234,179,8,0.2)] transition-all group text-center active:scale-95">
                        <Users className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-4 sm:mb-6 text-gray-600 group-hover:text-yellow-500 transition-colors" />
                        <p className="text-4xl sm:text-5xl font-black uppercase italic tracking-tighter text-white">2 <span className="text-yellow-500">v</span> 2</p>
                      </button>
                    </div>
                  )}

                  {wizardStep === 3 && (
                    <div className="space-y-6 sm:space-y-8">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-h-64 sm:max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                        {players.map(p => {
                          const isSelected = selectedForTeam.find(s => s.id === p.id);
                          const isAlreadyTaken = newTournament.teams.some(team => team.playerData?.some(pd => pd.id === p.id));
                          return (
                            <button key={p.id} disabled={isAlreadyTaken} onClick={() => handlePlayerClick(p, newTournament.format === '2v2' ? 2 : 1)} className={`p-3 sm:p-4 rounded-2xl sm:rounded-3xl border flex items-center gap-3 sm:gap-4 transition-all ${isSelected ? 'bg-yellow-500/10 border-yellow-500 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.2)]' : 'bg-black border-white/5 text-gray-300 hover:border-white/20'} ${isAlreadyTaken ? 'opacity-20 grayscale cursor-not-allowed' : 'active:scale-95'}`}>
                              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full overflow-hidden bg-[#121212] border border-white/10 shrink-0">
                                <video src={p.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover scale-110" />
                              </div>
                              <span className="text-[11px] sm:text-xs font-black uppercase tracking-tight text-left leading-none">{p.name}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex flex-col gap-3 sm:gap-4">
                        <button disabled={selectedForTeam.length < (newTournament.format === '2v2' ? 2 : 1)} onClick={addTeamToTournament} className="w-full py-4 sm:py-5 bg-black border border-white/10 rounded-[20px] font-black text-[10px] sm:text-xs uppercase tracking-widest text-white hover:bg-yellow-500/10 hover:border-yellow-500 hover:text-yellow-500 transition-all disabled:opacity-30 active:scale-95">
                          Lock Team ({newTournament.teams.length} Added)
                        </button>
                        <button onClick={handleForge} disabled={newTournament.teams.length < 2} className="w-full py-5 sm:py-6 bg-gradient-to-r from-yellow-600 to-yellow-500 text-black rounded-[20px] font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-xs sm:text-sm shadow-[0_0_20px_rgba(234,179,8,0.4)] flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-50 disabled:grayscale">
                          <Trophy className="w-4 h-4 sm:w-5 sm:h-5" /> Forge League
                        </button>
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
                <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-[#0a0a0c] border border-yellow-500/30 w-full max-w-2xl p-6 sm:p-10 rounded-[30px] sm:rounded-[40px] shadow-[0_0_50px_rgba(234,179,8,0.15)] relative max-h-[90vh] overflow-y-auto custom-scrollbar">
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
                              <video src={p.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover scale-110" />
                            </div>
                            <span className="text-[11px] sm:text-xs font-black uppercase tracking-tight text-left leading-none">{p.name}</span>
                          </button>
                        );
                      })}
                    </div>
                    
                    <button disabled={selectedForTeam.length < (editingTournament.format === '2v2' ? 2 : 1)} onClick={handleAddTeamToExisting} className="w-full py-5 sm:py-6 bg-gradient-to-r from-yellow-600 to-yellow-500 text-black rounded-[20px] font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-xs sm:text-sm shadow-[0_0_20px_rgba(234,179,8,0.4)] flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-50 disabled:grayscale">
                      <UserPlus className="w-4 h-4 sm:w-5 sm:h-5" /> Add Team to League
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* RECORD MATCH SCORE MODAL */}
          <AnimatePresence>
            {showMatchModal && (
              <div className="fixed inset-0 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-[#0a0a0c] border border-yellow-500/30 w-full max-w-2xl p-6 sm:p-10 rounded-[30px] sm:rounded-[40px] relative shadow-[0_0_50px_rgba(234,179,8,0.15)] max-h-[90vh] overflow-y-auto custom-scrollbar">
                  <button onClick={() => setShowMatchModal(false)} className="absolute top-6 right-6 sm:top-8 sm:right-8 text-gray-500 hover:text-white transition-colors"><X /></button>
                  <div className="text-center mb-8 sm:mb-10 mt-4 sm:mt-0">
                    <p className="text-yellow-500 text-[10px] font-black tracking-widest uppercase mb-1 sm:mb-2">Final Whistle</p>
                    <h2 className="text-2xl sm:text-3xl font-black italic uppercase text-white drop-shadow-md">Record Result</h2>
                  </div>
                  
                  <div className="space-y-6 sm:space-y-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      <select onChange={(e) => setMatchData({...matchData, homeTeam: activeTournament.teams[e.target.value]})} className="bg-black border border-white/10 p-4 sm:p-5 rounded-xl sm:rounded-2xl font-black text-xs text-white outline-none focus:border-yellow-500 transition-colors">
                        <option value="">Select Home Side</option>
                        {activeTournament.teams.map((team, idx) => (<option key={idx} value={idx} disabled={matchData.awayTeam?.name === team.name}>{team.name}</option>))}
                      </select>
                      <select onChange={(e) => setMatchData({...matchData, awayTeam: activeTournament.teams[e.target.value]})} className="bg-black border border-white/10 p-4 sm:p-5 rounded-xl sm:rounded-2xl font-black text-xs text-white outline-none focus:border-yellow-500 transition-colors">
                        <option value="">Select Away Side</option>
                        {activeTournament.teams.map((team, idx) => (<option key={idx} value={idx} disabled={matchData.homeTeam?.name === team.name}>{team.name}</option>))}
                      </select>
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
                                <p className="text-[11px] sm:text-xs font-black uppercase text-white border-b border-white/10 pb-2 mb-3 sm:mb-4">{team.name}</p>
                                {team.playerData?.map(p => (
                                  <div key={p.id} className="flex items-center justify-between gap-3">
                                    <span className="text-[10px] font-bold text-gray-300 uppercase truncate flex-1">{p.name.split(' ')[0]}</span>
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
                    
                    <button 
                      disabled={!isScoreValid()} 
                      onClick={handleUpdateScore} 
                      className={`w-full py-5 sm:py-6 rounded-2xl font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-xs sm:text-sm transition-all mt-2 sm:mt-0 ${isScoreValid() ? 'bg-gradient-to-r from-yellow-600 to-yellow-500 text-black shadow-[0_0_20px_rgba(234,179,8,0.4)] hover:scale-[1.02] active:scale-95' : 'bg-[#121212] text-gray-600 border border-white/5 cursor-not-allowed'}`}
                    >
                      Submit Match Result
                    </button>
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