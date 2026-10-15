// Landora Desktop: abre o painel (landora-app-dk.web.app) numa janela própria.
// Como carrega o site online, toda vez que você publica uma atualização (firebase deploy)
// o aplicativo já abre com a versão nova — não precisa gerar outro .exe.

const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, session, shell } = require("electron");
const path = require("path");

const APP_URL = "https://landora-app-dk.web.app";
const APP_ORIGIN = new URL(APP_URL).origin;

// Mantém a call (envio de voz/vídeo/tela) rodando normalmente com a janela minimizada ou em segundo plano.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let pickerWin = null;
let pickerResolve = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 600,
    title: "Landora",
    icon: path.join(__dirname, "build", "icon.png"),
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.loadURL(APP_URL);

  // Links para outros sites abrem no navegador, não dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Sem internet: mostra uma tela simples com botão para tentar de novo.
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && url.startsWith("http")) {
      win.loadFile(path.join(__dirname, "offline.html"));
    }
  });

  win.on("closed", () => {
    win = null;
  });
}

// ---------- permissões (microfone, câmera, compartilhar tela) ----------
function setupPermissions() {
  const allowed = new Set(["media", "display-capture", "fullscreen", "notifications"]);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details.requestingUrl ? new URL(details.requestingUrl).origin : "";
    callback(origin === APP_ORIGIN && allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
    return origin === APP_ORIGIN && allowed.has(permission);
  });

  // Quando o site pede para compartilhar a tela, abrimos um seletor de telas/janelas.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const chosen = await pickSource();
    if (!chosen) {
      callback({});
      return;
    }
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
    const source = sources.find((s) => s.id === chosen);
    if (!source) {
      callback({});
      return;
    }
    // "loopback" também envia o som do computador junto com a tela.
    callback({ video: source, audio: "loopback" });
  });
}

// ---------- seletor de tela/janela ----------
function pickSource() {
  return new Promise((resolve) => {
    if (pickerWin) pickerWin.close();
    pickerResolve = resolve;
    pickerWin = new BrowserWindow({
      width: 760,
      height: 560,
      parent: win || undefined,
      modal: !!win,
      title: "Compartilhar tela",
      backgroundColor: "#0a0a0a",
      autoHideMenuBar: true,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, "picker-preload.js"),
        contextIsolation: true,
        sandbox: true,
      },
    });
    pickerWin.setMenu(null);
    pickerWin.loadFile(path.join(__dirname, "picker.html"));
    pickerWin.on("closed", () => {
      pickerWin = null;
      if (pickerResolve) {
        pickerResolve(null);
        pickerResolve = null;
      }
    });
  });
}

ipcMain.handle("picker:sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
  });
  return sources.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
});
ipcMain.on("picker:choose", (_e, id) => {
  if (pickerResolve) {
    pickerResolve(id);
    pickerResolve = null;
  }
  if (pickerWin) pickerWin.close();
});
ipcMain.on("picker:cancel", () => {
  if (pickerWin) pickerWin.close();
});

app.whenReady().then(async () => {
  // Sempre abre a versão mais nova do site (descarta qualquer cópia antiga guardada).
  await session.defaultSession.clearCache().catch(() => {});
  setupPermissions();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
