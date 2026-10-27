import { gateway } from './gateway.js';
import { native } from './native.js';
import { getSettings } from './settings.js';
import { playSound } from './sounds.js';
import { HOME, REL, getState, navigate, privateChannelName } from './store.js';
import { displayName } from './util.js';

// Notifica DMs e menções (padrão do Discord), a menos que o canal esteja aberto com a janela em foco.
// Roda depois do reducer: o store já contou a menção quando este handler é chamado.
gateway.on((t, d) => {
  if (t !== 'MESSAGE_CREATE') return;
  const s = getState();
  if (!s.user || d.type === 3 || d.author.id === s.user.id || s.relationships[d.author.id]?.type === REL.BLOCKED) return;
  if (s.user.status === 'dnd') return;
  if (!s.mentions[d.channel_id]) return;

  const channel = s.channels[d.channel_id];
  const guildKey = channel?.guild_id ?? HOME;
  const viewing = s.nav.guildId === guildKey && s.nav.channels[guildKey] === d.channel_id && !s.layer;
  if (viewing && document.hasFocus()) return;

  playSound('message');
  native?.window.flashFrame(true);
  if (!getSettings().desktopNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;

  const title = channel?.guild_id
    ? `${displayName(d.author)} (#${channel.name}, ${s.guilds[channel.guild_id]?.name})`
    : channel?.type === 3 ? `${displayName(d.author)} (${privateChannelName(s, channel)})` : displayName(d.author);
  const files = d.attachments?.length ?? 0;
  const body = d.content || (files ? `Enviou ${files === 1 ? 'um anexo' : `${files} anexos`}.` : '');
  const notification = new Notification(title, { body: body.slice(0, 200), icon: d.author.avatar ?? undefined, silent: true });
  notification.onclick = () => {
    window.focus();
    native?.window.focus();
    navigate(guildKey, d.channel_id);
  };
});
