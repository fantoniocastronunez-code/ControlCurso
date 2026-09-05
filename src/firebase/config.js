import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAGlTuOnaPDfsT1C8S8cbjhXkbzfM-wgrA",
  authDomain: "brewcontrol-app.firebaseapp.com",
  projectId: "brewcontrol-app",
  storageBucket: "brewcontrol-app.firebasestorage.app",
  messagingSenderId: "684520597229",
  appId: "1:684520597229:web:310a2aacecca3d54d7cee4",
  measurementId: "G-07ECP6SLP2"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, "controlcurso2");
export const dbDefault = getFirestore(app); // Temporary for migration
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
