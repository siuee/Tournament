import { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { Trophy, Shield, Gamepad2, Sun, Moon, Activity, Droplets, Flame, Sparkles, Leaf, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import LockerRoom from './components/LockerRoom';
import InsiderInsight from './components/InsiderInsight';
import Standings from './components/Standings'; 
import MatchDay from './components/MatchDay';
import { AnimatedSocialIcons } from './components/ui/floating-action-button';

const StarShockwaves = lazy(() => import('./components/ui/star-shockwaves').then(m => ({ default: m.StarShockwaves })));

// Mobile: lightweight gradient (no Three.js). Desktop: full particle background.
const StarShockwavesLite = () => {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 769px)');
    setIsDesktop(mq.matches);
    const fn = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  if (!isDesktop) return <div className="fixed inset-0 z-[-10] bg-gradient-to-b from-[#0a0505] via-[#1a0a05] to-[#050505]" />;
  return <Suspense fallback={<div className="fixed inset-0 z-[-10] bg-gradient-to-b from-[#0a0505] via-[#1a0a05] to-[#050505]" />}><StarShockwaves /></Suspense>;
};

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
  const [hideMobileNav, setHideMobileNav] = useState(false);

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
    return `
      body { background-color: #050505; color: white; transition: background-color 0.5s ease; overflow: ${screenFallen ? 'hidden' : 'auto'}; }
      ::-webkit-scrollbar-thumb { background: rgba(234, 179, 8, 0.3); }
    `;
  }, [screenFallen]);

  // Listen for Insider comment open/close events to hide/show mobile navbar
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e) => {
      const shouldHide = !!(e?.detail);
      setHideMobileNav(shouldHide);
    };
    window.addEventListener('insider-comment-open', handler);
    return () => window.removeEventListener('insider-comment-open', handler);
  }, []);

  return (
    <div className="min-h-screen relative font-sans overflow-x-hidden">
      {/* Dynamic Background - solid base, behind particles */}
      <motion.div 
        animate={{ backgroundColor: '#050505' }}
        className="fixed inset-0 z-[-20]"
        style={{ transition: 'background-color 0.6s ease' }}
      />
      {/* StarShockwaves on desktop; lightweight gradient on mobile for fast load */}
      <div className="fixed inset-0 z-[-10]">
        <StarShockwavesLite />
      </div>

      {/* --- THE FALLING STAGE --- */}
      <motion.div 
        animate={screenFallen ? { y: '120vh', rotate: -12, scale: 0.85, opacity: 0 } : { y: 0, rotate: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", mass: 2.5, damping: 12, stiffness: 45 }}
        className="min-h-screen relative z-10"
      >

        {/* Curly navbar clip-path: flat sides, curly dip only between 1/4 and 3/4 */}
        <svg width="0" height="0" className="absolute">
          <defs>
            <clipPath id="navbar-curve" clipPathUnits="objectBoundingBox">
              <path d="M 0 0 L 1 0 L 1 0.82 L 0.75 0.82 C 0.7 1.2 0.55 1.25 0.5 1.12 C 0.45 0.99 0.3 1.2 0.25 0.82 L 0 0.82 Z" />
            </clipPath>
          </defs>
        </svg>
        {/* --- DESKTOP CURVED NAVBAR --- */}
        <nav className="hidden md:flex fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-full max-w-4xl px-4 justify-center">
          <motion.div 
            initial={{ y: -100 }} animate={{ y: 0 }}
            className="relative w-full pt-1 bg-[#0a0a0c]/95 backdrop-blur-xl border border-white/10 rounded-[28px] shadow-[0_20px_50px_rgba(0,0,0,0.4)]"
            style={{ clipPath: 'url(#navbar-curve)' }}
          >
            <div className="px-6 lg:px-12 py-5 flex justify-between items-center max-w-7xl mx-auto">
              {/* Logo */}
              <div className="flex items-center gap-3">
                <div className="text-yellow-500 drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]"><BananaIcon className="w-8 h-8" /></div>
                <div className="flex flex-col">
                  <h1 className="text-xl font-black italic tracking-tighter uppercase leading-none text-white">Banana <span className="text-yellow-500">FC</span></h1>
                  <span className="text-[7px] font-black tracking-[0.3em] text-gray-500 uppercase">Tournament Hub</span>
                </div>
              </div>
              {/* Nav links */}
              <div className="flex items-center gap-1">
                <NavBtn icon={<Activity size={16}/>} label="Standings" active={activeTab === 'standings'} onClick={() => setActiveTab('standings')} />
                <NavBtn icon={<Gamepad2 size={16}/>} label="Match Day" active={activeTab === 'match'} onClick={() => setActiveTab('match')} />
                <NavBtn icon={<Eye size={16}/>} label="Insider" active={activeTab === 'insider'} onClick={() => setActiveTab('insider')} />
                <NavBtn icon={<Shield size={16}/>} label="Club" active={activeTab === 'locker'} onClick={() => setActiveTab('locker')} />
              </div>
            </div>
          </motion.div>
        </nav>

        {/* --- MAIN PAGE CONTENT --- */}
        <main className="w-full md:pt-36 pb-28 md:pb-12 px-4 relative z-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="max-w-7xl mx-auto"
            >
              {activeTab === 'standings' && <Standings />}
              {activeTab === 'match' && <MatchDay />}
              {activeTab === 'insider' && <InsiderInsight />}
              {activeTab === 'locker' && <LockerRoom />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Theme controls - visible on all screen sizes */}
        <ShockwaveControls />

        {/* --- MOBILE CURVED TAB BAR --- */}
        <nav className="md:hidden fixed bottom-6 left-4 right-4 z-[100] pointer-events-none">
          <motion.div 
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: hideMobileNav ? 140 : 0, opacity: hideMobileNav ? 0 : 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 24 }}
            className="pointer-events-auto flex justify-around items-center py-4 px-4 rounded-t-[60px] rounded-b-[60px] border border-white/10 backdrop-blur-2xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)] bg-[#0a0a0c]/95"
          >
            <MobTab icon={<Activity />} label="RANK" active={activeTab === 'standings'} onClick={() => setActiveTab('standings')} />
            <MobTab icon={<Gamepad2 />} label="PLAY" active={activeTab === 'match'} onClick={() => setActiveTab('match')} />
            <MobTab icon={<Eye />} label="INSIDER" active={activeTab === 'insider'} onClick={() => setActiveTab('insider')} />
            <MobTab icon={<Shield />} label="CLUB" active={activeTab === 'locker'} onClick={() => setActiveTab('locker')} />
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
const NavBtn = ({ icon, label, active, onClick }) => (
  <button onClick={onClick} className={`group px-6 py-2.5 rounded-full font-black uppercase tracking-widest text-[10px] transition-all flex items-center gap-2 active:scale-95 ${active ? 'bg-yellow-500 text-black shadow-[0_10px_20px_rgba(234,179,8,0.3)] scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
    <motion.span animate={active ? { scale: [1, 1.2, 1] } : {}}>{icon}</motion.span>
    <span>{label}</span>
  </button>
);

// STYLIZED MOBILE TAB
const MobTab = ({ icon, label, active, onClick }) => (
  <button onClick={onClick} className="flex flex-col items-center justify-center relative px-6 py-2">
    <div className={`p-3.5 rounded-2xl transition-all duration-500 ${active ? 'bg-yellow-500 text-black shadow-xl rotate-[10deg] scale-110' : 'bg-white/5 text-gray-600'}`}>
      {icon}
    </div>
    <span className={`text-[8px] font-black uppercase mt-2 tracking-[0.2em] transition-all ${active ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'} text-white`}>
      {label}
    </span>
  </button>
);

const STORAGE_KEY = 'starshockwaves-settings';

// Global controls for StarShockwaves (theme + animate) via AnimatedSocialIcons FAB
const ShockwaveControls = () => {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'molten';
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) {
        const parsed = JSON.parse(s);
        if (parsed?.theme) return parsed.theme;
      }
    } catch {}
    return 'molten';
  });
  const [animate, setAnimate] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) {
        const parsed = JSON.parse(s);
        if (typeof parsed?.animate === 'boolean') return parsed.animate;
      }
    } catch {}
    return true;
  });

  const persist = (nextTheme, nextAnimate) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: nextTheme ?? theme, animate: nextAnimate ?? animate }));
    } catch {}
  };

  const sendTheme = (t) => {
    setTheme(t);
    persist(t, undefined);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('starshockwaves-theme', { detail: t }));
    }
  };

  const toggleAnimate = () => {
    const next = !animate;
    setAnimate(next);
    persist(undefined, next);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('starshockwaves-animate', { detail: next }));
    }
  };

  // Respond when a new StarShockwaves mounts (e.g. after page change) so it gets current theme/animate
  useEffect(() => {
    const handler = () => {
      window.dispatchEvent(new CustomEvent('starshockwaves-theme', { detail: theme }));
      window.dispatchEvent(new CustomEvent('starshockwaves-animate', { detail: animate }));
    };
    window.addEventListener('starshockwaves-request-state', handler);
    return () => window.removeEventListener('starshockwaves-request-state', handler);
  }, [theme, animate]);

  const themeIcons = [
    { Icon: Flame, onClick: () => sendTheme('molten'), active: theme === 'molten', circleBg: 'bg-orange-500' },
    { Icon: Sparkles, onClick: () => sendTheme('cosmic'), active: theme === 'cosmic', circleBg: 'bg-purple-500' },
    { Icon: Leaf, onClick: () => sendTheme('emerald'), active: theme === 'emerald', circleBg: 'bg-emerald-500' },
    {
      Icon: animate ? Sun : Moon,
      onClick: toggleAnimate,
      active: animate,
      circleBg: animate ? 'bg-amber-200' : 'bg-slate-700',
      iconClassName: animate ? 'text-slate-800' : 'text-white/90',
    },
  ];

  return (
    <div className="fixed bottom-24 left-4 md:bottom-4 z-[200]">
      <AnimatedSocialIcons icons={themeIcons} iconSize={20} className="w-auto" />
    </div>
  );
};

export default App;