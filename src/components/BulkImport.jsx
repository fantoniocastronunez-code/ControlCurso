import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, doc, setDoc } from 'firebase/firestore';
import { ArrowLeft, Upload, Key, AlertTriangle, CheckCircle, Image as ImageIcon, Save, Edit2, Trash2 } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

const BulkImport = ({ onBack, onImportComplete }) => {
  const [apiKey, setApiKey] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  useEffect(() => {
    // Cargar API key guardada
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      setApiKey(savedKey);
    } else {
      setShowApiKeyInput(true);
    }
  }, []);

  const saveApiKey = (e) => {
    e.preventDefault();
    localStorage.setItem('gemini_api_key', apiKey);
    setShowApiKeyInput(false);
    setMessage('API Key guardada correctamente.');
    setTimeout(() => setMessage(''), 3000);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
      setResults([]); // Reset results if new image
    }
  };

  const processImage = async () => {
    if (!apiKey) {
      setError('Debes configurar una API Key de Gemini primero.');
      setShowApiKeyInput(true);
      return;
    }
    if (!selectedImage || !imagePreview) {
      setError('Por favor selecciona una imagen primero.');
      return;
    }

    setProcessing(true);
    setError('');
    setMessage('');

    try {
      const client = new GoogleGenAI({ apiKey });
      
      // Convert base64 data url to proper base64 string for API
      const base64Data = imagePreview.split(',')[1];
      const mimeType = selectedImage.type;

      const prompt = `Analiza esta imagen que contiene una lista de alumnos. 
Extrae la información y devuélvela ESTRICTAMENTE como un arreglo JSON con el siguiente formato, sin markdown extra:
[
  {
    "listNumber": 1,
    "firstName": "Juan Pablo",
    "lastNamePaternal": "Perez",
    "lastNameMaternal": "Gonzalez"
  }
]
Si algún apellido materno falta, déjalo vacío (""). Asegúrate de limpiar los nombres de símbolos o manchas. Intenta separar correctamente el nombre de los apellidos.`;

      const response = await client.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [
          prompt,
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType
            }
          }
        ],
        config: {
           responseMimeType: "application/json",
        }
      });

      const responseText = response.text;
      
      let parsedData = [];
      try {
        parsedData = JSON.parse(responseText);
      } catch (parseErr) {
        console.error("Error parsing JSON:", responseText);
        throw new Error("La IA no devolvió un formato JSON válido.");
      }

      // Asignar IDs temporales para la tabla de revisión
      const dataWithIds = parsedData.map(item => ({
        ...item,
        tempId: Date.now().toString() + Math.random().toString(36).substr(2, 9)
      }));

      dataWithIds.sort((a, b) => {
        const aNum = parseInt(a.listNumber) || 999;
        const bNum = parseInt(b.listNumber) || 999;
        return aNum - bNum;
      });

      setResults(dataWithIds);
      setMessage('¡Imagen procesada! Por favor revisa los datos antes de guardar.');
      
    } catch (err) {
      console.error(err);
      setError('Error al procesar la imagen: ' + (err.message || 'Verifica tu API Key.'));
    } finally {
      setProcessing(false);
    }
  };

  // Funciones de edición en la tabla
  const startEditing = (student) => {
    setEditingId(student.tempId);
    setEditForm({ ...student });
  };

  const saveEdit = () => {
    setResults(results.map(r => r.tempId === editingId ? editForm : r));
    setEditingId(null);
  };

  const removeResult = (tempId) => {
    setResults(results.filter(r => r.tempId !== tempId));
  };

  const saveAllToFirebase = async () => {
    if (results.length === 0) return;
    setProcessing(true);
    try {
      for (const student of results) {
        const studentId = 'std_' + Date.now().toString() + Math.random().toString(36).substring(2, 5);
        const studentRef = doc(db, 'students', studentId);
        
        // Full name for compatibility
        const fullName = `${student.firstName} ${student.lastNamePaternal} ${student.lastNameMaternal}`.trim();

        await setDoc(studentRef, {
          listNumber: Number(student.listNumber) || 0,
          firstName: student.firstName || '',
          lastNamePaternal: student.lastNamePaternal || '',
          lastNameMaternal: student.lastNameMaternal || '',
          name: fullName,
          createdAt: new Date().toISOString()
        });
      }
      setMessage(`Se guardaron ${results.length} alumnos correctamente.`);
      setTimeout(() => {
        onImportComplete(); // Volver y recargar lista
      }, 2000);
    } catch (error) {
      console.error("Error guardando alumnos:", error);
      setError("Hubo un error al guardar en la base de datos.");
      setProcessing(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>Importar Lista (IA)</h3>
      </div>

      {message && (
        <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', color: 'var(--success)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={18} /> {message}
        </div>
      )}

      {error && (
        <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--danger)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={18} /> {error}
        </div>
      )}

      {/* Panel de API KEY */}
      {(showApiKeyInput || !apiKey) && (
        <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem', border: '1px solid var(--warning)' }}>
          <h4 style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}>
            <Key size={18} /> Configuración de Gemini API
          </h4>
          <p style={{ color: 'var(--text-muted)' }}>Para que la IA procese la imagen, necesitas una clave de API de Google Gemini (es gratuita en Google AI Studio). Se guardará solo en tu navegador.</p>
          <form onSubmit={saveApiKey} style={{ display: 'flex', gap: '1rem' }}>
            <input
              type="password"
              required
              className="input-field"
              placeholder="Pega tu GEMINI_API_KEY aquí..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ flex: 1, marginBottom: 0 }}
            />
            <button type="submit" className="btn btn-primary" style={{ padding: '0 2rem' }}>Guardar</button>
          </form>
        </div>
      )}

      {(!showApiKeyInput && apiKey) && (
        <div style={{ marginBottom: '1rem', textAlign: 'right' }}>
          <button onClick={() => setShowApiKeyInput(true)} className="btn btn-outline" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}>
            Cambiar API Key
          </button>
        </div>
      )}

      {/* Zona de Subida */}
      <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', textAlign: 'center' }}>
        <input 
          type="file" 
          accept="image/*" 
          id="file-upload" 
          style={{ display: 'none' }} 
          onChange={handleImageChange}
        />
        <label htmlFor="file-upload" style={{ cursor: 'pointer', display: 'inline-block' }}>
          <div style={{ padding: '3rem', border: '2px dashed rgba(255,255,255,0.2)', borderRadius: 'var(--radius-md)', transition: 'all 0.2s', backgroundColor: 'rgba(0,0,0,0.2)' }}
               onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
               onMouseOut={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'}>
            <Upload size={48} color="var(--primary)" style={{ marginBottom: '1rem' }} />
            <h4 style={{ margin: 0, color: 'white' }}>Sube la foto de la lista</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>JPG, PNG (Máx 5MB)</p>
          </div>
        </label>

        {imagePreview && (
          <div style={{ marginTop: '2rem' }}>
            <img src={imagePreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }} />
            <div style={{ marginTop: '1.5rem' }}>
              <button 
                onClick={processImage} 
                disabled={processing}
                className="btn btn-primary" 
                style={{ padding: '0.75rem 2rem', fontSize: '1.1rem' }}
              >
                {processing ? 'Analizando con IA...' : <><ImageIcon size={20}/> Procesar Imagen</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tabla de Revisión */}
      {results.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h4 style={{ margin: 0, color: 'var(--primary)' }}>Resultados de la IA ({results.length} encontrados)</h4>
            <button onClick={saveAllToFirebase} disabled={processing} className="btn btn-primary">
              {processing ? 'Guardando...' : <><Save size={18}/> Guardar Todos</>}
            </button>
          </div>
          
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <th style={{ padding: '1rem' }}>N°</th>
                  <th style={{ padding: '1rem' }}>Nombres</th>
                  <th style={{ padding: '1rem' }}>Apellido Pat.</th>
                  <th style={{ padding: '1rem' }}>Apellido Mat.</th>
                  <th style={{ padding: '1rem' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.tempId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    {editingId === r.tempId ? (
                      <>
                        <td style={{ padding: '0.5rem' }}>
                          <input type="number" className="input-field" style={{ marginBottom: 0, width: '60px' }} value={editForm.listNumber} onChange={e => setEditForm({...editForm, listNumber: e.target.value})} />
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          <input type="text" className="input-field" style={{ marginBottom: 0 }} value={editForm.firstName} onChange={e => setEditForm({...editForm, firstName: e.target.value})} />
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          <input type="text" className="input-field" style={{ marginBottom: 0 }} value={editForm.lastNamePaternal} onChange={e => setEditForm({...editForm, lastNamePaternal: e.target.value})} />
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          <input type="text" className="input-field" style={{ marginBottom: 0 }} value={editForm.lastNameMaternal} onChange={e => setEditForm({...editForm, lastNameMaternal: e.target.value})} />
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          <button onClick={saveEdit} className="btn btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>OK</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '1rem', fontWeight: 'bold' }}>{r.listNumber}</td>
                        <td style={{ padding: '1rem' }}>{r.firstName}</td>
                        <td style={{ padding: '1rem' }}>{r.lastNamePaternal}</td>
                        <td style={{ padding: '1rem' }}>{r.lastNameMaternal}</td>
                        <td style={{ padding: '1rem', display: 'flex', gap: '0.5rem' }}>
                          <button onClick={() => startEditing(r)} className="btn btn-outline" style={{ padding: '0.4rem', color: 'var(--text-muted)' }}>
                            <Edit2 size={16} />
                          </button>
                          <button onClick={() => removeResult(r.tempId)} className="btn btn-outline" style={{ padding: '0.4rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default BulkImport;
