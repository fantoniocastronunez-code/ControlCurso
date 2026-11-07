#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include <esp_bt_main.h>
#include <esp_bt_device.h>
#include <esp_system.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <BleKeyboard.h>
#include <Preferences.h>

// Nombres de los slots de dispositivos
const int NUM_DISPOSITIVOS = 3;
const char* nombresDispositivos[NUM_DISPOSITIVOS] = {
  "TABLET",
  "PC GAMING",
  "CELULAR"
};

const char* nombresBle[NUM_DISPOSITIVOS] = {
  "KDS-Tablet",
  "KDS-PC",
  "KDS-Movil"
};

Preferences preferences;

// Puntero para instanciar el teclado BLE
BleKeyboard* bleKeyboard = nullptr;

// Pantalla SH1106 128x64 I2C
Adafruit_SH1106G display(128, 64, &Wire, -1);

// Índices de los 7 botones
enum BotonIndex {
  BTN_HISTORIAL = 0, // Pin 13 -> En CURSO: Pestaña Anterior
  BTN_IZQUIERDA = 1, // Pin 14 -> En CURSO: Comanda Anterior
  BTN_DERECHA   = 2, // Pin 27 -> En CURSO: Comanda Siguiente
  BTN_ARRIBA    = 3, // Pin 26 -> En CURSO: Preparar
  BTN_ABAJO     = 4, // Pin 25 -> En CURSO: Devolver / Revertir
  BTN_ENTER     = 5, // Pin 33 -> En CURSO: Aceptar / Entregar
  BTN_INGENIERIA= 6  // Pin 32 -> En CURSO: Pestaña Siguiente
};

const int numSwitches = 7;
const uint8_t switchPins[numSwitches] = {13, 14, 27, 26, 25, 33, 32};
bool lastState[numSwitches] = {HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH};
unsigned long lastDebounce[numSwitches] = {0, 0, 0, 0, 0, 0, 0};
const unsigned long debounceDelay = 25;

// Definición de Perfiles
const int NUM_PERFILES = 3;
const char* nombresCortos[NUM_PERFILES] = {
  "CAFE",
  "CURSO",
  "JUEGO"
};

// Mapa de teclas
// Perfil 0: CAFE (Teclas numéricas clásicas)
// Perfil 1: CURSO (KDS Control de Comandas para AppCurso)
//   - Pin 13: 'q'            -> Pestaña Anterior
//   - Pin 14: KEY_LEFT_ARROW -> Comanda Anterior
//   - Pin 27: KEY_RIGHT_ARROW-> Comanda Siguiente
//   - Pin 26: 'p'            -> Enviar a PREPARAR
//   - Pin 25: 'r'            -> DEVOLVER a pendiente (Revertir)
//   - Pin 33: KEY_RETURN     -> ACEPTAR / Avanzar flujo (Bump) / Entregar
//   - Pin 32: 'e'            -> Pestaña Siguiente
// Perfil 2: JUEGO (Alt + [1-7])
const uint8_t mapaTeclas[NUM_PERFILES][numSwitches] = {
  {'1', '2', '3', '4', '6', '7', '8'},
  {'q', KEY_LEFT_ARROW, KEY_RIGHT_ARROW, 'p', 'r', KEY_RETURN, 'e'},
  {'1', '2', '3', '4', '5', '6', '7'}
};

// Etiquetas en pantalla OLED (máx 10 caracteres por línea a texto tamaño 2)
const char* etiquetasBotones[NUM_PERFILES][numSwitches] = {
  {"HISTORIAL", "IZQUIERDA", "DERECHA", "ARRIBA", "ABAJO", "ENTER", "INGENIERIA"},
  {"PEST. IZQ", "ANTERIOR", "SIGUIENTE", "PREPARAR", "DEVOLVER", "ACEPTAR", "PEST. DER"},
  {"ALT + 1", "ALT + 2", "ALT + 3", "ALT + 4", "ALT + 5", "ALT + 6", "ALT + 7"}
};

// Variables de estado del sistema
int perfilActual = 0;
int perfilSeleccionadoMenu = 0;

int dispActual = 0;
int dispSeleccionadoMenu = 0;

enum ModoPantalla { MODO_NORMAL, MENU_PERFILES, MENU_DISPOSITIVOS };
ModoPantalla modoActual = MODO_NORMAL;

bool esperandoSoltarCombo = false;
bool estadoConexionPrevio = false;
String lastActionText = "LISTO";

