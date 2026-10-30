// Processo principal da casca desktop, no mesmo desenho do Discord: janela sem moldura
// (a barra de título é desenhada pela página), splash enquanto o backend sobe, ícone na
// bandeja ao fechar e uma ponte mínima (preload) para os controles da janela.
const { app, BrowserWindow, Menu, Tray, desktopCapturer, ipcMain, nativeImage, session, shell } = require('electron');
const { fork, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Endereço do servidor: CLONE_URL > o escolhido na tela de conexão (server.json no perfil) >
// o gravado no build do instalador (cloneServerUrl) > local. Assim, se o IP do servidor mudar,
// a segunda máquina só digita o novo endereço, sem gerar outro instalador.
const { cloneServerUrl } = require('../package.json');
const DEFAULT_URL = cloneServerUrl ?? 'http://127.0.0.1:3001';
const SERVER_FILE = path.join(app.getPath('userData'), 'server.json');
const APP_URL = new URL(process.env.CLONE_URL ?? savedServerUrl() ?? DEFAULT_URL);
const SERVER_ENTRY = path.join(__dirname, '..', '..', 'server', 'src', 'index.js');
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const BACKGROUND = '#1e1f22';

let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverProcess = null;
let quitting = false;
let pendingScreenSource = null; // fonte escolhida no seletor da página para o próximo getDisplayMedia
let pttWatcher = null; // { vk, process } — leitura da tecla do pressione para falar fora de foco

function savedServerUrl() {
  try {
    return new URL(JSON.parse(fs.readFileSync(SERVER_FILE, 'utf8')).url).origin;
  } catch {
    return null;
  }
}

// Microfone, câmera e tela exigem contexto seguro (HTTPS ou localhost). Para testar na rede local
// com um servidor em http://IP:porta, tratamos só essa origem como segura.
if (APP_URL.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(APP_URL.hostname)) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', APP_URL.origin);
}
// Sem STUN, a voz/vídeo entre máquinas depende dos IPs locais nos candidatos ICE. O Chromium os
// esconde atrás de nomes .local (mDNS), que muitas redes Windows não resolvem; aqui usamos o IP real.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(start);
}

app.setAppUserModelId('clone.local.desktop');

// --- estado da janela (tamanho, posição, maximizada) ---

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { width: 1280, height: 720, maximized: false };
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getNormalBounds();
  const state = { ...bounds, maximized: mainWindow.isMaximized(), zoom: mainWindow.webContents.getZoomFactor() };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {
    // perfil sem permissão de escrita: só não lembra o tamanho
  }
}

// --- backend local ---

async function isServerUp() {
  try {
    const res = await fetch(new URL('/api/health', APP_URL), { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Se o servidor local não estiver rodando, sobe um junto com o app (o Electron executa o
// Node embutido no fork). Para um servidor remoto (CLONE_URL), só espera ele responder.
async function ensureServer(setStatus) {
  if (await isServerUp()) return;
  const local = ['127.0.0.1', 'localhost'].includes(APP_URL.hostname);
  if (local) {
    setStatus('Iniciando servidor local…');
    serverProcess = fork(SERVER_ENTRY, [], {
      cwd: path.dirname(path.dirname(SERVER_ENTRY)),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: APP_URL.port || '80', HOST: APP_URL.hostname },
      stdio: 'inherit',
    });
    serverProcess.on('exit', (code) => {
      serverProcess = null;
      if (!quitting) console.error(`Servidor local encerrou (código ${code}).`);
    });
  } else {
    setStatus('Conectando ao servidor…');
  }
  // Servidor local: tempo para subir. Remoto: se não responder logo, mostra o formulário de endereço.
  const deadline = Date.now() + (local ? 15000 : 8000);
  while (Date.now() < deadline) {
    if (await isServerUp()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`O servidor em ${APP_URL.origin} não respondeu.`);
}

// --- janelas ---

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 340,
    height: 380,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    skipTaskbar: true,
    backgroundColor: BACKGROUND,
    webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, 'splash-preload.js') },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow?.show());
  splashWindow.on('closed', () => (splashWindow = null));
}

function setSplashStatus(text) {
  splashWindow?.webContents.executeJavaScript(`window.setStatus(${JSON.stringify(text)})`).catch(() => {});
}

// Servidor fora do ar ou endereço errado: a splash mostra o endereço para corrigir.
function showServerForm(message) {
  const args = JSON.stringify({ message, url: APP_URL.origin, fallback: DEFAULT_URL });
  splashWindow?.webContents.executeJavaScript(`window.showServerForm(${args})`).catch(() => {});
}

// Gravar o novo endereço e reiniciar: a origem segura (acima) só vale a partir da inicialização.
function changeServer(value) {
  let url = null;
  if (value) {
    try {
      const parsed = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
      if (!parsed.port && !/:\d+\/?$/.test(value)) parsed.port = '3001'; // sem porta: a padrão do servidor
      url = parsed.origin;
    } catch {
      return showServerForm('Endereço inválido. Use o formato 192.168.0.10:3001');
    }
  }
  try {
    if (url) fs.writeFileSync(SERVER_FILE, JSON.stringify({ url }));
    else fs.rmSync(SERVER_FILE, { force: true });
  } catch (e) {
    return showServerForm(`Não foi possível salvar: ${e.message}`);
  }
  app.relaunch();
  app.exit(0);
}

function createMainWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 940,
    minHeight: 500,
    frame: false,
    show: false,
    backgroundColor: BACKGROUND,
    title: 'Clone Local',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false, // a voz continua funcionando com a janela minimizada
    },
  });
  if (state.maximized) mainWindow.maximize();

  mainWindow.webContents.on('did-finish-load', () => {
    if (state.zoom) mainWindow.webContents.setZoomFactor(state.zoom);
  });
  mainWindow.once('ready-to-show', () => {
    splashWindow?.close();
    mainWindow.show();
  });

  // Fechar esconde na bandeja, como o Discord; "Sair" no menu da bandeja encerra.
  mainWindow.on('close', (event) => {
    saveWindowState();
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  for (const name of ['maximize', 'unmaximize']) {
    mainWindow.on(name, () => mainWindow.webContents.send('CLONE_WINDOW_MAXIMIZED', mainWindow.isMaximized()));
  }
  mainWindow.on('focus', () => mainWindow.flashFrame(false));
  mainWindow.on('resized', saveWindowState);
  mainWindow.on('moved', saveWindowState);

  lockNavigation(mainWindow.webContents);
  attachContextMenu(mainWindow.webContents);
  attachShortcuts(mainWindow.webContents);

  mainWindow.loadURL(APP_URL.href);
}

function showMain() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// A janela só navega dentro do app; links externos abrem no navegador padrão.
function lockNavigation(contents) {
  const openExternal = (url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  };
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== APP_URL.origin) {
      event.preventDefault();
      openExternal(url);
    }
  });
}

