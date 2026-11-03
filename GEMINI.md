# Instrucciones y Reglas del Proyecto AppCurso

## Regla Obligatoria: Versionado, Commit, Push y Sync Automático
Cada vez que se complete una mejora, corrección o cambio solicitado por el usuario:
1. **Actualizar versión en `package.json`**: Incrementar versión según SemVer (`patch` para correcciones/detalles, `minor` para nuevas funcionalidades/módulos).
2. **Commit automático**: Ejecutar `git add .` y crear el commit descriptivo con el prefijo de la versión:
   `git commit -m "vX.Y.Z: <descripción de los cambios>"`
3. **Push y Sync automático**: Ejecutar `git push origin main` y verificar que el repositorio quede completamente sincronizado (`git status`).

