import { useState, useMemo } from 'react';
import { Trophy, Shield, Gamepad2, Sun, Moon, Activity, Droplets } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import LockerRoom from './components/LockerRoom';
import Standings from './components/Standings'; 
import MatchDay from './components/MatchDay'; 

// --- BRANDING SVG ---
const BananaIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 13c3.5-2 8-2 10 2a8.2 8.2 0 0 1-1 4.93M4 13c-1.5 6 1.5 9 1.5 9s3-3 1.5-9" />
    <path d="M14 15c4-2 6-6 2-11-2 1-4.5 2.5-6 5" />
    <path d="M15 4c1-1 3-1 4 0l2 2" />
  </svg>
);

// --- REALISTIC 3D GLASS SHATTER & SHARDS ---
const RealisticGlassShatter = () => {
  return (
    <>
      {/* The Central Web/Crack */}
      <svg viewBox="0 0 200 200" className="w-[300px] h-[300px] drop-shadow-[0_5px_15px_rgba(0,0,0,0.9)] opacity-95">
        <defs>
          <filter id="glassBlur">
            <feGaussianBlur stdDeviation="0.5" />
          </filter>
        </defs>
        {/* The deep impact hole */}
        <circle cx="100" cy="100" r="18" fill="black" opacity="0.9" />
        <circle cx="100" cy="100" r="28" fill="rgba(0,0,0,0.5)" filter="url(#glassBlur)" />
        
        {/* Deep internal fractures (Shadows) */}
        <path d="M100,100 L10,20 M100,100 L40,0 M100,100 L180,10 M100,100 L195,130 M100,100 L150,195 M100,100 L70,185 M100,100 L0,140" stroke="rgba(0,0,0,0.6)" strokeWidth="3" strokeLinecap="round" transform="translate(2, 2)"/>
        
        {/* Sharp light reflections (White edges) */}
        <path d="M100,100 L10,20 M100,100 L40,0 M100,100 L180,10 M100,100 L195,130 M100,100 L150,195 M100,100 L70,185 M100,100 L0,140" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M100,100 L30,60 L80,20 M100,100 L140,40 L180,80 M100,100 L160,160 L120,180 M100,100 L40,160 L20,100" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
        
        {/* Spiderweb micro-fractures */}
        <path d="M40,50 L70,40 L120,45 L150,60 L145,110 L120,145 L70,150 L45,110 Z" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />
        <path d="M60,70 L90,65 L110,80 L105,110 L80,115 L65,95 Z" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.8)" strokeWidth="1" />
      </svg>

      {/* Exploding Glass Shards */}
      {[...Array(8)].map((_, i) => {
        // Randomize shard shapes and trajectories
        const scale = Math.random() * 0.5 + 0.5;
        const xDist = (Math.random() - 0.5) * 800; // Fly far left/right
        const yDist = Math.random() * 800 + 200;   // Always fall down
        const rot = (Math.random() - 0.5) * 1080;  // Spin rapidly
        const clip = `polygon(${Math.random()*100}% 0, 100% ${Math.random()*100}%, ${Math.random()*100}% 100%, 0 ${Math.random()*100}%)`;

        return (
          <motion.div
            key={i}
            initial={{ x: 0, y: 0, scale: scale, rotate: 0, opacity: 1 }}
            animate={{ x: xDist, y: yDist, rotate: rot, opacity: 0 }}
            transition={{ duration: 1.2 + Math.random(), ease: "easeOut" }}
            className="absolute w-12 h-12 bg-white/20 backdrop-blur-xl border border-white/60 shadow-2xl"
            style={{ clipPath: clip, top: '50%', left: '50%', marginLeft: '-24px', marginTop: '-24px' }}
          />
        );
      })}
    </>
  );
};

