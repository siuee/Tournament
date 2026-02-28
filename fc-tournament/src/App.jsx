import { useState } from 'react'
import { Trophy, Users, PlayCircle, Settings } from 'lucide-react'
import LockerRoom from './components/LockerRoom' 
import Standings from './components/Standings' // Add this line!
import MatchDay from './components/MatchDay' // Make sure this is here!

function App() {
  const [activeTab, setActiveTab] = useState('standings')

  return (
    <div className="min-h-screen p-6 font-sans">
      {/* Top Navigation Bar */}
      <nav className="glass-card max-w-6xl mx-auto p-4 mb-8 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Trophy className="text-neonBlue w-8 h-8" />
          <h1 className="text-2xl font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-neonBlue to-blue-300">
            FC TOURNAMENT HUB
          </h1>
        </div>
        
        <div className="flex gap-4">
          <NavButton 
            icon={<Trophy />} label="Standings" 
            isActive={activeTab === 'standings'} 
            onClick={() => setActiveTab('standings')} 
          />
          <NavButton 
            icon={<PlayCircle />} label="Match Day" 
            isActive={activeTab === 'match'} 
            onClick={() => setActiveTab('match')} 
          />
          <NavButton 
            icon={<Users />} label="Locker Room" 
            isActive={activeTab === 'locker'} 
            onClick={() => setActiveTab('locker')} 
          />
        </div>
      </nav>

      {/* Main Content Area */}
      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto">
        {activeTab === 'standings' && <Standings />} {/* Update this line! */}
        {activeTab === 'match' && <MatchDay />}
        {activeTab === 'locker' && <LockerRoom />}
      </main>
    </div>
  )
}

// Reusable Navigation Button Component
const NavButton = ({ icon, label, isActive, onClick }) => (
  <button 
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
      isActive ? 'bg-neonBlue/20 text-neonBlue border border-neonBlue/50' : 'text-gray-400 hover:text-white hover:bg-white/5'
    }`}
  >
    {icon}
    <span className="font-semibold">{label}</span>
  </button>
)

// Temporary Placeholder for the Standings
const StandingsPlaceholder = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
    <div className="glass-card p-6 min-h-[400px]">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <span className="text-neonBlue">●</span> ePremier League (Feb 2026)
      </h2>
      <p className="text-gray-400">Monthly league standings will load here.</p>
    </div>
    <div className="glass-card p-6 min-h-[400px] border-neonGold/30">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-neonGold">
        <Trophy className="w-5 h-5" /> eChampions League
      </h2>
      <p className="text-gray-400">Road to May 30, 2026.</p>
    </div>
  </div>
)

export default App