void actualizarOLED() {
  display.clearDisplay();

  if (modoActual == MENU_PERFILES) {
    display.fillRect(0, 0, 128, 12, SH110X_WHITE);
    display.setTextColor(SH110X_BLACK, SH110X_WHITE);
    display.setTextSize(1);
    display.setCursor(14, 2);
    display.print("MODO DE TECLAS");

    display.setTextColor(SH110X_WHITE);
    display.setTextSize(2);
    String textoMenu = "< " + String(nombresCortos[perfilSeleccionadoMenu]) + " >";
    int ancho = textoMenu.length() * 12;
    int posX = (128 - ancho) / 2;
    display.setCursor(posX < 0 ? 0 : posX, 24);
    display.print(textoMenu);

    display.setTextSize(1);
    display.setCursor(4, 52);
    display.print("[ARR/ABA] [ENTER: OK]");
  } 
  else if (modoActual == MENU_DISPOSITIVOS) {
    display.fillRect(0, 0, 128, 12, SH110X_WHITE);
    display.setTextColor(SH110X_BLACK, SH110X_WHITE);
    display.setTextSize(1);
    display.setCursor(8, 2);
    display.print("DESTINO BLUETOOTH");

    display.setTextColor(SH110X_WHITE);
    display.setTextSize(2);
    String textoMenu = String(nombresDispositivos[dispSeleccionadoMenu]);
    int ancho = textoMenu.length() * 12;
    int posX = (128 - ancho) / 2;
    display.setCursor(posX < 0 ? 0 : posX, 24);
    display.print(textoMenu);

    display.setTextSize(1);
    display.setCursor(4, 52);
    display.print("[ARR/ABA] [ENTER: VINC]");
  } 
  else {
    // --- OPERACIÓN NORMAL ---
    display.fillRect(0, 0, 128, 12, SH110X_WHITE);
    display.setTextColor(SH110X_BLACK, SH110X_WHITE);
    display.setTextSize(1);
    
    display.setCursor(2, 2);
    if (bleKeyboard && bleKeyboard->isConnected()) {
      display.print("BT: ");
      display.print(nombresDispositivos[dispActual]);
    } else {
      display.print("BT: --");
    }
    
    String infoPerfil = "[" + String(nombresCortos[perfilActual]) + "]";
    int posXPerfil = 126 - (infoPerfil.length() * 6);
    display.setCursor(posXPerfil, 2);
    display.print(infoPerfil);

    display.setTextColor(SH110X_WHITE);
    display.setTextSize(2);
    int anchoTexto = lastActionText.length() * 12;
    int posX = (128 - anchoTexto) / 2;
    display.setCursor(posX < 0 ? 0 : posX, 26);
    display.print(lastActionText);

    display.drawFastHLine(0, 48, 128, SH110X_WHITE);
    display.setTextSize(1);
    display.setCursor(10, 54);
    display.print("H+ING: CAMBIAR BT");
  }

  display.display();
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  Serial.begin(115200);
  delay(200);

  preferences.begin("kds-config", false);
  perfilActual = preferences.getInt("perfil", 0);
  if (perfilActual < 0 || perfilActual >= NUM_PERFILES) perfilActual = 0;

  dispActual = preferences.getInt("dispositivo", 0);
  if (dispActual < 0 || dispActual >= NUM_DISPOSITIVOS) dispActual = 0;

  for (int i = 0; i < numSwitches; i++) {
    pinMode(switchPins[i], INPUT_PULLUP);
  }

  Wire.begin(21, 22);
  display.begin(0x3C, true);
  display.setRotation(2);
  display.setContrast(255);
  display.clearDisplay();

  // Asigna una dirección MAC independiente a cada ranura
  uint8_t macOriginal[6];
  esp_read_mac(macOriginal, ESP_MAC_BT);
  macOriginal[5] += dispActual;
  esp_base_mac_addr_set(macOriginal);

  // Inicializa el teclado Bluetooth de forma limpia
  bleKeyboard = new BleKeyboard(nombresBle[dispActual], "CastroSilva", 100);
  bleKeyboard->begin();

  actualizarOLED();
}

