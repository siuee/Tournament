import { useState, useRef, useEffect } from 'react';
import { Camera, Plus, X, Video, Trash2, Edit2, ShieldCheck, UserPlus, Sparkles, Hash, Zap, TrendingUp, CalendarDays } from 'lucide-react';
import { toTitleCase } from '../lib/utils';
import { db, storage } from '../firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { motion, AnimatePresence } from 'framer-motion';
import { verifyDeletePassword } from '../lib/security';

export default function LockerRoom() {
  const [players, setPlayers] = useState([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const clickOriginRef = useRef({ x: 0, y: 0 });

  // Form State
  const [formData, setFormData] = useState({ name: '', nickname: '' });
  const [tempVideoUrl, setTempVideoUrl] = useState(null);
  const [tempVideoBlob, setTempVideoBlob] = useState(null);

  // Studio State
  const [stream, setStream] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const countdownTimerRef = useRef(null);
  const recordingStopTimeoutRef = useRef(null);
  const streamRef = useRef(null);

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

  useEffect(() => {
    fetchPlayersAndSyncSeason();
  }, []);

  // Clean up studio timers and media on unmount (prevents RAM/CPU leak when switching tabs)
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (recordingStopTimeoutRef.current) clearTimeout(recordingStopTimeoutRef.current);
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  // --- THE MONTHLY PROGRESSION ENGINE ---
  const fetchPlayersAndSyncSeason = async () => {
    try {
      const currentMonth = new Date().toISOString().slice(0, 7); // Format: "YYYY-MM"
      
      const pSnap = await getDocs(collection(db, "players"));
      const tSnap = await getDocs(collection(db, "tournaments"));
      
      // 1. Initialize player tracking map
      const playerStats = {};
      pSnap.docs.forEach(d => {
        playerStats[d.id] = { ...d.data(), id: d.id, mGoals: 0, mAssists: 0 };
      });

      // 2. Scan ONLY tournaments created in the current month
      tSnap.docs.forEach(doc => {
        const data = doc.data();
        let tMonth = '';
        if (data.createdAt) {
           const tDate = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
           tMonth = tDate.toISOString().slice(0, 7);
        }
        
        // If it's this month's tournament, add up the stats
        if (tMonth === currentMonth && data.teams) {
          data.teams.forEach(team => {
            if (team.playerData) {
              team.playerData.forEach(pd => {
                if (playerStats[pd.id]) {
                  playerStats[pd.id].mGoals += (pd.tournamentGoals || 0);
                  playerStats[pd.id].mAssists += (pd.tournamentAssists || 0);
                }
              });
            }
          });
        }
      });

      const batch = writeBatch(db);
      let batchCount = 0;
      const finalPlayers = [];

      // 3. Calculate new stats & Check for Monthly Resets
      Object.values(playerStats).forEach(p => {
         const stats = generateDynamicStats(p.mGoals, p.mAssists, p.name);
         const calculatedOvr = stats.ovr;

         // If the month changed OR their OVR changed, STORE IT IN THE DATABASE
         if (p.lastResetMonth !== currentMonth || p.ovr !== calculatedOvr) {
            batch.update(doc(db, "players", p.id), {
               ovr: calculatedOvr,
               lastResetMonth: currentMonth,
               monthlyGoals: p.mGoals,
               monthlyAssists: p.mAssists
            });
            batchCount++;
         }

         finalPlayers.push({ ...p, stats });
      });

      // Commit the resets/updates to Firebase
      if (batchCount > 0) {
         await batch.commit();
      }

      // 4. Sort roster: Highest OVR first
      finalPlayers.sort((a, b) => {
        if (b.stats.ovr !== a.stats.ovr) return b.stats.ovr - a.stats.ovr;
        if (b.mGoals !== a.mGoals) return b.mGoals - a.mGoals;
        return (a.name || "").localeCompare(b.name || "");
      });

      setPlayers(finalPlayers);
      setLoading(false);
    } catch (error) {
      console.error("Error syncing seasonal data: ", error);
      setLoading(false);
    }
  };

  // THE EA FC ALGORITHM (Base 75 -> Hard 99)
  const generateDynamicStats = (goals, assists, name) => {
    // Math: Goals are worth 0.25 points, Assists worth 0.15. 
    // To go from 75 to 99 (+24), you need roughly 80 goals and 30 assists!
    const ovr = Math.min(99, Math.max(75, 75 + Math.floor((goals * 0.25) + (assists * 0.15))));
    
    return {
      ovr: ovr,
      pac: Math.min(99, 75 + Math.floor((goals + assists) * 0.15)),
      sho: Math.min(99, 70 + Math.floor(goals * 0.3)),
      pas: Math.min(99, 72 + Math.floor(assists * 0.4)),
      dri: Math.min(99, 76 + Math.floor((goals + assists) * 0.1)),
      def: Math.min(99, 45 + Math.floor(assists * 0.2)),
      phy: Math.min(99, 70 + Math.floor(goals * 0.15))
    };
  };

  const formatName = (fullName) => {
    if (!fullName || typeof fullName !== 'string') return { first: '', last: 'UNKNOWN' };
    const parts = fullName.trim().split(' ');
    if (parts.length === 1) return { first: '', last: parts[0] };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  };

  // --- STUDIO LOGIC ---
  const enterStudio = async (e) => {
    if (e?.clientX != null && e?.clientY != null) {
      clickOriginRef.current = { x: e.clientX, y: e.clientY };
    }
    setIsStudioOpen(true);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      if (videoRef.current) videoRef.current.srcObject = mediaStream;
    } catch (err) {
      alert("Camera access denied.");
      setIsStudioOpen(false);
    }
  };

  const closeStudio = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (recordingStopTimeoutRef.current) {
      clearTimeout(recordingStopTimeoutRef.current);
      recordingStopTimeoutRef.current = null;
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (stream) stream.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStream(null);
    setIsStudioOpen(false);
    setCountdown(null);
  };

  const startRecording = () => {
    let count = 3;
    setCountdown(count);
    const timer = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count === 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        executeCapture();
      }
    }, 1000);
    countdownTimerRef.current = timer;
  };

  const executeCapture = () => {
    setCountdown('RECORDING!');
    setIsRecording(true);
    chunksRef.current = [];
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      setTempVideoBlob(blob);
      setTempVideoUrl(URL.createObjectURL(blob));
      setIsRecording(false);
      closeStudio();
    };
    mediaRecorder.start();
    recordingStopTimeoutRef.current = setTimeout(() => mediaRecorder.stop(), 3000);
  };

  // --- DATABASE LOGIC ---
  const handleSavePlayer = async (e) => {
    e.preventDefault();
    const id = editingPlayer ? editingPlayer.id : `player_${Date.now()}`;
    let finalVideoUrl = editingPlayer ? editingPlayer.videoUrl : null;
  
    try {
      if (tempVideoBlob) {
        const storageRef = ref(storage, `motion_stickers/${id}.webm`);
        await uploadBytes(storageRef, tempVideoBlob);
        finalVideoUrl = await getDownloadURL(storageRef);
      }
  
      // Only set static identity data. Stats are calculated automatically!
      const playerData = {
        name: formData.name || 'Unknown Player',
        nickname: formData.nickname || '',
        videoUrl: finalVideoUrl,
      };
  
      await setDoc(doc(db, "players", id), playerData, { merge: true });
      resetForm();
      await fetchPlayersAndSyncSeason(); 
    } catch (error) {
      console.error("Save failed:", error);
    }
  };

  const handleDeletePlayer = async (id) => {
    const password = window.prompt("Enter admin password to delete this player:");
    if (!password) return;

    const ok = await verifyDeletePassword(password);
    if (!ok) {
      alert("Incorrect password. Player was not deleted.");
      return;
    }

    const sure = window.confirm("Are you sure you want to permanently delete this player from the squad?");
    if (!sure) return;

    try {
      await deleteDoc(doc(db, "players", id));
      fetchPlayersAndSyncSeason();
    } catch (e) {
      console.error("Failed to delete player:", e);
      alert("Something went wrong while deleting the player. Please try again.");
    }
  };

  const resetForm = () => {
    setIsFormOpen(false);
    setEditingPlayer(null);
    setFormData({ name: '', nickname: '' });
    setTempVideoUrl(null);
    setTempVideoBlob(null);
  };

  const containerVariants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
  const itemVariants = { hidden: { opacity: 0, scale: 0.8, y: 20 }, show: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 150 } } };

  const fcCardShape = "polygon(10% 0, 90% 0, 100% 8%, 100% 85%, 50% 100%, 0 85%, 0 8%)";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#020617] text-yellow-500 font-black tracking-widest uppercase flex-col gap-4">
        <ShieldCheck className="w-12 h-12 animate-pulse" />
        Syncing Monthly Form...
      </div>
    );
  }

  return (
    <div className="min-h-screen relative text-white pb-32 overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-8 pt-6 pb-4 border-b border-yellow-500/20 mb-4 md:mb-8 bg-black/60 backdrop-blur-xl sticky top-0 z-30 flex justify-between items-center shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
         <div className="min-w-0 flex-1 pr-2">
            <h2 className="text-3xl md:text-5xl font-black italic uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 via-yellow-500 to-yellow-700 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] flex items-center gap-3 pr-2">
              My Club
            </h2>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-1.5"><TrendingUp className="w-3 h-3 text-yellow-500"/> Live Ratings</p>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-gradient-to-r from-yellow-600 to-yellow-500 text-black text-[9px] font-black shadow-[0_0_10px_rgba(234,179,8,0.4)]">
                <CalendarDays className="w-2.5 h-2.5" /> SEASON: {new Date().toLocaleString('default', { month: 'short' }).toUpperCase()}
              </div>
            </div>
         </div>
         <motion.button 
           onClick={(e) => openWithClick(() => setIsFormOpen(true), e)}
           whileHover={{ scale: 1.05 }}
           whileTap={{ scale: 0.95 }}
           className="hidden md:flex bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-600 px-6 py-3 rounded-xl font-black uppercase text-xs tracking-widest text-black shadow-[0_0_20px_rgba(234,179,8,0.4)] items-center gap-2 border border-yellow-200/50"
         >
           <UserPlus className="w-4 h-4" /> Open Pack
         </motion.button>
      </div>

      {/* MOBILE OPEN PACK BUTTON – placed under header so it never hides behind bottom navbar */}
      <div className="md:hidden px-4 pb-4">
        <motion.button 
          onClick={(e) => openWithClick(() => setIsFormOpen(true), e)} 
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="w-full bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-600 py-3 rounded-2xl font-black uppercase tracking-[0.2em] text-xs text-black shadow-[0_8px_20px_rgba(234,179,8,0.4)] flex items-center justify-center gap-2 border border-yellow-200"
        >
          <UserPlus className="w-4 h-4" /> Open Pack
        </motion.button>
      </div>

      {/* FC PLAYER CARDS GRID */}
      <div className="px-4 md:px-8 relative z-10 w-full max-w-[1600px] mx-auto">
        {players.length === 0 && (
           <div className="text-center py-20 text-gray-500 font-black tracking-widest uppercase text-xs">
              No players found in club...
           </div>
        )}
        
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6 md:gap-8 justify-items-center">
          {players.map((player, idx) => {
            const { first, last } = formatName(player.name);
            const stats = player.stats;
            
            // Reached 99? Give them the ultimate glowing aesthetic!
            const isMaxLevel = stats.ovr >= 99;
            const isTop3 = idx < 3;
            
            return (
              <motion.div 
                variants={itemVariants}
                key={player.id} 
                className="w-full max-w-[280px] aspect-[2/3] relative group perspective-1000 cursor-pointer"
              >
                <div className="w-full h-full relative transform-gpu transition-all duration-300 ease-out group-hover:scale-[1.05] group-hover:-translate-y-2 drop-shadow-[0_15px_25px_rgba(0,0,0,0.8)]">
                  
                  {/* EDIT/DELETE ACTIONS */}
                  <div className="absolute -top-3 -right-3 flex gap-2 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <motion.button onClick={(e) => { e.stopPropagation(); setEditingPlayer(player); setFormData({ name: player.name, nickname: player.nickname }); setIsFormOpen(true); }} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }} className="p-2 bg-yellow-500 text-black rounded-full shadow-lg"><Edit2 className="w-3.5 h-3.5" /></motion.button>
                    <motion.button onClick={(e) => { e.stopPropagation(); handleDeletePlayer(player.id); }} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }} className="p-2 bg-red-600 text-white rounded-full shadow-lg"><Trash2 className="w-3.5 h-3.5" /></motion.button>
                  </div>

                  {/* OUTER GOLD BORDER */}
                  <div 
                    className={`absolute inset-0 bg-gradient-to-br ${isMaxLevel ? 'from-white via-yellow-200 to-yellow-500 shadow-[0_0_30px_rgba(255,255,255,0.5)]' : isTop3 ? 'from-yellow-100 via-yellow-500 to-yellow-800' : 'from-yellow-400/50 via-yellow-700/50 to-yellow-900/50'} p-[2px] group-hover:from-white group-hover:via-yellow-400 group-hover:to-yellow-700 transition-all`}
                    style={{ clipPath: fcCardShape }}
                  >
                    
                    {/* INNER CARD BODY */}
                    <div 
                      className={`w-full h-full bg-gradient-to-b ${isMaxLevel ? 'from-[#3a2f15] via-[#1a140a]' : isTop3 ? 'from-[#2a2415] via-[#0a0a0a]' : 'from-[#121212] via-black'} to-black relative flex flex-col items-center overflow-hidden`}
                      style={{ clipPath: fcCardShape }}
                    >
                      
                      {/* Background Details */}
                      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(234, 179, 8, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(234, 179, 8, 0.2) 1px, transparent 1px)', backgroundSize: '15px 15px' }} />
                      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] ${isMaxLevel ? 'from-white/30' : isTop3 ? 'from-yellow-600/30' : 'from-yellow-600/10'} via-transparent to-transparent opacity-50 mix-blend-screen`} />

                      {/* TOP LEFT: OVR & POSITION */}
                      <div className="absolute top-4 left-3 md:top-5 md:left-4 flex flex-col items-center z-20 drop-shadow-[0_2px_4px_rgba(0,0,0,1)]">
                        <span className={`text-2xl md:text-3xl font-black leading-none tracking-tighter ${isMaxLevel ? 'text-transparent bg-clip-text bg-gradient-to-b from-white to-yellow-200 drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]' : 'text-white'}`}>{stats.ovr}</span>
                        <span className="text-xs md:text-sm font-black text-yellow-500 uppercase tracking-widest leading-none mt-0.5">ST</span>
                        <div className="w-6 h-[1px] bg-yellow-500/50 mt-1 mb-1" />
                        <img src="/assets/leagues/nepal.svg" className="w-4 h-3 md:w-5 md:h-4 object-cover rounded-[1px] opacity-90" alt="Nation" />
                      </div>

                      {/* CLUB RANK BADGE */}
                      <div className="absolute top-4 right-3 md:top-5 md:right-4 flex flex-col items-center z-20">
                        <div className="flex flex-col items-center justify-center min-w-[36px] px-2 py-1 rounded-lg bg-black/80 backdrop-blur-sm border border-yellow-500/60 shadow-[0_0_12px_rgba(234,179,8,0.3)] group-hover:border-yellow-400 group-hover:shadow-[0_0_16px_rgba(234,179,8,0.5)] transition-all">
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-yellow-400 leading-none mb-0.5 drop-shadow-[0_0_6px_rgba(234,179,8,0.6)]">Rank</span>
                          <span className="text-base font-black text-yellow-300 italic leading-none drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]">#{idx + 1}</span>
                        </div>
                      </div>

                      {/* CENTER PLAYER VIDEO (Faded Mask) */}
                      <div className="absolute top-0 left-0 right-0 h-[60%] z-10 flex items-end justify-center pointer-events-none" style={{ maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)' }}>
                        {player.videoUrl ? (
                          <video src={player.videoUrl} autoPlay loop muted playsInline preload="metadata" className="w-full h-[120%] object-cover object-top" />
                        ) : (
                          <div className="w-24 h-24 mb-10 rounded-full border border-yellow-500/30 bg-[#121212] flex items-center justify-center shadow-[0_0_30px_rgba(234,179,8,0.2)]">
                            <Camera className="text-yellow-600/50 w-8 h-8" />
                          </div>
                        )}
                      </div>

                      {/* BOTTOM HALF: STATS & NAME */}
                      <div className="absolute bottom-0 left-0 right-0 h-[45%] flex flex-col items-center justify-end pb-3 md:pb-4 px-2 z-20">
                        
                        <div className="flex flex-col items-center w-full px-4 mb-1">
                          {first && (
                            <span className="font-sport text-sm md:text-base text-yellow-500 font-semibold tracking-[0.2em] leading-none mb-0.5 text-center w-full truncate drop-shadow-[0_2px_2px_rgba(0,0,0,1)]">
                              {toTitleCase(first)}
                            </span>
                          )}
                          <span className={`font-sport text-2xl md:text-3xl font-semibold tracking-wide text-center leading-none w-full break-words drop-shadow-[0_2px_4px_rgba(0,0,0,1)] line-clamp-1 ${isMaxLevel ? 'text-transparent bg-clip-text bg-gradient-to-b from-white to-yellow-200' : 'text-white'}`}>
                            {toTitleCase(last)}
                          </span>
                        </div>

                        <div className="w-3/4 h-[1px] bg-gradient-to-r from-transparent via-yellow-500/50 to-transparent my-1 md:my-2" />

                        {/* Authentic FC Stats Grid */}
                        <div className="grid grid-cols-6 w-full px-2 gap-x-1 gap-y-0.5 text-center">
                          <div className="flex flex-col"><span className="text-xs md:text-sm font-black text-white leading-none">{stats.pac}</span><span className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase">PAC</span></div>
                          <div className="flex flex-col"><span className="text-xs md:text-sm font-black text-white leading-none">{stats.sho}</span><span className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase">SHO</span></div>
                          <div className="flex flex-col"><span className="text-xs md:text-sm font-black text-white leading-none">{stats.pas}</span><span className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase">PAS</span></div>
                          <div className="flex flex-col"><span className="text-xs md:text-sm font-black text-white leading-none">{stats.dri}</span><span className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase">DRI</span></div>
                          <div className="flex flex-col"><span className="text-xs md:text-sm font-black text-white leading-none">{stats.def}</span><span className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase">DEF</span></div>
                          <div className="flex flex-col"><span className="text-xs md:text-sm font-black text-white leading-none">{stats.phy}</span><span className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase">PHY</span></div>
                        </div>

                        <div className="mt-2 text-yellow-500 opacity-60">
                           <Zap className={`w-3 h-3 md:w-4 md:h-4 fill-current ${isMaxLevel ? 'drop-shadow-[0_0_10px_rgba(255,255,255,0.8)] text-white' : ''}`} />
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* ADD / EDIT PLAYER MODAL */}
      <AnimatePresence>
        {isFormOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4">
            <motion.div
              initial={getClickOriginVariant()}
              animate={{ scale: 1, opacity: 1, x: 0, y: 0 }}
              exit={getClickOriginVariant()}
              transition={{ type: "spring", stiffness: 350, damping: 28 }}
              className="bg-gradient-to-b from-[#1a1813] to-black border border-yellow-600 w-full max-w-md p-8 rounded-[30px] shadow-[0_0_80px_rgba(234,179,8,0.2)] relative max-h-[90vh] overflow-y-auto no-scrollbar"
            >
              <button onClick={resetForm} className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors p-2"><X /></button>
              
              <div className="text-center mb-8">
                 <p className="text-yellow-500 text-[10px] font-black tracking-widest uppercase mb-1">Scouting Network</p>
                 <h2 className="text-3xl font-black italic uppercase text-white drop-shadow-[0_2px_4px_rgba(0,0,0,1)]">{editingPlayer ? 'Update Item' : 'Draft Item'}</h2>
              </div>
              
              <form onSubmit={handleSavePlayer} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Player Identity</label>
                  <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-black/50 border border-yellow-500/30 p-4 rounded-xl text-white outline-none focus:border-yellow-500 transition-colors font-black text-sm shadow-inner" placeholder="e.g. S. Koirala" />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Kit Name / Nickname</label>
                  <input value={formData.nickname} onChange={e => setFormData({...formData, nickname: e.target.value})} className="w-full bg-black/50 border border-yellow-500/30 p-4 rounded-xl text-white outline-none focus:border-yellow-500 transition-colors font-black text-sm shadow-inner" placeholder="e.g. Chhoto" />
                </div>

                <div className="space-y-3 pt-2">
                  <label className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest ml-1 flex items-center gap-2"><Sparkles className="w-3 h-3"/> Dynamic Image Scan</label>
                  <div className="flex items-center gap-4 bg-black/80 p-3 rounded-2xl border border-yellow-500/20">
                    <div className="w-20 h-24 rounded-lg overflow-hidden bg-[#0a0a0c] border border-yellow-600/50 shadow-[0_0_15px_rgba(234,179,8,0.2)] shrink-0">
                       {(tempVideoUrl || editingPlayer?.videoUrl) ? <video src={tempVideoUrl || editingPlayer.videoUrl} autoPlay loop muted playsInline preload="metadata" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Video className="w-5 h-5 text-yellow-600/50" /></div>}
                    </div>
                    <motion.button type="button" onClick={(ev) => enterStudio(ev)} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="flex-1 h-full py-5 bg-gradient-to-br from-gray-900 to-black border border-yellow-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-yellow-500 hover:text-white hover:border-yellow-400 shadow-md">Enter Studio</motion.button>
                  </div>
                </div>

                <motion.button type="submit" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="w-full py-5 bg-gradient-to-r from-yellow-300 via-yellow-500 to-yellow-600 text-black rounded-xl font-black uppercase tracking-[0.2em] text-sm shadow-[0_5px_20px_rgba(234,179,8,0.4)] mt-4 border border-yellow-200">
                  {editingPlayer ? 'Confirm Updates' : 'Add to Club'}
                </motion.button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* HIGH-TECH STUDIO MODAL (Face Scan Laser) */}
      <AnimatePresence>
        {isStudioOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4">
            <motion.div
              initial={getClickOriginVariant()}
              animate={{ scale: 1, opacity: 1, x: 0, y: 0 }}
              exit={getClickOriginVariant()}
              transition={{ type: "spring", stiffness: 350, damping: 28 }}
              className="max-w-md w-full space-y-6 text-center relative"
            >
              <h2 className="text-yellow-500 font-black uppercase tracking-[0.4em] text-sm flex items-center justify-center gap-2"><ShieldCheck className="w-5 h-5"/> Face Scan Booth</h2>
              
              <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-[#0a0a0c] border-4 border-yellow-500 shadow-[0_0_50px_rgba(234,179,8,0.3)]">
                <div className="absolute inset-0 pointer-events-none z-10" style={{ backgroundImage: 'linear-gradient(rgba(234, 179, 8, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(234, 179, 8, 0.2) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
                
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-105" />
                
                {countdown === 'RECORDING!' && (
                  <motion.div
                    initial={{ top: '0%' }}
                    animate={{ top: '100%' }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                    className="absolute left-0 right-0 h-[4px] bg-red-500 shadow-[0_0_30px_rgba(239,68,68,1)] z-20 pointer-events-none"
                  />
                )}

                {countdown && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10 backdrop-blur-sm">
                    <span className={`font-black tracking-tighter ${countdown === 'RECORDING!' ? 'text-red-500 text-5xl animate-pulse drop-shadow-[0_0_20px_rgba(239,68,68,1)]' : 'text-yellow-500 text-8xl drop-shadow-[0_0_30px_rgba(234,179,8,1)]'}`}>{countdown}</span>
                  </div>
                )}
                {countdown === 'RECORDING!' && (
                  <div className="absolute top-6 right-6 w-4 h-4 bg-red-600 rounded-full animate-ping z-30 shadow-[0_0_10px_rgba(239,68,68,1)]" />
                )}
              </div>

              <div className="flex gap-4">
                <motion.button onClick={closeStudio} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="flex-1 py-5 bg-black border border-white/20 rounded-xl font-black uppercase tracking-widest text-xs text-gray-400 hover:bg-white/5">Abort</motion.button>
                <motion.button onClick={startRecording} disabled={countdown !== null} whileHover={{ scale: countdown === null ? 1.02 : 1 }} whileTap={{ scale: 0.98 }} className="flex-[2] py-5 bg-gradient-to-r from-yellow-500 to-yellow-600 text-black rounded-xl font-black uppercase tracking-widest text-xs disabled:opacity-50 shadow-[0_0_20px_rgba(234,179,8,0.3)]">Capture Subject</motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.02); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(234, 179, 8, 0.5); border-radius: 10px; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        input { font-size: 16px !important; }
      `}} />
    </div>
  );
}