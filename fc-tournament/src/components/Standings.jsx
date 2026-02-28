import { useState, useEffect } from 'react';
import { Trophy, Calendar, Sparkles, Wand2, Goal, Star, Crown, TrendingUp } from 'lucide-react';
import { db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function Standings() {
  const [players, setPlayers] = useState([]);
  
  // TEAM DATA (Duo vs Duo)
  const [premierLeague] = useState([
    { id: 1, team: 'Sudip & Kushal', mp: 5, w: 4, d: 1, l: 0, gf: 22, ga: 10, gd: 12, pts: 13, form: ['W', 'W', 'D', 'W', 'W'] },
    { id: 2, team: 'Sujan & Pratik', mp: 5, w: 1, d: 1, l: 3, gf: 12, ga: 22, gd: -10, pts: 4, form: ['L', 'D', 'L', 'W', 'L'] }
  ]);

  useEffect(() => {
    const fetchPlayerData = async () => {
      const querySnapshot = await getDocs(collection(db, "players"));
      const pList = [];
      querySnapshot.forEach((doc) => pList.push({ id: doc.id, ...doc.data() }));
      
      const totalPoints = pList.reduce((acc, p) => acc + (p.goals * 3 + p.assists * 2), 0);
      const pWithProb = pList.map(p => {
        const score = (p.goals * 3 + p.assists * 2);
        const prob = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 25;
        return { ...p, probability: prob };
      });

      setPlayers(pWithProb.sort((a, b) => b.probability - a.probability));
    };
    fetchPlayerData();
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-8 pb-20">
      
      <div className="flex-1 space-y-8">
        {/* TEAM STANDINGS TABLE (RESTORED) */}
        <div className="glass-card p-6 border-t-4 border-t-neonBlue">
          <h2 className="text-2xl font-black italic mb-6 tracking-tighter">ePREMIER LEAGUE <span className="text-neonBlue text-sm not-italic ml-2 tracking-widest uppercase">Teams</span></h2>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-gray-500 text-[10px] uppercase tracking-widest border-b border-white/10">
                  <th className="pb-4">Pos</th>
                  <th className="pb-4">Team</th>
                  <th className="pb-4 text-center">MP</th>
                  <th className="pb-4 text-center">W</th>
                  <th className="pb-4 text-center">D</th>
                  <th className="pb-4 text-center">L</th>
                  <th className="pb-4 text-center">GF</th>
                  <th className="pb-4 text-center">GA</th>
                  <th className="pb-4 text-center">GD</th>
                  <th className="pb-4 text-center font-bold text-white">Pts</th>
                  <th className="pb-4 text-right">Form</th>
                </tr>
              </thead>
              <tbody>
                {premierLeague.map((row, i) => (
                  <tr key={row.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-4 font-bold text-gray-500">{i + 1}</td>
                    <td className="py-4 font-black text-lg">{row.team}</td>
                    <td className="py-4 text-center font-medium">{row.mp}</td>
                    <td className="py-4 text-center">{row.w}</td>
                    <td className="py-4 text-center">{row.d}</td>
                    <td className="py-4 text-center">{row.l}</td>
                    <td className="py-4 text-center">{row.gf}</td>
                    <td className="py-4 text-center">{row.ga}</td>
                    <td className="py-4 text-center text-gray-400">{row.gd > 0 ? `+${row.gd}` : row.gd}</td>
                    <td className="py-4 text-center font-black text-xl text-neonBlue">{row.pts}</td>
                    <td className="py-4 flex justify-end gap-1">
                      {row.form.map((f, idx) => (
                        <span key={idx} className={`w-5 h-5 flex items-center justify-center text-[9px] font-bold rounded border ${f === 'W' ? 'border-green-500/50 text-green-400 bg-green-500/10' : f === 'D' ? 'border-yellow-500/50 text-yellow-400 bg-yellow-500/10' : 'border-red-500/50 text-red-400 bg-red-500/10'}`}>{f}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* PLAYER STATS (EVERYONE WITH VIDEO) */}
        <div className="glass-card p-6">
          <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2 mb-6">
            <TrendingUp className="w-4 h-4 text-neonBlue" /> Individual Player Performance
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {players.map(player => (
              <PlayerStatRow key={player.id} player={player} />
            ))}
          </div>
        </div>
      </div>

      {/* BALLON D'OR SIDEBAR */}
      <div className="w-full lg:w-80">
        <div className="glass-card p-6 border-t-4 border-t-neonGold sticky top-6">
          <div className="flex items-center gap-2 mb-1 text-neonGold">
             <Crown className="w-5 h-5" />
             <h2 className="text-xl font-black italic uppercase">Ballon d'Or</h2>
          </div>
          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-8">Winning Probability</p>
          <div className="space-y-8">
            {players.map((player) => (
              <div key={player.id} className="relative group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full border-2 border-white/10 overflow-hidden bg-dark group-hover:border-neonGold transition-colors">
                      {player.videoUrl ? <video src={player.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover scale-110" /> : <div className="w-full h-full bg-gray-800" />}
                    </div>
                    <p className="text-xs font-black uppercase tracking-tighter">{player.name}</p>
                  </div>
                  <span className="text-neonGold font-black text-sm">{player.probability}%</span>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                   <div className="h-full bg-gradient-to-r from-neonGold to-yellow-200 transition-all duration-1000" style={{ width: `${player.probability}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerStatRow({ player }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/20 transition-all">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg border border-white/10 overflow-hidden bg-black shadow-lg">
           {player.videoUrl ? (
             <video src={player.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover scale-110" />
           ) : (
             <div className="w-full h-full bg-gray-800" />
           )}
        </div>
        <div>
          <p className="font-black text-sm uppercase leading-none">{player.name}</p>
          <p className="text-[10px] text-neonBlue font-bold tracking-widest uppercase mt-1">"{player.nickname || 'PLAYER'}"</p>
        </div>
      </div>
      <div className="flex gap-4 text-center">
        <div><p className="text-xs font-black text-white">{player.goals}</p><p className="text-[8px] text-gray-500 uppercase font-bold">Gls</p></div>
        <div><p className="text-xs font-black text-white">{player.assists}</p><p className="text-[8px] text-gray-500 uppercase font-bold">Ast</p></div>
      </div>
    </div>
  );
}