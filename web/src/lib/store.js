import { useSyncExternalStore } from 'react';
import { compareIds, displayName } from './util.js';

// Store único no estilo Flux: os eventos do gateway (READY, MESSAGE_CREATE…) viram
// ações, o reducer atualiza o estado e os componentes re-renderizam.
// Seletores devem devolver referências estáveis (fatias do estado), nunca objetos novos.

export const HOME = '@me';
export const REL = { FRIEND: 1, BLOCKED: 2, INCOMING: 3, OUTGOING: 4 };

const initialState = () => ({
  connection: 'disconnected',
  ready: false,
  user: null,
  users: {},
  guilds: {}, // id -> { id, name, icon, banner, owner_id, system_channel_id, system_channel_flags, roles: { id -> role } }
  guildOrder: [],
  guildPositions: [], // ordem escolhida arrastando na barra (guild_positions das configurações)
  channels: {}, // canais de servidor e DMs
  members: {}, // guildId -> { userId -> { nick, roles, joined_at } }
  presences: {}, // userId -> 'online' | 'idle' | 'dnd' | 'offline'
  relationships: {}, // userId -> { type, since }
  voiceStates: {}, // userId -> { guild_id, channel_id, user_id, self_mute, self_deaf }
  calls: {}, // dmChannelId -> { channel_id, message_id, ringing: [userId] } (chamadas em DM)
  speaking: {}, // userId -> true
  typing: {}, // channelId -> { userId -> instante (ms) em que o aviso expira }
  messages: {}, // channelId -> { list, hasMore }
  pinsUpdated: {}, // channelId -> último CHANNEL_PINS_UPDATE (o popout de fixadas recarrega)
  manualUnread: {}, // channelId -> true: "marcar como não lida" (não confirma leitura sozinho)
  jump: null, // { channelId, messageId, nonce }: pular até uma mensagem
  slowmode: {}, // channelId -> instante (ms) em que o modo lento libera o próximo envio
  auditUpdated: {}, // guildId -> instante da última entrada nova no registro de auditoria

  // Estado local (salvo por usuário neste dispositivo).
  readStates: {}, // channelId -> id da última mensagem lida
  mentions: {}, // channelId -> menções não lidas (toda mensagem de DM conta)
  closedDms: {}, // channelId -> true (DM fechada na lista até chegar mensagem nova)
  nav: { guildId: HOME, channels: {} }, // canal escolhido por servidor (HOME -> DM ou null = Amigos)
  collapsed: {}, // id da categoria -> true (recolhida)
  nsfwAllowed: {}, // channelId -> true: já confirmou a idade para ver este canal NSFW
  showMembers: true,

  // Camada sobre o app: configurações de usuário, servidor ou canal.
  layer: null,
});

let state = initialState();
const listeners = new Set();

export const getState = () => state;

export function dispatch(action) {
  const next = reduce(state, action);
  if (next === state) return;
  state = next;
  persist();
  for (const listener of listeners) listener();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useStore = (selector) => useSyncExternalStore(subscribe, () => selector(state));

// --- persistência do estado local ---

const LOCAL_KEYS = ['readStates', 'mentions', 'closedDms', 'nav', 'collapsed', 'nsfwAllowed', 'showMembers'];
let persistTimer = null;

function persist() {
  if (!state.user || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!state.user) return;
    try {
      const local = Object.fromEntries(LOCAL_KEYS.map((k) => [k, state[k]]));
      localStorage.setItem(`local:${state.user.id}`, JSON.stringify(local));
    } catch {
      // sem armazenamento: o estado local vale só para esta sessão
    }
  }, 500);
}

function loadLocal(userId) {
  try {
    return JSON.parse(localStorage.getItem(`local:${userId}`) ?? '{}');
  } catch {
    return {};
  }
}

// --- ações de interface ---

export const navigate = (guildId, channelId) => dispatch({ type: 'NAVIGATE', d: { guildId, channelId } });
export const jumpToMessage = (guildId, channelId, messageId) =>
  dispatch({ type: 'JUMP', d: { guildId, channelId, messageId } });
export const openLayer = (layer) => dispatch({ type: 'OPEN_LAYER', d: layer });
export const closeLayer = () => dispatch({ type: 'CLOSE_LAYER' });

// --- reducer ---

const without = (obj, key) => {
  if (!(key in obj)) return obj;
  const copy = { ...obj };
  delete copy[key];
  return copy;
};

const indexBy = (list, key = 'id') => Object.fromEntries(list.map((item) => [item[key], item]));

