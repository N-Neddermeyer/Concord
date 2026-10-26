import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { CHANNEL_DM, CHANNEL_GROUP_DM, CHANNEL_VOICE, REL, messagePayload, privateUser, publicUser, q } from './db.js';
import { P, computePermissions, has, highestPosition } from './permissions.js';
import { snowflake } from './snowflake.js';

// Opcodes no estilo do gateway do Discord. VOICE_SIGNAL é nosso: como a voz é P2P,
// o gateway só repassa as ofertas SDP e candidatos ICE entre os participantes.
export const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
  VOICE_SIGNAL: 30,
};

const HEARTBEAT_INTERVAL = 41250;
const RING_TIMEOUT_MS = 45_000; // quem não atende nesse tempo para de tocar (chamada perdida)
const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

const sockets = new Map(); // userId -> Set<WebSocket>
const statusPrefs = new Map(); // userId -> status escolhido (só de quem está conectado)
const voiceStates = new Map(); // userId -> { guild_id, channel_id, user_id, self_mute, self_deaf, ws }
const calls = new Map(); // dmChannelId -> { channel_id, message_id, ringing: Map<userId, timer>, participants: Set }

function send(ws, op, d, t = null) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ op, d, t, s: op === OP.DISPATCH ? ++ws.seq : null }));
}

export function dispatchToUser(userId, t, d) {
  for (const ws of sockets.get(userId) ?? []) send(ws, OP.DISPATCH, d, t);
}

export function dispatchToUsers(userIds, t, d) {
  for (const id of new Set(userIds)) dispatchToUser(id, t, d);
}

export function dispatchToGuild(guildId, t, d) {
  for (const { user_id } of q.memberIds.all(guildId)) dispatchToUser(user_id, t, d);
}

// Canal de servidor vai para os membros; DM vai para os participantes.
export function dispatchToChannel(channel, t, d) {
  if (channel.guild_id) return dispatchToGuild(channel.guild_id, t, d);
  dispatchToUsers(q.dmRecipientIds.all(channel.id).map((r) => r.user_id), t, d);
}

// Quem precisa saber da presença e do perfil de um usuário: colegas de servidor, amigos e DMs.
export function relatedUserIds(userId) {
  return new Set([
    userId,
    ...q.guildmates.all(userId).map((r) => r.user_id),
    ...q.friendIds.all(userId).map((r) => r.target_id),
    ...q.dmPartners.all(userId).map((r) => r.user_id),
  ]);
}

export function statusOf(userId) {
  if (!sockets.has(userId)) return 'offline';
  const pref = statusPrefs.get(userId) ?? 'online';
  return pref === 'invisible' ? 'offline' : pref;
}

export function broadcastPresence(userId) {
  dispatchToUsers(relatedUserIds(userId), 'PRESENCE_UPDATE', { user_id: userId, status: statusOf(userId) });
}

// --- permissões (o cliente calcula o mesmo a partir dos cargos para montar a interface) ---

export function permissionsOf(guild, userId) {
  const roleIds = q.memberRoles.all(guild.id, userId).map((r) => r.role_id);
  return computePermissions(guild, q.roles.all(guild.id), roleIds, userId);
}

export function rankOf(guild, userId) {
  const roleIds = q.memberRoles.all(guild.id, userId).map((r) => r.role_id);
  return highestPosition(guild, q.roles.all(guild.id), roleIds, userId);
}

// --- formatos enviados ao cliente ---

const publicVoice = ({ guild_id, channel_id, user_id, self_mute, self_deaf, self_video, self_stream }) => ({
  guild_id, channel_id, user_id, self_mute, self_deaf, self_video, self_stream,
});

export const toRole = (r) => ({ ...r, hoist: !!r.hoist });

export function buildMember(guildId, userRow) {
  return {
    user: publicUser(userRow),
    roles: q.memberRoles.all(guildId, userRow.id).map((r) => r.role_id),
    joined_at: q.member.get(guildId, userRow.id)?.joined_at ?? userRow.joined_at,
  };
}

