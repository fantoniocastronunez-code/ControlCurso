import { useEffect } from 'react';
import { db } from '../firebase/config';
import { doc, onSnapshot } from 'firebase/firestore';

let initialVersion = null;

const VersionChecker = () => {
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'version'), (docSnap) => {
      if (docSnap.exists()) {
        const currentVersion = docSnap.data().v;
        if (initialVersion === null) {
          initialVersion = currentVersion;
        } else if (initialVersion !== currentVersion) {
          window.location.reload();
        }
      } else {
        if (initialVersion === null) {
          initialVersion = 1;
        }
      }
    });

    return () => unsub();
  }, []);

  return null;
};

export default VersionChecker;
