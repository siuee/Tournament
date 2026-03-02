import { useState, useEffect } from 'react';
import { Trophy, Crown, TrendingUp, Loader2, Goal, Medal, Flame, Users, User, Sparkles, Activity } from 'lucide-react';
import { db } from '../firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';

export default function Standings() {
  const [players, setPlayers] = useState([]);
  const [leagues, setLeagues] = useState({});
  const [loading, setLoading] = useState(true);
  const [gbFormat, setGbFormat] = useState('2v2');

  const leagueIcons = {
    'ePremier League': '/assets/leagues/pl.png',
    'eLaLiga': '/assets/leagues/laliga.png',
    'eSerie A': '/assets/leagues/seriea.png',
    'eLigue 1': '/assets/leagues/ligue1.png',
    'eInternational': '/assets/leagues/intl.jpg',
    'eChampions League': '/assets/leagues/ucl.png'
  };

  // HELPER LOGIC: Converts "First Last & First Last" to "First & First"
  const formatTeamName = (fullName) => {
    if (!fullName) return "Team";
    if (fullName.includes('&')) {
      return fullName.split('&').map(name => name.trim().split(' ')[0]).join(' & ');
    }
    return fullName.trim().split(' ')[0];
  };

  const getSafeTime = (dateObj) => {
    if (!dateObj) return 0;
    if (typeof dateObj.toMillis === 'function') return dateObj.toMillis();
    if (dateObj instanceof Date) return dateObj.getTime();
    if (dateObj.seconds) return dateObj.seconds * 1000;
    return new Date(dateObj).getTime() || 0;
  };

  useEffect(() => {
    const fetchAllData = async () => {
      try {
        const pSnap = await getDocs(collection(db, "players"));
        const tSnap = await getDocs(collection(db, "tournaments"));
        const mSnap = await getDocs(query(collection(db, "matches"), orderBy("createdAt", "desc")));

        const basePlayers = pSnap.docs.map(doc => ({ 
            id: doc.id, ...doc.data(), 
            goals1v1: 0, assists1v1: 0, goals2v2: 0, assists2v2: 0,
            tGoals: 0, tAssists: 0 
        }));
        
        const matchHistory = mSnap.docs.map(doc => doc.data());
        const leagueGroups = {};

        tSnap.docs.forEach(doc => {
          const data = doc.data();
          const type = data.type || 'Other Leagues';
          const format = data.format || '2v2';
          
          const groupKey = `${type}_${format}`;
          if (!leagueGroups[groupKey]) leagueGroups[groupKey] = [];

          if (data.teams) {
            data.teams.forEach(team => {
              const teamName = team.name || '';
              
              const teamMatches = matchHistory.filter(m => {
                const home = m.homeTeam || '';
                const away = m.awayTeam || '';
                return m.tournamentType === type && (home.trim() === teamName.trim() || away.trim() === teamName.trim());
              });

              let w = 0, d = 0, l = 0, gs = 0, gc = 0, form = [];
              const sortedMatches = [...teamMatches].sort((a, b) => getSafeTime(b.createdAt) - getSafeTime(a.createdAt));

              sortedMatches.forEach((m, idx) => {
                const home = m.homeTeam || '';
                const isHome = home.trim() === teamName.trim();
                const tS = isHome ? (Number(m.homeScore) || 0) : (Number(m.awayScore) || 0);
                const oS = isHome ? (Number(m.awayScore) || 0) : (Number(m.homeScore) || 0);
                
                gs += tS; gc += oS;
                const res = tS > oS ? 'W' : tS === oS ? 'D' : 'L';
                if (res === 'W') w++; else if (res === 'D') d++; else l++;
                if (idx < 5) form.push(res);
              });

              leagueGroups[groupKey].push({
                ...team, mp: teamMatches.length, w, d, l, gs, gc, gd: gs - gc, form, format, type 
              });

              if (team.playerData) {
                  team.playerData.forEach(pd => {
                      const pIndex = basePlayers.findIndex(p => p.id === pd.id);
                      if (pIndex !== -1) {
                          const pGoals = Number(pd.tournamentGoals) || 0;
                          const pAssists = Number(pd.tournamentAssists) || 0;
                          basePlayers[pIndex].tGoals += pGoals;
                          basePlayers[pIndex].tAssists += pAssists;
                          if (format === '1v1') {
                            basePlayers[pIndex].goals1v1 += pGoals;
                            basePlayers[pIndex].assists1v1 += pAssists;
                          } else {
                            basePlayers[pIndex].goals2v2 += pGoals;
                            basePlayers[pIndex].assists2v2 += pAssists;
                          }
                      }
                  });
              }
            });
          }
        });

        Object.keys(leagueGroups).forEach(key => {
          leagueGroups[key].sort((a, b) => (b.pts || 0) - (a.pts || 0) || (b.gd || 0) - (a.gd || 0));
        });
        setLeagues(leagueGroups);

        const totalWeight = basePlayers.reduce((acc, p) => acc + (p.tGoals * 5 + p.tAssists * 3), 0);
        const playersWithStats = basePlayers.map(p => {
          const score = (p.tGoals * 5 + p.tAssists * 3);
          const prob = totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 0;
          return { ...p, probability: prob };
        });

        setPlayers(playersWithStats);
        setLoading(false);
      } catch (e) {
        console.error("Standings Sync Error:", e);
        setLoading(false);
      }
    };
    fetchAllData();
  }, []);

  if (loading) return (
    <div className="relative min-h-screen flex flex-col items-center justify-center text-white overflow-hidden">
      <div className="relative z-10 flex flex-col items-center">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <Loader2 className="w-12 h-12 text-[#00ff88] animate-spin absolute" />
          <Goal className="w-5 h-5 text-neonBlue animate-pulse" />
        </div>
        <h2 className="text-white font-black italic tracking-tighter mt-4 animate-pulse uppercase">Syncing Pitch Data...</h2>
      </div>
    </div>
  );

  const activeGBPlayers = [...players].sort((a, b) => {
    if (gbFormat === '1v1') return (b.goals1v1 || 0) - (a.goals1v1 || 0);
    return (b.goals2v2 || 0) - (a.goals2v2 || 0) || (b.assists2v2 || 0) - (a.assists2v2 || 0);
  });

  const ballonDorPlayers = [...players].sort((a, b) => (b.probability || 0) - (a.probability || 0));

  const containerVariants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
  const itemVariants = { hidden: { opacity: 0, x: 15 }, show: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 120 } } };

  return (
    <div className="relative min-h-screen flex flex-col xl:flex-row gap-6 xl:gap-8 pb-24 xl:pb-20 text-white items-stretch w-full min-w-0 overflow-x-hidden">
      {/* LEFT COLUMN: LEAGUE TABLES & CAREER STATS */}
      <div className="flex-1 min-w-0 space-y-8 xl:space-y-12 xl:max-w-[calc(100%-410px)] relative z-10 w-full">
        
        {/* LEAGUE TABLES */}
        {Object.keys(leagues).map((groupKey) => {
          const leagueData = leagues[groupKey];
          if (!leagueData || leagueData.length === 0) return null;
          
          const leagueType = leagueData[0].type;
          const leagueFormat = leagueData[0].format;

          return (
            <div key={groupKey} className="relative overflow-hidden rounded-[20px] bg-white/[0.02] border border-white/10 backdrop-blur-sm p-3 sm:p-6">
              <img src={leagueIcons[leagueType]} className="absolute -right-10 -bottom-10 w-48 h-48 object-contain opacity-[0.02] pointer-events-none" alt="" />
              
              <div className="flex justify-between items-center mb-4 sm:mb-6 relative z-10">
                <div className="flex items-center gap-3">
                   <h2 className="text-2xl sm:text-3xl font-black italic tracking-tighter uppercase leading-none text-transparent bg-clip-text bg-gradient-to-r from-neonBlue to-[#00ff88]">
                     <span className="text-neonBlue lowercase italic">e</span>{leagueType.replace('e', '')}
                   </h2>
                   <span className="text-[9px] font-black uppercase tracking-widest bg-[#00ff88]/10 text-[#00ff88] px-2 py-1 rounded-md border border-[#00ff88]/20">{leagueFormat}</span>
                </div>
                <img src={leagueIcons[leagueType]} className="w-10 h-10 object-contain brightness-125 drop-shadow-[0_0_10px_rgba(0,243,255,0.3)]" alt="" />
              </div>

              {/* TIGHTER ELECTRIC PITCH BORDER TABLE */}
              <div className="relative p-[1px] rounded-2xl bg-gradient-to-r from-neonBlue via-[#00ff88] to-neonBlue animate-gradient-border shadow-[0_0_20px_rgba(0,255,136,0.1)] z-10 w-full min-w-0">
                <div className="bg-[#050b14] rounded-[15px] overflow-hidden relative pitch-lines w-full">
                  <div className="overflow-x-auto overflow-y-visible relative z-10 custom-scrollbar pb-2 -mx-1 px-1 sm:mx-0 sm:px-0" style={{ WebkitOverflowScrolling: 'touch' }}>
                    <table className="w-full min-w-[540px] text-left border-collapse whitespace-nowrap text-xs sm:text-sm">
                      <thead className="bg-[#0a1120]/80 border-b border-[#00ff88]/20 backdrop-blur-md">
                        <tr className="text-gray-400 text-[9px] sm:text-[10px] uppercase tracking-widest">
                          <th className="px-2 sm:px-3 py-2 sm:py-3 font-black text-center w-6 sm:w-8">#</th>
                          <th className="px-1.5 sm:px-2 py-2 sm:py-3 font-black min-w-[90px] sm:min-w-[120px]">Team</th>
                          <th className="px-1.5 sm:px-2 py-2 sm:py-3 text-center font-black">P</th>
                          <th className="px-1.5 sm:px-2 py-2 sm:py-3 text-center font-black text-[#00ff88]">W</th>
                          <th className="px-1.5 sm:px-2 py-2 sm:py-3 text-center font-black text-yellow-400">D</th>
                          <th className="px-1.5 sm:px-2 py-2 sm:py-3 text-center font-black text-red-400">L</th>
                          <th className="px-1.5 sm:px-2 py-2 sm:py-3 text-center font-black">GS/GC</th>
                          <th className="px-1.5 sm:px-2 py-2 sm:py-3 text-center font-black text-blue-400">GD</th>
                          <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[#00ff88] font-black">Pts</th>
                          <th className="px-2 sm:px-3 py-2 sm:py-3 text-right font-black">Form</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {leagueData.map((team, i) => (
                          <tr key={i} className="hover:bg-white/5 transition-colors group">
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center font-black text-gray-600 text-xs">{i + 1}</td>
                            <td className="px-1.5 sm:px-2 py-2 sm:py-2.5 font-black text-xs sm:text-sm uppercase tracking-tighter group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-neonBlue group-hover:to-[#00ff88] transition-all">
                              {formatTeamName(team.name)}
                            </td>
                            <td className="px-1.5 sm:px-2 py-2 sm:py-2.5 text-center text-gray-400 font-bold text-xs">{team.mp}</td>
                            <td className="px-1.5 sm:px-2 py-2 sm:py-2.5 text-center text-[#00ff88] font-bold text-xs">{team.w}</td>
                            <td className="px-1.5 sm:px-2 py-2 sm:py-2.5 text-center text-yellow-400 font-bold text-xs">{team.d}</td>
                            <td className="px-1.5 sm:px-2 py-2 sm:py-2.5 text-center text-red-400 font-bold text-xs">{team.l}</td>
                            <td className="px-1.5 sm:px-2 py-2 sm:py-2.5 text-center font-black text-xs tracking-wider">
                              <span className="text-cyan-400">{team.gs}</span>
                              <span className="text-gray-600 mx-0.5">/</span>
                              <span className="text-fuchsia-400">{team.gc}</span>
                            </td>
                            
                            <td className={`px-1.5 sm:px-2 py-2 sm:py-2.5 text-center font-black text-xs ${team.gd > 0 ? 'text-[#00ff88]' : team.gd < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                              {team.gd > 0 ? `+${team.gd}` : team.gd}
                            </td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center font-black text-lg sm:text-xl text-[#00ff88] drop-shadow-[0_0_5px_rgba(0,255,136,0.3)] italic leading-none">{team.pts || 0}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5">
                              <div className="flex justify-end gap-1">
                                {team.form.map((f, idx) => (
                                  <div key={idx} className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black border ${f === 'W' ? 'bg-[#00ff88]/20 border-[#00ff88]/50 text-[#00ff88]' : f === 'D' ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' : 'bg-red-500/20 border-red-500/50 text-red-400'}`}>{f}</div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* FC ULTIMATE TEAM STYLE CAREER STATS */}
        <div className="relative overflow-visible rounded-[20px] bg-white/[0.02] border border-white/10 backdrop-blur-sm p-4 sm:p-6 w-full min-w-0">
          <div className="flex items-center gap-3 mb-6 sm:mb-8">
             <Activity className="w-6 h-6 text-[#00ff88] shrink-0" /> 
             <h3 className="text-xl sm:text-2xl font-black text-white italic tracking-tighter uppercase">Squad Career Stats</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5 w-full min-w-0">
            {players.map(player => (
              <PlayerStatRow key={player.id} player={player} />
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: SMART STICKY HUD */}
      <div className="w-full xl:w-[380px] flex flex-col gap-6 xl:gap-8 xl:sticky xl:top-6 xl:max-h-[calc(100vh-48px)] overflow-y-auto no-scrollbar pr-1 pb-6 min-w-0 shrink-0 xl:shrink-0" style={{ WebkitMaskImage: 'linear-gradient(to bottom, black 98%, transparent 100%)', maskImage: 'linear-gradient(to bottom, black 98%, transparent 100%)' }}>
        
        {/* WIDGET 1: DYNAMIC GOLDEN BOOT */}
        <div className="relative rounded-[20px] bg-[#0a1120]/80 border border-neonGold/30 backdrop-blur-md p-6 flex flex-col shrink-0 overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)]">
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-yellow-500/10 rounded-full blur-3xl pointer-events-none transform-gpu" />
          
          <div className="flex items-start justify-between mb-6 relative z-10">
            <div>
              <div className="flex items-center gap-2 text-neonGold font-black italic uppercase">
                <Medal className="w-6 h-6" /> <h2>Golden Boot</h2>
              </div>
              <p className="text-[9px] text-gray-400 uppercase tracking-widest mt-1">Tournament Leaders</p>
            </div>

            <div className="flex bg-[#050b14] p-1 rounded-xl border border-white/10">
               <button onClick={() => setGbFormat('1v1')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${gbFormat === '1v1' ? 'bg-neonGold text-black shadow-md' : 'text-gray-500 hover:text-white'}`}>
                 <User className="w-3 h-3" /> 1v1
               </button>
               <button onClick={() => setGbFormat('2v2')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${gbFormat === '2v2' ? 'bg-neonGold text-black shadow-md' : 'text-gray-500 hover:text-white'}`}>
                 <Users className="w-3 h-3" /> 2v2
               </button>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={gbFormat} variants={containerVariants} initial="hidden" animate="show" exit={{ opacity: 0, y: -10 }} className="space-y-4 relative z-10">
              
              {/* Rank 1 */}
              {activeGBPlayers[0] && (
                <motion.div variants={itemVariants} className="relative bg-gradient-to-br from-[#1a1405] to-black border border-neonGold/40 rounded-2xl p-4 overflow-hidden group hover:border-neonGold transition-all shrink-0">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/10 rounded-full blur-2xl transform-gpu" />
                  <div className="flex items-center gap-4 relative z-10">
                    <div className="relative">
                      <div className="w-14 h-14 rounded-full border-2 border-neonGold overflow-hidden bg-black shadow-[0_0_15px_rgba(234,179,8,0.3)]">
                        {activeGBPlayers[0].videoUrl ? <video src={activeGBPlayers[0].videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-900" />}
                      </div>
                      <div className="absolute -bottom-2 -right-2 bg-neonGold text-black text-[10px] font-black px-1.5 py-0.5 rounded border border-[#121212]">#1</div>
                    </div>
                    <div className="flex-1">
                      <p className="font-black uppercase tracking-tighter text-lg leading-none truncate text-white group-hover:text-neonGold transition-colors">{activeGBPlayers[0].name.split(' ')[0]}</p>
                      <p className="text-[9px] text-yellow-500 font-bold uppercase tracking-widest mt-1">Top Scorer</p>
                    </div>
                    <div className="text-right">
                      <motion.p initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200, delay: 0.5 }} className="text-4xl font-black italic text-neonGold drop-shadow-[0_2px_10px_rgba(234,179,8,0.3)]">
                        {gbFormat === '1v1' ? (activeGBPlayers[0].goals1v1 || 0) : (activeGBPlayers[0].goals2v2 || 0)}
                      </motion.p>
                      <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">Goals</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Rank 2 & 3 */}
              <div className="grid grid-cols-2 gap-3 mt-2 shrink-0">
                {[1, 2].map((idx) => activeGBPlayers[idx] && (
                  <motion.div key={idx} variants={itemVariants} className={`flex flex-col items-center text-center p-3 rounded-2xl bg-[#050b14]/80 border ${idx === 1 ? 'border-gray-400/30' : 'border-orange-700/30'} transition-colors`}>
                    <div className={`w-10 h-10 rounded-full border-2 mb-2 overflow-hidden bg-black ${idx === 1 ? 'border-gray-400 shadow-[0_0_10px_rgba(156,163,175,0.2)]' : 'border-orange-600 shadow-[0_0_10px_rgba(234,88,12,0.2)]'}`}>
                      {activeGBPlayers[idx].videoUrl ? <video src={activeGBPlayers[idx].videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-900" />}
                    </div>
                    <p className="font-black uppercase text-[10px] text-gray-300 truncate w-full mb-1">{activeGBPlayers[idx].name.split(' ')[0]}</p>
                    <div className="flex items-center gap-1.5 bg-black/40 px-3 py-1 rounded-full border border-white/5">
                      <Goal className={`w-3 h-3 ${idx === 1 ? 'text-gray-400' : 'text-orange-500'}`} />
                      <span className="font-black italic text-sm text-white">{gbFormat === '1v1' ? (activeGBPlayers[idx].goals1v1 || 0) : (activeGBPlayers[idx].goals2v2 || 0)}</span>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Remaining Players */}
              {activeGBPlayers.length > 3 && (
                <div className="flex flex-col gap-2 pt-2">
                  {activeGBPlayers.slice(3).map((player, idx) => (
                    <motion.div key={player.id} variants={itemVariants} className="flex items-center justify-between p-2.5 rounded-xl bg-[#050b14]/60 border border-white/5 hover:border-white/10 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-600 font-black italic text-[10px] w-4">#{idx + 4}</span>
                        <div className="w-7 h-7 rounded-full overflow-hidden bg-black border border-white/10">
                          {player.videoUrl ? <video src={player.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-900" />}
                        </div>
                        <p className="font-black uppercase text-[10px] text-gray-400 truncate max-w-[100px]">{player.name.split(' ')[0]}</p>
                      </div>
                      <div className="flex items-center gap-1.5 px-2">
                        <span className="font-black italic text-sm text-gray-300">{gbFormat === '1v1' ? (player.goals1v1 || 0) : (player.goals2v2 || 0)}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* WIDGET 2: BALLON D'OR - LAVA FLOW */}
        <div className="relative rounded-[20px] bg-[#0a1120]/80 border border-neonGold/30 backdrop-blur-md p-6 flex flex-col shrink-0 overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)]">
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #00ff88 1px, transparent 0)', backgroundSize: '24px 24px' }} />
          
          <div className="flex items-center justify-between mb-8 relative z-10 shrink-0">
            <div>
              <div className="flex items-center gap-2 text-neonGold font-black italic uppercase">
                <Crown className="w-6 h-6" /> <h2>Ballon d'Or</h2>
              </div>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest mt-1 leading-none">Live Win Probability</p>
            </div>
            <Sparkles className="w-5 h-5 text-neonGold animate-pulse opacity-50" />
          </div>

          <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-4 relative z-10 overflow-visible pr-1">
            {ballonDorPlayers.map((player, idx) => {
              
              let rankStyle = {};
              if (idx === 0) rankStyle = { bg: "bg-[#1a1405] border-neonGold/40 shadow-[0_0_20px_rgba(253,224,71,0.1)]", text: "text-neonGold", bar: "from-yellow-600 via-yellow-200 to-yellow-600", sparkColor: "bg-yellow-300 shadow-[0_0_8px_rgba(253,224,71,1)]", badge: "The Star" };
              else if (idx === 1) rankStyle = { bg: "bg-[#050b14] border-gray-400/30", text: "text-gray-300", bar: "from-gray-500 via-gray-100 to-gray-500", sparkColor: "bg-white shadow-[0_0_8px_rgba(255,255,255,1)]", badge: "Contender" };
              else if (idx === 2) rankStyle = { bg: "bg-[#140a05] border-orange-700/30", text: "text-orange-500", bar: "from-orange-700 via-orange-300 to-orange-700", sparkColor: "bg-orange-300 shadow-[0_0_8px_rgba(251,146,60,1)]", badge: "Podium" };
              else rankStyle = { bg: "bg-white/5 border-white/5", text: "text-blue-400", bar: "from-[#00ff88] via-cyan-300 to-[#00ff88]", sparkColor: "bg-[#00ff88] shadow-[0_0_8px_rgba(0,255,136,1)]", badge: "Nominee" };

              return (
                <motion.div variants={itemVariants} key={player.id} className={`relative p-3.5 rounded-xl border ${rankStyle.bg} overflow-hidden group transition-all hover:scale-[1.02]`}>
                  <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl pointer-events-none transform-gpu ${idx === 0 ? 'bg-yellow-500/10' : idx === 1 ? 'bg-gray-400/5' : idx === 2 ? 'bg-orange-600/10' : 'bg-[#00ff88]/10' }`} />

                  <div className="flex items-center justify-between mb-3 relative z-10">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className={`w-10 h-10 rounded-full border-2 overflow-hidden bg-black ${idx === 0 ? 'border-neonGold shadow-[0_0_15px_rgba(250,204,21,0.4)]' : 'border-white/10'}`}>
                          {player.videoUrl ? <video src={player.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover scale-110" /> : <div className="w-full h-full bg-gray-800" />}
                        </div>
                        <span className={`absolute -bottom-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full text-[8px] font-black border border-black bg-black ${rankStyle.text}`}>{idx + 1}</span>
                      </div>
                      
                      <div>
                        <p className="text-xs font-black uppercase tracking-tighter leading-none mb-1 text-white truncate max-w-[120px]">{player.name.split(' ')[0]}</p>
                        <div className="flex gap-2 items-center leading-none">
                           <span className={`text-[7px] font-black tracking-widest uppercase border px-1 rounded-sm ${rankStyle.text} border-current opacity-70`}>{rankStyle.badge}</span>
                           <span className="text-[9px] text-gray-500 font-bold uppercase flex gap-1 items-baseline"><span className="text-gray-300 leading-none">{player.tGoals || 0}</span>G</span>
                           <span className="text-[9px] text-gray-500 font-bold uppercase flex gap-1 items-baseline"><span className="text-gray-300 leading-none">{player.tAssists || 0}</span>A</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <span className={`font-black text-lg italic drop-shadow-md leading-none ${rankStyle.text}`}>{player.probability || 0}%</span>
                    </div>
                  </div>

                  <div className="h-1.5 w-full bg-black/80 rounded-full border border-white/5 relative z-10 flex items-center">
                    <motion.div 
                      initial={{ width: 0 }} 
                      animate={{ width: `${player.probability || 0}%` }} 
                      transition={{ duration: 2.5, ease: "easeOut", delay: 0.2 }} 
                      className={`h-full bg-gradient-to-r ${rankStyle.bar} animate-lava relative flex justify-end items-center rounded-full`}
                    >
                       <div className="absolute right-0 translate-x-1/2 flex items-center justify-center w-4 h-4">
                          <div className={`absolute w-3 h-3 rounded-full ${rankStyle.sparkColor} animate-ping opacity-60`} />
                          <div className="w-1.5 h-1.5 bg-white rounded-full z-10 shadow-[0_0_5px_rgba(255,255,255,1)]" />
                       </div>
                    </motion.div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>

      </div>

      <style jsx global>{`
        /* CUSTOM SCROLLBAR - TABLES: touch-friendly on mobile */
        .custom-scrollbar::-webkit-scrollbar {
          height: 8px;
        }
        @media (max-width: 640px) {
          .custom-scrollbar::-webkit-scrollbar {
            height: 10px;
          }
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 255, 136, 0.02);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(to right, rgba(0, 255, 136, 0.4), rgba(0, 243, 255, 0.4));
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(to right, rgba(0, 255, 136, 0.8), rgba(0, 243, 255, 0.8));
        }

        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

        @keyframes lava-flow {
          0% { background-position: 200% 50%; }
          100% { background-position: -200% 50%; }
        }
        .animate-lava {
          background-size: 200% 100%;
          animation: lava-flow 3s linear infinite;
        }

        @keyframes gradient-border {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient-border {
          background-size: 200% 200%;
          animation: gradient-border 4s ease infinite;
        }

        /* Football Hex Mesh Background applied to the main wrapper */
        .hex-bg {
          background-color: #020617;
          background-image: url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 34.641l-10-5.774v-11.547l10-5.774 10 5.774v11.547l-10 5.774zm0-2.31l8-4.619v-9.238l-8-4.619-8 4.619v9.238l8 4.619zM10 17.321L0 11.547v-11.547l10-5.774 10 5.774v11.547l-10 5.774zm0-2.31l8-4.619v-9.238l-8-4.619-8 4.619v9.238l8 4.619zM30 17.321l-10-5.774v-11.547l10-5.774 10 5.774v11.547l-10 5.774zm0-2.31l8-4.619v-9.238l-8-4.619-8 4.619v9.238l8 4.619zM0 34.641v-11.547l10-5.774v11.547l-10 5.774zM40 34.641v-11.547l-10-5.774v11.547l10 5.774z' fill='%23ffffff' fill-opacity='0.02' fill-rule='evenodd'/%3E%3C/svg%3E");
        }

        /* Subtle Pitch Lines for Table Backgrounds */
        .pitch-lines {
          background-image: repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(255,255,255,0.02) 40px, rgba(255,255,255,0.02) 80px);
        }
      `}</style>
    </div>
  );
}

// FC ULTIMATE TEAM STYLE PLAYER CARD
function PlayerStatRow({ player }) {
  const totalRating = (player.tGoals || 0) + (player.tAssists || 0);
  
  // Dynamic border glow based on how high their rating is
  const isTopTier = totalRating >= 15;
  const cardBorder = isTopTier ? "border-neonGold shadow-[0_0_15px_rgba(212,175,55,0.15)]" : "border-white/10 hover:border-[#00ff88]/50";
  const glow = isTopTier ? "from-yellow-500/10" : "from-[#00ff88]/5";

  return (
    <div className={`relative p-[1px] rounded-[18px] bg-gradient-to-b ${glow} to-transparent overflow-hidden group transition-all w-full min-w-0`}>
      <div className={`flex flex-col h-full min-h-0 bg-[#0a1120]/90 rounded-[17px] border ${cardBorder} transition-colors backdrop-blur-sm`}>
        
        {/* Top Profile Section */}
        <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 border-b border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-white/5 to-transparent rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
          
          <div className="relative shrink-0">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 border-white/20 overflow-hidden bg-black shadow-lg">
               {player.videoUrl ? <video src={player.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover scale-110" /> : <div className="w-full h-full bg-gray-800" />}
            </div>
            {/* OVR Rating Badge */}
            <div className={`absolute -bottom-2 -right-2 w-7 h-7 flex items-center justify-center rounded-lg border-2 border-[#0a1120] font-black text-[10px] ${isTopTier ? 'bg-neonGold text-black' : 'bg-[#00ff88] text-black'}`}>
               {totalRating}
            </div>
          </div>
          
          <div className="flex-1">
            {/* Using first name logic here too for consistency! */}
            <p className="font-black text-sm uppercase tracking-tighter leading-none text-white group-hover:text-[#00ff88] transition-colors">{player.name.split(' ')[0]}</p>
            <p className="text-[9px] text-gray-500 font-bold uppercase mt-1 tracking-widest">Career G/A</p>
          </div>
        </div>

        {/* Bottom Attributes Section (EA FC Style Grid) */}
        <div className="grid grid-cols-3 divide-x divide-white/5 p-2 sm:p-3 bg-black/40 min-w-0">
          <div className="flex flex-col items-center justify-center">
             <p className="text-sm font-black text-white leading-none">{player.goals1v1 || 0}</p>
             <p className="text-[8px] text-gray-500 uppercase font-bold mt-1 tracking-widest">1v1 Gls</p>
          </div>
          <div className="flex flex-col items-center justify-center">
             <p className="text-sm font-black text-white leading-none">{player.goals2v2 || 0}</p>
             <p className="text-[8px] text-gray-500 uppercase font-bold mt-1 tracking-widest">2v2 Gls</p>
          </div>
          <div className="flex flex-col items-center justify-center">
             <p className="text-sm font-black text-white leading-none">{player.assists2v2 || 0}</p>
             <p className="text-[8px] text-gray-500 uppercase font-bold mt-1 tracking-widest">2v2 Ast</p>
          </div>
        </div>

      </div>
    </div>
  );
}