function addGuild(s, g) {
  const users = { ...s.users };
  const presences = { ...s.presences };
  const voiceStates = { ...s.voiceStates };
  const channels = { ...s.channels };
  const readStates = { ...s.readStates };
  const members = {};
  for (const m of g.members) {
    users[m.user.id] = m.user;
    members[m.user.id] = { nick: m.nick ?? null, roles: m.roles, joined_at: m.joined_at };
  }
  for (const p of g.presences) presences[p.user_id] = p.status;
  for (const v of g.voice_states) voiceStates[v.user_id] = v;
  for (const c of g.channels) {
    channels[c.id] = c;
    // Canal nunca visto neste dispositivo começa como lido.
    if (!(c.id in readStates) && c.last_message_id) readStates[c.id] = c.last_message_id;
  }
  return {
    ...s,
    users,
    presences,
    voiceStates,
    channels,
    readStates,
    guilds: { ...s.guilds, [g.id]: { ...guildFields(g), roles: indexBy(g.roles) } },
    guildOrder: orderGuilds(s.guildOrder.includes(g.id) ? s.guildOrder : [...s.guildOrder, g.id], s.guildPositions),
    members: { ...s.members, [g.id]: members },
  };
}

const guildFields = (g) => ({
  id: g.id,
  name: g.name,
  icon: g.icon ?? null,
  banner: g.banner ?? null,
  owner_id: g.owner_id,
  system_channel_id: g.system_channel_id ?? null,
  system_channel_flags: g.system_channel_flags ?? 0,
});

