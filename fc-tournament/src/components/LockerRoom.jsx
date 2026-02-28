import { useState, useRef, useEffect } from 'react';
import { Camera, Plus, X, Video, Trash2, Edit2, ShieldCheck } from 'lucide-react';
import { db, storage } from '../firebase';
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export default function LockerRoom() {
  const [players, setPlayers] = useState([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null);
  
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

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "players"));
      const pList = [];
      querySnapshot.forEach((doc) => {
        // We use doc.id to ensure we are using the unique Firebase ID
        pList.push({ id: doc.id, ...doc.data() });
      });
      
      // Sort and set
      setPlayers([...pList].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      console.error("Error fetching players: ", error);
    }
  };

  // --- STUDIO LOGIC ---
  const enterStudio = async () => {
    setIsStudioOpen(true);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(mediaStream);
      if (videoRef.current) videoRef.current.srcObject = mediaStream;
    } catch (err) {
      alert("Camera access denied.");
    }
  };

  const closeStudio = () => {
    if (stream) stream.getTracks().forEach(track => track.stop());
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
        clearInterval(timer);
        executeCapture();
      }
    }, 1000);
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
    setTimeout(() => mediaRecorder.stop(), 3000);
  };

  // --- DATABASE LOGIC ---
  const handleSavePlayer = async (e) => {
    e.preventDefault();
    // Create a truly unique ID if not editing
    const id = editingPlayer ? editingPlayer.id : `player_${Date.now()}`;
    let finalVideoUrl = editingPlayer ? editingPlayer.videoUrl : null;
  
    try {
      if (tempVideoBlob) {
        const storageRef = ref(storage, `motion_stickers/${id}.webm`);
        await uploadBytes(storageRef, tempVideoBlob);
        finalVideoUrl = await getDownloadURL(storageRef);
      }
  
      const playerData = {
        name: formData.name,
        nickname: formData.nickname,
        videoUrl: finalVideoUrl,
        goals: editingPlayer ? editingPlayer.goals : 0,
        assists: editingPlayer ? editingPlayer.assists : 0
      };
  
      await setDoc(doc(db, "players", id), playerData, { merge: true });
      
      // Crucial: Reset everything before refetching
      resetForm();
      await fetchPlayers(); 
    } catch (error) {
      console.error("Save failed:", error);
    }
  };

  const handleDeletePlayer = async (id) => {
    const password = prompt("Enter Admin Password to delete player:");
    if (password === "Supshzz1") {
      await deleteDoc(doc(db, "players", id));
      fetchPlayers();
    } else {
      alert("Incorrect Password!");
    }
  };

  const resetForm = () => {
    setIsFormOpen(false);
    setEditingPlayer(null);
    setFormData({ name: '', nickname: '' });
    setTempVideoUrl(null);
    setTempVideoBlob(null);
  };

  return (
    <div className="space-y-8 pb-20">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-black italic tracking-tighter uppercase text-white">Squad Management</h2>
        <button 
          onClick={() => setIsFormOpen(true)}
          className="bg-neonBlue px-6 py-3 rounded-xl font-black uppercase text-xs tracking-widest flex items-center gap-2 hover:bg-blue-500 transition-all active:scale-95"
        >
          <Plus className="w-4 h-4" /> Add Player
        </button>
      </div>

      {/* Player Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {players.map(player => (
          <div key={player.id} className="glass-card p-6 flex flex-col items-center group relative overflow-hidden">
            <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => { setEditingPlayer(player); setFormData({ name: player.name, nickname: player.nickname }); setIsFormOpen(true); }} className="p-2 bg-white/10 rounded-lg hover:bg-neonBlue/20 text-white"><Edit2 className="w-4 h-4" /></button>
              <button onClick={() => handleDeletePlayer(player.id)} className="p-2 bg-white/10 rounded-lg hover:bg-red-500/20 text-red-500"><Trash2 className="w-4 h-4" /></button>
            </div>
            
            <div className="w-32 h-32 rounded-2xl bg-black border-2 border-white/5 mb-4 overflow-hidden shadow-2xl">
              {player.videoUrl ? <video src={player.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover scale-110" /> : <div className="w-full h-full flex items-center justify-center bg-gray-900"><Camera className="text-gray-700" /></div>}
            </div>

            <h3 className="text-xl font-black uppercase tracking-tighter">{player.name}</h3>
            <p className="text-neonBlue text-[10px] font-bold tracking-[0.3em] uppercase">{player.nickname || 'N/A'}</p>
          </div>
        ))}
      </div>

      {/* FORM MODAL (ADD/EDIT) */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
          <div className="glass-card p-8 max-w-md w-full relative border-t-4 border-t-neonBlue">
            <button onClick={resetForm} className="absolute top-4 right-4 text-gray-500 hover:text-white"><X /></button>
            <h2 className="text-2xl font-black italic uppercase mb-6">{editingPlayer ? 'Edit Player' : 'Create Player'}</h2>
            
            <form onSubmit={handleSavePlayer} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Full Name</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-white/5 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-neonBlue transition-colors" placeholder="e.g. Sudip Koirala" />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Nickname (Optional)</label>
                <input value={formData.nickname} onChange={e => setFormData({...formData, nickname: e.target.value})} className="w-full bg-white/5 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-neonBlue" placeholder="e.g. Chhoto" />
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Profile Motion Sticker</label>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-xl bg-black overflow-hidden border border-white/10">
                    {(tempVideoUrl || editingPlayer?.videoUrl) ? <video src={tempVideoUrl || editingPlayer.videoUrl} autoPlay loop muted className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-gray-900"><Video className="w-4 h-4 text-gray-700" /></div>}
                  </div>
                  <button type="button" onClick={enterStudio} className="flex-1 py-3 bg-white/5 border border-white/10 rounded-xl text-xs font-bold hover:bg-white/10 transition-colors uppercase tracking-widest">Record New Pose</button>
                </div>
              </div>

              <button type="submit" className="w-full py-4 bg-neonBlue rounded-xl font-black uppercase tracking-widest text-sm shadow-lg shadow-blue-500/20 active:scale-95 transition-all">
                {editingPlayer ? 'Update Profile' : 'Join Squad'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* STUDIO MODAL */}
      {isStudioOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black p-4">
          <div className="max-w-md w-full space-y-6 text-center">
            <h2 className="text-neonGold font-black uppercase tracking-[0.4em] text-sm flex items-center justify-center gap-2"><ShieldCheck className="w-4 h-4"/> Studio Broadcast Mode</h2>
            <div className="relative aspect-[3/4] rounded-3xl overflow-hidden bg-gray-900 border-4 border-white/10">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {countdown && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <span className={`font-black ${countdown === 'RECORDING!' ? 'text-red-500 text-3xl animate-pulse' : 'text-neonGold text-7xl'}`}>{countdown}</span>
                </div>
              )}
            </div>
            <div className="flex gap-4">
              <button onClick={closeStudio} className="flex-1 py-4 bg-white/5 border border-white/10 rounded-2xl font-bold uppercase tracking-widest text-xs">Cancel</button>
              <button onClick={startRecording} disabled={countdown !== null} className="flex-[2] py-4 bg-neonGold text-black rounded-2xl font-black uppercase tracking-widest text-xs disabled:opacity-50">Start 3s Capture</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}