// Menu de contexto com recortar/copiar/colar e sugestões do corretor ortográfico.
function attachContextMenu(contents) {
  contents.on('context-menu', (_event, params) => {
    const items = [];
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
    }
    if (params.misspelledWord) {
      items.push({ label: 'Adicionar ao dicionário', click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.linkURL) items.push({ label: 'Copiar link', click: () => require('electron').clipboard.writeText(params.linkURL) });
    if (params.isEditable) {
      items.push({ label: 'Recortar', role: 'cut', enabled: params.editFlags.canCut });
      items.push({ label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy });
      items.push({ label: 'Colar', role: 'paste', enabled: params.editFlags.canPaste });
      items.push({ label: 'Selecionar tudo', role: 'selectAll' });
    } else if (params.selectionText) {
      items.push({ label: 'Copiar', role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(contents) });
  });
}

// Sem menu de aplicativo: os atalhos úteis do Discord são tratados aqui.
function attachShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
    const key = input.key.toLowerCase();
    const zoom = contents.getZoomFactor();
    if (input.shift && key === 'i') contents.toggleDevTools();
    else if (key === 'r' && !input.shift) contents.reload();
    else if (key === '=' || key === '+') contents.setZoomFactor(Math.min(zoom + 0.1, 2));
    else if (key === '-') contents.setZoomFactor(Math.max(zoom - 0.1, 0.5));
    else if (key === '0') contents.setZoomFactor(1);
    else return;
    event.preventDefault();
    saveWindowState();
  });
}

// --- bandeja ---

// Ícone neutro (círculo na cor de destaque) enquanto o app não tem logo própria.
function trayIcon() {
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center);
      const alpha = Math.max(0, Math.min(1, size / 2 - distance));
      const i = (y * size + x) * 4;
      pixels[i] = 0xf2; // BGRA: #5865f2
      pixels[i + 1] = 0x65;
      pixels[i + 2] = 0x58;
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size }).resize({ width: 16, height: 16 });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Clone Local');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir', click: showMain },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]));
  tray.on('click', showMain);
}

// --- pressione para falar fora de foco ---

// O Discord usa um hook nativo de teclado. Aqui, no Windows, um PowerShell consulta só a tecla
// escolhida (GetAsyncKeyState) a cada 15 ms e avisa quando ela muda; a página junta isso às teclas
// que ela mesma recebe em foco. O processo fecha sozinho se o app fechar.
function watchPttKey(vk) {
  const key = Number.isInteger(vk) && vk > 0 && vk < 256 ? vk : null;
  if (key === (pttWatcher?.vk ?? null)) return;
  pttWatcher?.process.kill();
  pttWatcher = null;
  if (!key || process.platform !== 'win32') return;

  const script = `$ErrorActionPreference = 'Stop'
Add-Type -Namespace CloneLocal -Name Keys -MemberDefinition '[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);'
$parent = [System.Diagnostics.Process]::GetProcessById(${process.pid})
$last = $false
while (-not $parent.HasExited) {
  $down = ([CloneLocal.Keys]::GetAsyncKeyState(${key}) -band 0x8000) -ne 0
  if ($down -ne $last) { [Console]::Out.WriteLine([int]$down); $last = $down }
  Start-Sleep -Milliseconds 15
}`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const watcher = { vk: key, process: child };
  pttWatcher = watcher;
  child.stdout.on('data', (chunk) => {
    const states = String(chunk).match(/[01]/g);
    if (states && pttWatcher === watcher) mainWindow?.webContents.send('CLONE_PTT_STATE', states.at(-1) === '1');
  });
  child.on('exit', () => {
    if (pttWatcher !== watcher) return;
    pttWatcher = null;
    mainWindow?.webContents.send('CLONE_PTT_STATE', false);
  });
}

