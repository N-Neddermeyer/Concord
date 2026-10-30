import { useSyncExternalStore } from 'react';

// Configurações do aplicativo (aparência, voz, notificações). Como no Discord, ficam
// salvas localmente em cada dispositivo, não na conta.

const DEFAULTS = {
  theme: 'dark', // dark | light | onyx
  messageDisplay: 'cozy', // cozy | compact
  fontSize: 16,
  inputDevice: 'default',
  videoDevice: 'default',
  outputDevice: 'default',
  outputVolume: 100,
  inputMode: 'voice', // voice (detecção de voz) | ptt (pressione para falar)
  pttKey: null, // { code, name, vk } — tecla ou botão do mouse do pressione para falar
  pttDelay: 20, // ms de atraso ao soltar a tecla
  autoSensitivity: true,
  sensitivity: -50, // dB, quando a detecção automática está desligada
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  desktopNotifications: true,
  sounds: true,
  streamAudio: true, // compartilhar o som junto com a tela
  userAudio: {}, // volume e silenciar por pessoa: userId -> { volume, muted, streamVolume, streamMuted }
  callHeaderHeight: null, // altura da chamada na DM, ajustada arrastando a borda (null = padrão)
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings') ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = load();
const listeners = new Set();

export const getSettings = () => settings;

export function updateSettings(patch) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem('settings', JSON.stringify(settings));
  } catch {
    // armazenamento indisponível: vale só para esta sessão
  }
  applyAppearance();
  for (const listener of listeners) listener(settings);
}

export const onSettingsChange = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSettings = () => useSyncExternalStore(onSettingsChange, getSettings);

export function applyAppearance() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.display = settings.messageDisplay;
  root.style.setProperty('--chat-font-size', `${settings.fontSize}px`);
}
