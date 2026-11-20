/* TailRef · ayrı panel penceresi köprüsü */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panelBridge', {
  onInit: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('panel-init', (_event, data) => callback(data));
  },
  onUpdate: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('panel-update', (_event, snapshot) => callback(snapshot));
  },
  sendAction: (id, action) => ipcRenderer.send('panel-action-from-window', id, action),
  /* Ayrı penceredeki <webview> konuğundan gelen mesajı ana uygulamaya iletir. */
  sendGuestMessage: (id, channel, args) => ipcRenderer.send('panel-guest-message', id, channel, args),
  onGuestSend: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('panel-guest-send', (_event, channel, args) => callback(channel, args));
  },
  requestDock: id => ipcRenderer.send('panel-window-dock', id),
  requestClose: id => ipcRenderer.send('panel-window-close', id),
  /* Ayrı panel penceresini tam ekran yap / durumunu sor. */
  toggleFullscreen: id => ipcRenderer.invoke('panel-window-toggle-fullscreen', id),
  isFullscreen: id => ipcRenderer.invoke('panel-window-is-fullscreen', id),
  /* Panel kenarından canlı boyutlandırma: görünen panelin ekran dikdörtgeni. */
  setPanelBounds: (id, bounds) => ipcRenderer.send('panel-window-set-bounds', id, bounds),
});
