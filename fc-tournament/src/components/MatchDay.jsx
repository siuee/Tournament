import { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { Plus, Users, User, X, Hammer, Trash2, Goal, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function MatchDay() {
  const [players, setPlayers] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [screenShake, setScreenShake] = useState(false);
  
  const [newTournament, setNewTournament] = useState({ type: '', format: '2v2', teams: [] });
  const [selectedForTeam, setSelectedForTeam] = useState([]);

  const strikeSound = useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3'));

  const leagues = [
    { name: 'ePremier League', logo: '/assets/leagues/pl.png' },
    { name: 'eLaLiga', logo: '/assets/leagues/laliga.png' },
    { name: 'eSerie A', logo: '/assets/leagues/seriea.png' },
    { name: 'eLigue 1', logo: '/assets/leagues/ligue1.png' },
    { name: 'eInternational', logo: '/assets/leagues/intl.jpg' }
  ];

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const pSnap = await getDocs(collection(db, "players"));
    const tSnap = await getDocs(collection(db, "tournaments"));
    setPlayers(pSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    setTournaments(tSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  const handlePlayerClick = (player) => {
    if (selectedForTeam.find(p => p.id === player.id)) {
      setSelectedForTeam(selectedForTeam.filter(p => p.id !== player.id));
      return;
    }
    const limit = newTournament.format === '2v2' ? 2 : 1;
    if (selectedForTeam.length < limit) setSelectedForTeam([...selectedForTeam, player]);
  };

  const addTeamToTournament = () => {
    const teamName = selectedForTeam.map(p => p.name).join(' & ');
    
    const tournamentPlayerData = selectedForTeam.map(p => ({
      id: p.id,
      name: p.name,
      videoUrl: p.videoUrl,
      tournamentGoals: 0,
      tournamentAssists: 0
    }));

    const newTeam = {
      name: teamName,
      playerData: tournamentPlayerData, 
      pts: 0,
      totalGoals: 0
    };

    setNewTournament({ ...newTournament, teams: [...newTournament.teams, newTeam] });
    setSelectedForTeam([]);
  };

  const handleForge = async () => {
    strikeSound.current.play().catch(() => {});
    setScreenShake(true);
    setTimeout(() => setScreenShake(false), 400);

    try {
      await addDoc(collection(db, "tournaments"), {
        ...newTournament,
        status: 'active',
        createdAt: new Date()
      });
      setShowCreateModal(false);
      setWizardStep(1);
      setNewTournament({ type: '', format: '2v2', teams: [] });
      fetchData();
    } catch (e) { console.error(e); }
  };

  const handleDeleteTournament = async (id) => {
    const password = prompt("Enter Admin Password to delete this league:");
    if (password === "Supshzz1") {
      await deleteDoc(doc(db, "tournaments", id));
      fetchData();
    } else {
      alert("Unauthorized Access!");
    }
  };

  return (
    <motion.div animate={screenShake ? { x: [-10, 10, -10, 10, 0] } : {}} className="space-y-8 p-4">
      <div className="flex justify-between items-center mb-10">
        <h2 className="text-4xl font-black italic uppercase tracking-tighter text-white">Match Day</h2>
        <button onClick={() => setShowCreateModal(true)} className="bg-neonBlue px-8 py-3 rounded-xl font-black uppercase text-xs tracking-widest shadow-[0_0_20px_rgba(0,243,255,0.3)] hover:scale-105 transition-transform">
          Create Tournament
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {tournaments.map(t => (
          <div key={t.id} className="glass-card p-6 border-t-4 border-t-neonBlue relative group">
            <button 
              onClick={() => handleDeleteTournament(t.id)}
              className="absolute top-4 right-4 p-2 bg-red-500/10 text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-30"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            
            <div className="flex justify-between items-center mb-10">
              <div>
                <h3 className="text-3xl font-black italic uppercase tracking-tighter leading-none flex items-center">
                  <span className="text-neonBlue lowercase italic font-black mr-1">e</span>
                  {t.type.replace(/^e/, '')}
                </h3>
                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-2">{t.format} LEAGUE</p>
              </div>
              <div className="w-16 h-16 flex items-center justify-center p-2 bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                 <img src={leagues.find(l => l.name === t.type)?.logo} alt="" className="w-full h-full object-contain filter brightness-110" />
              </div>
            </div>

            <div className="space-y-6">
              {t.teams?.map((team, i) => (
                <div key={i} className="bg-white/5 p-4 rounded-3xl border border-white/5 relative overflow-hidden">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-4">
                      {/* DUAL PHOTO DESIGN */}
                      <div className="flex -space-x-4">
                        {team.playerData && team.playerData.length > 0 ? (
                          team.playerData.map((player, idx) => (
                            <div key={idx} className="w-14 h-14 rounded-2xl border-2 border-[#121212] overflow-hidden bg-black shadow-lg shadow-black/40">
                              <video src={player.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover scale-110" />
                            </div>
                          ))
                        ) : (
                          <div className="w-14 h-14 rounded-2xl bg-gray-800 border-2 border-[#121212]" />
                        )}
                      </div>

                      <div className="flex flex-col">
                        <span className="text-lg font-black text-white uppercase tracking-tighter leading-none mb-2">
                           {team.name}
                        </span>
                        
                        {/* PLAYER STAT BREAKDOWN */}
                        <div className="flex flex-col gap-1.5">
                           {team.playerData?.map((p, idx) => (
                             <div key={idx} className="flex items-center gap-3">
                               <span className="text-[10px] font-black text-neonBlue uppercase w-12">{p.name?.split(' ')[0]}</span>
                               <div className="flex gap-2">
                                 <span className="text-[9px] font-bold text-gray-500 uppercase flex items-center gap-1">
                                   <Goal className="w-2.5 h-2.5" /> G: <span className="text-white font-black">{p.tournamentGoals || 0}</span>
                                 </span>
                                 <span className="text-[9px] font-bold text-gray-500 uppercase flex items-center gap-1">
                                   <Star className="w-2.5 h-2.5" /> A: <span className="text-white font-black">{p.tournamentAssists || 0}</span>
                                 </span>
                               </div>
                             </div>
                           ))}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                       <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest leading-none mb-1">Total Pts</p>
                       <p className="text-3xl font-black text-neonBlue italic tracking-tighter">{team.pts || 0}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl p-4">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="glass-card max-w-2xl w-full p-8 relative">
              <button onClick={() => setShowCreateModal(false)} className="absolute top-6 right-6 text-gray-400 hover:text-white"><X /></button>
              
              <div className="mb-10 text-center">
                <p className="text-neonBlue text-[10px] font-black tracking-widest uppercase mb-2">Forge Process Step {wizardStep}</p>
                <h2 className="text-4xl font-black italic uppercase tracking-tighter">
                   {wizardStep === 1 ? 'Select Brand' : wizardStep === 2 ? 'Match Format' : 'Draft Squads'}
                </h2>
              </div>

              {wizardStep === 1 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                  {leagues.map(l => (
                    <button key={l.name} onClick={() => { setNewTournament({...newTournament, type: l.name}); setWizardStep(2); }} className="p-6 rounded-3xl bg-white/5 border border-white/10 flex flex-col items-center hover:border-neonBlue transition-all group">
                      <div className="w-20 h-20 mb-4 p-2 flex items-center justify-center">
                        <img src={l.logo} className="w-full h-full object-contain" />
                      </div>
                      <p className="text-[10px] font-black uppercase text-center tracking-widest">{l.name}</p>
                    </button>
                  ))}
                </div>
              )}

              {wizardStep === 2 && (
                <div className="flex gap-6">
                  <button onClick={() => {setNewTournament({...newTournament, format: '1v1'}); setWizardStep(3)}} className="flex-1 p-12 rounded-3xl bg-white/5 border border-white/10 hover:border-neonBlue text-center group">
                    <User className="w-8 h-8 mx-auto mb-4 text-gray-500 group-hover:text-neonBlue transition-colors" />
                    <p className="text-3xl font-black uppercase italic tracking-tighter">1 <span className="text-neonBlue">v</span> 1</p>
                  </button>
                  <button onClick={() => {setNewTournament({...newTournament, format: '2v2'}); setWizardStep(3)}} className="flex-1 p-12 rounded-3xl bg-white/5 border border-white/10 hover:border-neonBlue text-center group">
                    <Users className="w-8 h-8 mx-auto mb-4 text-gray-500 group-hover:text-neonBlue transition-colors" />
                    <p className="text-3xl font-black uppercase italic tracking-tighter">2 <span className="text-neonBlue">v</span> 2</p>
                  </button>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                    {players.map(p => {
                      const isSelected = selectedForTeam.find(s => s.id === p.id);
                      const isAlreadyTaken = newTournament.teams.some(team => team.playerData?.some(pd => pd.id === p.id));
                      
                      return (
                        <button 
                          key={p.id} 
                          disabled={isAlreadyTaken}
                          onClick={() => handlePlayerClick(p)} 
                          className={`p-4 rounded-2xl border flex items-center gap-4 transition-all ${isSelected ? 'border-neonBlue bg-neonBlue/10 shadow-[0_0_15px_rgba(0,243,255,0.1)]' : 'border-white/5 bg-white/5'} ${isAlreadyTaken ? 'opacity-20 grayscale cursor-not-allowed' : ''}`}
                        >
                          <div className="w-10 h-10 rounded-xl overflow-hidden bg-black border border-white/10 flex-shrink-0">
                            <video src={p.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                          </div>
                          <span className="text-[11px] font-black uppercase tracking-tight text-left">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  <button 
                    disabled={selectedForTeam.length < (newTournament.format === '2v2' ? 2 : 1)}
                    onClick={addTeamToTournament}
                    className="w-full py-4 bg-white/5 border border-white/10 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] hover:bg-neonBlue/10 hover:border-neonBlue transition-all disabled:opacity-30"
                  >
                    Lock Team ({newTournament.teams.length} Ready)
                  </button>

                  <button 
                    onClick={handleForge}
                    disabled={newTournament.teams.length < 2}
                    className="w-full py-5 bg-neonBlue text-white rounded-3xl font-black uppercase tracking-[0.5em] text-sm shadow-[0_10px_30px_rgba(0,243,255,0.3)] hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-4"
                  >
                    <Hammer className="w-5 h-5" /> Forge eLeague
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
