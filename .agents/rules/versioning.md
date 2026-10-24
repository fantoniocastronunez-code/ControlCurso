# Regla de Versionado y Sincronización Automática

En este proyecto, ante **CUALQUIER cambio o conjunto de cambios** solicitado por el usuario:
1. **Asignar número de versión:**
   - Incrementar el número de versión en `package.json` respetando SemVer (`patch` para arreglos/ajustes, `minor` para nuevas características o pantallas).
2. **Commit automático:**
   - Realizar `git add .`
   - Crear el commit con el mensaje formateado incluyendo la versión:
     `git commit -m "vX.Y.Z: <descripción clara de los cambios>"`
3. **Push y Sincronización automática:**
   - Ejecutar inmediatamente `git push origin main`.
   - Confirmar estado limpio y sincronizado con `git status`.
