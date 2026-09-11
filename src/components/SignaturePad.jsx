import React, { useRef, useState, useEffect } from 'react';
import { Eraser, Maximize, Minimize, CheckCircle } from 'lucide-react';

export default function SignaturePad({ title, initialData, onSave, onClear, onChange }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const loadedRef = useRef(false);
  const drawingDataRef = useRef(initialData || null);

  useEffect(() => {
    if (initialData && !loadedRef.current) {
      drawingDataRef.current = initialData;
    }
  }, [initialData]);

  // Algoritmo para dibujar la imagen sin achatarla (Mantiene la proporción original)
  const drawImageProportionally = (ctx, img, canvas) => {
    const targetW = canvas.offsetWidth;
    const targetH = canvas.offsetHeight;
    const imgAspect = img.width / img.height;
    const targetAspect = targetW / targetH;
    
    let drawW, drawH, drawX, drawY;

    if (imgAspect > targetAspect) {
       drawW = targetW;
       drawH = targetW / imgAspect;
       drawX = 0;
       drawY = (targetH - drawH) / 2;
    } else {
       drawH = targetH;
       drawW = targetH * imgAspect;
       drawX = (targetW - drawW) / 2;
       drawY = 0;
    }
    
    ctx.clearRect(0, 0, targetW, targetH);
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  };

  // 1. Manejar el redimensionado al abrir/cerrar pantalla completa
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Retraso de 150ms para permitir que la animación CSS de cierre termine
    const timer = setTimeout(() => {
      const ctx = canvas.getContext('2d');
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      ctx.scale(ratio, ratio);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (drawingDataRef.current) {
        const img = new Image();
        img.onload = () => drawImageProportionally(ctx, img, canvas);
        img.src = drawingDataRef.current;
      }
    }, 150); 

    return () => clearTimeout(timer);
  }, [isFullscreen]);

  // 2. Cargar la firma que viene de la base de datos (solo la primera vez)
  useEffect(() => {
    if (initialData && !loadedRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
         drawImageProportionally(ctx, img, canvas);
         loadedRef.current = true;
      };
      img.src = initialData;
    }
  }, [initialData]);

  // Eventos de Dibujo
  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    
    const pressure = e.pressure && e.pointerType === 'pen' ? e.pressure * 5 : 2.5;
    
    ctx.lineWidth = pressure;
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();

    if (e.pointerType === 'pen') {
       ctx.lineWidth = Math.max(e.pressure * 5, 0.5);
    }
    
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      if (canvasRef.current) {
        const data = canvasRef.current.toDataURL('image/png');
        drawingDataRef.current = data;
        if (onChange) onChange(data);
      }
    }
  };

  const handleSave = () => {
    if (canvasRef.current) {
      const data = canvasRef.current.toDataURL('image/png');
      drawingDataRef.current = data;
      if (onSave) onSave(data);
      loadedRef.current = true;
      if (isFullscreen) closeFullscreen();
    }
  };

  const clearPad = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
    loadedRef.current = false;
    drawingDataRef.current = null;
    if (onClear) onClear();
  };

  const closeFullscreen = () => {
    if (isDrawing) setIsDrawing(false);
    setIsFullscreen(false);
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
      {title && (
        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', color: 'var(--text-main)' }}>{title}</h4>
      )}
      
      {/* Fondo borroso cuando está en pantalla completa */}
      {isFullscreen && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15, 23, 42, 0.9)', zIndex: 9998, backdropFilter: 'blur(4px)', transition: 'opacity 0.3s' }}></div>
      )}

      <div style={
        isFullscreen
          ? { position: 'fixed', left: '1rem', right: '1rem', top: '50%', transform: 'translateY(-50%)', height: '75vh', zIndex: 9999, border: '2px solid #cbd5e1', borderRadius: '1.5rem', backgroundColor: '#fff', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', touchAction: 'none', display: 'flex', flexDirection: 'column' }
          : { position: 'relative', border: '2px dashed #cbd5e1', borderRadius: '1rem', backgroundColor: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', touchAction: 'none', height: '150px' }
      }>
        
        {isFullscreen && (
           <div style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0', padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
             <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', paddingLeft: '0.5rem' }}>Dibuja tu firma</span>
             <button onClick={closeFullscreen} style={{ backgroundColor: '#fff', padding: '0.375rem', borderRadius: '0.5rem', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', border: '1px solid #e2e8f0', color: '#475569', cursor: 'pointer' }}>
                <Minimize style={{ width: '1rem', height: '1rem' }} />
             </button>
           </div>
        )}

        <canvas
          ref={canvasRef}
          style={{ width: '100%', cursor: 'crosshair', flex: isFullscreen ? 1 : 'none', height: isFullscreen ? 'auto' : '100%', touchAction: 'none' }}
          onPointerDown={(e) => { e.target.releasePointerCapture(e.pointerId); startDrawing(e); }}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerLeave={stopDrawing}
          onPointerCancel={stopDrawing}
        />

        {/* Controles Flotantes (Solo en vista normal) */}
        {!isFullscreen && (
          <div style={{ position: 'absolute', display: 'flex', gap: '0.5rem', top: '0.5rem', right: '0.5rem' }}>
            <button 
              type="button" 
              onClick={() => setIsFullscreen(true)}
              style={{ backgroundColor: '#f1f5f9', color: '#475569', padding: '0.375rem', borderRadius: '0.5rem', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', border: '1px solid #e2e8f0', cursor: 'pointer' }}
              title="Pantalla Completa"
            >
              <Maximize style={{ width: '1rem', height: '1rem' }} />
            </button>
            <button 
              type="button" 
              onClick={clearPad} 
              style={{ backgroundColor: '#fef2f2', color: '#ef4444', padding: '0.375rem', borderRadius: '0.5rem', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', border: '1px solid #fecaca', cursor: 'pointer' }}
              title="Borrar Firma"
            >
              <Eraser style={{ width: '1rem', height: '1rem' }} />
            </button>
            <button 
              type="button" 
              onClick={handleSave} 
              style={{ backgroundColor: '#f0fdf4', color: '#16a34a', padding: '0.375rem', borderRadius: '0.5rem', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', border: '1px solid #bbf7d0', cursor: 'pointer' }}
              title="Guardar Firma"
            >
              <CheckCircle style={{ width: '1rem', height: '1rem' }} />
            </button>
          </div>
        )}
        
        {/* Controles Inferiores (Solo en pantalla completa) */}
        {isFullscreen && (
           <div style={{ backgroundColor: '#fff', padding: '1rem', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
              <button type="button" onClick={clearPad} style={{ flex: 1, backgroundColor: '#fef2f2', color: '#dc2626', padding: '0.75rem 0', borderRadius: '0.75rem', fontWeight: 'bold', fontSize: '0.875rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', border: '1px solid #fecaca', cursor: 'pointer' }}>
                <Eraser style={{ width: '1.25rem', height: '1.25rem' }} /> Borrar
              </button>
              <button type="button" onClick={handleSave} style={{ flex: 1, backgroundColor: '#22c55e', color: '#fff', padding: '0.75rem 0', borderRadius: '0.75rem', fontWeight: 'bold', fontSize: '0.875rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.3)', border: 'none', cursor: 'pointer' }}>
                <CheckCircle style={{ width: '1.25rem', height: '1.25rem' }} /> Guardar
              </button>
           </div>
        )}

      </div>
    </div>
  );
}
