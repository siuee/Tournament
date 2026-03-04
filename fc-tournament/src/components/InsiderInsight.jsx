import { useState, useEffect, useRef, useCallback } from 'react';
import { db, storage } from '../firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, orderBy, increment } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Eye, Upload, Video, Image, Camera, X, Loader2, Film, Heart, MessageCircle, Share2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatMatchDateTime } from '../lib/utils';

const MAX_VIDEO_SECONDS = 60;

const RANDOM_NAMES = [
  'PitchKing', 'GoalMachine', 'BananaStriker', 'YellowBullet', 'TurfWarrior', 'NetBuster',
  'ShadowDribbler', 'GoldenBoot', 'AceWinger', 'MidfieldMaestro', 'DefensiveRock', 'TurboFwd',
  'MatchDayHero', 'FeverPitch', 'ClutchPlayer', 'SidelineSage', 'BleacherBoss', 'StadiumStar',
  'GrassCutter', 'LastMinuteKing', 'HatTrickHunter', 'AssistAce', 'CleanSheetKeeper',
];

function randomCommenterName() {
  const base = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
  return base + Math.floor(100 + Math.random() * 900);
}

/* Social media SVG logos – official brand shapes */
const SocialIcons = {
  facebook: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  ),
  x: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  ),
  whatsapp: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  ),
  instagram: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
  ),
  tiktok: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
    </svg>
  ),
  snapchat: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301.165-.088.344-.104.464-.104.182 0 .359.029.509.09.45.149.734.479.734.838.015.449-.39.839-1.213 1.168-.089.029-.209.075-.344.119-.45.135-1.139.36-1.333.81-.09.224-.061.524.12.868l.015.015c.06.136 1.526 3.475 4.791 4.014.255.044.435.27.42.509 0 .075-.015.149-.045.225-.24.569-1.273.988-3.146 1.271-.059.091-.12.375-.164.57-.029.179-.074.36-.134.553-.076.271-.27.405-.555.405h-.03c-.135 0-.313-.031-.538-.074-.36-.075-.765-.135-1.273-.135-.3 0-.599.015-.913.074-.6.104-1.123.464-1.723.884-.853.599-1.826 1.288-3.294 1.288-.06 0-.119-.015-.18-.015h-.149c-1.468 0-2.427-.675-3.279-1.288-.599-.42-1.107-.779-1.707-.884-.314-.045-.629-.074-.928-.074-.54 0-.958.089-1.272.149-.211.043-.391.074-.54.074-.374 0-.523-.224-.583-.42-.061-.192-.09-.389-.135-.567-.046-.181-.105-.494-.166-.57-1.918-.222-2.95-.642-3.189-1.226-.031-.063-.054-.15-.054-.225-.015-.243.164-.465.42-.509 3.264-.54 4.73-3.879 4.791-4.02l.016-.029c.18-.345.224-.645.119-.869-.195-.434-.884-.658-1.332-.809-.121-.029-.24-.074-.346-.119-1.107-.435-1.257-.93-1.197-1.273.089-.479.674-.793 1.168-.793.146 0 .27.029.383.074.42.194.789.3 1.104.3.234 0 .384-.06.465-.105l-.046-.569c-.098-1.626-.225-3.651.307-4.837C7.392 1.077 10.739.807 11.727.807l.419-.015h.06z"/>
    </svg>
  ),
  linkedin: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  ),
  telegram: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  ),
  reddit: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
    </svg>
  ),
};

