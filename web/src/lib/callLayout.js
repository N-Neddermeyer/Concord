import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// Layout da chamada por canal, no modelo do Discord (ChannelRTCStore):
//   MINIMUM     só voz: a faixa com os avatares em cima do chat
//   NORMAL      vídeo com o chat embaixo (a altura se ajusta arrastando a borda de baixo)
//   NO_CHAT     a chamada ocupa o canal inteiro (botão "Ocultar chat")
//   FULL_SCREEN tela cheia do app; Esc ou o botão voltam ao layout anterior
// Também guarda o participante em destaque (o bloco ampliado na grade).

export const LAYOUT = { MINIMUM: 'minimum', NORMAL: 'normal', NO_CHAT: 'no-chat', FULL_SCREEN: 'full-screen' };

// Limites da área redimensionável, os mesmos do Discord.
export const CALL_MIN_HEIGHT = 230;
export const CALL_CHAT_RESERVE = 200; // altura máxima = altura do canal menos isso

const EMPTY = { layout: LAYOUT.NORMAL, previous: LAYOUT.NORMAL, selected: null };
let state = {}; // channelId -> { layout, previous, selected }
const listeners = new Set();

const entry = (channelId) => state[channelId] ?? EMPTY;

function update(channelId, patch) {
  state = { ...state, [channelId]: { ...entry(channelId), ...patch } };
  for (const listener of listeners) listener();
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useCallLayout = (channelId) => useSyncExternalStore(subscribe, () => entry(channelId));

export const setLayout = (channelId, layout) => update(channelId, { layout });

export const selectParticipant = (channelId, key) => update(channelId, { selected: key });

export function toggleChat(channelId) {
  const { layout } = entry(channelId);
  // Em tela cheia, "mostrar chat" sai dela direto para o layout com chat.
  if (layout === LAYOUT.FULL_SCREEN) return leaveFullScreen(channelId, LAYOUT.NORMAL);
  setLayout(channelId, layout === LAYOUT.NO_CHAT ? LAYOUT.NORMAL : LAYOUT.NO_CHAT);
}

export function enterFullScreen(channelId) {
  const { layout } = entry(channelId);
  if (layout === LAYOUT.FULL_SCREEN) return;
  update(channelId, { layout: LAYOUT.FULL_SCREEN, previous: layout });
  document.documentElement.requestFullscreen?.().catch(() => {});
}

export function leaveFullScreen(channelId, to) {
  const current = entry(channelId);
  if (current.layout !== LAYOUT.FULL_SCREEN) return;
  update(channelId, { layout: to ?? current.previous });
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

export const toggleFullScreen = (channelId) =>
  entry(channelId).layout === LAYOUT.FULL_SCREEN ? leaveFullScreen(channelId) : enterFullScreen(channelId);

// Tela cheia de um bloco: destaca o participante e entra em tela cheia; de novo no mesmo, sai.
export function fullscreenParticipant(channelId, key) {
  const { layout, selected } = entry(channelId);
  const full = layout === LAYOUT.FULL_SCREEN;
  if ((!full && selected !== key) || (full && selected === key)) selectParticipant(channelId, full ? null : key);
  toggleFullScreen(channelId);
}

// Saiu da tela cheia pelo sistema (Esc, F11, outra janela): volta ao layout anterior.
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) return;
  for (const [channelId, s] of Object.entries(state)) if (s.layout === LAYOUT.FULL_SCREEN) leaveFullScreen(channelId);
});
// Esc também sai quando o navegador não estava em tela cheia de verdade (ex.: pedido negado).
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  for (const [channelId, s] of Object.entries(state)) if (s.layout === LAYOUT.FULL_SCREEN) leaveFullScreen(channelId);
});

// Controles somem depois de 2 s sem mexer o mouse (mesmo tempo do Discord).
const IDLE_MS = 2000;
export function useIdle(enabled) {
  const [idle, setIdle] = useState(false);
  const timer = useRef(null);
  const wake = () => {
    setIdle(false);
    clearTimeout(timer.current);
    if (enabled) timer.current = setTimeout(() => setIdle(true), IDLE_MS);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(timer.current);
  }, [enabled]);
  return [enabled && idle, { onMouseMove: wake, onMouseDown: wake, onMouseLeave: () => enabled && setIdle(true) }];
}
