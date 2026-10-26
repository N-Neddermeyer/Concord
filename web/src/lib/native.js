// Ponte exposta pelo preload do Electron (equivalente ao DiscordNative). No navegador é null.
export const native = window.CloneNative ?? null;
export const isDesktop = native !== null;