const SHARE_PLATFORMS = [
  { id: 'facebook', name: 'Facebook', url: (u, t) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`, Icon: SocialIcons.facebook },
  { id: 'x', name: 'X (Twitter)', url: (u, t) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`, Icon: SocialIcons.x },
  { id: 'whatsapp', name: 'WhatsApp', url: (u, t) => `https://wa.me/?text=${encodeURIComponent(t + ' ' + u)}`, Icon: SocialIcons.whatsapp },
  { id: 'instagram', name: 'Instagram', copyOnly: true, copyMessage: 'Link copied! Paste in Instagram to share', Icon: SocialIcons.instagram },
  { id: 'tiktok', name: 'TikTok', copyOnly: true, copyMessage: 'Link copied! Paste in TikTok to share', Icon: SocialIcons.tiktok },
  { id: 'snapchat', name: 'Snapchat', copyOnly: true, copyMessage: 'Link copied! Paste in Snapchat to share', Icon: SocialIcons.snapchat },
  { id: 'linkedin', name: 'LinkedIn', url: (u, t) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}`, Icon: SocialIcons.linkedin },
  { id: 'telegram', name: 'Telegram', url: (u, t) => `https://telegram.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`, Icon: SocialIcons.telegram },
  { id: 'reddit', name: 'Reddit', url: (u, t) => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(t)}`, Icon: SocialIcons.reddit },
];

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
  const [likedIds, setLikedIds] = useState(() => {
    try {
      const s = localStorage.getItem('insider-liked');
      if (s) return new Set(JSON.parse(s));
    } catch {}
    return new Set();
  });
  const [expandedPost, setExpandedPost] = useState(null);
  const [commentPostId, setCommentPostId] = useState(null);
  const [sharePost, setSharePost] = useState(null);

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
      setPosts(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, viewCount: data.viewCount ?? 0, likeCount: data.likeCount ?? 0, commentCount: data.commentCount ?? 0 };
      }));
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

  const handleLike = useCallback(async (postId) => {
    if (likedIds.has(postId)) return;
    const next = new Set(likedIds);
    next.add(postId);
    setLikedIds(next);
    try {
      localStorage.setItem('insider-liked', JSON.stringify([...next]));
    } catch {}
    try {
      await updateDoc(doc(db, 'insider_insights', postId), { likeCount: increment(1) });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, likeCount: (p.likeCount ?? 0) + 1 } : p));
      setExpandedPost(p => (p && p.id === postId) ? { ...p, likeCount: (p.likeCount ?? 0) + 1 } : p);
    } catch (e) {
      next.delete(postId);
      setLikedIds(new Set(next));
    }
  }, [likedIds]);

  const handleDelete = useCallback(async (post) => {
    if (!confirm('Delete this post?')) return;
    try {
      await deleteDoc(doc(db, 'insider_insights', post.id));
      setPosts(prev => prev.filter(p => p.id !== post.id));
      setExpandedPost(prev => (prev?.id === post.id ? null : prev));
      setCommentPostId(prev => (prev === post.id ? null : prev));
    } catch (e) {
      console.error('Delete failed:', e);
      alert('Failed to delete.');
    }
  }, []);

  const handleShare = useCallback((post) => setSharePost(post), []);

  const handleAddComment = useCallback(async (postId, text) => {
    if (!text?.trim()) return null;
    const authorName = randomCommenterName();
    const commentData = { authorName, text: text.trim(), createdAt: new Date() };
    try {
      const docRef = await addDoc(collection(db, 'insider_insights', postId, 'comments'), {
        ...commentData,
        createdAt: new Date(),
      });
      await updateDoc(doc(db, 'insider_insights', postId), { commentCount: increment(1) });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, commentCount: (p.commentCount ?? 0) + 1 } : p));
      setExpandedPost(p => (p && p.id === postId) ? { ...p, commentCount: (p.commentCount ?? 0) + 1 } : p);
      return { id: docRef.id, ...commentData };
    } catch (e) {
      console.error('Comment failed:', e);
      return null;
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
        likeCount: 0,
        commentCount: 0,
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
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pb-4">
              {posts.map((post, i) => (
                <InsiderPostCard
                  key={post.id}
                  post={post}
                  index={i}
                  onView={recordView}
                  onExpand={() => setExpandedPost(post)}
                  formatDate={formatMatchDateTime}
                />
              ))}
            </div>
            {/* Lightbox – tap media to expand and play */}
            <AnimatePresence>
              {expandedPost && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-[1000] bg-black/95 flex items-center justify-center p-4"
                  onClick={() => setExpandedPost(null)}
                >
                  <button
                    onClick={() => setExpandedPost(null)}
                    className="fixed top-6 right-6 z-[1001] p-2.5 rounded-full bg-black/60 border border-white/20 text-white hover:bg-white/20 transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="relative w-full max-w-2xl max-h-[90vh] flex flex-col items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {expandedPost.mediaType === 'video' ? (
                      <MediaLightboxVideo src={expandedPost.mediaUrl} />
                    ) : (
                      <img src={expandedPost.mediaUrl} alt="" className="max-w-full max-h-[75vh] object-contain rounded-2xl" />
                    )}
                    <div className="w-full mt-3 p-3 rounded-2xl bg-black/40 border border-white/10">
                      {expandedPost.caption && <p className="text-white text-sm font-medium">{expandedPost.caption}</p>}
                      <p className="text-[10px] text-gray-400 mt-1">{formatMatchDateTime(expandedPost.createdAt)}</p>
                    </div>
                    {/* Action bar – Delete, Like, Comment, Share */}
                    <div className="flex items-center justify-center gap-6 mt-4">
                      <motion.button
                        onClick={(e) => { e.stopPropagation(); handleDelete(expandedPost); }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                        className="flex flex-col items-center gap-0.5 text-red-400/80 hover:text-red-400"
                      >
                        <Trash2 className="w-5 h-5" />
                        <span className="text-[9px] font-bold uppercase">Delete</span>
                      </motion.button>
                      <motion.button
                        onClick={(e) => { e.stopPropagation(); handleLike(expandedPost.id); }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                        className={`flex flex-col items-center gap-0.5 ${likedIds.has(expandedPost.id) ? 'text-red-500' : 'text-white/80 hover:text-red-400'}`}
                      >
                        <Heart className={`w-5 h-5 ${likedIds.has(expandedPost.id) ? 'fill-current' : ''}`} />
                        <span className="text-[9px] font-bold">{expandedPost.likeCount ?? 0}</span>
                      </motion.button>
                      <motion.button
                        onClick={(e) => { e.stopPropagation(); setCommentPostId(expandedPost.id); }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                        className="flex flex-col items-center gap-0.5 text-white/80 hover:text-yellow-400"
                      >
                        <MessageCircle className="w-5 h-5" />
                        <span className="text-[9px] font-bold">{expandedPost.commentCount ?? 0}</span>
                      </motion.button>
                      <motion.button
                        onClick={(e) => { e.stopPropagation(); handleShare(expandedPost); }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                        className="flex flex-col items-center gap-0.5 text-white/80 hover:text-yellow-400"
                      >
                        <Share2 className="w-5 h-5" />
                        <span className="text-[9px] font-bold uppercase">Share</span>
                      </motion.button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
            {/* Comment panel – slides from right */}
            <AnimatePresence>
              {commentPostId && (
                <CommentPanel
                  key="comment-panel"
                  postId={commentPostId}
                  onClose={() => setCommentPostId(null)}
                  onAddComment={handleAddComment}
                  formatDate={formatMatchDateTime}
                />
              )}
            </AnimatePresence>
            {/* Share modal */}
            <AnimatePresence>
              {sharePost && (
                <ShareModal key="share-modal" post={sharePost} onClose={() => setSharePost(null)} />
              )}
            </AnimatePresence>
          </>
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

/** Comment panel – slides in from right */
function CommentPanel({ postId, onClose, onAddComment, formatDate }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!postId) return;
    setLoading(true);
    const q = query(
      collection(db, 'insider_insights', postId, 'comments'),
      orderBy('createdAt', 'asc')
    );
    getDocs(q).then(snap => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [postId]);

  useEffect(() => {
    if (postId) inputRef.current?.focus();
  }, [postId]);

  const submit = async () => {
    if (!input.trim() || !postId || submitting) return;
    setSubmitting(true);
    const newComment = await onAddComment(postId, input);
    setSubmitting(false);
    if (newComment) {
      setInput('');
      setComments(prev => [...prev, { ...newComment, createdAt: { toDate: () => new Date(newComment.createdAt) } }]);
    }
  };

  if (!postId) return null;

  return (
    <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[1002] flex justify-end"
        onClick={onClose}
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="w-full max-w-md bg-[#0a0a0c] border-l border-white/10 shadow-2xl flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          <div className="p-4 border-b border-white/10 flex justify-between items-center">
            <h3 className="font-black uppercase text-sm text-white">Comments</h3>
            <button onClick={onClose} className="p-2 text-gray-500 hover:text-white rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 text-yellow-500 animate-spin" /></div>
            ) : comments.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">No comments yet. Be the first!</p>
            ) : (
              comments.map(c => (
                <div key={c.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-yellow-500 text-sm">{c.authorName}</span>
                    <span className="text-[10px] text-gray-500">{c.createdAt?.toDate ? formatDate(c.createdAt) : ''}</span>
                  </div>
                  <p className="text-white/90 text-sm">{c.text}</p>
                </div>
              ))
            )}
          </div>
          <div className="p-4 border-t border-white/10 flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit()}
              placeholder="Add a comment..."
              className="flex-1 bg-black border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-500 focus:border-yellow-500 focus:outline-none text-sm"
            />
            <motion.button
              onClick={submit}
              disabled={!input.trim() || submitting}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-4 py-3 rounded-xl bg-yellow-500 text-black font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Post'}
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
  );
}

/** Share modal – top 6 social platforms */
function ShareModal({ post, onClose }) {
  if (!post) return null;
  const shareUrl = typeof window !== 'undefined' ? window.location.href + '?insider=' + post.id : '';
  const shareText = (post.caption || 'Check out this Insider clip!').slice(0, 100);

  const copyLink = (msg = 'Link copied!') => {
    navigator.clipboard?.writeText(shareUrl).then(() => alert(msg)).catch(() => {});
  };

  return (
    <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[1002] flex items-center justify-center bg-black/80 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-[#0a0a0c] border border-yellow-500/30 rounded-3xl p-6 max-w-sm w-full max-h-[85vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-black uppercase text-white">Share to</h3>
            <button onClick={onClose} className="p-2 text-gray-500 hover:text-white rounded-lg"><X className="w-5 h-5" /></button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {SHARE_PLATFORMS.map(pf =>
              pf.copyOnly ? (
                <motion.button
                  key={pf.id}
                  onClick={() => copyLink(pf.copyMessage)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-yellow-500/40 transition-colors"
                >
                  <pf.Icon className="w-8 h-8 text-white" />
                  <span className="text-xs font-bold text-white/90">{pf.name}</span>
                </motion.button>
              ) : (
                <motion.a
                  key={pf.id}
                  href={pf.url(shareUrl, shareText)}
                  target="_blank"
                  rel="noopener noreferrer"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-yellow-500/40 transition-colors"
                >
                  <pf.Icon className="w-8 h-8 text-white" />
                  <span className="text-xs font-bold text-white/90">{pf.name}</span>
                </motion.a>
              )
            )}
          </div>
          <motion.button
            onClick={copyLink}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full mt-4 py-3 rounded-xl bg-yellow-500/20 border border-yellow-500/50 text-yellow-500 font-bold text-sm"
          >
            Copy link
          </motion.button>
        </motion.div>
    </motion.div>
  );
}

/** Video in lightbox – autoplays when opened */
function MediaLightboxVideo({ src }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {});
  }, [src]);
  return (
    <video
      ref={videoRef}
      src={src}
      controls
      playsInline
      autoPlay
      loop
      className="max-w-full max-h-[75vh] object-contain rounded-2xl"
    />
  );
}

function InsiderPostCard({ post, index, onView, onExpand, formatDate }) {
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
      onClick={onExpand}
      className="group relative aspect-[9/16] rounded-2xl overflow-hidden bg-black border border-white/10 hover:border-yellow-500/40 transition-colors cursor-pointer"
    >
      {post.mediaType === 'video' ? (
        <video
          ref={videoRef}
          src={post.mediaUrl}
          playsInline
          muted
          loop
          preload="metadata"
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : (
        <img src={post.mediaUrl} alt="" className="w-full h-full object-cover pointer-events-none" />
      )}
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent pointer-events-none" />
      {/* Right side actions – Reels/Instagram style */}
      <div className="absolute right-2 bottom-14 flex flex-col items-center gap-3">
        <div className="flex flex-col items-center gap-0.5">
          <Eye className="w-5 h-5 text-white drop-shadow-lg" />
          <span className="text-[10px] font-bold text-white drop-shadow-md">{viewCount}</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <Heart className="w-5 h-5 text-white drop-shadow-lg" />
          <span className="text-[10px] font-bold text-white drop-shadow-md">{post.likeCount ?? 0}</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <MessageCircle className="w-5 h-5 text-white drop-shadow-lg" />
          <span className="text-[10px] font-bold text-white drop-shadow-md">{post.commentCount ?? 0}</span>
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
