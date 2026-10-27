import { useEffect, useState } from 'react';
import { api } from './api.js';
import { gateway } from './gateway.js';
import { REL, dispatch, useStore } from './store.js';

// "Fulano está digitando…" no padrão do Discord: enquanto a pessoa digita, o cliente faz
// POST /channels/:id/typing no máximo a cada 8 s; cada aviso vale 10 s ou até a mensagem chegar.

const RESEND_MS = 8_000;
const EXPIRE_MS = 10_000;
const lastSent = new Map(); // channelId -> instante do último aviso enviado

export function notifyTyping(channelId) {
  const now = Date.now();
  if (now - (lastSent.get(channelId) ?? 0) < RESEND_MS) return;
  lastSent.set(channelId, now);
  api(`/channels/${channelId}/typing`, { method: 'POST' }).catch(() => {});
}

// Depois de enviar, o próximo caractere já avisa de novo (o envio encerrou o aviso no outro lado).
export const resetTyping = (channelId) => lastSent.delete(channelId);

gateway.on((t, d) => {
  if (t !== 'TYPING_START') return;
  setTimeout(() => dispatch({ type: 'TYPING_STOP', d: { channelId: d.channel_id, userId: d.user_id } }), EXPIRE_MS + 50);
});

const EMPTY = [];

// Ids de quem está digitando no canal (sem bloqueados), na ordem em que começaram.
export function useTypingUsers(channelId) {
  const typing = useStore((s) => s.typing[channelId]);
  const relationships = useStore((s) => s.relationships);
  const [, tick] = useState(0);
  // Re-renderiza quando o aviso mais antigo expira, caso o TYPING_STOP ainda não tenha chegado.
  useEffect(() => {
    if (!typing) return;
    const next = Math.min(...Object.values(typing)) - Date.now();
    if (next <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), next + 10);
    return () => clearTimeout(timer);
  }, [typing]);
  if (!typing) return EMPTY;
  const now = Date.now();
  return Object.entries(typing)
    .filter(([id, expires]) => expires > now && relationships[id]?.type !== REL.BLOCKED)
    .map(([id]) => id);
}
