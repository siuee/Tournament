import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const ADMIN_COLLECTION = 'admin';
const SECURITY_DOC_ID = 'security';
const DELETE_PASSWORD_FIELD = 'deletePasswordHash';
const DEFAULT_DELETE_PASSWORD = 'root';

async function hashPasswordSha256(password) {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Secure hashing is not available in this environment.');
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateDeletePasswordHash() {
  const securityRef = doc(db, ADMIN_COLLECTION, SECURITY_DOC_ID);
  const snap = await getDoc(securityRef);

  if (snap.exists()) {
    const data = snap.data() || {};
    if (typeof data[DELETE_PASSWORD_FIELD] === 'string' && data[DELETE_PASSWORD_FIELD].length > 0) {
      return data[DELETE_PASSWORD_FIELD];
    }
  }

  // If no password is configured yet, seed with the default one.
  const defaultHash = await hashPasswordSha256(DEFAULT_DELETE_PASSWORD);
  await setDoc(
    securityRef,
    { [DELETE_PASSWORD_FIELD]: defaultHash },
    { merge: true }
  );
  return defaultHash;
}

export async function verifyDeletePassword(inputPassword) {
  if (!inputPassword) return false;
  try {
    const [storedHash, inputHash] = await Promise.all([
      getOrCreateDeletePasswordHash(),
      hashPasswordSha256(inputPassword),
    ]);
    return storedHash === inputHash;
  } catch (err) {
    console.error('Password verification failed:', err);
    return false;
  }
}

