import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, googleProvider } from '../firebase/config';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useModal } from './ModalContext';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const { showAlert } = useModal();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); // 'superadmin', 'admin', 'apoderado'
  const [loading, setLoading] = useState(true);

  const [userData, setUserData] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Check role in Firestore using Email as ID
        try {
          const userDocRef = doc(db, 'users', currentUser.uid); // Changed to uid instead of email for consistency, although existing might use email
          // Wait, the existing code uses currentUser.email as document ID! Let's respect that or check.
          const emailLower = currentUser.email ? currentUser.email.toLowerCase() : '';
          const userDocRefEmail = doc(db, 'users', emailLower);
          let userDoc = await getDoc(userDocRefEmail);

          if (!userDoc.exists()) {
             // Fallback to uid if email doc doesn't exist
             const userDocRefUid = doc(db, 'users', currentUser.uid);
             userDoc = await getDoc(userDocRefUid);
          }

          if (userDoc.exists()) {
            setRole(userDoc.data().role);
            setUserData(userDoc.data());
            // Actualizamos la info de perfil por si cambió
            await setDoc(doc(db, 'users', userDoc.id), {
              ...userDoc.data(),
              displayName: currentUser.displayName || userDoc.data().displayName || '',
              photoURL: currentUser.photoURL || userDoc.data().photoURL || '',
              uid: currentUser.uid
            }, { merge: true });
          } else {
            // Si el usuario no existe en la BD, lo creamos
            // The default role won't be assigned until they enter an invite code, 
            // except for superadmin which we can hardcode for testing.
            const initialRole = currentUser.email === 'fantoniocastronunez@gmail.com' ? 'superadmin' : null;
            
            const newUser = {
              email: currentUser.email,
              displayName: currentUser.displayName || '',
              photoURL: currentUser.photoURL || '',
              uid: currentUser.uid,
              role: initialRole,
              roles: initialRole === 'superadmin' ? { global: 'superadmin' } : {},
              createdAt: new Date().toISOString(),
            };
            
            await setDoc(doc(db, 'users', currentUser.uid), newUser); // Save using uid going forward
            setRole(initialRole);
            setUserData(newUser);
          }
        } catch (error) {
          console.error("Error al obtener o crear el usuario en Firestore:", error);
          await showAlert("Error de permisos en la base de datos. Por favor revisa las reglas de Firestore.");
          setRole(null);
        }
      } else {
        setUser(null);
        setRole(null);
        setUserData(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error signing in with Google", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, role, userData, loading, loginWithGoogle, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
