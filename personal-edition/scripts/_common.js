'use strict';
const os = require('os');
const path = require('path');

/** Default data folder used by the desktop app (Electron userData/data). */
function defaultDataDir() {
  if (process.env.VMS_DATA_DIR) return path.resolve(process.env.VMS_DATA_DIR);
  const name = 'BOP VMS-SLA Personal';
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), name, 'data');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', name, 'data');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name, 'data');
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i += 1; }
    } else out._.push(a);
  }
  return out;
}

module.exports = { defaultDataDir, parseArgs };
