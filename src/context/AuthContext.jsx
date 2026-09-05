import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, googleProvider } from '../firebase/config';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); // 'superadmin', 'admin', 'apoderado'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Check role in Firestore using Email as ID
        try {
          const userDocRef = doc(db, 'users', currentUser.email);
          const userDoc = await getDoc(userDocRef);

          if (userDoc.exists()) {
            setRole(userDoc.data().role);
            // Actualizamos la info de perfil por si cambió
            await setDoc(userDocRef, {
              ...userDoc.data(),
              displayName: currentUser.displayName || userDoc.data().displayName || '',
              photoURL: currentUser.photoURL || userDoc.data().photoURL || '',
              uid: currentUser.uid
            }, { merge: true });
          } else {
            // Si el usuario no existe en la BD, lo creamos como apoderado por defecto, o si es tu email, superadmin.
            const initialRole = currentUser.email === 'fantoniocastronunez@gmail.com' ? 'superadmin' : 'apoderado';
            await setDoc(userDocRef, {
              email: currentUser.email,
              displayName: currentUser.displayName || '',
              photoURL: currentUser.photoURL || '',
              uid: currentUser.uid,
              role: initialRole,
              createdAt: new Date().toISOString(),
            });
            setRole(initialRole);
          }
        } catch (error) {
          console.error("Error al obtener o crear el usuario en Firestore:", error);
          alert("Error de permisos en la base de datos. Por favor revisa las reglas de Firestore.");
          // Forzar un rol básico para que no se quede pegado, o simplemente cerrar sesión
          setRole('apoderado');
        }
      } else {
        setUser(null);
        setRole(null);
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
    <AuthContext.Provider value={{ user, role, loading, loginWithGoogle, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
