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

        // Si es un usuario anónimo (ej. cliente escaneando QR de pedido o pantalla de cocina vía QR)
        // no tiene perfil en 'users', simplemente permitimos el acceso sin consultar ni arrojar alertas
        if (currentUser.isAnonymous) {
          setRole('guest');
          setUserData(null);
          setLoading(false);
          return;
        }

        // Check role in Firestore using Email as ID
        try {
          const emailLower = currentUser.email ? currentUser.email.toLowerCase().trim() : '';
          let userDoc = null;

          if (emailLower) {
            const userDocRefEmail = doc(db, 'users', emailLower);
            userDoc = await getDoc(userDocRefEmail);
          }

          if (!userDoc || !userDoc.exists()) {
             // Fallback to uid if email doc doesn't exist
             const userDocRefUid = doc(db, 'users', currentUser.uid);
             userDoc = await getDoc(userDocRefUid);
          }

          if (userDoc && userDoc.exists()) {
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
              email: currentUser.email || '',
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
          const isPublicRoute = window.location.pathname.startsWith('/pedido') || 
                                window.location.pathname.startsWith('/comandas') || 
                                window.location.pathname.startsWith('/entrega');
          if (!isPublicRoute) {
            await showAlert("Error de permisos en la base de datos. Por favor revisa las reglas de Firestore.");
          }
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