// --- ponte com a página (canais no estilo DISCORD_*, aqui CLONE_*) ---

function fromMainWindow(event) {
  return mainWindow && event.sender === mainWindow.webContents && new URL(event.senderFrame.url).origin === APP_URL.origin;
}

function registerIpc() {
  const on = (channel, handler) => ipcMain.on(channel, (event, ...args) => fromMainWindow(event) && handler(...args));
  const handle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => (fromMainWindow(event) ? handler(...args) : null));

  on('CLONE_WINDOW_MINIMIZE', () => mainWindow.minimize());
  on('CLONE_WINDOW_MAXIMIZE', () => (mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()));
  on('CLONE_WINDOW_CLOSE', () => mainWindow.close());
  on('CLONE_WINDOW_FOCUS', showMain);
  on('CLONE_WINDOW_FLASH', (flag) => !mainWindow.isFocused() && mainWindow.flashFrame(!!flag));
  on('CLONE_WINDOW_SET_ZOOM', (factor) => {
    const value = Number(factor);
    if (value >= 0.5 && value <= 2) mainWindow.webContents.setZoomFactor(value);
    saveWindowState();
  });
  handle('CLONE_WINDOW_IS_MAXIMIZED', () => mainWindow.isMaximized());
  handle('CLONE_WINDOW_GET_ZOOM', () => mainWindow.webContents.getZoomFactor());
  // Compartilhar tela: a página lista as fontes (com miniatura), mostra o seletor no estilo do
  // Discord e escolhe uma; o getDisplayMedia seguinte usa essa fonte (setDisplayMediaRequestHandler).
  handle('CLONE_SCREEN_GET_SOURCES', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources
      .filter((s) => !mainWindow || s.id !== mainWindow.getMediaSourceId())
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: s.thumbnail.toDataURL(),
        icon: s.appIcon?.toDataURL() ?? null,
      }));
  });
  on('CLONE_SCREEN_SELECT', (id) => (pendingScreenSource = typeof id === 'string' ? id : null));
  on('CLONE_PTT_SET_KEY', (vk) => watchPttKey(vk));

  // Tela de conexão (splash): trocar o servidor ou sair.
  const fromSplash = (event) => splashWindow && event.sender === splashWindow.webContents;
  ipcMain.on('CLONE_SPLASH_SET_SERVER', (event, value) => fromSplash(event) && changeServer(String(value ?? '').trim()));
  ipcMain.on('CLONE_SPLASH_QUIT', (event) => fromSplash(event) && app.quit());
  handle('CLONE_APP_GET_INFO', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
  }));
}

// Microfone, câmera, tela, notificações e tela cheia (chamada) só para a origem do app; o resto é negado.
function configurePermissions() {
  const allowed = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'speaker-selection', 'fullscreen']);
  const fromApp = (url) => {
    try {
      return new URL(url).origin === APP_URL.origin;
    } catch {
      return false;
    }
  };
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(fromApp(details.requestingUrl ?? contents.getURL()) && allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => fromApp(origin) && allowed.has(permission));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const id = pendingScreenSource;
    pendingScreenSource = null;
    if (!fromApp(request.securityOrigin ?? request.frame?.url) || !id) return callback({});
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } });
    const source = sources.find((s) => s.id === id);
    // Som da tela: o loopback do sistema (só no Windows). A página pede com restrictOwnAudio, e o
    // Chromium troca para o loopback sem o som do próprio app, sem eco das vozes da chamada.
    const audio = request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' } : {};
    callback(source ? { video: source, ...audio } : {});
  });
}

async function start() {
  Menu.setApplicationMenu(null);
  registerIpc();
  configurePermissions();
  createSplash();
  createTray();
  try {
    await ensureServer(setSplashStatus);
    setSplashStatus('Iniciando…');
    createMainWindow();
  } catch (e) {
    showServerForm(e.message);
  }
}

app.on('before-quit', () => {
  quitting = true;
  saveWindowState();
  serverProcess?.kill();
  pttWatcher?.process.kill();
});

app.on('window-all-closed', () => {
  // Fica na bandeja: a janela principal só é escondida.
});