void loop() {
  unsigned long now = millis();

  bool conectadoAhora = (bleKeyboard && bleKeyboard->isConnected());
  if (conectadoAhora != estadoConexionPrevio) {
    estadoConexionPrevio = conectadoAhora;
    actualizarOLED();
  }

  bool arribaP = (digitalRead(switchPins[BTN_ARRIBA]) == LOW);
  bool abajoP  = (digitalRead(switchPins[BTN_ABAJO]) == LOW);
  bool histP   = (digitalRead(switchPins[BTN_HISTORIAL]) == LOW);
  bool ingP    = (digitalRead(switchPins[BTN_INGENIERIA]) == LOW);

  // Combo 1: ARRIBA + ABAJO -> Menú Perfiles
  if (arribaP && abajoP && !esperandoSoltarCombo && modoActual == MODO_NORMAL) {
    if (bleKeyboard) bleKeyboard->releaseAll();
    modoActual = MENU_PERFILES;
    perfilSeleccionadoMenu = perfilActual;
    esperandoSoltarCombo = true;
    actualizarOLED();
    delay(200);
    return;
  }

  // Combo 2: HISTORIAL + INGENIERÍA -> Menú Dispositivos BT
  if (histP && ingP && !esperandoSoltarCombo && modoActual == MODO_NORMAL) {
    if (bleKeyboard) bleKeyboard->releaseAll();
    modoActual = MENU_DISPOSITIVOS;
    dispSeleccionadoMenu = dispActual;
    esperandoSoltarCombo = true;
    actualizarOLED();
    delay(200);
    return;
  }

  if (esperandoSoltarCombo) {
    if (!arribaP && !abajoP && !histP && !ingP) {
      esperandoSoltarCombo = false;
      for (int i = 0; i < numSwitches; i++) lastState[i] = HIGH;
    }
    return;
  }

  for (int i = 0; i < numSwitches; i++) {
    bool reading = digitalRead(switchPins[i]);

    if (reading != lastState[i]) {
      if ((now - lastDebounce[i]) > debounceDelay) {
        lastDebounce[i] = now;
        lastState[i] = reading;

        if (modoActual == MENU_PERFILES) {
          if (reading == LOW) {
            if (i == BTN_ARRIBA || i == BTN_IZQUIERDA) {
              perfilSeleccionadoMenu--;
              if (perfilSeleccionadoMenu < 0) perfilSeleccionadoMenu = NUM_PERFILES - 1;
              actualizarOLED();
            } 
            else if (i == BTN_ABAJO || i == BTN_DERECHA) {
              perfilSeleccionadoMenu++;
              if (perfilSeleccionadoMenu >= NUM_PERFILES) perfilSeleccionadoMenu = 0;
              actualizarOLED();
            } 
            else if (i == BTN_ENTER) {
              perfilActual = perfilSeleccionadoMenu;
              preferences.putInt("perfil", perfilActual);
              modoActual = MODO_NORMAL;
              lastActionText = "LISTO";
              actualizarOLED();
            }
          }
        }
        else if (modoActual == MENU_DISPOSITIVOS) {
          if (reading == LOW) {
            if (i == BTN_ARRIBA || i == BTN_IZQUIERDA) {
              dispSeleccionadoMenu--;
              if (dispSeleccionadoMenu < 0) dispSeleccionadoMenu = NUM_DISPOSITIVOS - 1;
              actualizarOLED();
            } 
            else if (i == BTN_ABAJO || i == BTN_DERECHA) {
              dispSeleccionadoMenu++;
              if (dispSeleccionadoMenu >= NUM_DISPOSITIVOS) dispSeleccionadoMenu = 0;
              actualizarOLED();
            } 
            else if (i == BTN_ENTER) {
              dispActual = dispSeleccionadoMenu;
              preferences.putInt("dispositivo", dispActual);

              // Mensaje visual y reinicio automático para arrancar el stack limpio
              display.clearDisplay();
              display.setTextSize(1);
              display.setTextColor(SH110X_WHITE);
              display.setCursor(16, 28);
              display.print("CAMBIANDO A:");
              display.setCursor(16, 42);
              display.print(nombresDispositivos[dispActual]);
              display.display();

              delay(600);
              ESP.restart(); // Reinicia la ESP32 con la nueva MAC y nombre limpios
            }
          }
        }
        else {
          if (reading == LOW) {
            lastActionText = etiquetasBotones[perfilActual][i];
            actualizarOLED();

            if (bleKeyboard && bleKeyboard->isConnected()) {
              if (perfilActual == 2) {
                bleKeyboard->press(KEY_LEFT_ALT);
                bleKeyboard->press(mapaTeclas[perfilActual][i]);
              } else {
                bleKeyboard->write(mapaTeclas[perfilActual][i]);
              }
            }
          } else {
            if (perfilActual == 2 && bleKeyboard && bleKeyboard->isConnected()) {
              bleKeyboard->release(mapaTeclas[perfilActual][i]);
              bleKeyboard->release(KEY_LEFT_ALT);
            }
          }
        }
      }
    }
  }
}
