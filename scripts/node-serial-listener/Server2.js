const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { Server } = require("socket.io");
const http = require("http");

// Linux:
// const SERIAL_PATH =
//   "/dev/serial/by-id/usb-Arduino_LLC_Arduino_Leonardo-if00";

const SERIAL_PATH = "COM3";

const SERIAL_BAUD = 9600;
const SOCKET_PORT = 3001;

// El control se considera liberado cuando pasan
// 250 ms sin recibir repeticiones.
const BUTTON_RELEASE_MS = 250;

const buttonLocks = new Map();

const httpServer = http.createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

let port = null;
let reconnectTimer = null;

function emitButtonPress(controlId, key) {
  const payload = {
    type: "button_press",
    buttonId: controlId,
    ...(key === undefined ? {} : { key }),
    receivedAt: Date.now(),
  };

  console.log("[SOCKET EMIT]", payload);
  io.emit("button_press", payload);
}

function lockButton(lockId) {
  const existingTimer = buttonLocks.get(lockId);

  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    buttonLocks.delete(lockId);
    console.log(`[DEBOUNCE] ${lockId} liberado`);
  }, BUTTON_RELEASE_MS);

  buttonLocks.set(lockId, timer);
}

function handleSerialMessage(line) {
  const msg = line.trim();

  if (!msg) {
    return;
  }

  console.log("[SERIAL RX]", msg);

  // Botones originales: BOTON 1 (IDs del 1 al 9).
  const legacyMatch = msg.match(/^BOTON\s+(\d+)$/i);

  if (legacyMatch) {
    const buttonId = Number(legacyMatch[1]);

    if (!Number.isInteger(buttonId) || buttonId < 1 || buttonId > 9) {
      console.warn(`[SERIAL] ID fuera de rango ignorado: ${legacyMatch[1]}`);
      return;
    }

    const lockId = `BOTON:${buttonId}`;
    const isAlreadyLocked = buttonLocks.has(lockId);
    lockButton(lockId);

    if (!isAlreadyLocked) {
      emitButtonPress(buttonId);
    }
    return;
  }

  // Controles RF: RF 1003200 4.
  const match = msg.match(/^RF\s+(\d+)\s+(\d+)$/i);

  if (!match) {
    // Ignoramos BASE_RF_READY y cualquier basura serial.
    console.log(`[SERIAL] Mensaje ignorado: ${JSON.stringify(msg)}`);
    return;
  }

  const controlId = Number(match[1]);
  const key = Number(match[2]);

  if (!Number.isInteger(controlId) || controlId <= 0) {
    console.warn(`[SERIAL] Control ID inválido: ${match[1]}`);
    return;
  }

  if (!Number.isInteger(key) || key < 1 || key > 15) {
    console.warn(`[SERIAL] Tecla inválida: ${match[2]}`);
    return;
  }

  /*
   * El lock incluye control + tecla.
   *
   * Así, si algún día usamos A/B/C/D para cosas distintas,
   * no nos limitamos innecesariamente.
   */
  const lockId = `RF:${controlId}:${key}`;

  const isAlreadyLocked = buttonLocks.has(lockId);

  lockButton(lockId);

  if (isAlreadyLocked) {
    return;
  }

  emitButtonPress(controlId, key);
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
