import React, { createContext, useContext, useState, useCallback } from 'react';

const ModalContext = createContext();

export const useModal = () => useContext(ModalContext);

export const ModalProvider = ({ children }) => {
  const [modalState, setModalState] = useState({
    isOpen: false,
    type: 'alert', // 'alert', 'confirm', 'prompt'
    message: '',
    defaultValue: '',
    resolve: null
  });
  
  const [inputValue, setInputValue] = useState('');

  const showAlert = useCallback((message) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        type: 'alert',
        message,
        resolve
      });
    });
  }, []);

  const showConfirm = useCallback((message) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        type: 'confirm',
        message,
        resolve
      });
    });
  }, []);

  const showPrompt = useCallback((message, defaultValue = '') => {
    return new Promise((resolve) => {
      setInputValue(defaultValue);
      setModalState({
        isOpen: true,
        type: 'prompt',
        message,
        defaultValue,
        resolve
      });
    });
  }, []);

  const handleClose = (result) => {
    if (modalState.resolve) {
      modalState.resolve(result);
    }
    setModalState(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <ModalContext.Provider value={{ showAlert, showConfirm, showPrompt }}>
      {children}
      
      {modalState.isOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(5px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div className="glass-panel animate-fade-in" style={{
            width: '90%',
            maxWidth: '400px',
            padding: '2rem',
            backgroundColor: 'var(--bg-main)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
            border: '1px solid var(--border-color)',
            textAlign: 'center'
          }}>
            <p style={{ fontSize: '1.1rem', marginBottom: '1.5rem', color: 'var(--text-main)', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
              {modalState.message}
            </p>
            
            {modalState.type === 'prompt' && (
              <input
                type="text"
                autoFocus
                className="input-field"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleClose(inputValue);
                  if (e.key === 'Escape') handleClose(null);
                }}
                style={{ marginBottom: '1.5rem', textAlign: 'center' }}
              />
            )}
            
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              {(modalState.type === 'confirm' || modalState.type === 'prompt') && (
                <button
                  className="btn btn-outline"
                  onClick={() => handleClose(modalState.type === 'prompt' ? null : false)}
                  style={{ flex: 1 }}
                >
                  Cancelar
                </button>
              )}
              
              <button
                className="btn btn-primary"
                onClick={() => handleClose(modalState.type === 'prompt' ? inputValue : true)}
                style={{ flex: 1 }}
                autoFocus={modalState.type !== 'prompt'}
              >
                {modalState.type === 'alert' ? 'Entendido' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
};
