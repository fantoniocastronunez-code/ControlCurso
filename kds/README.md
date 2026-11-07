# KDS Bump Bar para AppCurso (Pantalla de Comandas de Cocina)

Este directorio contiene el firmware de Arduino para el controlador físico KDS (Kitchen Display System) basado en **ESP32** con teclado Bluetooth BLE y pantalla OLED SH1106.

---

## 📌 Asignación de Teclas en Modo "CURSO"

| Botón Físico | Pin ESP32 | Tecla Enviada | Etiqueta OLED | Función en AppCurso (Pantalla de Comandas) |
|---|---|---|---|---|
| **BTN_HISTORIAL** | `Pin 13` | `'q'` | `PEST. IZQ` | Cambiar a la pestaña anterior (Pendientes, En Prep., Entregados, Todas) |
| **BTN_IZQUIERDA** | `Pin 14` | `KEY_LEFT_ARROW` | `ANTERIOR` | Mover foco a la comanda anterior |
| **BTN_DERECHA** | `Pin 27` | `KEY_RIGHT_ARROW` | `SIGUIENTE` | Mover foco a la comanda siguiente |
| **BTN_ARRIBA** | `Pin 26` | `'p'` / `KEY_UP_ARROW` | `PREPARAR` | Enviar la comanda seleccionada a **En Preparación** |
| **BTN_ABAJO** | `Pin 25` | `'r'` / `KEY_DOWN_ARROW`| `DEVOLVER` | **Devolver** la comanda a Pendiente si hubo error |
| **BTN_ENTER** | `Pin 33` | `KEY_RETURN` (Enter) | `ACEPTAR` | **Avanzar / Entregar**: En Pendiente la pasa a Preparando; en Preparando la marca ¡LISTO/ENTREGADO! |
| **BTN_INGENIERIA** | `Pin 32` | `'e'` | `PEST. DER` | Cambiar a la pestaña siguiente |

---

## 💡 Flujo de Trabajo en Cocina

1. **Llegada de Comanda**: Entra el vale con aviso sonoro y se selecciona automáticamente en la pantalla con borde destacado (`★ EN FOCO`).
2. **Empezar a Cocinar**: El cocinero presiona `PREPARAR` (`Pin 26`) o `ENTER` (`Pin 33`) -> la comanda pasa a color azul **PREPARANDO**.
3. **Plato Terminado**: El cocinero presiona `ACEPTAR` (`Pin 33`) -> la comanda pasa a verde **ENTREGADO**.
4. **Error / Revertir**: Si se presionó por error, pulsar `DEVOLVER` (`Pin 25`) regresa la comanda al estado anterior.
5. **Navegación**:
   - `ANTERIOR` (`Pin 14`) y `SIGUIENTE` (`Pin 27`) para navegar entre las tarjetas.
   - `PEST. IZQ` (`Pin 13`) y `PEST. DER` (`Pin 32`) para alternar pestañas.

---

## ⚙️ Menús del Controlador KDS

- **Cambiar Perfil (CAFE / CURSO / JUEGO)**: Mantener presionados **ARRIBA + ABAJO** simultáneamente.
- **Cambiar Dispositivo Bluetooth (Tablet / PC / Celular)**: Mantener presionados **HISTORIAL + INGENIERÍA** simultáneamente.