export function buildGuild(guild) {
  const roleRows = q.guildMemberRoles.all(guild.id);
  const members = q.membersOf.all(guild.id).map((row) => ({
    user: publicUser(row),
    roles: roleRows.filter((r) => r.user_id === row.id).map((r) => r.role_id),
    joined_at: row.joined_at,
  }));
  return {
    id: guild.id,
    name: guild.name,
    icon: guild.icon ?? null,
    owner_id: guild.owner_id,
    roles: q.roles.all(guild.id).map(toRole),
    channels: q.channelsOf.all(guild.id),
    members,
    presences: members.map((m) => ({ user_id: m.user.id, status: statusOf(m.user.id) })),
    voice_states: [...voiceStates.values()].filter((v) => v.guild_id === guild.id).map(publicVoice),
  };
}

export function buildDmChannel(channel, viewerId) {
  const recipients = q.dmRecipientIds
    .all(channel.id)
    .filter((r) => r.user_id !== viewerId)
    .map((r) => publicUser(q.userById.get(r.user_id)));
  return {
    id: channel.id,
    type: channel.type,
    guild_id: null,
    name: channel.type === CHANNEL_GROUP_DM ? (channel.name || null) : null,
    owner_id: channel.owner_id ?? null,
    last_message_id: channel.last_message_id,
    recipients,
  };
}

export const buildRelationship = (row) => ({ id: row.id, type: row.type, since: row.since, user: publicUser(row) });

// --- voz ---

const dmRecipients = (channelId) => q.dmRecipientIds.all(channelId).map((r) => r.user_id);

// Estado de voz de servidor vai para os membros; de DM (chamada), para os participantes da DM.
function dispatchVoice(state, payload) {
  if (state.guild_id) dispatchToGuild(state.guild_id, 'VOICE_STATE_UPDATE', payload);
  else dispatchToUsers(dmRecipients(state.channel_id), 'VOICE_STATE_UPDATE', payload);
}

const statesIn = (channelId) => [...voiceStates.values()].filter((v) => v.channel_id === channelId);

export function leaveVoice(userId) {
  const state = voiceStates.get(userId);
  if (!state) return;
  voiceStates.delete(userId);
  dispatchVoice(state, { ...publicVoice(state), channel_id: null, self_mute: false, self_deaf: false, self_video: false, self_stream: false });
  // Quem foi removido do servidor não recebe mais eventos dele; avisa diretamente.
  if (state.guild_id && !q.member.get(state.guild_id, userId)) {
    dispatchToUser(userId, 'VOICE_STATE_UPDATE', { ...publicVoice(state), channel_id: null });
  }
  if (!state.guild_id && statesIn(state.channel_id).length === 0) endCall(state.channel_id);
}

// Usado ao expulsar/banir, excluir canal de voz ou excluir servidor.
export function disconnectVoice(predicate) {
  for (const state of [...voiceStates.values()]) if (predicate(state)) leaveVoice(state.user_id);
}

// --- chamadas em DM (mesmo fluxo do Discord: CALL_CREATE / CALL_UPDATE / CALL_DELETE) ---

const publicCall = (call) => ({ channel_id: call.channel_id, message_id: call.message_id, ringing: [...call.ringing.keys()] });

function dispatchCall(call, t) {
  dispatchToUsers(dmRecipients(call.channel_id), t, t === 'CALL_DELETE' ? { channel_id: call.channel_id } : publicCall(call));
}

function dispatchCallMessage(call, t) {
  const message = messagePayload(call.message_id);
  dispatchToUsers(dmRecipients(call.channel_id), t, { ...message, guild_id: null });
}

const blockedBetween = (a, b) =>
  q.relationship.get(a, b)?.type === REL.BLOCKED || q.relationship.get(b, a)?.type === REL.BLOCKED;

// Toca para quem ainda não está na chamada; para sozinho depois de RING_TIMEOUT_MS.
function addRinging(call, userIds) {
  const inCall = new Set(statesIn(call.channel_id).map((v) => v.user_id));
  for (const id of userIds) {
    if (inCall.has(id)) continue;
    clearTimeout(call.ringing.get(id));
    call.ringing.set(id, setTimeout(() => stopRinging(call.channel_id, [id]), RING_TIMEOUT_MS));
  }
}

