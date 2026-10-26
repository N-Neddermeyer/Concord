// Ponte da splash: só trocar o endereço do servidor ou sair.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('CloneSplash', {
  setServer: (url) => ipcRenderer.send('CLONE_SPLASH_SET_SERVER', String(url)),
  quit: () => ipcRenderer.send('CLONE_SPLASH_QUIT'),
});
