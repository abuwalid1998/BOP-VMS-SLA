'use strict';
// Exposes the minimum surface to the sandboxed renderer: one request channel
// and a helper to open a generated PDF in the system viewer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vms', {
  platform: 'electron',
  invoke: (channel, args) => ipcRenderer.invoke('vms:invoke', channel, args),
  openPdf: (base64, name) => ipcRenderer.invoke('vms:openPdf', base64, name),
});
