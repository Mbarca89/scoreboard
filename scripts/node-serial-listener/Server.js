const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { Server } = require("socket.io");
const http = require("http");

const SERIAL_PATH =
  "/dev/serial/by-id/usb-Arduino_LLC_Arduino_Leonardo-if00";

const SERIAL_BAUD = 9600;
const SOCKET_PORT = 3001;

// El botón se libera recién cuando pasan 500 ms sin recibir repeticiones.
const BUTTON_RELEASE_MS = 500;

const buttonLocks = new Map();

const httpServer = http.createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

let port = null;
let reconnectTimer = null;

function emitButtonPress(buttonId) {
  const payload = {
    type: "button_press",
    buttonId,
    receivedAt: Date.now(),
  };

  console.log("[SOCKET EMIT]", payload);
  io.emit("button_press", payload);
}

function lockButton(buttonId) {
  const existingTimer = buttonLocks.get(buttonId);

  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    buttonLocks.delete(buttonId);
    console.log(`[DEBOUNCE] Botón ${buttonId} liberado`);
  }, BUTTON_RELEASE_MS);

  buttonLocks.set(buttonId, timer);
}

function handleSerialMessage(line) {
  const msg = line.trim();

  if (!msg) {
    return;
  }

  console.log("[SERIAL RX]", msg);

  const match = msg.match(/^BOTON\s+(\d{1,3})$/i);

  if (!match) {
    return;
  }

  const buttonId = Number(match[1]);

  // El protocolo del transmisor usa un byte. Cualquier otro valor se descarta.
  if (!Number.isInteger(buttonId) || buttonId < 1 || buttonId > 255) {
    console.warn(`[SERIAL] ID fuera de rango ignorado: ${match[1]}`);
    return;
  }
  const isAlreadyLocked = buttonLocks.has(buttonId);

  // Cada repetición extiende el bloqueo.
  lockButton(buttonId);

  if (isAlreadyLocked) {
    console.log(`[DEBOUNCE] Repetición ignorada: botón ${buttonId}`);
    return;
  }

  // Solo la primera copia de la pulsación genera evento.
  emitButtonPress(buttonId);
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSerial();
  }, 2000);
}

function openSerial() {
  console.log(
    `[SERIAL] Opening ${SERIAL_PATH} at ${SERIAL_BAUD} baud...`
  );

  port = new SerialPort({
    path: SERIAL_PATH,
    baudRate: SERIAL_BAUD,
    autoOpen: false,
  });

  const parser = port.pipe(
    new ReadlineParser({
      delimiter: "\n",
    })
  );

  port.on("open", () => {
    console.log("[SERIAL] Port opened");
  });

  port.on("error", (error) => {
    console.error("[SERIAL] Error:", error.message);
  });

  port.on("close", () => {
    console.warn("[SERIAL] Port closed. Reconnecting in 2s...");
    scheduleReconnect();
  });

  parser.on("data", handleSerialMessage);

  port.open((error) => {
    if (error) {
      console.error("[SERIAL] Open failed:", error.message);
      scheduleReconnect();
    }
  });
}

io.on("connection", (socket) => {
  console.log(`[SOCKET] Client connected: ${socket.id}`);

  socket.emit("remote_status", {
    type: "remote_status",
    connected: Boolean(port?.isOpen),
    serialPath: SERIAL_PATH,
  });

  socket.on("disconnect", () => {
    console.log(`[SOCKET] Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(SOCKET_PORT, () => {
  console.log(`[SOCKET] Listening on port ${SOCKET_PORT}`);
});

openSerial();
