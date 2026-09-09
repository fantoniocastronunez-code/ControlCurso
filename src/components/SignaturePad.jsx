import React, { useRef, useState, useEffect } from 'react';

const SignaturePad = ({ title, onSave, onClear }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      // Set actual size in memory (scaled for retina displays)
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = 150 * 2; // Fixed height of 150px
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000000';
    }
  }, []);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    e.preventDefault();
    if (!isDrawing) return;
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasSignature) setHasSignature(true);
  };

  const stopDrawing = () => {
    if (isDrawing) {
      const ctx = canvasRef.current.getContext('2d');
      ctx.closePath();
      setIsDrawing(false);
      
      // Auto-save the signature when stroke ends
      if (onSave) {
        onSave(canvasRef.current.toDataURL('image/png'));
      }
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    if (onClear) onClear();
    if (onSave) onSave(null);
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-main)' }}>{title}</h4>
        {hasSignature && (
          <button 
            type="button" 
            onClick={handleClear}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'var(--danger)', 
              fontSize: '0.8rem', 
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Limpiar
          </button>
        )}
      </div>
      <div 
        style={{ 
          width: '100%', 
          height: '150px', 
          backgroundColor: '#ffffff', 
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          overflow: 'hidden',
          touchAction: 'none' // Prevent scrolling while signing
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseOut={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
    </div>
  );
};

export default SignaturePad;
