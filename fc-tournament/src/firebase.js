import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your exact Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAggsGigZcO4_XwzDtBFkUDCRO4K0HbiEU",
  authDomain: "fc-tournament-6abe3.firebaseapp.com",
  projectId: "fc-tournament-6abe3",
  storageBucket: "fc-tournament-6abe3.firebasestorage.app",
  messagingSenderId: "450534814510",
  appId: "1:450534814510:web:78e9cd5529007d0fae40bf",
  measurementId: "G-5YHWVE1ZB4"
};

// Initialize the Firebase App
const app = initializeApp(firebaseConfig);

// THESE ARE THE EXPORTS YOUR APP WAS LOOKING FOR!
export const db = getFirestore(app);
export const storage = getStorage(app);