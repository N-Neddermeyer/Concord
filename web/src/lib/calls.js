import { api } from './api.js';
import { showError } from './dialogs.js';
import { native } from './native.js';
import { getSettings } from './settings.js';
import { startLoop, stopLoop } from './sounds.js';
import { HOME, dmRecipient, getState, navigate, privateChannelName, subscribe } from './store.js';
import { voice } from './voice.js';

// Chamadas individuais em DM, no fluxo do Discord: quem liga entra na "voz" da DM, o
// servidor cria a chamada e toca para o outro (CALL_CREATE com ringing), que atende
// entrando também, ou recusa (stop-ringing). A chamada termina quando o último sai.

export const startCall = (channelId) => voice.join(null, channelId);

export function acceptCall(channelId) {
  navigate(HOME, channelId);
  voice.join(null, channelId);
}

export const declineCall = (channelId) =>
  api(`/channels/${channelId}/call/stop-ringing`, { method: 'POST', body: {} }).catch((e) => showError(e.message));

export const ringAgain = (channelId) =>
  api(`/channels/${channelId}/call/ring`, { method: 'POST', body: {} }).catch((e) => showError(e.message));

export const hangUp = () => voice.leave();

// Chamadas tocando para mim (e das quais ainda não participo).
export function incomingCalls(s) {
  if (!s.user) return [];
  return Object.values(s.calls).filter((c) => c.ringing.includes(s.user.id) && s.voiceStates[s.user.id]?.channel_id !== c.channel_id);
}

// --- toques: chamada recebida e "chamando…" ---

let ringingFor = new Set();

function updateRingtones() {
  const s = getState();
  if (!s.user) {
    stopLoop('ringing');
    stopLoop('calling');
    ringingFor = new Set();
    return;
  }

  const incoming = incomingCalls(s);
  if (incoming.length && s.user.status !== 'dnd') startLoop('ringing');
  else stopLoop('ringing');

  // Avisa fora da janela uma vez por chamada recebida.
  const ids = new Set(incoming.map((c) => c.channel_id));
  for (const call of incoming) {
    if (ringingFor.has(call.channel_id) || s.user.status === 'dnd') continue;
    native?.window.flashFrame(true);
    const channel = s.channels[call.channel_id];
    if (!channel) continue;
    const caller = channel.type === 1 ? dmRecipient(s, channel) : null;
    if (!document.hasFocus() && getSettings().desktopNotifications && window.Notification?.permission === 'granted') {
      const n = new Notification(privateChannelName(s, channel), { body: 'Chamada recebida…', icon: caller?.avatar ?? undefined, silent: true });
      n.onclick = () => {
        window.focus();
        native?.window.focus();
        navigate(HOME, call.channel_id);
      };
    }
  }
  ringingFor = ids;

  // Estou numa chamada de DM tocando para o outro, e ninguém mais entrou: "chamando…".
  const mine = s.voiceStates[s.user.id];
  const call = mine && !mine.guild_id ? s.calls[mine.channel_id] : null;
  const alone = call && !Object.values(s.voiceStates).some((v) => v.channel_id === call.channel_id && v.user_id !== s.user.id);
  if (call && alone && call.ringing.length) startLoop('calling');
  else stopLoop('calling');
}

subscribe(updateRingtones);
