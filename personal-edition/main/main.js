'use strict';
/**
 * Electron main process.
 *
 * Security posture: context isolation, sandboxed renderer, no Node in the
 * renderer, a single IPC channel validated against the app's own window,
 * navigation and new windows blocked, all permission requests denied.
 */
const { app, BrowserWindow, ipcMain, shell, Menu, session, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createContext } = require('./context');
const { createApi } = require('./api');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const APP_ORIGIN = 'app://bop';

// The UI is served from a privileged app:// scheme (not file://) so ES modules load
// reliably and the renderer can only reach files inside the renderer folder.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serveRenderer() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(RENDERER_DIR, `.${rel}`);
    if (url.host !== 'bop' || !file.startsWith(RENDERER_DIR + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
let mainWindow = null;
let api = null;
let logStream = null;

function dataDir() {
  if (process.env.VMS_DATA_DIR) return path.resolve(process.env.VMS_DATA_DIR);
  return path.join(app.getPath('userData'), 'data');
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  if (logStream) logStream.write(line);
  if (!app.isPackaged) process.stdout.write(line);
}

const FOOTER = '<div style="font-family:Arial,sans-serif;font-size:7px;width:100%;padding:0 14mm;display:flex;justify-content:space-between;color:#7b6370"><span>Bank of Palestine · VMS-SLA · <span class="title"></span></span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>';

/** HTML -> PDF using an offscreen, script-disabled window. */
async function renderPdf(html) {
  const tmp = path.join(os.tmpdir(), `vms-sla-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadFile(tmp);
    return await win.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, preferCSSPageSize: false,
      margins: { top: 0.63, bottom: 0.71, left: 0.55, right: 0.55 },
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: FOOTER,
    });
  } finally {
    win.destroy();
    fs.rm(tmp, { force: true }, () => {});
  }
}

async function openPath(p) {
  const err = await shell.openPath(p);
  if (err) throw new Error(err);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    title: 'BOP Vendor & SLA - Personal', backgroundColor: '#faf7f9', show: false,
    icon: path.join(RENDERER_DIR, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${APP_ORIGIN}/`)) e.preventDefault(); });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
}

function buildMenu() {
  const template = [
    { label: 'File', submenu: [{ label: 'Open data folder', click: () => shell.openPath(dataDir()) }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  // The database is held in memory and written atomically; a second instance would overwrite it.
  app.quit();
} else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

  app.whenReady().then(async () => {
    const dir = dataDir();
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    logStream = fs.createWriteStream(path.join(dir, 'logs', 'app.log'), { flags: 'a' });
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    serveRenderer();

    const ctx = await createContext({ dataDir: dir, renderPdf, openPath, log });
    api = createApi(ctx);
    log(`VMS-SLA started. Data folder: ${dir}`);

    ipcMain.handle('vms:invoke', (event, channel, args) => {
      if (!mainWindow || event.sender !== mainWindow.webContents || !event.senderFrame.url.startsWith(`${APP_ORIGIN}/`)) {
        return { ok: false, error: { message: 'Request rejected.', code: 'FORBIDDEN' } };
      }
      if (typeof channel !== 'string') return { ok: false, error: { message: 'Bad request.', code: 'VALIDATION' } };
      return api.invoke(channel, args);
    });
    ipcMain.handle('vms:openPdf', async (event, base64, name) => {
      if (!mainWindow || event.sender !== mainWindow.webContents) return false;
      const safe = String(name || 'preview.pdf').replace(/[^A-Za-z0-9._-]/g, '_');
      const p = path.join(os.tmpdir(), `vms-sla-${Date.now()}-${safe}`);
      fs.writeFileSync(p, Buffer.from(String(base64), 'base64'));
      await openPath(p);
      return true;
    });

    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    app.on('before-quit', () => { try { ctx.db.close(); } catch (e) { log('close failed', e); } });
  }).catch((e) => {
    log('Startup failed', e);
    const { dialog } = require('electron');
    dialog.showErrorBox('VMS-SLA could not start', String(e && e.message ? e.message : e));
    app.quit();
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