function App() {
  const [activeTab, setActiveTab] = useState('standings');
  const [belloMode, setBelloMode] = useState(false); 
  
  // --- EASTER EGG STATES ---
  const [isSmashMode, setIsSmashMode] = useState(false);
  const [cracks, setCracks] = useState([]);
  const [screenFallen, setScreenFallen] = useState(false);

  // Advanced Smash Logic
  const handleSmashScreen = (e) => {
    if (screenFallen) return;

    // 1. Play the "Whoosh/Kick" sound instantly as the ball flies in
    const kickSound = new Audio('https://assets.mixkit.co/active_storage/sfx/3005/3005-preview.mp3');
    kickSound.volume = 0.4;
    kickSound.play().catch(() => {});

    // 2. Schedule the Glass Shatter sound to match the exact moment of impact (200ms delay)
    setTimeout(() => {
      const glassSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2866/2866-preview.mp3');
      glassSound.volume = 0.7;
      glassSound.play().catch(() => {});
    }, 200);

    // Record the strike coordinates
    const newCrack = { 
      id: Date.now(), 
      x: e.clientX, 
      y: e.clientY, 
      rot: Math.random() * 360 
    };

    setCracks(prev => {
      const updatedCracks = [...prev, newCrack];
      // If broken 10 times, trigger the heavy collapse
      if (updatedCracks.length >= 10) {
        setScreenFallen(true);
        setTimeout(() => {
          const collapseSound = new Audio('https://assets.mixkit.co/active_storage/sfx/318/318-preview.mp3');
          collapseSound.volume = 1.0;
          collapseSound.play().catch(() => {});
        }, 300);
      }
      return updatedCracks;
    });
  };

  // Wash the screen and reset the app
  const exitSmashMode = () => {
    const washSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2418/2418-preview.mp3');
    washSound.volume = 0.5;
    washSound.play().catch(() => {});

    setIsSmashMode(false);
    setCracks([]);
    setScreenFallen(false);
  };

  const dynamicStyles = useMemo(() => {
    return belloMode ? `
      body { background-color: #fffbeb; color: #1e293b; transition: background-color 0.5s ease; overflow: ${screenFallen ? 'hidden' : 'auto'}; }
      ::-webkit-scrollbar-thumb { background: #fbbf24; }
    ` : `
      body { background-color: #050505; color: white; transition: background-color 0.5s ease; overflow: ${screenFallen ? 'hidden' : 'auto'}; }
      ::-webkit-scrollbar-thumb { background: rgba(234, 179, 8, 0.3); }
    `;
  }, [belloMode, screenFallen]);

  return (
    <div className="min-h-screen relative font-sans overflow-x-hidden">
      
      {/* --- THE FALLING STAGE --- */}
      <motion.div 
        animate={screenFallen ? { y: '120vh', rotate: -12, scale: 0.85, opacity: 0 } : { y: 0, rotate: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", mass: 2.5, damping: 12, stiffness: 45 }}
        className="min-h-screen relative z-10"
      >
        {/* Dynamic Background */}
        <motion.div 
          animate={{ backgroundColor: belloMode ? '#fffbeb' : '#050505' }}
          className="fixed inset-0 z-0"
        />

        {/* --- DESKTOP PRO NAVIGATION --- */}
        <nav className="hidden md:flex fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-full max-w-5xl px-4">
          <motion.div 
            initial={{ y: -100 }} animate={{ y: 0 }}
            className={`w-full ${belloMode ? 'bg-white/90 border-yellow-200' : 'bg-[#0a0a0c]/80 border-white/10'} backdrop-blur-xl border rounded-full p-2 flex justify-between items-center shadow-[0_20px_50px_rgba(0,0,0,0.3)] transition-all duration-500`}
          >
            <div className="flex items-center gap-3 pl-4 pr-6 border-r border-white/10">
              <div className="text-yellow-500 drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]"><BananaIcon className="w-8 h-8" /></div>
              <div className="flex flex-col">
                <h1 className={`text-xl font-black italic tracking-tighter uppercase leading-none ${belloMode ? 'text-slate-900' : 'text-white'}`}>Banana <span className="text-yellow-500">FC</span></h1>
                <span className="text-[7px] font-black tracking-[0.3em] text-gray-500 uppercase">Tournament Hub</span>
              </div>
            </div>
            
            <div className="flex gap-2">
              <NavBtn icon={<Activity size={16}/>} label="Standings" active={activeTab === 'standings'} onClick={() => setActiveTab('standings')} bello={belloMode} />
              <NavBtn icon={<Gamepad2 size={16}/>} label="Match Day" active={activeTab === 'match'} onClick={() => setActiveTab('match')} bello={belloMode} />
              <NavBtn icon={<Shield size={16}/>} label="Club" active={activeTab === 'locker'} onClick={() => setActiveTab('locker')} bello={belloMode} />
            </div>

            <div className="pl-4 pr-2 border-l border-white/10">
              <motion.button 
                whileTap={{ scale: 0.8 }} onClick={() => setBelloMode(!belloMode)} 
                className={`p-2.5 rounded-full transition-all ${belloMode ? 'bg-slate-900 text-yellow-400' : 'bg-white text-slate-900 shadow-[0_0_15px_rgba(255,255,255,0.3)]'}`}
              >
                {belloMode ? <Moon size={18}/> : <Sun size={18}/>}
              </motion.button>
            </div>
          </motion.div>
        </nav>

        {/* --- MAIN PAGE CONTENT --- */}
        <main className="w-full md:pt-28 pb-28 md:pb-12 px-4 relative z-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="max-w-7xl mx-auto"
            >
              {activeTab === 'standings' && <Standings belloMode={belloMode} />}
              {activeTab === 'match' && <MatchDay belloMode={belloMode} />}
              {activeTab === 'locker' && <LockerRoom belloMode={belloMode} />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Global StarShockwaves controls (theme, pulse, animate) */}
        <ShockwaveControls />

        {/* --- MOBILE CONSOLE TAB BAR --- */}
        <nav className="md:hidden fixed bottom-6 left-4 right-4 z-[100]">
          <motion.div 
            initial={{ y: 100 }} animate={{ y: 0 }}
            className={`flex justify-around items-center p-3 rounded-[35px] border backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] transition-all duration-500 ${belloMode ? 'bg-white/95 border-yellow-200' : 'bg-[#0a0a0c]/90 border-white/10'}`}
          >
            <MobTab icon={<Activity />} label="RANK" minion="standings" active={activeTab === 'standings'} onClick={() => setActiveTab('standings')} bello={belloMode} />
            <MobTab icon={<Gamepad2 />} label="PLAY" minion="match" active={activeTab === 'match'} onClick={() => setActiveTab('match')} bello={belloMode} />
            <MobTab icon={<Shield />} label="CLUB" minion="locker" active={activeTab === 'locker'} onClick={() => setActiveTab('locker')} bello={belloMode} />
          </motion.div>
        </nav>

        {/* --- 3D SMASH OVERLAY --- */}
        {isSmashMode && (
          <div onClick={handleSmashScreen} className="absolute inset-0 z-[900] cursor-crosshair">
            {cracks.map((crack) => (
              <div 
                key={crack.id} 
                style={{ left: crack.x, top: crack.y }} 
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              >
                {/* 1. The Soccer Ball Flying IN (Disappears at impact) */}
                <motion.img
                  src="https://upload.wikimedia.org/wikipedia/commons/d/d3/Soccerball.svg"
                  initial={{ scale: 20, opacity: 0, rotate: -720, y: -500 }}
                  animate={{ scale: 0, opacity: [0, 1, 1, 0], rotate: 0, y: 0 }}
                  transition={{ duration: 0.2, ease: "easeIn" }}
                  className="absolute inset-0 m-auto w-32 h-32 drop-shadow-2xl z-50"
                  style={{ filter: "drop-shadow(0 50px 50px rgba(0,0,0,0.8))" }}
                />

                {/* 2. The Glass Shatter (Appears exactly when the ball hits) */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="absolute inset-0 flex items-center justify-center backdrop-blur-sm rounded-full"
                  style={{ rotate: crack.rot, width: '300px', height: '300px', transform: 'translate(-50%, -50%)' }}
                >
                  <RealisticGlassShatter />
                </motion.div>
              </div>
            ))}
          </div>
        )}
      </motion.div>


      {/* --- EASTER EGG FLOATING ACTION BUTTONS --- */}
      <div className="fixed bottom-28 md:bottom-8 right-6 z-[9999] flex flex-col items-center gap-4">
        <AnimatePresence mode="wait">
          {!isSmashMode ? (
            <motion.button
              key="start-smash"
              initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, rotate: 180 }}
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={() => setIsSmashMode(true)}
              className="w-16 h-16 rounded-full bg-white border-4 border-yellow-500 shadow-[0_10px_30px_rgba(234,179,8,0.5)] flex items-center justify-center text-3xl pb-1"
            >
              ⚽
            </motion.button>
          ) : (
            <motion.button
              key="exit-smash"
              initial={{ scale: 0, y: 50 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0, y: 50 }}
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={exitSmashMode}
              className="w-16 h-16 rounded-full bg-sky-500 border-4 border-white shadow-[0_10px_30px_rgba(14,165,233,0.5)] flex items-center justify-center text-white"
            >
              <Droplets className="w-8 h-8 fill-current" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <style dangerouslySetInnerHTML={{ __html: dynamicStyles + `
        * { scroll-behavior: smooth; -webkit-tap-highlight-color: transparent; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { border-radius: 10px; }
      `}} />
    </div>
  );
}

// STYLIZED DESKTOP BUTTON
const NavBtn = ({ icon, label, active, onClick, bello }) => (
  <button onClick={onClick} className={`group px-6 py-2.5 rounded-full font-black uppercase tracking-widest text-[10px] transition-all flex items-center gap-2 active:scale-95 ${active ? 'bg-yellow-500 text-black shadow-[0_10px_20px_rgba(234,179,8,0.3)] scale-105' : bello ? 'text-slate-500 hover:text-black hover:bg-yellow-100' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
    <motion.span animate={active ? { scale: [1, 1.2, 1] } : {}}>{icon}</motion.span>
    <span>{label}</span>
  </button>
);

// STYLIZED MOBILE TAB
const MobTab = ({ icon, label, active, onClick, minion, bello }) => (
  <button onClick={onClick} className="flex flex-col items-center justify-center relative px-6 py-2">
    <AnimatePresence>
      {active && (
        <motion.img 
          initial={{ y: 30, opacity: 0, scale: 0.5 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0, scale: 0.5 }}
          src={`/assets/minions/${minion}_tab.png`} className="absolute -top-16 w-16 h-16 object-contain z-20 drop-shadow-2xl pointer-events-none"
        />
      )}
    </AnimatePresence>
    <div className={`p-3.5 rounded-2xl transition-all duration-500 ${active ? 'bg-yellow-500 text-black shadow-xl rotate-[10deg] scale-110' : bello ? 'bg-yellow-50 text-yellow-600' : 'bg-white/5 text-gray-600'}`}>
      {icon}
    </div>
    <span className={`text-[8px] font-black uppercase mt-2 tracking-[0.2em] transition-all ${active ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'} ${bello ? 'text-slate-900' : 'text-white'}`}>
      {label}
    </span>
  </button>
);

// Global controls for StarShockwaves background (communicates via window events)
const ShockwaveControls = () => {
  const [theme, setTheme] = useState('molten');
  const [animate, setAnimate] = useState(true);

  const sendTheme = (t) => {
    setTheme(t);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('starshockwaves-theme', { detail: t }));
    }
  };

  const pulse = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('starshockwaves-pulse'));
    }
  };

  const toggleAnimate = () => {
    const next = !animate;
    setAnimate(next);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('starshockwaves-animate', { detail: next }));
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-[200] flex flex-col gap-3">
      <div className="rounded-2xl bg-black/70 border border-white/10 backdrop-blur-xl px-3 py-2 flex flex-wrap items-center gap-2">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 mr-1">
          Theme
        </span>
        {['molten', 'cosmic', 'emerald'].map((t) => (
          <button
            key={t}
            onClick={() => sendTheme(t)}
            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
              theme === t
                ? 'bg-yellow-400 text-black border-yellow-300 shadow-[0_0_12px_rgba(250,204,21,0.5)]'
                : 'bg-white/5 text-gray-300 border-white/10 hover:border-yellow-400 hover:text-yellow-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-black/70 border border-white/10 backdrop-blur-xl px-3 py-2 flex items-center gap-3">
        <button
          onClick={pulse}
          className="px-4 py-1.5 rounded-xl bg-yellow-500 text-black text-[10px] font-black uppercase tracking-[0.18em] shadow-[0_0_12px_rgba(234,179,8,0.6)] hover:scale-105 active:scale-95 transition-transform"
        >
          Pulse
        </button>
        <button
          onClick={toggleAnimate}
          className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-[0.18em] border transition-all ${
            animate
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400'
              : 'bg-white/5 text-gray-300 border-white/10'
          }`}
        >
          {animate ? 'Animate On' : 'Animate Off'}
        </button>
      </div>
    </div>
  );
};

export default App;