export function ringCall(channelId, userIds) {
  const call = calls.get(channelId);
  if (!call) return false;
  addRinging(call, userIds);
  dispatchCall(call, 'CALL_UPDATE');
  return true;
}

export function stopRinging(channelId, userIds) {
  const call = calls.get(channelId);
  if (!call) return false;
  let changed = false;
  for (const id of userIds) {
    if (!call.ringing.has(id)) continue;
    clearTimeout(call.ringing.get(id));
    call.ringing.delete(id);
    changed = true;
  }
  if (changed) dispatchCall(call, 'CALL_UPDATE');
  return true;
}

export const isInCall = (channelId, userId) => voiceStates.get(userId)?.channel_id === channelId;

function startCall(channel, callerId) {
  const messageId = snowflake();
  const firstMessage = !channel.last_message_id;
  q.insertCallMessage.run(messageId, channel.id, callerId, JSON.stringify([callerId]));
  q.touchChannel.run(messageId, channel.id);
  const call = { channel_id: channel.id, message_id: messageId, ringing: new Map(), participants: new Set([callerId]) };
  calls.set(channel.id, call);

  const recipients = dmRecipients(channel.id);
  // Primeira mensagem da DM: o outro lado ainda não conhece o canal.
  if (firstMessage) {
    for (const id of recipients) dispatchToUser(id, 'CHANNEL_CREATE', buildDmChannel(q.channel.get(channel.id), id));
  }
  addRinging(call, recipients.filter((id) => id !== callerId));
  dispatchCallMessage(call, 'MESSAGE_CREATE');
  dispatchCall(call, 'CALL_CREATE');
}

function joinCall(channelId, userId) {
  const call = calls.get(channelId);
  if (!call) return;
  stopRinging(channelId, [userId]);
  if (call.participants.has(userId)) return;
  call.participants.add(userId);
  q.updateCallMessage.run(JSON.stringify([...call.participants]), null, call.message_id);
  dispatchCallMessage(call, 'MESSAGE_UPDATE');
}

// Último participante saiu: encerra, registra o fim na mensagem (para mostrar a duração) e avisa.
function endCall(channelId) {
  const call = calls.get(channelId);
  if (!call) return;
  for (const timer of call.ringing.values()) clearTimeout(timer);
  calls.delete(channelId);
  q.updateCallMessage.run(JSON.stringify([...call.participants]), new Date().toISOString(), call.message_id);
  dispatchCallMessage(call, 'MESSAGE_UPDATE');
  dispatchCall(call, 'CALL_DELETE');
}

function canJoin(user, channel) {
  if (channel.type === CHANNEL_VOICE) {
    return !!q.member.get(channel.guild_id, user.id) && has(permissionsOf(q.guild.get(channel.guild_id), user.id), P.CONNECT);
  }
  if (channel.type === CHANNEL_DM) {
    const recipients = dmRecipients(channel.id);
    const other = recipients.find((id) => id !== user.id);
    return recipients.includes(user.id) && !blockedBetween(user.id, other);
  }
  if (channel.type === CHANNEL_GROUP_DM) return dmRecipients(channel.id).includes(user.id);
  return false;
}

function handleVoiceStateUpdate(ws, d) {
  const user = ws.user;
  if (!d?.channel_id) return leaveVoice(user.id);

  const channel = q.channel.get(d.channel_id);
  if (!channel || !canJoin(user, channel)) return;

  const current = voiceStates.get(user.id);
  if (current && current.channel_id !== channel.id) leaveVoice(user.id);

  const state = {
    guild_id: channel.guild_id,
    channel_id: channel.id,
    user_id: user.id,
    self_mute: !!d.self_mute || !!d.self_deaf,
    self_deaf: !!d.self_deaf,
    // Câmera e transmissão de tela, como self_video/self_stream do Discord.
    self_video: !!d.self_video,
    self_stream: !!d.self_stream,
    ws,
  };
  voiceStates.set(user.id, state);
  dispatchVoice(state, publicVoice(state));

  if (!channel.guild_id) {
    if (calls.has(channel.id)) joinCall(channel.id, user.id);
    else startCall(channel, user.id);
  }
}

