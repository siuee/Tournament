import { useState, useMemo, useCallback } from 'react';
import { Trophy, Shield, Gamepad2, Sun, Moon, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import LockerRoom from './components/LockerRoom';
import Standings from './components/Standings'; 
import MatchDay from './components/MatchDay'; 

// Custom Banana SVG component
const BananaIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 13c3.5-2 8-2 10 2a8.2 8.2 0 0 1-1 4.93M4 13c-1.5 6 1.5 9 1.5 9s3-3 1.5-9" />
    <path d="M14 15c4-2 6-6 2-11-2 1-4.5 2.5-6 5" />
    <path d="M15 4c1-1 3-1 4 0l2 2" />
  </svg>
);

function App() {
  const [activeTab, setActiveTab] = useState('standings');
  const [belloMode, setBelloMode] = useState(false); 
  const [isShaking, setIsShaking] = useState(false);
  const [rainItems, setRainItems] = useState([]); 

  // Trigger the high-energy Banana Rain effect
  const triggerBananaRain = useCallback(() => {
    setIsShaking(true);
    
    // Create particles with unique IDs and random properties
    const count = 25; // Increased count for better celebration
    const newItems = Array.from({ length: count }).map((_, i) => ({
      id: Math.random(), 
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duration: 1.2 + Math.random() * 0.8,
      size: 20 + Math.random() * 30,
      rotate: Math.random() * 360
    }));

    setRainItems(newItems);
    
    setTimeout(() => {
      setIsShaking(false);
      setRainItems([]);
    }, 2500);
  }, []);

  const dynamicStyles = useMemo(() => {
    return belloMode ? `
      body { background-color: #fffbeb; color: #1e293b; transition: background-color 0.5s ease; }
      ::-webkit-scrollbar-thumb { background: #fbbf24; }
      .glass-card { background: rgba(255, 255, 255, 0.8); border-color: #fde68a; }
    ` : `
      body { background-color: #050505; color: white; transition: background-color 0.5s ease; }
      ::-webkit-scrollbar-thumb { background: rgba(234, 179, 8, 0.3); }
      .glass-card { background: rgba(10, 10, 12, 0.8); border-color: rgba(255, 255, 255, 0.05); }
    `;
  }, [belloMode]);

  return (
    <div className="min-h-screen relative font-sans overflow-x-hidden">
      {/* Dynamic Background Shell */}
      <motion.div 
        animate={{ backgroundColor: belloMode ? '#fffbeb' : '#050505' }}
        style={{ x: isShaking ? [0, -10, 10, -10, 10, 0] : 0 }}
        className="fixed inset-0 z-0"
      />

      {/* BANANA RAIN SYSTEM */}
      <div className="fixed inset-0 pointer-events-none z-[200] overflow-hidden">
        <AnimatePresence>
          {rainItems.map((item) => (
            <motion.div
              key={item.id}
              initial={{ y: -100, x: `${item.left}vw`, opacity: 0, rotate: 0 }}
              animate={{ y: '110vh', opacity: [0, 1, 1, 0], rotate: item.rotate + 360 }}
              exit={{ opacity: 0 }}
              transition={{ duration: item.duration, delay: item.delay, ease: "linear" }}
              className="absolute text-yellow-400 drop-shadow-2xl"
              style={{ width: item.size, height: item.size }}
            >
              <BananaIcon className="w-full h-full fill-current" />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* UI Content Wrapper */}
      <div className="relative z-10">
        {/* --- DESKTOP NAVIGATION --- */}
        <nav className="hidden md:flex fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-full max-w-5xl px-4">
          <div className={`w-full ${belloMode ? 'bg-white/90 border-yellow-200' : 'bg-[#0a0a0c]/80 border-white/10'} backdrop-blur-xl border rounded-full p-2 flex justify-between items-center shadow-2xl transition-all duration-500`}>
            
            <div onClick={triggerBananaRain} className="flex items-center gap-3 pl-4 pr-6 border-r border-white/10 cursor-pointer group">
              <motion.div
                animate={{ rotate: isShaking ? [0, 90, -90, 0] : [0, 10, -10, 0] }}
                transition={{ repeat: isShaking ? 0 : Infinity, duration: isShaking ? 0.2 : 3 }}
                className="text-yellow-500 drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]"
              >
                <BananaIcon className="w-8 h-8" />
              </motion.div>
              <h1 className={`text-xl font-black italic tracking-tighter uppercase ${belloMode ? 'text-slate-900' : 'text-white'}`}>
                Banana <span className="text-yellow-500">FC</span>
              </h1>
            </div>
            
            <div className="flex gap-2">
              <NavBtn icon={<Trophy size={16}/>} label="Standings" active={activeTab === 'standings'} onClick={() => setActiveTab('standings')} bello={belloMode} />
              <NavBtn icon={<Gamepad2 size={16}/>} label="Match Day" active={activeTab === 'match'} onClick={() => setActiveTab('match')} bello={belloMode} />
              <NavBtn icon={<Shield size={16}/>} label="Club" active={activeTab === 'locker'} onClick={() => setActiveTab('locker')} bello={belloMode} />
            </div>

            <div className="pl-4 pr-2 border-l border-white/10">
              <button onClick={() => setBelloMode(!belloMode)} className={`p-2.5 rounded-full transition-all active:scale-75 ${belloMode ? 'bg-slate-900 text-yellow-400' : 'bg-white text-slate-900'}`}>
                {belloMode ? <Moon size={18}/> : <Sun size={18}/>}
              </button>
            </div>
          </div>
        </nav>

        {/* --- MAIN CONTENT AREA --- */}
        <main className="w-full md:pt-28 pb-28 md:pb-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'standings' && <Standings belloMode={belloMode} />}
              {/* UPDATED: Pass onGoalScored to MatchDay */}
              {activeTab === 'match' && <MatchDay belloMode={belloMode} onGoalScored={triggerBananaRain} />}
              {activeTab === 'locker' && <LockerRoom belloMode={belloMode} />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* --- MOBILE NAVIGATION --- */}
        <nav className="md:hidden fixed bottom-6 left-4 right-4 z-[999]">
          <div className={`flex justify-around items-center p-3 rounded-[30px] border backdrop-blur-xl shadow-2xl transition-all duration-500 ${belloMode ? 'bg-white/95 border-yellow-200' : 'bg-[#0a0a0c]/90 border-white/10'}`}>
            <MobTab icon={<Activity />} label="Rank" minion="standings" active={activeTab === 'standings'} onClick={() => setActiveTab('standings')} bello={belloMode} />
            <MobTab icon={<Gamepad2 />} label="Play" minion="match" active={activeTab === 'match'} onClick={() => setActiveTab('match')} bello={belloMode} />
            <MobTab icon={<Shield />} label="Club" minion="locker" active={activeTab === 'locker'} onClick={() => setActiveTab('locker')} bello={belloMode} />
          </div>
        </nav>
      </div>

      <style dangerouslySetInnerHTML={{ __html: dynamicStyles + `
        * { scroll-behavior: smooth; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { border-radius: 10px; }
        .no-spinners::-webkit-outer-spin-button, .no-spinners::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .no-spinners { -moz-appearance: textfield; }
        .fc-clip-path { clip-path: polygon(10% 0, 90% 0, 100% 8%, 100% 85%, 50% 100%, 0 85%, 0 8%); }
      `}} />
    </div>
  );
}

const NavBtn = ({ icon, label, active, onClick, bello }) => (
  <button onClick={onClick} className={`px-5 py-2 rounded-full font-black uppercase tracking-widest text-[10px] transition-all flex items-center gap-2 active:scale-95 ${active ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20' : bello ? 'text-slate-500 hover:text-black hover:bg-yellow-50' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
    {icon} <span>{label}</span>
  </button>
);

const MobTab = ({ icon, label, active, onClick, minion, bello }) => (
  <button onClick={onClick} className="flex flex-col items-center justify-center relative px-4">
    <AnimatePresence>
      {active && (
        <motion.img 
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
          src={`/assets/minions/${minion}_tab.png`} 
          className="absolute -top-14 w-14 h-14 object-contain drop-shadow-xl z-20"
        />
      )}
    </AnimatePresence>
    <div className={`p-3 rounded-full transition-all duration-300 ${active ? 'bg-yellow-500 text-black shadow-lg scale-110' : bello ? 'bg-yellow-50 text-yellow-600' : 'bg-white/5 text-gray-600'}`}>
      {icon}
    </div>
    <span className={`text-[9px] font-black uppercase mt-1 tracking-widest transition-all ${active ? 'opacity-100' : 'opacity-0'} ${bello ? 'text-slate-900' : 'text-white'}`}>{label}</span>
  </button>
);

export default App;