// Os da lista guild_positions primeiro, na ordem dela; o resto na ordem em que entrou.
function orderGuilds(order, positions) {
  const rank = (id) => (positions.includes(id) ? positions.indexOf(id) : positions.length);
  return order.map((id, i) => [id, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([id]) => id);
}

function removeGuild(s, guildId) {
  const channels = Object.fromEntries(Object.entries(s.channels).filter(([, c]) => c.guild_id !== guildId));
  const voiceStates = Object.fromEntries(Object.entries(s.voiceStates).filter(([, v]) => v.guild_id !== guildId));
  const layer = s.layer?.guildId === guildId ? null : s.layer; // camadas de servidor e de canal levam guildId
  return {
    ...s,
    guilds: without(s.guilds, guildId),
    guildOrder: s.guildOrder.filter((id) => id !== guildId),
    members: without(s.members, guildId),
    channels,
    voiceStates,
    layer,
    nav: s.nav.guildId === guildId ? { ...s.nav, guildId: HOME } : s.nav,
  };
}

function addDm(s, c) {
  const users = { ...s.users };
  for (const u of c.recipients) users[u.id] = u;
  const readStates = !(c.id in s.readStates) && c.last_message_id ? { ...s.readStates, [c.id]: c.last_message_id } : s.readStates;
  return { ...s, users, readStates, channels: { ...s.channels, [c.id]: c } };
}

function setMember(s, guildId, userId, member) {
  return { ...s, members: { ...s.members, [guildId]: { ...s.members[guildId], [userId]: member } } };
}

export const isPrivate = (channel) => channel?.type === 1 || channel?.type === 3;

const isMention = (s, m) => {
  if (m.referenced_message?.author.id === s.user.id && m.reply_ping) return true;
  // @everyone/@here: o servidor diz se valeu (mention_everyone) conforme a permissão do autor.
  if (m.mention_everyone) return true;
  const name = s.user.username.toLowerCase();
  return m.content.toLowerCase().split(/\s+/).some((word) => word.replace(/[^\w.@]/g, '') === `@${name}`);
};

const TYPING_MS = 10_000;

function reduce(s, { type, d }) {
  switch (type) {
    case 'RESET':
      return initialState();

    case 'CONNECTION':
      return { ...s, connection: d };

    case 'READY': {
      const local = loadLocal(d.user.id);
      let next = {
        ...initialState(),
        ...(s.ready && s.user?.id === d.user.id ? Object.fromEntries(LOCAL_KEYS.map((k) => [k, s[k]])) : local),
        connection: 'connected',
        ready: true,
        user: d.user,
        users: { [d.user.id]: d.user },
        layer: s.user?.id === d.user.id ? s.layer : null,
        guildPositions: d.user_settings?.guild_positions ?? [],
      };
      next.presences = { [d.user.id]: d.user.status === 'invisible' ? 'offline' : d.user.status };
      for (const g of d.guilds) next = addGuild(next, g);
      for (const c of d.private_channels) next = addDm(next, c);
      const users = { ...next.users };
      const relationships = {};
      for (const r of d.relationships) {
        users[r.id] = r.user;
        relationships[r.id] = { type: r.type, since: r.since };
      }
      const presences = { ...next.presences };
      for (const p of d.presences) presences[p.user_id] = p.status;
      const calls = {};
      const voiceStates = { ...next.voiceStates };
      for (const { voice_states: states, ...call } of d.calls ?? []) {
        calls[call.channel_id] = call;
        for (const v of states) voiceStates[v.user_id] = v;
      }
      next = { ...next, users, relationships, presences, calls, voiceStates };
      if (next.nav.guildId !== HOME && !next.guilds[next.nav.guildId]) next.nav = { ...next.nav, guildId: HOME };
      return next;
    }

    case 'GUILD_CREATE':
      return addGuild(s, d);

    case 'GUILD_UPDATE': {
      const guild = s.guilds[d.id];
      if (!guild) return s;
      return { ...s, guilds: { ...s.guilds, [d.id]: { ...guild, ...guildFields(d) } } };
    }

    case 'GUILD_DELETE':
      return removeGuild(s, d.id);

    case 'GUILD_ROLES_UPDATE': {
      const guild = s.guilds[d.guild_id];
      if (!guild) return s;
      return { ...s, guilds: { ...s.guilds, [guild.id]: { ...guild, roles: indexBy(d.roles) } } };
    }

    case 'GUILD_MEMBER_ADD': {
      const next = setMember(s, d.guild_id, d.user.id, { nick: d.nick ?? null, roles: d.roles ?? [], joined_at: d.joined_at });
      return { ...next, users: { ...s.users, [d.user.id]: d.user }, presences: { ...s.presences, [d.user.id]: d.status } };
    }

    case 'GUILD_MEMBER_UPDATE':
      if (!s.members[d.guild_id]) return s;
      return { ...setMember(s, d.guild_id, d.user.id, { nick: d.nick ?? null, roles: d.roles, joined_at: d.joined_at }), users: { ...s.users, [d.user.id]: d.user } };

    case 'GUILD_MEMBER_REMOVE':
      if (!s.members[d.guild_id]) return s;
      return { ...s, members: { ...s.members, [d.guild_id]: without(s.members[d.guild_id], d.user.id) } };

    case 'CHANNEL_CREATE':
      return isPrivate(d) ? addDm(s, d) : { ...s, channels: { ...s.channels, [d.id]: d } };

    case 'CHANNEL_UPDATE':
      if (isPrivate(d)) return addDm(s, { ...s.channels[d.id], ...d });
      return { ...s, channels: { ...s.channels, [d.id]: { ...s.channels[d.id], ...d } } };

    case 'CHANNEL_DELETE': {
      // Saiu (ou foi removido) de um grupo aberto: volta para Amigos.
      const nav = s.nav.channels[HOME] === d.id ? { ...s.nav, channels: { ...s.nav.channels, [HOME]: null } } : s.nav;
      return {
        ...s,
        nav,
        channels: without(s.channels, d.id),
        messages: without(s.messages, d.id),
        calls: without(s.calls, d.id),
        layer: s.layer?.channelId === d.id ? null : s.layer,
      };
    }

    case 'CHANNEL_RECIPIENT_ADD': {
      const channel = s.channels[d.channel_id];
      if (!channel || channel.recipients.some((u) => u.id === d.user.id)) return s;
      return addDm(s, { ...channel, recipients: [...channel.recipients, d.user] });
    }

    case 'CHANNEL_RECIPIENT_REMOVE': {
      const channel = s.channels[d.channel_id];
      if (!channel) return s;
      return { ...s, channels: { ...s.channels, [channel.id]: { ...channel, recipients: channel.recipients.filter((u) => u.id !== d.user.id) } } };
    }

    case 'CHANNEL_PINS_UPDATE':
      return { ...s, pinsUpdated: { ...s.pinsUpdated, [d.channel_id]: Date.now() } };

    case 'PRESENCE_UPDATE':
      return { ...s, presences: { ...s.presences, [d.user_id]: d.status } };

    case 'USER_UPDATE':
      if (d.id === s.user.id) return { ...s, user: { ...s.user, ...d }, users: { ...s.users, [d.id]: { ...s.users[d.id], ...d } } };
      return { ...s, users: { ...s.users, [d.id]: d } };

    case 'USER_SETTINGS_UPDATE': {
      const { guild_positions: positions, ...settings } = d;
      if (!positions) return { ...s, user: { ...s.user, ...settings } };
      return { ...s, user: { ...s.user, ...settings }, guildPositions: positions, guildOrder: orderGuilds(s.guildOrder, positions) };
    }

    // Ordem nova arrastando na barra: aplica na hora (o servidor confirma com USER_SETTINGS_UPDATE).
    case 'GUILD_ORDER':
      return { ...s, guildPositions: d, guildOrder: orderGuilds(s.guildOrder, d) };

    case 'GUILD_AUDIT_LOG_ENTRY_CREATE':
      return { ...s, auditUpdated: { ...s.auditUpdated, [d.guild_id]: Date.now() } };

    case 'SLOWMODE_START':
      return { ...s, slowmode: { ...s.slowmode, [d.channelId]: d.until } };

    case 'NSFW_ALLOW':
      return { ...s, nsfwAllowed: { ...s.nsfwAllowed, [d]: true } };

    case 'RELATIONSHIP_ADD':
      return {
        ...s,
        users: { ...s.users, [d.id]: d.user },
        relationships: { ...s.relationships, [d.id]: { type: d.type, since: d.since } },
      };

    case 'RELATIONSHIP_REMOVE':
      return { ...s, relationships: without(s.relationships, d.id) };

    case 'VOICE_STATE_UPDATE': {
      const voiceStates = { ...s.voiceStates };
      if (d.channel_id) voiceStates[d.user_id] = d;
      else delete voiceStates[d.user_id];
      return { ...s, voiceStates };
    }

    case 'CALL_CREATE':
    case 'CALL_UPDATE':
      return { ...s, calls: { ...s.calls, [d.channel_id]: d } };

    case 'CALL_DELETE':
      return { ...s, calls: without(s.calls, d.channel_id) };

    case 'SPEAKING': {
      const speaking = { ...s.speaking };
      if (d.speaking) speaking[d.user_id] = true;
      else delete speaking[d.user_id];
      return { ...s, speaking };
    }

    case 'MESSAGES_LOADED': {
      const current = s.messages[d.channelId]?.list ?? [];
      const byId = new Map([...current, ...d.messages].map((m) => [m.id, m]));
      const list = [...byId.values()].sort((a, b) => compareIds(a.id, b.id));
      return { ...s, messages: { ...s.messages, [d.channelId]: { list, hasMore: d.hasMore } } };
    }

    case 'MESSAGE_CREATE': {
      const channel = s.channels[d.channel_id];
      if (!channel) return s;
      let next = { ...s, channels: { ...s.channels, [channel.id]: { ...channel, last_message_id: d.id } } };

      const entry = s.messages[d.channel_id];
      if (entry && !entry.list.some((m) => m.id === d.id)) {
        next.messages = { ...s.messages, [d.channel_id]: { ...entry, list: [...entry.list, d] } };
      }
      // Quem enviou parou de digitar.
      if (s.typing[channel.id]?.[d.author.id]) {
        next.typing = { ...s.typing, [channel.id]: without(s.typing[channel.id], d.author.id) };
      }
      if (d.author.id === s.user.id) {
        next.readStates = { ...s.readStates, [channel.id]: d.id };
      } else if ((d.type === 0 || d.type === 19) && s.relationships[d.author.id]?.type !== REL.BLOCKED && (isPrivate(channel) || isMention(s, d))) {
        next.mentions = { ...s.mentions, [channel.id]: (s.mentions[channel.id] ?? 0) + 1 };
      }
      if (isPrivate(channel)) next.closedDms = without(s.closedDms, channel.id);
      return next;
    }

    case 'MESSAGE_UPDATE': {
      const entry = s.messages[d.channel_id];
      if (!entry || !entry.list.some((m) => m.id === d.id)) return s;
      const list = entry.list.map((m) => (m.id === d.id ? { ...m, ...d } : m));
      return { ...s, messages: { ...s.messages, [d.channel_id]: { ...entry, list } } };
    }

    case 'MESSAGE_REACTION_ADD':
    case 'MESSAGE_REACTION_REMOVE': {
      const entry = s.messages[d.channel_id];
      if (!entry) return s;
      const add = type === 'MESSAGE_REACTION_ADD';
      const list = entry.list.map((m) => {
        if (m.id !== d.message_id) return m;
        let reactions = m.reactions ?? [];
        const current = reactions.find((r) => r.emoji === d.emoji);
        if (add && !current) reactions = [...reactions, { emoji: d.emoji, user_ids: [d.user_id] }];
        else if (current) {
          const ids = add ? [...new Set([...current.user_ids, d.user_id])] : current.user_ids.filter((id) => id !== d.user_id);
          reactions = ids.length
            ? reactions.map((r) => (r.emoji === d.emoji ? { ...r, user_ids: ids } : r))
            : reactions.filter((r) => r.emoji !== d.emoji);
        }
        return { ...m, reactions };
      });
      return { ...s, messages: { ...s.messages, [d.channel_id]: { ...entry, list } } };
    }

    case 'TYPING_START': {
      if (d.user_id === s.user.id || !s.channels[d.channel_id]) return s;
      const expires = Date.now() + TYPING_MS;
      return { ...s, typing: { ...s.typing, [d.channel_id]: { ...s.typing[d.channel_id], [d.user_id]: expires } } };
    }

    // Disparado pelo timer de lib/typing.js; ignora se chegou um aviso mais novo nesse meio-tempo.
    case 'TYPING_STOP': {
      const current = s.typing[d.channelId]?.[d.userId];
      if (!current || current > Date.now()) return s;
      return { ...s, typing: { ...s.typing, [d.channelId]: without(s.typing[d.channelId], d.userId) } };
    }

    case 'MESSAGE_DELETE': {
      const entry = s.messages[d.channel_id];
      if (!entry) return s;
      return { ...s, messages: { ...s.messages, [d.channel_id]: { ...entry, list: entry.list.filter((m) => m.id !== d.id) } } };
    }

    // --- interface ---

    case 'ACK': {
      const read = s.readStates[d.channelId];
      if ((read && compareIds(read, d.messageId) >= 0) && !s.mentions[d.channelId]) return s;
      return {
        ...s,
        readStates: { ...s.readStates, [d.channelId]: read && compareIds(read, d.messageId) > 0 ? read : d.messageId },
        mentions: without(s.mentions, d.channelId),
      };
    }

    case 'MARK_UNREAD':
      return {
        ...s,
        readStates: { ...s.readStates, [d.channelId]: d.messageId },
        manualUnread: { ...s.manualUnread, [d.channelId]: true },
      };

    case 'JUMP': {
      const channels = { ...s.nav.channels, [d.guildId]: d.channelId };
      return { ...s, nav: { guildId: d.guildId, channels }, layer: null, jump: { ...d, nonce: Date.now() } };
    }

    case 'JUMP_DONE':
      return s.jump?.nonce === d ? { ...s, jump: null } : s;

    case 'NAVIGATE': {
      const channels = d.channelId === undefined ? s.nav.channels : { ...s.nav.channels, [d.guildId]: d.channelId };
      const closedDms = d.channelId ? without(s.closedDms, d.channelId) : s.closedDms;
      return { ...s, closedDms, manualUnread: {}, nav: { guildId: d.guildId, channels } };
    }

    case 'CLOSE_DM': {
      const nav = s.nav.channels[HOME] === d ? { ...s.nav, channels: { ...s.nav.channels, [HOME]: null } } : s.nav;
      return { ...s, nav, closedDms: { ...s.closedDms, [d]: true } };
    }

    case 'TOGGLE_CATEGORY':
      return { ...s, collapsed: s.collapsed[d] ? without(s.collapsed, d) : { ...s.collapsed, [d]: true } };

    case 'TOGGLE_MEMBERS':
      return { ...s, showMembers: !s.showMembers };

    case 'OPEN_LAYER':
      return { ...s, layer: d };

    case 'CLOSE_LAYER':
      return { ...s, layer: null };

    default:
      return s;
  }
}

// --- leituras derivadas usadas em vários componentes ---

export const isUnread = (s, channel) =>
  !!channel?.last_message_id && (!s.readStates[channel.id] || compareIds(channel.last_message_id, s.readStates[channel.id]) > 0);

export const dmRecipient = (s, channel) => s.users[channel.recipients[0]?.id] ?? channel.recipients[0];

// Nome mostrado num servidor: o apelido, senão o nome exibido, senão o nome de usuário.
export const memberName = (s, guildId, userId, fallback) =>
  (guildId && s.members[guildId]?.[userId]?.nick) || displayName(s.users[userId] ?? fallback);

// Nome de um canal privado: o outro participante (DM) ou o nome do grupo / nomes de quem está nele.
export function privateChannelName(s, channel) {
  if (channel.type === 1) return displayName(dmRecipient(s, channel));
  if (channel.name) return channel.name;
  const names = channel.recipients.map((u) => displayName(s.users[u.id] ?? u));
  return names.length ? names.join(', ') : displayName(s.user);
}
