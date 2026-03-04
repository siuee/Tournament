import { useState, useEffect, useRef, useCallback } from 'react';
import { db, storage } from '../firebase';
import { collection, getDocs, addDoc, doc, updateDoc, query, orderBy, increment } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Eye, Upload, Video, Image, Camera, X, Loader2, Film } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatMatchDateTime } from '../lib/utils';

const MAX_VIDEO_SECONDS = 60;

/** Get video duration from a File (for upload validation) */
function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Could not load video'));
    };
    video.src = URL.createObjectURL(file);
  });
}

export default function InsiderInsight() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [caption, setCaption] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [useCamera, setUseCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [durationError, setDurationError] = useState(null);
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const viewedIdsRef = useRef(new Set());

  useEffect(() => {
    fetchPosts();
  }, []);

  // Assign camera stream to video element after it mounts
  useEffect(() => {
    if (useCamera && cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      return () => {
        if (videoRef.current) videoRef.current.srcObject = null;
      };
    }
  }, [useCamera, cameraStream]);

  const fetchPosts = async () => {
    try {
      const q = query(collection(db, 'insider_insights'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data(), viewCount: d.data().viewCount ?? 0 })));
    } catch (e) {
      console.error('Failed to fetch posts:', e);
    } finally {
      setLoading(false);
    }
  };

  const recordView = useCallback(async (postId) => {
    if (viewedIdsRef.current.has(postId)) return;
    viewedIdsRef.current.add(postId);
    try {
      await updateDoc(doc(db, 'insider_insights', postId), { viewCount: increment(1) });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, viewCount: (p.viewCount ?? 0) + 1 } : p));
    } catch (e) {
      viewedIdsRef.current.delete(postId);
    }
  }, []);

  const resetUpload = () => {
    setCaption('');
    setSelectedFile(null);
    setPreviewUrl(null);
    setRecordingBlob(null);
    setDurationError(null);
    setUseCamera(false);
    setIsRecording(false);
    setRecordingSeconds(0);
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      setCameraStream(null);
    }
    setShowUpload(false);
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) return;
    setDurationError(null);
    if (isVideo) {
      try {
        const duration = await getVideoDuration(file);
        if (duration > MAX_VIDEO_SECONDS) {
          setDurationError(`Video must be ${MAX_VIDEO_SECONDS} seconds or less. This video is ${Math.ceil(duration)}s.`);
          e.target.value = '';
          return;
        }
      } catch {
        setDurationError('Could not validate video duration.');
        e.target.value = '';
        return;
      }
    }
    setSelectedFile(file);
    setRecordingBlob(null);
    setPreviewUrl(URL.createObjectURL(file));
    e.target.value = '';
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      setCameraStream(stream);
      setUseCamera(true);
    } catch (e) {
      console.error('Camera access denied:', e);
      alert('Camera access is required. Please allow camera permissions.');
    }
  };

  const stopCamera = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      setCameraStream(null);
    }
    setUseCamera(false);
    setRecordingBlob(null);
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const startRecording = () => {
    const stream = cameraStream || videoRef.current?.srcObject;
    if (!stream) return;

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];

    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      setRecordingBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
      setIsRecording(false);
      setRecordingSeconds(0);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    setRecordingSeconds(0);

    // 60 second max – auto-stop
    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds(s => {
        if (s >= MAX_VIDEO_SECONDS - 1) {
          if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
          if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
          return MAX_VIDEO_SECONDS;
        }
        return s + 1;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleUpload = async () => {
    const mediaBlob = recordingBlob || (selectedFile ? selectedFile : null);
    if (!mediaBlob) return;

    const isVideo = mediaBlob.type.startsWith('video/');
    if (isVideo && selectedFile) {
      try {
        const duration = await getVideoDuration(selectedFile);
        if (duration > MAX_VIDEO_SECONDS) {
          setDurationError(`Video must be ${MAX_VIDEO_SECONDS} seconds or less.`);
          return;
        }
      } catch {
        setDurationError('Could not validate video.');
        return;
      }
    }

    setUploading(true);
    setDurationError(null);
    try {
      const ext = recordingBlob ? 'webm' : selectedFile.name.split('.').pop() || 'bin';
      const path = `insider_insights/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, mediaBlob);
      const mediaUrl = await getDownloadURL(storageRef);

      await addDoc(collection(db, 'insider_insights'), {
        mediaUrl,
        mediaType: isVideo ? 'video' : 'image',
        caption: caption?.trim() || '',
        createdAt: new Date(),
        viewCount: 0,
      });
      resetUpload();
      fetchPosts();
    } catch (e) {
      console.error('Upload failed:', e);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const canUpload = selectedFile || recordingBlob;

  return (
    <div className="relative min-h-screen flex flex-col w-full max-w-lg mx-auto pb-36 md:pb-28">
      {/* Header */}
      <div className="w-full mb-4 md:mb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 rounded-2xl bg-yellow-500/10 border border-yellow-500/30">
                <Eye className="w-6 h-6 text-yellow-500" />
              </div>
              <h1 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-yellow-200 to-yellow-600">
                Insider Insight
              </h1>
            </div>
            <p className="text-xs text-gray-400 font-medium">Behind-the-scenes clips & photos</p>
          </div>
          <motion.button
            onClick={() => setShowUpload(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-2 bg-gradient-to-r from-yellow-600 to-yellow-500 px-4 py-2.5 rounded-2xl font-black uppercase text-[10px] tracking-widest text-black shadow-[0_0_15px_rgba(234,179,8,0.4)]"
          >
            <Upload className="w-4 h-4" /> Share
          </motion.button>
        </div>
      </div>

      {/* Feed – TikTok/Reels style vertical cards */}
      <div className="flex-1 w-full">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-12 h-12 text-yellow-500 animate-spin" />
            <p className="text-gray-500 font-semibold text-sm">Loading...</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-black/30 p-12 text-center">
            <Film className="w-16 h-16 text-yellow-500/30 mx-auto mb-4" />
            <p className="text-gray-500 font-semibold mb-2">No insider clips yet</p>
            <p className="text-gray-600 text-sm mb-6">Be the first to share a behind-the-scenes moment</p>
            <motion.button
              onClick={() => setShowUpload(true)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-6 py-3 rounded-xl bg-yellow-500/20 border border-yellow-500/40 text-yellow-500 font-black uppercase text-xs tracking-widest"
            >
              Share Your First Clip
            </motion.button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pb-4">
            {posts.map((post, i) => (
              <InsiderPostCard key={post.id} post={post} index={i} onView={recordView} formatDate={formatMatchDateTime} />
            ))}
          </div>
        )}
      </div>

      {/* Upload Modal */}
      <AnimatePresence>
        {showUpload && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0a0a0c] border border-yellow-500/30 w-full max-w-lg rounded-[30px] shadow-[0_0_50px_rgba(234,179,8,0.15)] overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="p-5 border-b border-white/10 flex justify-between items-center sticky top-0 bg-[#0a0a0c] z-10">
                <h2 className="text-base font-black uppercase tracking-tight text-white">Share Clip (max {MAX_VIDEO_SECONDS}s)</h2>
                <button onClick={resetUpload} className="p-2 text-gray-500 hover:text-white rounded-lg transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-5">
                {durationError && (
                  <p className="text-sm text-red-400 font-semibold bg-red-500/10 rounded-xl px-4 py-2">{durationError}</p>
                )}
                {!useCamera && !previewUrl && (
                  <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Choose source</p>
                    <label className="flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-white/20 hover:border-yellow-500/50 cursor-pointer transition-colors bg-black/40">
                      <div className="flex gap-4">
                        <Video className="w-10 h-10 text-yellow-500/70" />
                        <Image className="w-10 h-10 text-yellow-500/70" />
                      </div>
                      <span className="text-xs font-bold text-gray-400">Upload Video or Photo</span>
                      <span className="text-[10px] text-gray-500">Videos max {MAX_VIDEO_SECONDS} seconds</span>
                      <input type="file" accept="video/*,image/*" onChange={handleFileSelect} className="hidden" />
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-white/10" />
                      <span className="text-[10px] text-gray-500 font-bold uppercase">or</span>
                      <div className="flex-1 h-px bg-white/10" />
                    </div>
                    <motion.button
                      onClick={startCamera}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-white/20 bg-white/5 hover:bg-yellow-500/10 hover:border-yellow-500/50 transition-colors"
                    >
                      <Camera className="w-5 h-5 text-yellow-500" />
                      <span className="font-black uppercase text-xs tracking-widest">Record with Camera (max {MAX_VIDEO_SECONDS}s)</span>
                    </motion.button>
                  </div>
                )}

                {useCamera && !previewUrl && (
                  <div className="space-y-4">
                    <div className="relative aspect-[9/16] max-h-[50vh] rounded-2xl overflow-hidden bg-black border border-white/10">
                      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                      {isRecording && (
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/90 text-white text-xs font-bold">
                          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                          {recordingSeconds}s / {MAX_VIDEO_SECONDS}s
                        </div>
                      )}
                    </div>
                    <div className="flex gap-3">
                      <motion.button
                        onClick={() => { stopCamera(); setUseCamera(false); }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="flex-1 py-3 rounded-xl border border-white/20 text-gray-400 font-bold uppercase text-xs hover:bg-white/5"
                      >
                        Cancel
                      </motion.button>
                      {isRecording ? (
                        <motion.button
                          onClick={stopRecording}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="flex-1 py-3 rounded-xl bg-red-500/30 border border-red-500/50 text-red-400 font-bold uppercase text-xs"
                        >
                          Stop Recording
                        </motion.button>
                      ) : (
                        <motion.button
                          onClick={startRecording}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="flex-1 py-3 rounded-xl bg-yellow-500/20 border border-yellow-500/50 text-yellow-500 font-bold uppercase text-xs"
                        >
                          Start Recording
                        </motion.button>
                      )}
                    </div>
                  </div>
                )}

                {previewUrl && (
                  <div className="space-y-4">
                    <div className="relative aspect-[9/16] max-h-[50vh] rounded-2xl overflow-hidden bg-black border border-white/10">
                      {selectedFile?.type?.startsWith('image/') || (recordingBlob && recordingBlob.type?.includes('image')) ? (
                        <img src={previewUrl} alt="Preview" className="w-full h-full object-contain" />
                      ) : (
                        <video src={previewUrl} controls className="w-full h-full object-contain" />
                      )}
                    </div>
                    {useCamera ? (
                      <motion.button
                        onClick={() => { stopCamera(); setPreviewUrl(null); setRecordingBlob(null); setSelectedFile(null); if (previewUrl) URL.revokeObjectURL(previewUrl); }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="w-full py-2 rounded-xl text-gray-400 text-xs font-bold hover:text-white"
                      >
                        Choose different source
                      </motion.button>
                    ) : (
                      <motion.button
                        onClick={() => { setPreviewUrl(null); setSelectedFile(null); if (previewUrl) URL.revokeObjectURL(previewUrl); }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="w-full py-2 rounded-xl text-gray-400 text-xs font-bold hover:text-white"
                      >
                        Choose different file
                      </motion.button>
                    )}
                  </div>
                )}

                {canUpload && (
                  <>
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-yellow-500 mb-2 block">Caption (optional)</label>
                      <textarea
                        value={caption}
                        onChange={(e) => setCaption(e.target.value)}
                        placeholder="Add context or insider details..."
                        rows={2}
                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 focus:border-yellow-500 focus:outline-none resize-none text-sm"
                      />
                    </div>
                    <div className="flex gap-3">
                      <motion.button
                        onClick={resetUpload}
                        disabled={uploading}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="flex-1 py-3.5 rounded-xl border border-white/20 text-gray-400 font-bold uppercase text-xs hover:bg-white/5 disabled:opacity-50"
                      >
                        Cancel
                      </motion.button>
                      <motion.button
                        onClick={handleUpload}
                        disabled={uploading}
                        whileHover={{ scale: uploading ? 1 : 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-yellow-600 to-yellow-500 text-black font-black uppercase text-xs tracking-widest shadow-[0_0_20px_rgba(234,179,8,0.3)] disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : 'Post'}
                      </motion.button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InsiderPostCard({ post, index, onView, formatDate }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const hasRecordedView = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || hasRecordedView.current) return;
        hasRecordedView.current = true;
        onView(post.id);
      },
      { threshold: 0.5, rootMargin: '50px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [post.id, onView]);

  const viewCount = post.viewCount ?? 0;

  return (
    <motion.article
      ref={containerRef}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.03 }}
      className="group relative aspect-[9/16] rounded-2xl overflow-hidden bg-black border border-white/10 hover:border-yellow-500/40 transition-colors"
    >
      {post.mediaType === 'video' ? (
        <video
          ref={videoRef}
          src={post.mediaUrl}
          playsInline
          muted
          loop
          preload="metadata"
          controls
          className="w-full h-full object-cover"
        />
      ) : (
        <img src={post.mediaUrl} alt="" className="w-full h-full object-cover" />
      )}
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent pointer-events-none" />
      {/* Right side actions – Reels style */}
      <div className="absolute right-2 bottom-14 flex flex-col items-center gap-4">
        <div className="flex flex-col items-center gap-1">
          <Eye className="w-5 h-5 text-white drop-shadow-lg" />
          <span className="text-[10px] font-bold text-white drop-shadow-md">{viewCount}</span>
        </div>
      </div>
      {/* Bottom caption */}
      <div className="absolute bottom-0 left-0 right-0 p-3">
        {post.caption && (
          <p className="text-white text-xs font-medium line-clamp-2 drop-shadow-lg">{post.caption}</p>
        )}
        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1">{formatDate(post.createdAt)}</p>
      </div>
    </motion.article>
  );
}
