import { useEffect } from 'react';

export const useLockBodyScroll = (isLocked) => {
  useEffect(() => {
    if (isLocked) {
      // Prevent scrolling on mount
      document.body.style.overflow = 'hidden';
    } else {
      // Re-enable scrolling when unmounted or not locked
      document.body.style.overflow = 'unset';
    }

    // Cleanup function to re-enable scrolling
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isLocked]);
};
