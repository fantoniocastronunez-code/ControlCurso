import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBwlZjUSPcaAoudUoYrztUe7qRWgjZSAPA",
  authDomain: "control-curso-1f25e.firebaseapp.com",
  projectId: "control-curso-1f25e",
  storageBucket: "control-curso-1f25e.firebasestorage.app",
  messagingSenderId: "504493943595",
  appId: "1:504493943595:web:997993b06bd7275cac736e"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