function handleVoiceSignal(ws, d) {
  const me = voiceStates.get(ws.user.id);
  const them = voiceStates.get(d?.to);
  if (!me || !them || me.channel_id !== them.channel_id) return;
  send(them.ws, OP.DISPATCH, { from: ws.user.id, payload: d.payload }, 'VOICE_SIGNAL');
}

// --- sessão ---

function handlePresenceUpdate(ws, d) {
  const status = d?.status;
  if (!STATUSES.includes(status)) return;
  q.setStatus.run(status, ws.user.id);
  statusPrefs.set(ws.user.id, status);
  dispatchToUser(ws.user.id, 'USER_SETTINGS_UPDATE', { status });
  broadcastPresence(ws.user.id);
}

function handleIdentify(ws, d) {
  if (ws.user) return ws.close(4005, 'Already authenticated');
  const user = q.userByToken.get(String(d?.token ?? ''));
  if (!user) return ws.close(4004, 'Authentication failed');

  ws.user = user;
  const firstSession = !sockets.has(user.id);
  if (firstSession) sockets.set(user.id, new Set());
  sockets.get(user.id).add(ws);
  statusPrefs.set(user.id, user.status);

  const relationships = q.relationshipsOf.all(user.id).map(buildRelationship);
  const privateChannels = q.dmChannelsOf.all(user.id).map((c) => buildDmChannel(c, user.id));
  const dmIds = new Set(privateChannels.map((c) => c.id));
  const activeCalls = [...calls.values()]
    .filter((call) => dmIds.has(call.channel_id))
    .map((call) => ({ ...publicCall(call), voice_states: statesIn(call.channel_id).map(publicVoice) }));
  const presenceIds = new Set([
    ...relationships.filter((r) => r.type === REL.FRIEND).map((r) => r.id),
    ...privateChannels.flatMap((c) => c.recipients.map((u) => u.id)),
  ]);

  send(ws, OP.DISPATCH, {
    v: 1,
    session_id: randomUUID(),
    user: privateUser(user),
    guilds: q.guildsOf.all(user.id).map(buildGuild),
    relationships,
    private_channels: privateChannels,
    presences: [...presenceIds].map((id) => ({ user_id: id, status: statusOf(id) })),
    calls: activeCalls,
  }, 'READY');

  if (firstSession) broadcastPresence(user.id);
}

function handleClose(ws) {
  clearInterval(ws.watchdog);
  const user = ws.user;
  if (!user) return;
  if (voiceStates.get(user.id)?.ws === ws) leaveVoice(user.id);

  const set = sockets.get(user.id);
  set?.delete(ws);
  if (set?.size === 0) {
    sockets.delete(user.id);
    statusPrefs.delete(user.id);
    broadcastPresence(user.id);
  }
}

export function attachGateway(server) {
  const wss = new WebSocketServer({ server, path: '/gateway', maxPayload: 64 * 1024 });

  wss.on('connection', (ws) => {
    ws.seq = 0;
    ws.user = null;
    ws.lastHeartbeat = Date.now();
    ws.watchdog = setInterval(() => {
      if (Date.now() - ws.lastHeartbeat > HEARTBEAT_INTERVAL * 1.5) ws.close(4009, 'Session timed out');
    }, 10_000);

    send(ws, OP.HELLO, { heartbeat_interval: HEARTBEAT_INTERVAL });

    ws.on('message', (raw) => {
      let packet;
      try {
        packet = JSON.parse(raw);
      } catch {
        return ws.close(4002, 'Decode error');
      }
      const { op, d } = packet;

      if (op === OP.HEARTBEAT) {
        ws.lastHeartbeat = Date.now();
        return send(ws, OP.HEARTBEAT_ACK, null);
      }
      if (op === OP.IDENTIFY) return handleIdentify(ws, d);
      if (!ws.user) return ws.close(4003, 'Not authenticated');
      if (op === OP.PRESENCE_UPDATE) return handlePresenceUpdate(ws, d);
      if (op === OP.VOICE_STATE_UPDATE) return handleVoiceStateUpdate(ws, d);
      if (op === OP.VOICE_SIGNAL) return handleVoiceSignal(ws, d);
      ws.close(4001, 'Unknown opcode');
    });

    ws.on('close', () => handleClose(ws));
  });

  return wss;
}
