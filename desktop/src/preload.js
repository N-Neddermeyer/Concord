// Ponte mínima entre a página e o processo principal (equivalente ao DiscordNative).
// A página não tem acesso ao Node; só a estas funções.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('CloneNative', {
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.send('CLONE_WINDOW_MINIMIZE'),
    maximize: () => ipcRenderer.send('CLONE_WINDOW_MAXIMIZE'),
    close: () => ipcRenderer.send('CLONE_WINDOW_CLOSE'),
    focus: () => ipcRenderer.send('CLONE_WINDOW_FOCUS'),
    flashFrame: (flag) => ipcRenderer.send('CLONE_WINDOW_FLASH', !!flag),
    isMaximized: () => ipcRenderer.invoke('CLONE_WINDOW_IS_MAXIMIZED'),
    getZoom: () => ipcRenderer.invoke('CLONE_WINDOW_GET_ZOOM'),
    setZoom: (factor) => ipcRenderer.send('CLONE_WINDOW_SET_ZOOM', Number(factor)),
    onMaximizeChange: (callback) => {
      const listener = (_event, maximized) => callback(!!maximized);
      ipcRenderer.on('CLONE_WINDOW_MAXIMIZED', listener);
      return () => ipcRenderer.removeListener('CLONE_WINDOW_MAXIMIZED', listener);
    },
  },
  app: {
    getInfo: () => ipcRenderer.invoke('CLONE_APP_GET_INFO'),
  },
  screen: {
    getSources: () => ipcRenderer.invoke('CLONE_SCREEN_GET_SOURCES'),
    select: (id) => ipcRenderer.send('CLONE_SCREEN_SELECT', String(id)),
  },
});
