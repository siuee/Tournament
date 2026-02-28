import { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, query, orderBy, limit } from 'firebase/firestore';
import { Plus, Users, User, X, Hammer, Trash2, Goal, Star, Trophy, Sword, ChevronDown, AlertCircle, History, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function MatchDay() {
  const [players, setPlayers] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [matches, setMatches] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [screenShake, setScreenShake] = useState(false);
  
  const [activeTournament, setActiveTournament] = useState(null);
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
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  const isScoreValid = () => {
    if (!matchData.homeTeam || !matchData.awayTeam) return false;
    if (matchData.homeScore === '' || matchData.awayScore === '') return false;

    // For 1v1, validation is true once scores are entered
    if (activeTournament?.format === '1v1') return true;

    // For 2v2, check if individual goals match team score
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

  const handlePlayerClick = (p) => {
    if (selectedForTeam.find(pl => pl.id === p.id)) { 
        setSelectedForTeam(selectedForTeam.filter(pl => pl.id !== p.id)); 
        return; 
    }
    const limitNum = newTournament.format === '2v2' ? 2 : 1;
    if (selectedForTeam.length < limitNum) setSelectedForTeam([...selectedForTeam, p]);
  };

  const addTeamToTournament = () => {
    const teamName = selectedForTeam.map(p => p.name).join(' & ');
    const tournamentPlayerData = selectedForTeam.map(p => ({ id: p.id, name: p.name, videoUrl: p.videoUrl, tournamentGoals: 0, tournamentAssists: 0 }));
    setNewTournament({ ...newTournament, teams: [...newTournament.teams, { name: teamName, playerData: tournamentPlayerData, pts: 0, totalGoals: 0 }] });
    setSelectedForTeam([]);
  };

  return (
    <motion.div animate={screenShake ? { x: [-10, 10, -10, 10, 0] } : {}} className="space-y-12 p-4 custom-scrollbar relative">
      <div className="flex justify-between items-center mb-10">
        <h2 className="text-4xl font-black italic uppercase tracking-tighter text-white">Match Day</h2>
        <button 
          onClick={() => { setWizardStep(1); setShowCreateModal(true); }} 
          className="bg-neonBlue px-8 py-3 rounded-xl font-black uppercase text-xs tracking-widest shadow-[0_0_20px_rgba(0,243,255,0.3)] hover:scale-105 transition-all z-20"
        >
          Create Tournament
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {tournaments.map(t => (
          <div key={t.id} className="glass-card p-6 border-t-4 border-t-neonBlue relative group">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h3 className="text-3xl font-black italic uppercase tracking-tighter leading-none text-white">
                  <span className="text-neonBlue lowercase italic font-black mr-1">e</span>{t.type.replace(/^e/, '')}
                </h3>
                <button onClick={() => { setActiveTournament(t); setShowMatchModal(true); }} className="mt-4 flex items-center gap-2 text-[10px] font-black uppercase bg-neonBlue/20 text-neonBlue px-4 py-2 rounded-lg border border-neonBlue/30 hover:bg-neonBlue hover:text-white transition-all">
                  <Sword className="w-3 h-3" /> Play Match
                </button>
              </div>
              <img src={leagues.find(l => l.name === t.type)?.logo} className="w-14 h-14 object-contain filter brightness-110" />
            </div>

            <div className="space-y-4">
              {t.teams?.sort((a,b) => b.pts - a.pts).map((team, i) => (
                <div key={i} className="bg-white/5 p-4 rounded-3xl border border-white/5">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex -space-x-3">
                        {team.playerData?.map((p, idx) => (
                          <div key={idx} className="w-10 h-10 rounded-xl border-2 border-[#121212] overflow-hidden bg-black shadow-lg">
                            <video src={p.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                      <span className="text-sm font-black text-white uppercase tracking-tight">{team.name}</span>
                    </div>
                    <div className="text-xl font-black text-neonBlue italic">{team.pts} <span className="text-[8px] not-italic text-gray-500 ml-1">PTS</span></div>
                  </div>
                  <div className="flex gap-4 border-t border-white/5 pt-2">
                    {team.playerData?.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-[9px] font-black text-neonBlue uppercase">{p.name.split(' ')[0]}</span>
                        <span className="text-[8px] font-bold text-gray-400 flex items-center gap-1"><Goal className="w-2.5 h-2.5"/> {p.tournamentGoals || 0}</span>
                        <span className="text-[8px] font-bold text-gray-400 flex items-center gap-1"><Star className="w-2.5 h-2.5"/> {p.tournamentAssists || 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => {if(confirm("Delete league?")) { deleteDoc(doc(db, "tournaments", t.id)); fetchData(); }}} className="absolute top-4 right-4 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

<div className="mt-16 bg-white/5 rounded-[40px] p-8 border border-white/5">
  <div className="flex items-center gap-4 mb-8">
     <History className="text-neonBlue w-6 h-6" />
     <h3 className="text-2xl font-black italic uppercase tracking-tighter text-white">Match History</h3>
  </div>
  
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    {matches.length > 0 ? matches.map(m => (
      <div key={m.id} className="bg-black/40 p-6 rounded-3xl border border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4 hover:border-neonBlue/30 transition-all group relative overflow-hidden">
        <img 
          src={leagues.find(l => l.name === m.tournamentType)?.logo} 
          className="absolute -right-2 -bottom-2 w-16 h-16 object-contain opacity-[0.03] group-hover:opacity-[0.08] transition-opacity" 
        />
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <span className="text-sm font-black text-white uppercase tracking-tight text-center sm:text-left leading-tight">
            {m.homeTeam}
          </span>
          <div className="flex items-center gap-2">
            <div className="w-4 h-[1px] bg-white/10 sm:hidden" />
            <span className="text-[10px] font-black italic tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-neonBlue to-purple-500 px-2 py-1 bg-white/5 rounded-full border border-white/5">
              VS
            </span>
            <div className="w-4 h-[1px] bg-white/10 sm:hidden" />
          </div>
          <span className="text-sm font-black text-white uppercase tracking-tight text-center sm:text-left leading-tight">
            {m.awayTeam}
          </span>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-center bg-white/5 px-6 py-2 rounded-2xl border border-white/10 shadow-xl min-w-[100px]">
            <span className="text-2xl font-black italic text-white tracking-tighter">
              {m.homeScore} <span className="text-neonBlue">:</span> {m.awayScore}
            </span>
          </div>
          <p className="text-[8px] font-black text-gray-600 uppercase mt-2 tracking-[0.2em]">
            {m.tournamentType.replace('e', '')}
          </p>
        </div>
      </div>
    )) : (
      <p className="text-gray-600 text-[10px] font-black uppercase tracking-widest italic">No matches recorded yet...</p>
    )}
  </div>
</div>

      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="glass-card max-w-2xl w-full p-10 relative">
              <button onClick={() => setShowCreateModal(false)} className="absolute top-8 right-8 text-gray-400 hover:text-white transition-colors"><X /></button>
              <div className="mb-12 text-center">
                <p className="text-neonBlue text-[10px] font-black tracking-widest uppercase mb-2">Tournament Builder</p>
                <h2 className="text-4xl font-black italic uppercase tracking-tighter text-white">
                  {wizardStep === 1 ? 'Select League' : wizardStep === 2 ? 'Format' : 'Draft Teams'}
                </h2>
              </div>

              {wizardStep === 1 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                  {leagues.map(l => (
                    <button key={l.name} onClick={() => { setNewTournament({...newTournament, type: l.name}); setWizardStep(2); }} className="p-8 rounded-[32px] bg-white/5 border border-white/10 flex flex-col items-center hover:border-neonBlue transition-all group">
                      <div className="w-16 h-16 mb-4 flex items-center justify-center">
                        <img src={l.logo} className="w-full h-full object-contain group-hover:scale-110 transition-transform" />
                      </div>
                      <p className="text-[10px] font-black uppercase text-center text-white tracking-widest">{l.name}</p>
                    </button>
                  ))}
                </div>
              )}

              {wizardStep === 2 && (
                <div className="flex gap-8">
                  <button onClick={() => {setNewTournament({...newTournament, format: '1v1'}); setWizardStep(3)}} className="flex-1 p-16 rounded-[48px] bg-white/5 border border-white/10 hover:border-neonBlue transition-all group text-center">
                    <User className="w-10 h-10 mx-auto mb-6 text-gray-500 group-hover:text-neonBlue" />
                    <p className="text-4xl font-black uppercase italic tracking-tighter text-white">1 <span className="text-neonBlue">v</span> 1</p>
                  </button>
                  <button onClick={() => {setNewTournament({...newTournament, format: '2v2'}); setWizardStep(3)}} className="flex-1 p-16 rounded-[48px] bg-white/5 border border-white/10 hover:border-neonBlue transition-all group text-center">
                    <Users className="w-10 h-10 mx-auto mb-6 text-gray-500 group-hover:text-neonBlue" />
                    <p className="text-4xl font-black uppercase italic tracking-tighter text-white">2 <span className="text-neonBlue">v</span> 2</p>
                  </button>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-4 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                    {players.map(p => {
                      const isSelected = selectedForTeam.find(s => s.id === p.id);
                      const isAlreadyTaken = newTournament.teams.some(team => team.playerData?.some(pd => pd.id === p.id));
                      return (
                        <button key={p.id} disabled={isAlreadyTaken} onClick={() => handlePlayerClick(p)} className={`p-5 rounded-[28px] border flex items-center gap-4 transition-all ${isSelected ? 'bg-neonBlue border-neonBlue text-white shadow-xl shadow-blue-500/20' : 'bg-white/5 border-white/10 text-white'} ${isAlreadyTaken ? 'opacity-20 grayscale' : ''}`}>
                          <div className="w-12 h-12 rounded-[18px] overflow-hidden bg-black border border-white/20">
                            <video src={p.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                          </div>
                          <span className="text-xs font-black uppercase tracking-tight text-left leading-none">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-col gap-4">
                    <button disabled={selectedForTeam.length < (newTournament.format === '2v2' ? 2 : 1)} onClick={addTeamToTournament} className="w-full py-5 bg-white/5 border border-white/10 rounded-[24px] font-black text-xs uppercase tracking-widest text-white hover:bg-neonBlue/10 hover:border-neonBlue transition-all disabled:opacity-30">
                      Lock Team ({newTournament.teams.length} Added)
                    </button>
                    <button onClick={handleForge} disabled={newTournament.teams.length < 2} className="w-full py-6 bg-neonBlue text-white rounded-[28px] font-black uppercase tracking-[0.4em] text-sm shadow-2xl shadow-blue-500/30 flex items-center justify-center gap-4 hover:scale-[1.02] transition-transform">
                      <Trophy className="w-6 h-6" /> Forge League
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMatchModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4">
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="glass-card max-w-2xl w-full p-8 relative border border-white/10 overflow-y-auto max-h-[90vh] custom-scrollbar">
              <button onClick={() => setShowMatchModal(false)} className="absolute top-8 right-8 text-gray-400 hover:text-white transition-colors"><X /></button>
              <div className="text-center mb-8"><h2 className="text-2xl font-black italic uppercase text-white">Record Match Result</h2></div>
              <div className="space-y-8">
                <div className="grid grid-cols-2 gap-4">
                  <select onChange={(e) => setMatchData({...matchData, homeTeam: activeTournament.teams[e.target.value]})} className="bg-[#1a1a1a] border border-white/10 p-4 rounded-xl font-black text-xs text-white">
                    <option value="">Select Home Side</option>
                    {activeTournament.teams.map((team, idx) => (<option key={idx} value={idx} disabled={matchData.awayTeam?.name === team.name}>{team.name}</option>))}
                  </select>
                  <select onChange={(e) => setMatchData({...matchData, awayTeam: activeTournament.teams[e.target.value]})} className="bg-[#1a1a1a] border border-white/10 p-4 rounded-xl font-black text-xs text-white">
                    <option value="">Select Away Side</option>
                    {activeTournament.teams.map((team, idx) => (<option key={idx} value={idx} disabled={matchData.homeTeam?.name === team.name}>{team.name}</option>))}
                  </select>
                </div>

                <div className="flex items-center justify-center gap-10 bg-white/5 p-6 rounded-3xl border border-white/5">
                  <input 
                    type="number" 
                    placeholder="-" 
                    value={matchData.homeScore} 
                    onChange={(e) => setMatchData({...matchData, homeScore: e.target.value === '' ? '' : parseInt(e.target.value)})} 
                    className="w-20 h-20 bg-black/40 border-2 border-neonBlue rounded-2xl text-center text-4xl font-black text-white outline-none placeholder:text-gray-700" 
                  />
                  <span className="text-xl font-black italic text-gray-600">VS</span>
                  <input 
                    type="number" 
                    placeholder="-" 
                    value={matchData.awayScore} 
                    onChange={(e) => setMatchData({...matchData, awayScore: e.target.value === '' ? '' : parseInt(e.target.value)})} 
                    className="w-20 h-20 bg-black/40 border-2 border-neonBlue rounded-2xl text-center text-4xl font-black text-white outline-none placeholder:text-gray-700" 
                  />
                </div>

                {/* INDIVIDUAL PLAYER GOALS - ONLY SHOW FOR 2V2 */}
                {activeTournament?.format === '2v2' && (matchData.homeTeam || matchData.awayTeam) && (
                  <div className="space-y-6 pt-4 border-t border-white/10">
                    <p className="text-[10px] font-black text-neonBlue uppercase tracking-widest text-center">Assign Scorer</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {[matchData.homeTeam, matchData.awayTeam].map((team, tIdx) => (
                        team && (
                          <div key={tIdx} className="space-y-3">
                            <p className="text-[11px] font-black uppercase text-white border-b border-white/5 pb-1">{team.name}</p>
                            {team.playerData?.map(p => (
                              <div key={p.id} className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-bold text-gray-400 uppercase w-24 truncate">{p.name.split(' ')[0]}</span>
                                <input 
                                  type="number" 
                                  placeholder="-" 
                                  value={matchData.playerGoals[p.id] || ''} 
                                  onChange={(e) => setMatchData(prev => ({...prev, playerGoals: {...prev.playerGoals, [p.id]: e.target.value === '' ? '' : parseInt(e.target.value)}}))} 
                                  className="w-16 h-8 bg-white/5 border border-white/10 rounded text-center text-xs font-black text-neonBlue placeholder:text-gray-700" 
                                />
                              </div>
                            ))}
                          </div>
                        )
                      ))}
                    </div>
                    {!isScoreValid() && (
                      <div className="flex items-center justify-center gap-2 text-red-500 bg-red-500/10 p-3 rounded-xl border border-red-500/20">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-center">Individual goals must equal team score!</span>
                      </div>
                    )}
                  </div>
                )}
                <button 
                  disabled={!isScoreValid()} 
                  onClick={handleUpdateScore} 
                  className={`w-full py-5 rounded-3xl font-black uppercase tracking-[0.4em] text-sm transition-all ${isScoreValid() ? 'bg-neonBlue text-white shadow-[0_10px_30px_rgba(0,243,255,0.3)] hover:scale-[1.02]' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
                >
                  Submit Match Result
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.05); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #00f3ff; border-radius: 10px; }
      `}</style>
    </motion.div>
  );
}