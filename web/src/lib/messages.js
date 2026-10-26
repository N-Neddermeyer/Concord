import { api } from './api.js';
import { confirmDialog, showError } from './dialogs.js';
import { rememberEmoji } from './emoji.js';
import { dispatch, getState } from './store.js';

// Ações sobre mensagens usadas pela barra de ações, pelo menu de 3 pontos e pelo clique direito.

const call = (promise) => promise.catch((e) => showError(e.message));
const path = (m) => `/channels/${m.channel_id}/messages/${m.id}`;

export const isUserMessage = (m) => m.type === 0 || m.type === 19;

export function toggleReaction(message, emoji) {
  const me = getState().user.id;
  const mine = message.reactions?.find((r) => r.emoji === emoji)?.user_ids.includes(me);
  if (!mine) rememberEmoji(emoji);
  return call(api(`${path(message)}/reactions/${encodeURIComponent(emoji)}/@me`, { method: mine ? 'DELETE' : 'PUT' }));
}

export const editMessage = (message, content) => api(path(message), { method: 'PATCH', body: { content } });

export async function deleteMessage(message, skipConfirm = false) {
  if (!skipConfirm) {
    const ok = await confirmDialog({
      title: 'Excluir mensagem',
      body: 'Tem certeza de que deseja excluir esta mensagem? Dica: segure Shift ao clicar na lixeira para pular esta confirmação.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return false;
  }
  await call(api(path(message), { method: 'DELETE' }));
  return true;
}

export async function pinMessage(message) {
  const ok = await confirmDialog({
    title: 'Fixar mensagem',
    body: 'Tem certeza de que deseja fixar esta mensagem? Ela aparecerá em "Mensagens fixadas", no topo do canal.',
    confirmLabel: 'Ah, sim!',
  });
  if (ok) call(api(`/channels/${message.channel_id}/pins/${message.id}`, { method: 'PUT' }));
}

export async function unpinMessage(message, skipConfirm = false) {
  if (!skipConfirm) {
    const ok = await confirmDialog({
      title: 'Desafixar mensagem',
      body: 'Tem certeza de que deseja remover esta mensagem das fixadas?',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
  }
  call(api(`/channels/${message.channel_id}/pins/${message.id}`, { method: 'DELETE' }));
}

// Volta o marcador de leitura para antes desta mensagem (ela e as seguintes ficam como novas).
export function markUnread(message, list) {
  const index = list.findIndex((m) => m.id === message.id);
  dispatch({ type: 'MARK_UNREAD', d: { channelId: message.channel_id, messageId: index > 0 ? list[index - 1].id : '0' } });
}

export const messageLink = (channel, message) =>
  `${location.origin}/channels/${channel.guild_id ?? '@me'}/${channel.id}/${message.id}`;

// Link de mensagem do próprio app: /channels/<servidor ou @me>/<canal>/<mensagem>.
export function parseMessageLink(href) {
  try {
    const url = new URL(href);
    if (url.origin !== location.origin) return null;
    const match = url.pathname.match(/^\/channels\/(@me|\d+)\/(\d+)\/(\d+)$/);
    return match && { guildId: match[1], channelId: match[2], messageId: match[3] };
  } catch {
    return null;
  }
}

export const copyText = (text) => navigator.clipboard.writeText(text).catch(() => showError('Não foi possível copiar.'));
