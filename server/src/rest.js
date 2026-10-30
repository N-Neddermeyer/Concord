import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import { hashPassword, newToken, verifyPassword } from './auth.js';
import {
  ATTACHMENTS_DIR, CHANNEL_CATEGORY, CHANNEL_DM, CHANNEL_GROUP_DM, CHANNEL_TEXT, CHANNEL_THREAD, CHANNEL_VOICE, MSG, REL, db, loadMessages,
  messagePayload, privateUser, publicUser, q, toChannel, toOverwrite, toThread,
} from './db.js';
import {
  broadcastPresence,
  buildDmChannel,
  buildGuild,
  buildMember,
  channelPermissionsOf,
  customStatusOf,
  disconnectVoice,
  dispatchToChannel,
  dispatchToGuild,
  dispatchToGuildWith,
  dispatchToUser,
  dispatchToUsers,
  forgetGuild,
  guildFields,
  isInCall,
  leaveVoice,
  permissionsOf,
  presenceOf,
  rankOf,
  relatedUserIds,
  ringCall,
  statusOf,
  stopRinging,
  syncChannels,
  toRole,
} from './gateway.js';
import { iceServersFor } from './ice.js';
import {
  ALL_PERMISSIONS, CHANNEL_PERMISSIONS, DEFAULT_PERMISSIONS, OVERWRITE_MEMBER, OVERWRITE_ROLE, P, has,
} from './permissions.js';
import { snowflake, timestampOf } from './snowflake.js';

export const api = Router();

const COLORS = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#f0b232', '#3ba55c', '#00a8fc'];
const USERNAME = /^[\w.]{2,32}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_LENGTH = 400_000;
const MAX_GROUP_SIZE = 10; // participantes de um grupo de DM, como no Discord
const MAX_PINS = 50;
const MAX_REACTION_KINDS = 20;
const EMOJI = /^\p{Extended_Pictographic}[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f]*$/u;
// Anexos: limites da conta gratuita do Discord.
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+$/;

const now = () => new Date().toISOString();

// Erro com status HTTP: as rotas lançam e o handler no fim do arquivo responde.
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const fail = (status, message, extra) => {
  throw new HttpError(status, message, extra);
};

const validImage = (value) => value === null || (typeof value === 'string' && value.length <= MAX_IMAGE_LENGTH && IMAGE_DATA_URL.test(value));

// --- autenticação (sem token) ---

api.get('/health', (_req, res) => res.json({ ok: true }));

api.post('/auth/register', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!USERNAME.test(username)) fail(400, 'Nome de usuário: 2 a 32 letras, números, _ ou .');
  if (password.length < 6) fail(400, 'A senha precisa ter pelo menos 6 caracteres.');
  if (q.userByName.get(username)) fail(409, 'Esse nome de usuário já existe.');

  const token = newToken();
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  q.insertUser.run(snowflake(), username, hashPassword(password), token, color);
  res.status(201).json({ token });
});

api.post('/auth/login', (req, res) => {
  const user = q.userByName.get(String(req.body?.username ?? '').trim());
  if (!user || !verifyPassword(String(req.body?.password ?? ''), user.password_hash)) {
    fail(401, 'Usuário ou senha incorretos.');
  }
  res.json({ token: user.token });
});

// --- daqui em diante, exige o header Authorization com o token ---

api.use((req, _res, next) => {
  const user = q.userByToken.get(req.get('Authorization') ?? '');
  if (!user) fail(401, '401: Unauthorized');
  req.user = user;
  next();
});

// Servidores STUN/TURN para as chamadas (configurados no servidor; veja ice.js).
api.get('/voice/ice-servers', (req, res) => res.json(iceServersFor(req.user.id)));

// Servidor do qual o usuário é membro, opcionalmente exigindo uma permissão.
function loadGuild(req, permission) {
  const guild = q.guild.get(req.params.guildId);
  if (!guild || !q.member.get(guild.id, req.user.id)) fail(404, 'Servidor não encontrado.');
  const perms = permissionsOf(guild, req.user.id);
  if (permission && !has(perms, permission)) fail(403, 'Você não tem permissão para fazer isso.');
  return { guild, perms };
}

// Canal que o usuário pode ver: canal de servidor com "Ver canal", ou DM da qual participa.
function loadChannel(req) {
  const channel = q.channel.get(req.params.channelId);
  const visible = channel && (channel.guild_id
    ? has(channelPermissionsOf(channel, req.user.id), P.VIEW_CHANNEL)
    : q.dmRecipient.get(channel.id, req.user.id));
  if (!visible) fail(404, 'Canal não encontrado.');
  return channel;
}

function loadMessageChannel(req) {
  const channel = loadChannel(req);
  if (![CHANNEL_TEXT, CHANNEL_DM, CHANNEL_GROUP_DM, CHANNEL_THREAD].includes(channel.type)) fail(404, 'Canal não encontrado.');
  return channel;
}

// --- usuário ---

api.get('/users/@me', (req, res) => res.json(privateUser(req.user)));

api.patch('/users/@me', (req, res) => {
  const user = req.user;
  const body = req.body ?? {};
  const next = { ...user };

  const username = body.username === undefined ? user.username : String(body.username).trim();
  const changingSecret = username !== user.username || body.new_password !== undefined;
  if (changingSecret && !verifyPassword(String(body.password ?? ''), user.password_hash)) {
    fail(400, 'A senha atual está incorreta.');
  }

  if (username !== user.username) {
    if (!USERNAME.test(username)) fail(400, 'Nome de usuário: 2 a 32 letras, números, _ ou .');
    const taken = q.userByName.get(username);
    if (taken && taken.id !== user.id) fail(409, 'Esse nome de usuário já existe.');
    next.username = username;
  }
  if (body.new_password !== undefined) {
    if (String(body.new_password).length < 6) fail(400, 'A nova senha precisa ter pelo menos 6 caracteres.');
    next.password_hash = hashPassword(String(body.new_password));
    next.token = newToken(); // como no Discord: trocar a senha invalida o token antigo
  }
  if (body.global_name !== undefined) {
    const name = String(body.global_name ?? '').trim();
    if (name.length > 32) fail(400, 'O nome exibido pode ter no máximo 32 caracteres.');
    next.global_name = name || null;
  }
  if (body.avatar !== undefined) {
    if (!validImage(body.avatar)) fail(400, 'Imagem de avatar inválida ou grande demais.');
    next.avatar = body.avatar;
  }
  if (body.banner_color !== undefined) {
    if (body.banner_color !== null && !HEX_COLOR.test(body.banner_color)) fail(400, 'Cor de banner inválida.');
    next.banner_color = body.banner_color;
  }
  if (body.bio !== undefined) {
    const bio = String(body.bio ?? '');
    if (bio.length > 190) fail(400, 'O "Sobre mim" pode ter no máximo 190 caracteres.');
    next.bio = bio;
  }

  q.updateUser.run(next.username, next.password_hash, next.token, next.global_name, next.avatar, next.banner_color, next.bio, user.id);
  const updated = q.userById.get(user.id);
  dispatchToUser(user.id, 'USER_UPDATE', privateUser(updated));
  const others = [...relatedUserIds(user.id)].filter((id) => id !== user.id);
  dispatchToUsers(others, 'USER_UPDATE', publicUser(updated));
  res.json({ user: privateUser(updated), token: updated.token });
});

// --- amizades (mesma semântica do Discord: 1 amigo, 2 bloqueado, 3 recebido, 4 enviado) ---

function setRelationship(userId, targetId, type) {
  const since = now();
  q.setRelationship.run(userId, targetId, type, since);
  dispatchToUser(userId, 'RELATIONSHIP_ADD', { id: targetId, type, since, user: publicUser(q.userById.get(targetId)) });
  if (type === REL.FRIEND) dispatchToUser(userId, 'PRESENCE_UPDATE', presenceOf(targetId));
}

function removeRelationship(userId, targetId) {
  const current = q.relationship.get(userId, targetId);
  if (!current) return;
  q.deleteRelationship.run(userId, targetId);
  dispatchToUser(userId, 'RELATIONSHIP_REMOVE', { id: targetId, type: current.type });
}

const sendFriendRequest = db.transaction((me, target) => {
  if (target.id === me.id) fail(400, 'Você não pode adicionar a si mesmo.');
  const mine = q.relationship.get(me.id, target.id);
  const theirs = q.relationship.get(target.id, me.id);
  if (mine?.type === REL.FRIEND) fail(400, 'Vocês já são amigos!');
  if (mine?.type === REL.BLOCKED) fail(400, 'Desbloqueie este usuário antes de enviar um pedido de amizade.');
  if (theirs?.type === REL.BLOCKED) fail(400, 'Hm, não funcionou. Verifique se o nome de usuário está correto.');
  if (mine?.type === REL.OUTGOING) return;

  if (mine?.type === REL.INCOMING) {
    setRelationship(me.id, target.id, REL.FRIEND);
    setRelationship(target.id, me.id, REL.FRIEND);
  } else {
    setRelationship(me.id, target.id, REL.OUTGOING);
    setRelationship(target.id, me.id, REL.INCOMING);
  }
});

api.get('/users/@me/relationships', (req, res) => {
  res.json(q.relationshipsOf.all(req.user.id).map((r) => ({ id: r.id, type: r.type, since: r.since, user: publicUser(r) })));
});

api.post('/users/@me/relationships', (req, res) => {
  const target = q.userByName.get(String(req.body?.username ?? '').trim());
  if (!target) fail(404, 'Hm, não funcionou. Verifique se o nome de usuário está correto.');
  sendFriendRequest(req.user, target);
  res.status(204).end();
});

// Sem corpo (ou type 1): envia ou aceita pedido. type 2: bloqueia.
api.put('/users/@me/relationships/:userId', (req, res) => {
  const target = q.userById.get(req.params.userId);
  if (!target || target.id === req.user.id) fail(404, 'Usuário não encontrado.');

  if (req.body?.type === REL.BLOCKED) {
    db.transaction(() => {
      if (q.relationship.get(target.id, req.user.id)?.type !== REL.BLOCKED) removeRelationship(target.id, req.user.id);
      setRelationship(req.user.id, target.id, REL.BLOCKED);
    })();
  } else {
    sendFriendRequest(req.user, target);
  }
  res.status(204).end();
});

// Desfaz amizade, recusa/cancela pedido ou desbloqueia.
api.delete('/users/@me/relationships/:userId', (req, res) => {
  const mine = q.relationship.get(req.user.id, req.params.userId);
  if (!mine) fail(404, 'Relação não encontrada.');
  db.transaction(() => {
    removeRelationship(req.user.id, req.params.userId);
    if (mine.type !== REL.BLOCKED && q.relationship.get(req.params.userId, req.user.id)?.type !== REL.BLOCKED) {
      removeRelationship(req.params.userId, req.user.id);
    }
  })();
  res.status(204).end();
});

// --- notas e perfil completo ---

const MAX_NOTE_LENGTH = 256; // como no Discord

// Nota pessoal sobre outro usuário: só quem escreveu vê.
api.put('/users/@me/notes/:userId', (req, res) => {
  const target = q.userById.get(req.params.userId);
  if (!target || target.id === req.user.id) fail(404, 'Usuário não encontrado.');
  const note = String(req.body?.note ?? '').trim();
  if (note.length > MAX_NOTE_LENGTH) fail(400, `A nota pode ter no máximo ${MAX_NOTE_LENGTH} caracteres.`);
  if (note) q.setNote.run(req.user.id, target.id, note);
  else q.deleteNote.run(req.user.id, target.id);
  dispatchToUser(req.user.id, 'USER_NOTE_UPDATE', { id: target.id, note });
  res.status(204).end();
});

api.get('/users/@me/notes/:userId', (req, res) => {
  const row = q.note.get(req.user.id, req.params.userId);
  if (!row) fail(404, 'Nota não encontrada.');
  res.json({ note_user_id: req.params.userId, note: row.note });
});

// Perfil completo (modal): servidores e amigos em comum. Só de quem tem alguma ligação com você.
api.get('/users/:userId/profile', (req, res) => {
  const target = q.userById.get(req.params.userId);
  if (!target || (target.id !== req.user.id && !relatedUserIds(req.user.id).has(target.id) && !q.relationship.get(req.user.id, target.id))) {
    fail(404, 'Usuário não encontrado.');
  }
  const isMe = target.id === req.user.id;
  res.json({
    user: publicUser(target),
    mutual_guilds: isMe ? [] : q.mutualGuilds.all(target.id, req.user.id).map((g) => ({ id: g.id, nick: g.nick ?? null })),
    mutual_friends: isMe ? [] : q.mutualFriends.all(req.user.id, target.id).map((r) => publicUser(q.userById.get(r.id))),
  });
});

// --- mensagens diretas ---

api.get('/users/@me/channels', (req, res) => {
  res.json(q.dmChannelsOf.all(req.user.id).map((c) => buildDmChannel(c, req.user.id)));
});

const dmRecipientIds = (channelId) => q.dmRecipientIds.all(channelId).map((r) => r.user_id);
const isFriend = (a, b) => q.relationship.get(a, b)?.type === REL.FRIEND;

// Avisa cada participante com o canal visto do lado dele (os "outros" mudam por pessoa).
function dispatchDmChannel(channelId, t, userIds = dmRecipientIds(channelId)) {
  const channel = q.channel.get(channelId);
  for (const id of userIds) dispatchToUser(id, t, buildDmChannel(channel, id));
}

// recipient_id: DM individual (reaproveita a existente). recipients: novo grupo de DM.
api.post('/users/@me/channels', (req, res) => {
  if (Array.isArray(req.body?.recipients)) {
    const others = [...new Set(req.body.recipients.map(String))].filter((id) => id !== req.user.id);
    if (others.length < 1) fail(400, 'Escolha pelo menos um amigo.');
    if (others.length + 1 > MAX_GROUP_SIZE) fail(400, `Um grupo pode ter no máximo ${MAX_GROUP_SIZE} participantes.`);
    for (const id of others) {
      if (!q.userById.get(id) || !isFriend(req.user.id, id)) fail(403, 'Você só pode adicionar amigos ao grupo.');
    }
    const id = snowflake();
    db.transaction(() => {
      q.insertGroupDm.run(id, req.user.id);
      for (const userId of [req.user.id, ...others]) q.insertDmRecipient.run(id, userId);
    })();
    dispatchDmChannel(id, 'CHANNEL_CREATE');
    return res.status(201).json(buildDmChannel(q.channel.get(id), req.user.id));
  }

  const target = q.userById.get(String(req.body?.recipient_id ?? ''));
  if (!target || target.id === req.user.id) fail(404, 'Usuário não encontrado.');

  let channel = q.dmBetween.get(req.user.id, target.id);
  if (!channel) {
    if (!isFriend(req.user.id, target.id) && !q.sharesGuild.get(req.user.id, target.id)) {
      fail(403, 'Vocês precisam ser amigos ou estar em um mesmo servidor.');
    }
    const id = snowflake();
    db.transaction(() => {
      q.insertDmChannel.run(id);
      q.insertDmRecipient.run(id, req.user.id);
      q.insertDmRecipient.run(id, target.id);
    })();
    channel = q.channel.get(id);
  }
  const dm = buildDmChannel(channel, req.user.id);
  dispatchToUser(req.user.id, 'CHANNEL_CREATE', dm);
  res.json(dm);
});

function loadGroup(req) {
  const channel = loadChannel(req);
  if (channel.type !== CHANNEL_GROUP_DM) fail(400, 'Isso só vale para grupos de mensagem direta.');
  return channel;
}

// Adicionar um amigo ao grupo (qualquer participante pode).
api.put('/channels/:channelId/recipients/:userId', (req, res) => {
  const channel = loadGroup(req);
  const target = q.userById.get(req.params.userId);
  if (!target || !isFriend(req.user.id, target.id)) fail(403, 'Você só pode adicionar amigos ao grupo.');
  const members = dmRecipientIds(channel.id);
  if (members.includes(target.id)) return res.status(204).end();
  if (members.length >= MAX_GROUP_SIZE) fail(400, `Um grupo pode ter no máximo ${MAX_GROUP_SIZE} participantes.`);

  q.insertDmRecipient.run(channel.id, target.id);
  dispatchToUsers(members, 'CHANNEL_RECIPIENT_ADD', { channel_id: channel.id, user: publicUser(target) });
  dispatchDmChannel(channel.id, 'CHANNEL_CREATE', [target.id]);
  postMessage(q.channel.get(channel.id), req.user, { type: MSG.RECIPIENT_ADD, meta: { user_id: target.id } });
  res.status(204).end();
});

// Sair do grupo (o próprio usuário) ou remover alguém (só o dono do grupo).
function removeFromGroup(channel, actor, userId) {
  const members = dmRecipientIds(channel.id);
  if (!members.includes(userId)) fail(404, 'Essa pessoa não está no grupo.');
  if (userId !== actor.id && channel.owner_id !== actor.id) fail(403, 'Só o dono do grupo pode remover participantes.');

  if (isInCall(channel.id, userId)) leaveVoice(userId);
  q.deleteDmRecipient.run(channel.id, userId);
  dispatchToUser(userId, 'CHANNEL_DELETE', { id: channel.id, type: CHANNEL_GROUP_DM, guild_id: null });

  const remaining = members.filter((id) => id !== userId);
  if (!remaining.length) {
    q.deleteChannel.run(channel.id);
    return;
  }
  dispatchToUsers(remaining, 'CHANNEL_RECIPIENT_REMOVE', { channel_id: channel.id, user: publicUser(q.userById.get(userId)) });
  if (channel.owner_id === userId) {
    q.setChannelOwner.run(remaining[0], channel.id);
    dispatchDmChannel(channel.id, 'CHANNEL_UPDATE', remaining);
  }
  postMessage(q.channel.get(channel.id), actor, { type: MSG.RECIPIENT_REMOVE, meta: { user_id: userId } });
}

api.delete('/channels/:channelId/recipients/:userId', (req, res) => {
  removeFromGroup(loadGroup(req), req.user, req.params.userId);
  res.status(204).end();
});

// --- chamadas em DM ---

function loadCall(req) {
  const channel = loadChannel(req);
  if (channel.guild_id) fail(404, 'Canal não encontrado.');
  const others = q.dmRecipientIds.all(channel.id).map((r) => r.user_id).filter((id) => id !== req.user.id);
  const wanted = Array.isArray(req.body?.recipients) ? req.body.recipients.map(String) : null;
  return { channel, others, wanted };
}

// Toca de novo para os outros participantes (botão "Chamar" de quem já está na chamada).
api.post('/channels/:channelId/call/ring', (req, res) => {
  const { channel, others, wanted } = loadCall(req);
  if (!isInCall(channel.id, req.user.id)) fail(400, 'Entre na chamada antes de chamar alguém.');
  if (!ringCall(channel.id, wanted ? others.filter((id) => wanted.includes(id)) : others)) fail(404, 'Não há chamada em andamento.');
  res.status(204).end();
});

// Recusar (sem corpo: para de tocar para si mesmo) ou cancelar o toque para outros.
api.post('/channels/:channelId/call/stop-ringing', (req, res) => {
  const { channel, others, wanted } = loadCall(req);
  const targets = wanted ? [req.user.id, ...others].filter((id) => wanted.includes(id)) : [req.user.id];
  if (!stopRinging(channel.id, targets)) fail(404, 'Não há chamada em andamento.');
  res.status(204).end();
});

// --- registro de auditoria (mesmos action_type do Discord) ---

const AUDIT = {
  GUILD_UPDATE: 1,
  CHANNEL_CREATE: 10,
  CHANNEL_UPDATE: 11,
  CHANNEL_DELETE: 12,
  CHANNEL_OVERWRITE_CREATE: 13,
  CHANNEL_OVERWRITE_UPDATE: 14,
  CHANNEL_OVERWRITE_DELETE: 15,
  MEMBER_KICK: 20,
  MEMBER_BAN_ADD: 22,
  MEMBER_BAN_REMOVE: 23,
  MEMBER_UPDATE: 24,
  MEMBER_ROLE_UPDATE: 25,
  ROLE_CREATE: 30,
  ROLE_UPDATE: 31,
  ROLE_DELETE: 32,
  INVITE_CREATE: 40,
  INVITE_DELETE: 42,
  MESSAGE_DELETE: 72,
  MESSAGE_PIN: 74,
  MESSAGE_UNPIN: 75,
  THREAD_CREATE: 110,
  THREAD_UPDATE: 111,
  THREAD_DELETE: 112,
};
const AUDIT_ACTIONS = new Set(Object.values(AUDIT));

const toAuditEntry = (row) => ({
  id: row.id,
  user_id: row.user_id,
  target_id: row.target_id,
  action_type: row.action_type,
  changes: row.changes ? JSON.parse(row.changes) : undefined,
  options: row.options ? JSON.parse(row.options) : undefined,
  reason: row.reason ?? undefined,
});

function audit(guildId, userId, action, { target = null, changes = null, options = null, reason = null } = {}) {
  const row = {
    id: snowflake(),
    user_id: userId,
    target_id: target,
    action_type: action,
    changes: changes?.length ? JSON.stringify(changes) : null,
    options: options ? JSON.stringify(options) : null,
    reason: reason || null,
  };
  q.insertAudit.run(row.id, guildId, row.user_id, row.target_id, row.action_type, row.changes, row.options, row.reason);
  dispatchToGuildWith(guildId, P.VIEW_AUDIT_LOG, 'GUILD_AUDIT_LOG_ENTRY_CREATE', { guild_id: guildId, ...toAuditEntry(row) });
}

// Imagens entram no registro como hash (como o icon_hash do Discord), não como o data URL inteiro.
const imageHash = (value) => (value ? createHash('sha1').update(value).digest('hex').slice(0, 16) : null);

// [{ key, old_value, new_value }] só com o que mudou.
function diff(before, after, keys) {
  const changes = [];
  for (const key of keys) {
    const a = before?.[key] ?? null;
    const b = after?.[key] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ key, ...(a !== null && { old_value: a }), ...(b !== null && { new_value: b }) });
  }
  return changes;
}

api.get('/guilds/:guildId/audit-logs', (req, res) => {
  const { guild } = loadGuild(req, P.VIEW_AUDIT_LOG);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const action = req.query.action_type === undefined ? null : Number(req.query.action_type);
  if (action !== null && !AUDIT_ACTIONS.has(action)) fail(400, 'Tipo de ação inválido.');
  const rows = q.auditLog.all({
    guild: guild.id,
    user: typeof req.query.user_id === 'string' ? req.query.user_id : null,
    action,
    before: typeof req.query.before === 'string' ? req.query.before : null,
    limit,
  });
  const entries = rows.map(toAuditEntry);
  const userIds = new Set(entries.flatMap((e) => [e.user_id, e.target_id]).filter(Boolean));
  const users = [...userIds].map((id) => q.userById.get(id)).filter(Boolean).map((u) => publicUser(u));
  res.json({ audit_log_entries: entries, users });
});

// --- servidores ---

const SUPPRESS_JOIN_NOTIFICATIONS = 1 << 0;
const MAX_BANNER_LENGTH = 800_000;

// Manda o servidor completo (só com os canais visíveis) para o membro.
function sendGuild(userId, guildId) {
  const guild = buildGuild(q.guild.get(guildId), userId);
  dispatchToUser(userId, 'GUILD_CREATE', guild);
  return guild;
}

api.post('/guilds', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (name.length < 1 || name.length > 100) fail(400, 'Nome do servidor: 1 a 100 caracteres.');
  const icon = req.body?.icon ?? null;
  if (!validImage(icon)) fail(400, 'Ícone inválido ou grande demais.');

  // Mesmo ponto de partida do Discord: categorias de texto e de voz, #geral e o canal de voz Geral.
  const guildId = snowflake();
  db.transaction(() => {
    const textCategory = snowflake();
    const voiceCategory = snowflake();
    const general = snowflake();
    q.insertGuild.run(guildId, name, req.user.id);
    q.insertRole.run(guildId, guildId, '@everyone', null, DEFAULT_PERMISSIONS, 0, 0);
    q.insertMember.run(guildId, req.user.id, now());
    q.insertChannel.run(textCategory, guildId, 'Canais de texto', CHANNEL_CATEGORY, 0, null);
    q.insertChannel.run(voiceCategory, guildId, 'Canais de voz', CHANNEL_CATEGORY, 1, null);
    q.insertChannel.run(general, guildId, 'geral', CHANNEL_TEXT, 0, textCategory);
    q.insertChannel.run(snowflake(), guildId, 'Geral', CHANNEL_VOICE, 0, voiceCategory);
    q.updateGuild.run(name, icon, null, general, 0, guildId);
  })();

  res.status(201).json(sendGuild(req.user.id, guildId));
});

api.patch('/guilds/:guildId', (req, res) => {
  const { guild } = loadGuild(req, P.MANAGE_GUILD);
  const body = req.body ?? {};
  const next = { ...guild };
  if (body.name !== undefined) next.name = String(body.name).trim();
  if (next.name.length < 1 || next.name.length > 100) fail(400, 'Nome do servidor: 1 a 100 caracteres.');
  if (body.icon !== undefined) next.icon = body.icon;
  if (!validImage(next.icon)) fail(400, 'Ícone inválido ou grande demais.');
  if (body.banner !== undefined) {
    if (body.banner !== null && (typeof body.banner !== 'string' || body.banner.length > MAX_BANNER_LENGTH || !IMAGE_DATA_URL.test(body.banner))) {
      fail(400, 'Banner inválido ou grande demais.');
    }
    next.banner = body.banner;
  }
  if (body.system_channel_id !== undefined) {
    const channel = body.system_channel_id === null ? null : q.channel.get(String(body.system_channel_id));
    if (body.system_channel_id !== null && (!channel || channel.guild_id !== guild.id || channel.type !== CHANNEL_TEXT)) {
      fail(400, 'Canal de mensagens do sistema inválido.');
    }
    next.system_channel_id = channel?.id ?? null;
  }
  if (body.system_channel_flags !== undefined) next.system_channel_flags = Number(body.system_channel_flags) & SUPPRESS_JOIN_NOTIFICATIONS;

  q.updateGuild.run(next.name, next.icon, next.banner, next.system_channel_id, next.system_channel_flags, guild.id);
  const changes = diff(
    { ...guild, icon_hash: imageHash(guild.icon), banner_hash: imageHash(guild.banner) },
    { ...next, icon_hash: imageHash(next.icon), banner_hash: imageHash(next.banner) },
    ['name', 'icon_hash', 'banner_hash', 'system_channel_id', 'system_channel_flags'],
  );
  if (changes.length) audit(guild.id, req.user.id, AUDIT.GUILD_UPDATE, { target: guild.id, changes });
  const update = guildFields(q.guild.get(guild.id));
  dispatchToGuild(guild.id, 'GUILD_UPDATE', update);
  res.json(update);
});

api.delete('/guilds/:guildId', (req, res) => {
  const { guild } = loadGuild(req);
  if (guild.owner_id !== req.user.id) fail(403, 'Só o dono pode excluir o servidor.');
  const memberIds = q.memberIds.all(guild.id).map((m) => m.user_id);
  disconnectVoice((v) => v.guild_id === guild.id);
  q.deleteGuild.run(guild.id);
  for (const id of memberIds) forgetGuild(id, guild.id);
  dispatchToUsers(memberIds, 'GUILD_DELETE', { id: guild.id });
  res.status(204).end();
});

function removeMember(guild, userId) {
  disconnectVoice((v) => v.guild_id === guild.id && v.user_id === userId);
  const user = q.userById.get(userId);
  q.deleteMember.run(guild.id, userId);
  q.leaveGuildThreads.run(userId, guild.id);
  forgetGuild(userId, guild.id);
  dispatchToGuild(guild.id, 'GUILD_MEMBER_REMOVE', { guild_id: guild.id, user: publicUser(user) });
  dispatchToUser(userId, 'GUILD_DELETE', { id: guild.id });
}

api.delete('/users/@me/guilds/:guildId', (req, res) => {
  const { guild } = loadGuild(req);
  if (guild.owner_id === req.user.id) fail(400, 'O dono não pode sair do servidor. Transfira-o ou exclua-o.');
  removeMember(guild, req.user.id);
  res.status(204).end();
});

// Status personalizado: { text, emoji_name, expires_at } ou null. Some sozinho quando vence.
const MAX_CUSTOM_STATUS = 128;
const statusTimers = new Map(); // userId -> timer do vencimento

function parseCustomStatus(raw) {
  if (raw === null) return null;
  if (typeof raw !== 'object') fail(400, 'Status personalizado inválido.');
  const text = String(raw.text ?? '').trim();
  if (text.length > MAX_CUSTOM_STATUS) fail(400, `O status pode ter no máximo ${MAX_CUSTOM_STATUS} caracteres.`);
  const emoji = raw.emoji_name ? String(raw.emoji_name) : null;
  if (emoji && (emoji.length > 32 || !EMOJI.test(emoji))) fail(400, 'Emoji inválido.');
  let expires = null;
  if (raw.expires_at) {
    expires = new Date(raw.expires_at);
    if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) fail(400, 'Data de expiração inválida.');
    expires = expires.toISOString();
  }
  return text || emoji ? { text: text || null, emoji_name: emoji, expires_at: expires } : null;
}

function scheduleStatusExpiry(userId, custom) {
  clearTimeout(statusTimers.get(userId));
  statusTimers.delete(userId);
  if (!custom?.expires_at) return;
  const wait = Math.min(Date.parse(custom.expires_at) - Date.now(), 2 ** 31 - 1);
  statusTimers.set(userId, setTimeout(() => {
    statusTimers.delete(userId);
    const user = q.userById.get(userId);
    if (!user?.custom_status) return;
    if (customStatusOf(user)) return scheduleStatusExpiry(userId, JSON.parse(user.custom_status)); // espera longa: reagenda
    q.setCustomStatus.run(null, userId);
    dispatchToUser(userId, 'USER_SETTINGS_UPDATE', { custom_status: null });
    broadcastPresence(userId);
  }, Math.max(wait, 0)).unref());
}

// Ao subir: limpa os vencidos e agenda os outros.
for (const row of q.withCustomStatus.all()) {
  const custom = customStatusOf(row);
  if (custom) scheduleStatusExpiry(row.id, custom);
  else q.setCustomStatus.run(null, row.id);
}

// Configurações sincronizadas: ordem dos servidores na barra (guild_positions) e status personalizado.
api.patch('/users/@me/settings', (req, res) => {
  const body = req.body ?? {};
  if (body.guild_positions === undefined && body.custom_status === undefined) fail(400, 'Nada para alterar.');
  const update = {};
  if (body.guild_positions !== undefined) {
    const positions = body.guild_positions;
    if (!Array.isArray(positions) || positions.length > 200) fail(400, 'Formato inválido.');
    const mine = new Set(q.guildsOf.all(req.user.id).map((g) => g.id));
    update.guild_positions = [...new Set(positions.map(String))].filter((id) => mine.has(id));
  }
  if (body.custom_status !== undefined) update.custom_status = parseCustomStatus(body.custom_status);

  if (update.guild_positions) q.setGuildPositions.run(JSON.stringify(update.guild_positions), req.user.id);
  if (body.custom_status !== undefined) {
    q.setCustomStatus.run(update.custom_status && JSON.stringify(update.custom_status), req.user.id);
    scheduleStatusExpiry(req.user.id, update.custom_status);
  }
  dispatchToUser(req.user.id, 'USER_SETTINGS_UPDATE', update);
  if (body.custom_status !== undefined) broadcastPresence(req.user.id);
  res.json(update);
});

// --- canais ---

const SLOWMODE_MAX = 21600; // 6 horas, como no Discord
const CHANNEL_AUDIT_KEYS = ['name', 'type', 'topic', 'nsfw', 'rate_limit_per_user', 'parent_id'];

function channelName(raw, type) {
  let name = String(raw ?? '').trim();
  if (type === CHANNEL_TEXT) name = name.toLowerCase().replace(/\s+/g, '-');
  if (name.length < 1 || name.length > 100) fail(400, 'Nome do canal: 1 a 100 caracteres.');
  return name;
}

function slowmode(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > SLOWMODE_MAX) fail(400, 'Modo lento: de 0 a 21600 segundos.');
  return value;
}

const auditChannel = (c) => ({ ...c, nsfw: !!c.nsfw, parent_id: c.parent_id ?? null });

// Lista de overwrites vinda do cliente: cargos e membros do servidor, só com bits de canal.
function parseOverwrites(raw, guild) {
  if (!Array.isArray(raw) || raw.length > 100) fail(400, 'Overwrites de permissão inválidos.');
  const seen = new Set();
  return raw.map((o) => {
    const id = String(o?.id ?? '');
    const type = Number(o?.type);
    if (seen.has(id)) fail(400, 'Overwrite repetido.');
    seen.add(id);
    if (type === OVERWRITE_ROLE ? q.role.get(id)?.guild_id !== guild.id : type !== OVERWRITE_MEMBER || !q.member.get(guild.id, id)) {
      fail(400, 'Cargo ou membro inválido nos overwrites.');
    }
    const allow = Number(o.allow ?? 0) & CHANNEL_PERMISSIONS;
    const deny = Number(o.deny ?? 0) & CHANNEL_PERMISSIONS & ~allow;
    return { id, type, allow, deny };
  });
}

const sameOverwrites = (a, b) => {
  const key = (list) => JSON.stringify([...list].sort((x, y) => (x.id < y.id ? -1 : 1)).map((o) => [o.id, o.type, o.allow, o.deny]));
  return key(a) === key(b);
};

const overwritesOf = (channelId) => q.overwritesOf.all(channelId).map(toOverwrite);

// Quem não é administrador só libera ou nega por canal o que ele mesmo tem no canal.
function checkOverwriteGrant(perms, before, after) {
  if (has(perms, P.ADMINISTRATOR)) return;
  let changed = 0;
  for (const o of [...before, ...after]) {
    const a = before.find((x) => x.id === o.id) ?? { allow: 0, deny: 0 };
    const b = after.find((x) => x.id === o.id) ?? { allow: 0, deny: 0 };
    changed |= (a.allow ^ b.allow) | (a.deny ^ b.deny);
  }
  if (changed & ~perms) fail(403, 'Você não pode alterar permissões que não possui neste canal.');
}

function writeOverwrites(channelId, list) {
  q.clearOverwrites.run(channelId);
  for (const o of list) q.insertOverwrite.run(channelId, o.id, o.type, o.allow, o.deny);
}

// Uma entrada por overwrite criado, alterado ou removido.
function auditOverwrites(guild, userId, channelId, before, after) {
  const roleName = (o) => (o.type === OVERWRITE_ROLE ? { role_name: q.role.get(o.id)?.name } : {});
  for (const o of after) {
    const old = before.find((x) => x.id === o.id);
    const options = { id: o.id, type: String(o.type), ...roleName(o) };
    if (!old) {
      audit(guild.id, userId, AUDIT.CHANNEL_OVERWRITE_CREATE, { target: channelId, options, changes: diff({}, o, ['id', 'type', 'allow', 'deny']) });
    } else if (old.allow !== o.allow || old.deny !== o.deny) {
      audit(guild.id, userId, AUDIT.CHANNEL_OVERWRITE_UPDATE, { target: channelId, options, changes: diff(old, o, ['allow', 'deny']) });
    }
  }
  for (const o of before) {
    if (after.some((x) => x.id === o.id)) continue;
    audit(guild.id, userId, AUDIT.CHANNEL_OVERWRITE_DELETE, {
      target: channelId, options: { id: o.id, type: String(o.type), ...roleName(o) }, changes: diff(o, {}, ['id', 'type', 'allow', 'deny']),
    });
  }
}

api.post('/guilds/:guildId/channels', (req, res) => {
  const { guild, perms } = loadGuild(req, P.MANAGE_CHANNELS);
  const body = req.body ?? {};
  const type = [CHANNEL_VOICE, CHANNEL_CATEGORY].includes(body.type) ? body.type : CHANNEL_TEXT;
  const name = channelName(body.name, type);

  let parentId = null;
  if (body.parent_id && type !== CHANNEL_CATEGORY) {
    const parent = q.channel.get(String(body.parent_id));
    if (!parent || parent.guild_id !== guild.id || parent.type !== CHANNEL_CATEGORY) fail(400, 'Categoria inválida.');
    parentId = parent.id;
  }
  // Sem overwrites próprios, o canal nasce sincronizado com a categoria.
  const inherited = parentId ? overwritesOf(parentId) : [];
  let overwrites = inherited;
  if (body.permission_overwrites !== undefined) {
    if (!has(perms, P.MANAGE_ROLES)) fail(403, 'Você precisa da permissão Gerenciar cargos para criar canais privados.');
    overwrites = parseOverwrites(body.permission_overwrites, guild);
    checkOverwriteGrant(perms, inherited, overwrites);
  }

  const id = snowflake();
  db.transaction(() => {
    q.insertChannel.run(id, guild.id, name, type, q.nextChannelPosition.get(guild.id).pos, parentId);
    if (type !== CHANNEL_CATEGORY) {
      q.updateGuildChannel.run(name, type === CHANNEL_TEXT ? String(body.topic ?? '').slice(0, 1024) : '', body.nsfw ? 1 : 0,
        type === CHANNEL_TEXT && body.rate_limit_per_user !== undefined ? slowmode(body.rate_limit_per_user) : 0, id);
    }
    writeOverwrites(id, overwrites);
  })();
  const created = q.channel.get(id);
  const createdChanges = diff({}, auditChannel(created), ['name', 'type', 'nsfw', 'rate_limit_per_user']).filter((c) => c.key === 'type' || c.new_value);
  audit(guild.id, req.user.id, AUDIT.CHANNEL_CREATE, { target: id, changes: createdChanges });
  syncChannels(guild.id, [id]);
  res.status(201).json(toChannel(created));
});

// Reordenar arrastando: [{ id, position, parent_id?, lock_permissions? }], como no Discord.
api.patch('/guilds/:guildId/channels', (req, res) => {
  const { guild } = loadGuild(req, P.MANAGE_CHANNELS);
  const moves = Array.isArray(req.body) ? req.body : fail(400, 'Formato inválido.');
  const channels = new Map(q.channelsOf.all(guild.id).map((c) => [c.id, c]));
  const plan = moves.map((m) => {
    const channel = channels.get(String(m?.id));
    if (!channel) fail(400, 'Canal inválido.');
    if (!Number.isInteger(m.position) || m.position < 0) fail(400, 'Posição inválida.');
    let parentId = channel.parent_id;
    if (m.parent_id !== undefined) {
      parentId = m.parent_id === null ? null : String(m.parent_id);
      if (parentId && (channel.type === CHANNEL_CATEGORY || channels.get(parentId)?.type !== CHANNEL_CATEGORY)) fail(400, 'Categoria inválida.');
    }
    return { channel, position: m.position, parentId, lock: !!m.lock_permissions };
  });

  db.transaction(() => {
    for (const { channel, position, parentId, lock } of plan) {
      q.moveChannel.run(position, parentId, channel.id);
      if (lock && parentId) writeOverwrites(channel.id, overwritesOf(parentId));
    }
  })();
  for (const { channel, parentId } of plan) {
    if ((channel.parent_id ?? null) !== parentId) {
      audit(guild.id, req.user.id, AUDIT.CHANNEL_UPDATE, { target: channel.id, changes: diff(channel, { parent_id: parentId }, ['parent_id']) });
    }
  }
  syncChannels(guild.id, plan.map((p) => p.channel.id));
  res.status(204).end();
});

// Canal de servidor que o usuário vê, com as permissões dele no canal.
function loadGuildChannel(req) {
  const channel = loadChannel(req);
  if (!channel.guild_id) fail(400, 'Não é possível editar uma mensagem direta.');
  req.params.guildId = channel.guild_id;
  const { guild } = loadGuild(req);
  return { channel, guild, perms: channelPermissionsOf(channel, req.user.id) };
}

api.patch('/channels/:channelId', (req, res) => {
  if (q.channel.get(req.params.channelId)?.type === CHANNEL_THREAD) return updateThread(req, res);
  if (q.channel.get(req.params.channelId)?.type === CHANNEL_GROUP_DM) {
    const group = loadGroup(req);
    const name = String(req.body?.name ?? '').trim();
    if (name.length > 100) fail(400, 'O nome do grupo pode ter no máximo 100 caracteres.');
    if (name === (group.name ?? '')) return res.json(buildDmChannel(group, req.user.id));
    q.updateChannel.run(name, group.topic ?? '', group.id);
    dispatchDmChannel(group.id, 'CHANNEL_UPDATE');
    postMessage(q.channel.get(group.id), req.user, { type: MSG.CHANNEL_NAME_CHANGE, content: name, meta: { name } });
    return res.json(buildDmChannel(q.channel.get(group.id), req.user.id));
  }
  const { channel, guild, perms } = loadGuildChannel(req);
  const body = req.body ?? {};
  const { permission_overwrites: rawOverwrites, ...fields } = body;
  // Editar o canal exige Gerenciar canais; os overwrites, Gerenciar permissões (MANAGE_ROLES no canal).
  if (Object.keys(fields).length && !has(perms, P.MANAGE_CHANNELS)) fail(403, 'Você não tem permissão para fazer isso.');
  if (rawOverwrites !== undefined && !has(perms, P.MANAGE_ROLES)) fail(403, 'Você não tem permissão para alterar as permissões deste canal.');

  const isText = channel.type === CHANNEL_TEXT;
  const next = {
    ...channel,
    name: fields.name === undefined ? channel.name : channelName(fields.name, channel.type),
    topic: isText && fields.topic !== undefined ? String(fields.topic ?? '') : channel.topic,
    nsfw: channel.type !== CHANNEL_CATEGORY && fields.nsfw !== undefined ? (fields.nsfw ? 1 : 0) : channel.nsfw,
    rate_limit_per_user: isText && fields.rate_limit_per_user !== undefined ? slowmode(fields.rate_limit_per_user) : channel.rate_limit_per_user,
  };
  if (next.topic.length > 1024) fail(400, 'O tópico pode ter no máximo 1024 caracteres.');

  const before = overwritesOf(channel.id);
  const after = rawOverwrites === undefined ? before : parseOverwrites(rawOverwrites, guild);
  checkOverwriteGrant(perms, before, after);
  // Editar a categoria leva junto os canais que estavam sincronizados com ela.
  const synced = channel.type === CHANNEL_CATEGORY && rawOverwrites !== undefined
    ? q.channelsOf.all(guild.id).filter((c) => c.parent_id === channel.id && sameOverwrites(overwritesOf(c.id), before))
    : [];

  db.transaction(() => {
    q.updateGuildChannel.run(next.name, next.topic, next.nsfw, next.rate_limit_per_user, channel.id);
    if (rawOverwrites !== undefined) {
      writeOverwrites(channel.id, after);
      for (const c of synced) writeOverwrites(c.id, after);
    }
  })();
  const changes = diff(auditChannel(channel), auditChannel(next), CHANNEL_AUDIT_KEYS);
  if (changes.length) audit(guild.id, req.user.id, AUDIT.CHANNEL_UPDATE, { target: channel.id, changes });
  if (rawOverwrites !== undefined) auditOverwrites(guild, req.user.id, channel.id, before, after);
  syncChannels(guild.id, [channel.id, ...synced.map((c) => c.id)]);
  res.json(toChannel(q.channel.get(channel.id)));
});

api.delete('/channels/:channelId', (req, res) => {
  if (q.channel.get(req.params.channelId)?.type === CHANNEL_THREAD) return deleteThread(req, res);
  if (q.channel.get(req.params.channelId)?.type === CHANNEL_GROUP_DM) {
    removeFromGroup(loadGroup(req), req.user, req.user.id);
    return res.status(204).end();
  }
  const { channel, guild, perms } = loadGuildChannel(req);
  if (!has(perms, P.MANAGE_CHANNELS)) fail(403, 'Você não tem permissão para fazer isso.');
  // Excluir uma categoria não exclui os canais: eles ficam sem categoria.
  const children = q.channelsOf.all(guild.id).filter((c) => c.parent_id === channel.id).map((c) => c.id);
  disconnectVoice((v) => v.channel_id === channel.id);
  db.transaction(() => {
    q.deleteThreadsOf.run(channel.id); // as conversas do canal vão junto
    q.orphanChildren.run(channel.id);
    q.clearSystemChannel.run(channel.id);
    q.deleteChannel.run(channel.id);
  })();
  if (guild.system_channel_id === channel.id) dispatchToGuild(guild.id, 'GUILD_UPDATE', guildFields(q.guild.get(guild.id)));
  audit(guild.id, req.user.id, AUDIT.CHANNEL_DELETE, { target: channel.id, changes: diff(auditChannel(channel), {}, ['name', 'type', 'nsfw']) });
  syncChannels(guild.id, children);
  res.status(204).end();
});

// --- conversas (threads públicas, tipo 11) ---

// Durações de arquivamento automático do Discord, em minutos: 1 hora, 24 horas, 3 dias e 1 semana.
const ARCHIVE_DURATIONS = [60, 1440, 4320, 10080];
const THREAD_AUDIT_KEYS = ['name', 'archived', 'locked', 'auto_archive_duration'];

// O clone não tem os bits de 64 bits do Discord (CREATE_PUBLIC_THREADS, MANAGE_THREADS…): criar e
// falar em conversas segue "Enviar mensagens"; gerenciá-las, "Gerenciar mensagens" ou "Gerenciar canais".
const canManageThreads = (perms) => has(perms, P.MANAGE_MESSAGES) || has(perms, P.MANAGE_CHANNELS);

const auditThread = (t) => ({ ...t, archived: !!t.archived, locked: !!t.locked });

function threadName(raw) {
  const name = String(raw ?? '').trim();
  if (name.length < 1 || name.length > 100) fail(400, 'Nome da conversa: 1 a 100 caracteres.');
  return name;
}

function archiveDuration(raw) {
  if (raw === undefined) return 1440;
  const value = Number(raw);
  if (!ARCHIVE_DURATIONS.includes(value)) fail(400, 'Duração de arquivamento inválida.');
  return value;
}

function addThreadMember(thread, userId) {
  if (q.threadMember.get(thread.id, userId)) return false;
  q.addThreadMember.run(thread.id, userId, now());
  return true;
}

// Canal de texto em que a conversa nasce, com as permissões de quem cria.
function loadThreadParent(req) {
  const parent = loadChannel(req);
  if (parent.type !== CHANNEL_TEXT) fail(400, 'Só é possível criar conversas em canais de texto de servidor.');
  const perms = channelPermissionsOf(parent, req.user.id);
  if (!has(perms, P.SEND_MESSAGES)) fail(403, 'Você não tem permissão para criar conversas neste canal.');
  return parent;
}

function createThread(req, parent, id, starter) {
  const name = threadName(req.body?.name);
  const duration = archiveDuration(req.body?.auto_archive_duration);
  db.transaction(() => {
    q.insertThread.run(id, parent.guild_id, name, parent.id, req.user.id, duration, now());
    addThreadMember({ id }, req.user.id);
  })();
  const thread = q.channel.get(id);
  audit(parent.guild_id, req.user.id, AUDIT.THREAD_CREATE, { target: id, changes: diff({}, auditThread(thread), THREAD_AUDIT_KEYS).filter((c) => c.new_value) });
  syncChannels(parent.guild_id, [id]);
  // A primeira mensagem da conversa mostra a mensagem de origem (tipo 21); sem origem, o canal
  // ganha o aviso "Fulano iniciou uma conversa" (tipo 18).
  if (starter) postMessage(thread, req.user, { type: MSG.THREAD_STARTER_MESSAGE, reference_id: starter.id });
  else postMessage(parent, req.user, { type: MSG.THREAD_CREATED, content: name, meta: { thread_id: id } });
  return toThread(q.channel.get(id));
}

// A partir de uma mensagem: a conversa tem o mesmo id da mensagem, como no Discord.
api.post('/channels/:channelId/messages/:messageId/threads', (req, res) => {
  const parent = loadThreadParent(req);
  const message = loadMessage(req, parent);
  if (!isUserMessage(message)) fail(400, 'Não é possível criar uma conversa a partir desta mensagem.');
  if (q.channel.get(message.id)) fail(400, 'Já existe uma conversa para esta mensagem.');
  res.status(201).json(createThread(req, parent, message.id, message));
});

api.post('/channels/:channelId/threads', (req, res) => {
  const parent = loadThreadParent(req);
  res.status(201).json(createThread(req, parent, snowflake(), null));
});

// Conversa que o usuário vê, com as permissões dele no canal de origem.
function loadThread(req) {
  const thread = loadChannel(req);
  if (thread.type !== CHANNEL_THREAD) fail(404, 'Conversa não encontrada.');
  return { thread, perms: channelPermissionsOf(thread, req.user.id) };
}

// Renomear, arquivar e mudar o arquivamento: quem criou ou quem gerencia. Bloquear: só quem gerencia.
function updateThread(req, res) {
  const { thread, perms } = loadThread(req);
  const manager = canManageThreads(perms);
  if (thread.owner_id !== req.user.id && !manager) fail(403, 'Você não tem permissão para editar esta conversa.');
  const body = req.body ?? {};
  if (body.locked !== undefined && !manager) fail(403, 'Só quem gerencia mensagens pode bloquear conversas.');
  if (thread.locked && !manager) fail(403, 'Esta conversa está bloqueada.');

  const next = {
    ...thread,
    name: body.name === undefined ? thread.name : threadName(body.name),
    archived: body.archived === undefined ? thread.archived : body.archived ? 1 : 0,
    locked: body.locked === undefined ? thread.locked : body.locked ? 1 : 0,
    auto_archive_duration: body.auto_archive_duration === undefined ? thread.auto_archive_duration : archiveDuration(body.auto_archive_duration),
  };
  if (next.archived !== thread.archived) next.archive_timestamp = now();
  q.updateThread.run(next.name, next.archived, next.locked, next.auto_archive_duration, next.archive_timestamp, thread.id);
  const changes = diff(auditThread(thread), auditThread(next), THREAD_AUDIT_KEYS);
  if (changes.length) audit(thread.guild_id, req.user.id, AUDIT.THREAD_UPDATE, { target: thread.id, changes });
  syncChannels(thread.guild_id, [thread.id]);
  res.json(toThread(q.channel.get(thread.id)));
}

function deleteThread(req, res) {
  const { thread, perms } = loadThread(req);
  if (!canManageThreads(perms)) fail(403, 'Você não tem permissão para excluir esta conversa.');
  q.deleteChannel.run(thread.id);
  audit(thread.guild_id, req.user.id, AUDIT.THREAD_DELETE, { target: thread.id, changes: diff(auditThread(thread), {}, ['name']) });
  syncChannels(thread.guild_id);
  res.status(204).end();
}

// Entrar e sair da conversa (quem participa a vê na barra lateral).
api.put('/channels/:channelId/thread-members/@me', (req, res) => {
  const { thread } = loadThread(req);
  if (addThreadMember(thread, req.user.id)) syncChannels(thread.guild_id, [thread.id]);
  res.status(204).end();
});

api.delete('/channels/:channelId/thread-members/@me', (req, res) => {
  const { thread } = loadThread(req);
  q.removeThreadMember.run(thread.id, req.user.id);
  syncChannels(thread.guild_id, [thread.id]);
  res.status(204).end();
});

// Arquivamento automático: conversa sem mensagens novas pelo tempo escolhido vai para "arquivadas".
function archiveIdleThreads() {
  for (const t of q.activeThreads.all()) {
    const lastActivity = Math.max(
      t.last_message_id ? Date.parse(timestampOf(t.last_message_id)) : 0,
      t.archive_timestamp ? Date.parse(t.archive_timestamp) : 0,
    );
    if (Date.now() - lastActivity < (t.auto_archive_duration ?? 1440) * 60_000) continue;
    q.updateThread.run(t.name, 1, t.locked, t.auto_archive_duration, now(), t.id);
    syncChannels(t.guild_id, [t.id]);
  }
}
setInterval(archiveIdleThreads, 60_000).unref();

// --- cargos ---

function broadcastRoles(guildId) {
  dispatchToGuild(guildId, 'GUILD_ROLES_UPDATE', { guild_id: guildId, roles: q.roles.all(guildId).map(toRole) });
}

// Renumera as posições (0 = @everyone) depois de criar, mover ou excluir cargos.
function normalizeRolePositions(guildId) {
  q.roles.all(guildId).forEach((role, index) => q.setRolePosition.run(index, role.id));
}

function editableRole(req, guild) {
  const role = q.role.get(req.params.roleId);
  if (!role || role.guild_id !== guild.id) fail(404, 'Cargo não encontrado.');
  if (role.id !== guild.id && role.position >= rankOf(guild, req.user.id)) {
    fail(403, 'Você só pode editar cargos abaixo do seu cargo mais alto.');
  }
  return role;
}

// Quem não é administrador não pode conceder permissões que não tem.
function checkGrantable(perms, before, after) {
  if (has(perms, P.ADMINISTRATOR)) return;
  if ((after & ~before) & ~perms) fail(403, 'Você não pode conceder permissões que não possui.');
}

const ROLE_AUDIT_KEYS = ['name', 'color', 'permissions', 'hoist'];
const auditRole = (r) => ({ ...r, hoist: !!r.hoist });

api.post('/guilds/:guildId/roles', (req, res) => {
  const { guild, perms } = loadGuild(req, P.MANAGE_ROLES);
  const permissions = Number(req.body?.permissions ?? 0) & ALL_PERMISSIONS;
  checkGrantable(perms, 0, permissions);
  const name = String(req.body?.name ?? 'novo cargo').trim().slice(0, 100) || 'novo cargo';

  const id = snowflake();
  db.transaction(() => {
    q.shiftRolesUp.run(guild.id, 1);
    q.insertRole.run(id, guild.id, name, null, permissions, 1, 0);
  })();
  const role = q.role.get(id);
  audit(guild.id, req.user.id, AUDIT.ROLE_CREATE, { target: id, changes: diff({}, auditRole(role), ROLE_AUDIT_KEYS).filter((c) => c.new_value) });
  broadcastRoles(guild.id);
  res.status(201).json(toRole(role));
});

api.patch('/guilds/:guildId/roles/:roleId', (req, res) => {
  const { guild, perms } = loadGuild(req, P.MANAGE_ROLES);
  const role = editableRole(req, guild);
  const body = req.body ?? {};

  const name = role.id === guild.id || body.name === undefined ? role.name : String(body.name).trim();
  if (name.length < 1 || name.length > 100) fail(400, 'Nome do cargo: 1 a 100 caracteres.');
  const color = body.color === undefined ? role.color : body.color;
  if (color !== null && !HEX_COLOR.test(color)) fail(400, 'Cor inválida.');
  const permissions = body.permissions === undefined ? role.permissions : Number(body.permissions) & ALL_PERMISSIONS;
  checkGrantable(perms, role.permissions, permissions);
  const hoist = body.hoist === undefined ? role.hoist : body.hoist ? 1 : 0;

  q.updateRole.run(name, color, permissions, role.id === guild.id ? 0 : hoist, role.id);
  const updated = q.role.get(role.id);
  const changes = diff(auditRole(role), auditRole(updated), ROLE_AUDIT_KEYS);
  if (changes.length) audit(guild.id, req.user.id, AUDIT.ROLE_UPDATE, { target: role.id, changes });
  broadcastRoles(guild.id);
  if (updated.permissions !== role.permissions) syncChannels(guild.id);
  res.json(toRole(updated));
});

// Corpo: [{ id, position }] para os cargos movidos (as demais posições se ajustam).
api.patch('/guilds/:guildId/roles', (req, res) => {
  const { guild } = loadGuild(req, P.MANAGE_ROLES);
  const moves = Array.isArray(req.body) ? req.body : fail(400, 'Formato inválido.');
  const rank = rankOf(guild, req.user.id);
  const roles = q.roles.all(guild.id);

  for (const { id, position } of moves) {
    const role = roles.find((r) => r.id === id);
    if (!role || role.id === guild.id) fail(400, 'Cargo inválido.');
    if (!Number.isInteger(position) || position < 1) fail(400, 'Posição inválida.');
    if (role.position >= rank || position >= rank) fail(403, 'Você só pode mover cargos abaixo do seu cargo mais alto.');
  }
  db.transaction(() => {
    for (const { id, position } of moves) q.setRolePosition.run(position, id);
    normalizeRolePositions(guild.id);
  })();
  broadcastRoles(guild.id);
  res.json(q.roles.all(guild.id).map(toRole));
});

api.delete('/guilds/:guildId/roles/:roleId', (req, res) => {
  const { guild } = loadGuild(req, P.MANAGE_ROLES);
  const role = editableRole(req, guild);
  if (role.id === guild.id) fail(400, 'O cargo @everyone não pode ser excluído.');

  const holders = q.usersWithRole.all(role.id).map((r) => r.user_id);
  const channelsWithOverwrite = q.guildOverwrites.all(guild.id).filter((o) => o.target_id === role.id).map((o) => o.channel_id);
  db.transaction(() => {
    q.deleteRole.run(role.id);
    q.deleteOverwritesFor.run(role.id, guild.id);
    normalizeRolePositions(guild.id);
  })();
  audit(guild.id, req.user.id, AUDIT.ROLE_DELETE, { target: role.id, changes: diff(auditRole(role), {}, ROLE_AUDIT_KEYS) });
  broadcastRoles(guild.id);
  for (const userId of holders) dispatchMemberUpdate(guild.id, userId);
  syncChannels(guild.id, channelsWithOverwrite);
  res.status(204).end();
});

// --- membros, apelidos, expulsões e banimentos ---

function dispatchMemberUpdate(guildId, userId) {
  dispatchToGuild(guildId, 'GUILD_MEMBER_UPDATE', { guild_id: guildId, ...buildMember(guildId, q.userById.get(userId)) });
}

function loadTargetMember(req, guild) {
  const userId = req.params.userId === '@me' ? req.user.id : req.params.userId;
  if (!q.member.get(guild.id, userId)) fail(404, 'Membro não encontrado.');
  return userId;
}

// Expulsar/banir exige estar acima do alvo na hierarquia; o dono nunca é alvo.
function checkOutranks(req, guild, targetId) {
  if (targetId === req.user.id) fail(400, 'Você não pode fazer isso consigo mesmo.');
  if (targetId === guild.owner_id || rankOf(guild, targetId) >= rankOf(guild, req.user.id)) {
    fail(403, 'Este membro tem um cargo igual ou superior ao seu.');
  }
}

// Apelido (nick) e cargos. O próprio apelido exige Alterar apelido; o dos outros, Gerenciar apelidos
// e estar acima na hierarquia. /members/@me altera o próprio, como no Discord.
api.patch('/guilds/:guildId/members/:userId', (req, res) => {
  const { guild, perms } = loadGuild(req);
  const userId = loadTargetMember(req, guild);
  const body = req.body ?? {};
  if (body.nick === undefined && body.roles === undefined) fail(400, 'Nada para alterar.');

  let nick;
  if (body.nick !== undefined) {
    if (userId === req.user.id) {
      if (!has(perms, P.CHANGE_NICKNAME) && !has(perms, P.MANAGE_NICKNAMES)) fail(403, 'Você não tem permissão para alterar seu apelido.');
    } else {
      if (!has(perms, P.MANAGE_NICKNAMES)) fail(403, 'Você não tem permissão para alterar apelidos.');
      checkOutranks(req, guild, userId);
    }
    nick = String(body.nick ?? '').trim();
    if (nick.length > 32) fail(400, 'O apelido pode ter no máximo 32 caracteres.');
    nick ||= null;
  }

  let added = [];
  let removed = [];
  if (body.roles !== undefined) {
    if (!has(perms, P.MANAGE_ROLES)) fail(403, 'Você não tem permissão para fazer isso.');
    const wanted = Array.isArray(body.roles) ? [...new Set(body.roles.map(String))] : fail(400, 'Informe os cargos.');
    const roles = q.roles.all(guild.id);
    const current = q.memberRoles.all(guild.id, userId).map((r) => r.role_id);
    const rank = rankOf(guild, req.user.id);
    added = wanted.filter((id) => !current.includes(id));
    removed = current.filter((id) => !wanted.includes(id));
    for (const id of [...added, ...removed]) {
      const role = roles.find((r) => r.id === id);
      if (!role || role.id === guild.id) fail(400, 'Cargo inválido.');
      if (role.position >= rank) fail(403, 'Você só pode atribuir cargos abaixo do seu cargo mais alto.');
    }
  }

  const before = q.member.get(guild.id, userId);
  db.transaction(() => {
    if (nick !== undefined) q.setNick.run(nick, guild.id, userId);
    for (const id of added) q.addMemberRole.run(guild.id, userId, id);
    for (const id of removed) q.removeMemberRole.run(guild.id, userId, id);
  })();

  if (nick !== undefined && nick !== (before.nick ?? null)) {
    audit(guild.id, req.user.id, AUDIT.MEMBER_UPDATE, { target: userId, changes: diff(before, { nick }, ['nick']) });
  }
  if (added.length || removed.length) {
    const named = (ids) => ids.map((id) => ({ id, name: q.role.get(id).name }));
    const changes = [added.length && { key: '$add', new_value: named(added) }, removed.length && { key: '$remove', new_value: named(removed) }].filter(Boolean);
    audit(guild.id, req.user.id, AUDIT.MEMBER_ROLE_UPDATE, { target: userId, changes });
  }
  dispatchMemberUpdate(guild.id, userId);
  if (added.length || removed.length) syncChannels(guild.id);
  res.json(buildMember(guild.id, q.userById.get(userId)));
});

api.delete('/guilds/:guildId/members/:userId', (req, res) => {
  const { guild } = loadGuild(req, P.KICK_MEMBERS);
  const userId = loadTargetMember(req, guild);
  checkOutranks(req, guild, userId);
  removeMember(guild, userId);
  audit(guild.id, req.user.id, AUDIT.MEMBER_KICK, { target: userId, reason: String(req.body?.reason ?? '').slice(0, 512) });
  res.status(204).end();
});

api.get('/guilds/:guildId/bans', (req, res) => {
  const { guild } = loadGuild(req, P.BAN_MEMBERS);
  res.json(q.bansOf.all(guild.id).map((b) => ({ user: publicUser(b, b.user_id), reason: b.reason, created_at: b.created_at })));
});

api.put('/guilds/:guildId/bans/:userId', (req, res) => {
  const { guild } = loadGuild(req, P.BAN_MEMBERS);
  const target = q.userById.get(req.params.userId);
  if (!target) fail(404, 'Usuário não encontrado.');
  checkOutranks(req, guild, target.id);

  const reason = String(req.body?.reason ?? '').slice(0, 512);
  q.insertBan.run(guild.id, target.id, reason, now());
  if (q.member.get(guild.id, target.id)) removeMember(guild, target.id);
  audit(guild.id, req.user.id, AUDIT.MEMBER_BAN_ADD, { target: target.id, reason });
  res.status(204).end();
});

api.delete('/guilds/:guildId/bans/:userId', (req, res) => {
  const { guild } = loadGuild(req, P.BAN_MEMBERS);
  if (!q.ban.get(guild.id, req.params.userId)) fail(404, 'Banimento não encontrado.');
  q.deleteBan.run(guild.id, req.params.userId);
  audit(guild.id, req.user.id, AUDIT.MEMBER_BAN_REMOVE, { target: req.params.userId });
  res.status(204).end();
});

// --- convites ---

api.post('/guilds/:guildId/invites', (req, res) => {
  const { guild } = loadGuild(req, P.CREATE_INSTANT_INVITE);
  const code = randomBytes(6).toString('base64url');
  q.insertInvite.run(code, guild.id, req.user.id, now());
  audit(guild.id, req.user.id, AUDIT.INVITE_CREATE, { changes: [{ key: 'code', new_value: code }] });
  res.status(201).json({ code, guild_id: guild.id });
});

api.get('/guilds/:guildId/invites', (req, res) => {
  const { guild } = loadGuild(req, P.MANAGE_GUILD);
  res.json(q.invitesOf.all(guild.id).map((i) => ({
    code: i.code, uses: i.uses, created_at: i.created_at, inviter: publicUser(i, i.creator_id),
  })));
});

api.delete('/invites/:code', (req, res) => {
  const invite = q.invite.get(req.params.code);
  if (!invite) fail(404, 'Convite inválido.');
  req.params.guildId = invite.guild_id;
  const { perms } = loadGuild(req);
  if (invite.creator_id !== req.user.id && !has(perms, P.MANAGE_GUILD)) fail(403, 'Você não tem permissão para fazer isso.');
  q.deleteInvite.run(invite.code);
  audit(invite.guild_id, req.user.id, AUDIT.INVITE_DELETE, { changes: [{ key: 'code', old_value: invite.code }] });
  res.status(204).end();
});

api.post('/invites/:code', (req, res) => {
  // Aceita o código puro ou um link colado (…/convite/CODIGO).
  const code = req.params.code.split('/').pop();
  const invite = q.invite.get(code);
  if (!invite) fail(404, 'O convite é inválido ou expirou.');
  if (q.ban.get(invite.guild_id, req.user.id)) fail(403, 'Você está banido deste servidor.');

  const joined = !q.member.get(invite.guild_id, req.user.id);
  if (joined) {
    const joined_at = now();
    q.insertMember.run(invite.guild_id, req.user.id, joined_at);
    q.useInvite.run(invite.code);
    dispatchToGuild(invite.guild_id, 'GUILD_MEMBER_ADD', {
      guild_id: invite.guild_id,
      user: publicUser(req.user),
      nick: null,
      roles: [],
      joined_at,
      status: statusOf(req.user.id),
    });
    broadcastPresence(req.user.id);
  }
  const guild = sendGuild(req.user.id, invite.guild_id);
  // Mensagem de boas-vindas no canal de mensagens do sistema (tipo 7 do Discord).
  const row = q.guild.get(invite.guild_id);
  const systemChannel = row.system_channel_id && q.channel.get(row.system_channel_id);
  if (joined && systemChannel && !(row.system_channel_flags & SUPPRESS_JOIN_NOTIFICATIONS)) {
    postMessage(systemChannel, req.user, { type: MSG.USER_JOIN });
  }
  res.json(guild);
});

// --- digitando ---

// Permissão no canal (DMs e grupos: tudo liberado para os participantes).
const can = (req, channel, flag) => !channel.guild_id || has(channelPermissionsOf(channel, req.user.id), flag);
const canSendIn = (req, channel) => can(req, channel, P.SEND_MESSAGES);

function isBlockedDm(req, channel) {
  if (channel.type !== CHANNEL_DM) return false;
  const other = dmRecipientIds(channel.id).find((id) => id !== req.user.id);
  return q.relationship.get(req.user.id, other)?.type === REL.BLOCKED || q.relationship.get(other, req.user.id)?.type === REL.BLOCKED;
}

// Como no Discord: o cliente avisa a cada ~8 s enquanto digita e o aviso vale 10 s.
api.post('/channels/:channelId/typing', (req, res) => {
  const channel = loadMessageChannel(req);
  if (!canSendIn(req, channel)) fail(403, 'Você não tem permissão para enviar mensagens neste canal.');
  if (!isBlockedDm(req, channel)) {
    dispatchToChannel(channel, 'TYPING_START', {
      channel_id: channel.id, guild_id: channel.guild_id, user_id: req.user.id, timestamp: Math.floor(Date.now() / 1000),
    });
  }
  res.status(204).end();
});

// --- anexos ---

// Nome de arquivo como o Discord grava: espaços e símbolos viram "_".
function safeFilename(raw) {
  const name = String(raw ?? '').normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '').slice(-100);
  return name || 'arquivo';
}

const uploadDir = (key) => path.join(ATTACHMENTS_DIR, key);
const removeUpload = (a) => rmSync(uploadDir(a.upload_key), { recursive: true, force: true });

// Uploads que nunca viraram mensagem (aba fechada no meio do envio) somem depois de um dia.
for (const a of q.staleUploads.all(new Date(Date.now() - 86_400_000).toISOString())) {
  removeUpload(a);
  q.deleteAttachment.run(a.id);
}

// Passo 1: reserva os uploads e devolve para onde enviar cada arquivo (mesmo fluxo do Discord).
api.post('/channels/:channelId/attachments', (req, res) => {
  const channel = loadMessageChannel(req);
  if (!canSendIn(req, channel)) fail(403, 'Você não tem permissão para enviar mensagens neste canal.');
  if (!can(req, channel, P.ATTACH_FILES)) fail(403, 'Você não tem permissão para enviar arquivos neste canal.');
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  if (!files.length) fail(400, 'Nenhum arquivo.');
  if (files.length > MAX_ATTACHMENTS) fail(400, `Você só pode enviar até ${MAX_ATTACHMENTS} arquivos de uma vez.`);
  const created = now();
  const attachments = files.map((f) => {
    const size = Number(f?.file_size);
    if (!Number.isInteger(size) || size < 0) fail(400, 'Tamanho de arquivo inválido.');
    if (size > MAX_FILE_SIZE) fail(413, 'O tamanho máximo de arquivo é 10 MB.');
    const key = randomBytes(16).toString('hex');
    const filename = safeFilename(f.filename);
    q.insertAttachment.run(snowflake(), channel.id, req.user.id, key, filename, size, created);
    return { id: f.id ?? null, upload_url: `/api/uploads/${key}`, upload_filename: `${key}/${filename}` };
  });
  res.json({ attachments });
});

// Passo 2: PUT no upload_url com o arquivo no corpo.
api.put('/uploads/:key', express.raw({ type: () => true, limit: MAX_FILE_SIZE }), (req, res) => {
  const a = q.attachmentByKey.get(req.params.key);
  if (!a || a.uploader_id !== req.user.id || a.message_id) fail(404, 'Upload não encontrado.');
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const type = String(req.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  mkdirSync(uploadDir(a.upload_key), { recursive: true });
  writeFileSync(path.join(uploadDir(a.upload_key), 'file'), body); // o nome vai só no banco (pode mudar, ex.: SPOILER_)
  q.markUploaded.run(body.length, CONTENT_TYPE.test(type) ? type : 'application/octet-stream', a.id);
  res.status(204).end();
});

// Passo 3: a mensagem cita os uploads ({ filename, uploaded_filename, width, height }).
function claimAttachments(req, channel) {
  const list = req.body?.attachments;
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > MAX_ATTACHMENTS) fail(400, `Você só pode enviar até ${MAX_ATTACHMENTS} arquivos de uma vez.`);
  const dimension = (v) => (Number.isInteger(v) && v > 0 && v <= 65535 ? v : null);
  return list.map((item, position) => {
    const a = q.attachmentByKey.get(String(item?.uploaded_filename ?? '').split('/')[0]);
    if (!a || a.uploader_id !== req.user.id || a.channel_id !== channel.id || a.message_id || !a.uploaded) {
      fail(400, 'Anexo inválido ou ainda não enviado.');
    }
    const visual = /^(image|video)\//.test(a.content_type ?? '');
    return {
      row: a,
      // Pode renomear no envio (ex.: o prefixo SPOILER_).
      filename: item.filename ? safeFilename(item.filename) : a.filename,
      width: visual ? dimension(item.width) : null,
      height: visual ? dimension(item.height) : null,
      position,
    };
  });
}

// --- mensagens ---

api.get('/channels/:channelId/messages', (req, res) => {
  const channel = loadMessageChannel(req);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const before = typeof req.query.before === 'string' ? req.query.before : null;
  res.json(loadMessages(q.messagesBefore.all({ channel: channel.id, before, limit })));
});

// --- pesquisa (mesmos parâmetros de GET /guilds/:id/messages/search do Discord) ---

const SEARCH_PAGE = 25;
const LINK = /https?:\/\/\S/i;
const ATTACHMENT_KIND = { image: /^image\//, video: /^video\//, sound: /^audio\// };
const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const listParam = (value) => (value === undefined ? [] : [value].flat().map(String));

// Termos da pesquisa: palavras soltas ou "frases entre aspas"; todos precisam aparecer.
const searchTerms = (content) => [...fold(content).matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);

function runSearch(req, res, channelIds) {
  const query = req.query;
  const wantedChannels = listParam(query.channel_id);
  const channels = wantedChannels.length ? channelIds.filter((id) => wantedChannels.includes(id)) : channelIds;
  const kinds = listParam(query.has);
  if (kinds.some((h) => !['link', 'file', 'image', 'video', 'sound'].includes(h))) fail(400, 'Filtro "tem:" inválido.');
  const terms = searchTerms(String(query.content ?? '')).slice(0, 20);
  const mentionIds = listParam(query.mentions);
  const mentionNames = mentionIds.map((id) => q.userById.get(id)?.username.toLowerCase()).filter(Boolean);
  const offset = Math.min(Math.max(parseInt(query.offset, 10) || 0, 0), 5000);

  let rows = q.searchMessages.all({
    channels,
    authors: listParam(query.author_id),
    pinned: query.pinned === undefined ? null : query.pinned === 'true',
    minId: typeof query.min_id === 'string' ? query.min_id : null,
    maxId: typeof query.max_id === 'string' ? query.max_id : null,
  });

  if (kinds.some((h) => h !== 'link') && rows.length) {
    const files = new Map(); // messageId -> [content_type]
    const marks = channels.map(() => '?').join(',');
    for (const a of db.prepare(`SELECT message_id, content_type FROM attachments WHERE message_id IS NOT NULL AND channel_id IN (${marks})`).all(...channels)) {
      if (!files.has(a.message_id)) files.set(a.message_id, []);
      files.get(a.message_id).push(a.content_type ?? '');
    }
    rows = rows.filter((m) => kinds.every((h) => h === 'link' || (h === 'file' ? files.has(m.id) : (files.get(m.id) ?? []).some((t) => ATTACHMENT_KIND[h].test(t)))));
  }
  if (kinds.includes('link')) rows = rows.filter((m) => LINK.test(m.content));
  if (terms.length) rows = rows.filter((m) => {
    const text = fold(m.content);
    return terms.every((t) => text.includes(t));
  });
  if (mentionNames.length) rows = rows.filter((m) => {
    const words = m.content.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\w.@]/g, ''));
    const replied = m.reference_id && m.reply_ping ? q.message.get(m.reference_id)?.author_id : null;
    return mentionNames.every((name, i) => words.includes(`@${name}`) || replied === mentionIds[i]);
  });
  if (query.sort_order === 'asc') rows.reverse();

  res.json({ total_results: rows.length, messages: loadMessages(rows.slice(offset, offset + SEARCH_PAGE)).map((m) => [m]) });
}

// Servidor: canais de texto e conversas que o usuário vê (NSFW só com include_nsfw, como no Discord).
api.get('/guilds/:guildId/messages/search', (req, res) => {
  const { guild } = loadGuild(req);
  const all = q.channelsOf.all(guild.id);
  const byId = new Map(all.map((c) => [c.id, c]));
  const includeNsfw = req.query.include_nsfw === 'true';
  const ids = all.filter((c) => {
    if (c.type !== CHANNEL_TEXT && c.type !== CHANNEL_THREAD) return false;
    const base = c.type === CHANNEL_THREAD ? byId.get(c.parent_id) : c;
    if (!base || (base.nsfw && !includeNsfw)) return false;
    return has(channelPermissionsOf(c, req.user.id), P.VIEW_CHANNEL);
  }).map((c) => c.id);
  runSearch(req, res, ids);
});

// DM ou grupo (e qualquer canal que o usuário veja).
api.get('/channels/:channelId/messages/search', (req, res) => {
  const channel = loadMessageChannel(req);
  runSearch(req, res, [channel.id]);
});

// Grava e distribui uma mensagem (normal, resposta ou de sistema) no canal.
function postMessage(channel, author, {
  content = '', type = MSG.DEFAULT, reference_id = null, reply_ping = false, meta = null, attachments = [], mention_everyone = false,
}) {
  const id = snowflake();
  db.transaction(() => {
    q.insertMessage.run(id, channel.id, author.id, content, type, reference_id, reply_ping ? 1 : 0, meta && JSON.stringify(meta), mention_everyone ? 1 : 0);
    for (const a of attachments) q.linkAttachment.run(id, a.filename, a.width, a.height, a.position, a.row.id);
    q.touchChannel.run(id, channel.id);
  })();
  // Primeira mensagem de uma DM: o outro lado ainda não conhece o canal.
  if (!channel.guild_id && !channel.last_message_id) dispatchDmChannel(channel.id, 'CHANNEL_CREATE');

  const message = messagePayload(id);
  dispatchToChannel(channel, 'MESSAGE_CREATE', { ...message, guild_id: channel.guild_id });

  // Falar numa conversa: conta a mensagem, põe o autor como participante e desarquiva. O
  // THREAD_UPDATE vai depois do MESSAGE_CREATE (o cliente soma a mensagem ao recebê-la).
  if (channel.type === CHANNEL_THREAD && (type === MSG.DEFAULT || type === MSG.REPLY)) {
    q.bumpMessageCount.run(1, channel.id);
    const joined = addThreadMember(channel, author.id);
    if (channel.archived) q.updateThread.run(channel.name, 0, channel.locked, channel.auto_archive_duration, now(), channel.id);
    if (joined || channel.archived) syncChannels(channel.guild_id, [channel.id]);
  }
  return message;
}

// Em servidor, fixar exige Gerenciar mensagens; em DM e grupo, qualquer participante pode.
const canManageMessages = (req, channel) => can(req, channel, P.MANAGE_MESSAGES);

// Modo lento: último envio de cada membro por canal. Quem gerencia mensagens ou o canal não espera.
const lastSent = new Map(); // `${canal}:${usuário}` -> instante (ms)

function checkSlowmode(req, channel) {
  if (!channel.rate_limit_per_user) return;
  const perms = channelPermissionsOf(channel, req.user.id);
  if (has(perms, P.MANAGE_MESSAGES) || has(perms, P.MANAGE_CHANNELS)) return;
  const key = `${channel.id}:${req.user.id}`;
  const wait = (lastSent.get(key) ?? 0) + channel.rate_limit_per_user * 1000 - Date.now();
  if (wait > 0) fail(429, 'Calma! O modo lento está ativado neste canal.', { retry_after: Math.ceil(wait / 1000), code: 20016 });
  lastSent.set(key, Date.now());
}

const EVERYONE = /(^|[^\w.])@(everyone|here)(?![\w.])/i;

function loadMessage(req, channel) {
  const message = q.message.get(req.params.messageId);
  if (!message || message.channel_id !== channel.id) fail(404, 'Mensagem não encontrada.');
  return message;
}

const isUserMessage = (m) => m.type === MSG.DEFAULT || m.type === MSG.REPLY;

function dispatchMessageUpdate(channel, messageId) {
  dispatchToChannel(channel, 'MESSAGE_UPDATE', { ...messagePayload(messageId), guild_id: channel.guild_id });
}

api.post('/channels/:channelId/messages', (req, res) => {
  const channel = loadMessageChannel(req);
  const content = String(req.body?.content ?? '').trim();
  if (!canSendIn(req, channel)) fail(403, 'Você não tem permissão para fazer isso.');
  if (isBlockedDm(req, channel)) fail(403, 'Sua mensagem não pôde ser entregue. Isso acontece quando um dos dois bloqueou o outro.');
  if (channel.type === CHANNEL_THREAD && channel.locked && !canManageThreads(channelPermissionsOf(channel, req.user.id))) {
    fail(403, 'Esta conversa está bloqueada. Só quem gerencia mensagens pode falar nela.');
  }
  const attachments = claimAttachments(req, channel);
  if (content.length > 2000 || (!content && !attachments.length)) fail(400, 'A mensagem precisa ter de 1 a 2000 caracteres.');
  checkSlowmode(req, channel);

  // Resposta: message_reference + allowed_mentions.replied_user (menciona o autor), como no Discord.
  let reference = null;
  const referenceId = req.body?.message_reference?.message_id;
  if (referenceId) {
    reference = q.message.get(String(referenceId));
    if (!reference || reference.channel_id !== channel.id) fail(400, 'A mensagem respondida não existe neste canal.');
  }
  const message = postMessage(channel, req.user, {
    content,
    type: reference ? MSG.REPLY : MSG.DEFAULT,
    reference_id: reference?.id ?? null,
    reply_ping: reference ? req.body?.allowed_mentions?.replied_user !== false : false,
    attachments,
    // @everyone/@here só notificam se o autor tem a permissão no canal.
    mention_everyone: !!channel.guild_id && EVERYONE.test(content) && can(req, channel, P.MENTION_EVERYONE),
  });
  res.status(201).json(message);
});

api.patch('/channels/:channelId/messages/:messageId', (req, res) => {
  const channel = loadMessageChannel(req);
  const message = loadMessage(req, channel);
  if (message.author_id !== req.user.id || !isUserMessage(message)) fail(403, 'Você só pode editar suas próprias mensagens.');
  const content = String(req.body?.content ?? '').trim();
  const hasAttachments = q.attachmentsOfMessage.all(message.id).length > 0;
  if (content.length > 2000 || (!content && !hasAttachments)) fail(400, 'A mensagem precisa ter de 1 a 2000 caracteres.');

  if (content !== message.content) {
    q.editMessage.run(content, new Date().toISOString(), message.id);
    dispatchMessageUpdate(channel, message.id);
  }
  res.json(messagePayload(message.id));
});

api.delete('/channels/:channelId/messages/:messageId', (req, res) => {
  const channel = loadMessageChannel(req);
  const message = loadMessage(req, channel);
  if (message.author_id !== req.user.id && (!channel.guild_id || !canManageMessages(req, channel))) {
    fail(403, 'Você não tem permissão para fazer isso.');
  }

  const files = q.attachmentsOfMessage.all(message.id);
  q.deleteMessage.run(message.id);
  for (const a of files) removeUpload(a);
  if (channel.guild_id && message.author_id !== req.user.id) {
    audit(channel.guild_id, req.user.id, AUDIT.MESSAGE_DELETE, { target: message.author_id, options: { channel_id: channel.id, count: '1' } });
  }
  dispatchToChannel(channel, 'MESSAGE_DELETE', { id: message.id, channel_id: channel.id, guild_id: channel.guild_id });
  if (message.pinned_at) dispatchPinsUpdate(channel);
  if (channel.type === CHANNEL_THREAD && isUserMessage(message)) {
    q.bumpMessageCount.run(-1, channel.id);
    syncChannels(channel.guild_id, [channel.id]);
  }
  res.status(204).end();
});

// --- mensagens fixadas ---

function dispatchPinsUpdate(channel) {
  const last = q.pinsOf.all(channel.id)[0];
  dispatchToChannel(channel, 'CHANNEL_PINS_UPDATE', {
    channel_id: channel.id,
    guild_id: channel.guild_id,
    last_pin_timestamp: last?.pinned_at ?? null,
  });
}

api.get('/channels/:channelId/pins', (req, res) => {
  const channel = loadMessageChannel(req);
  res.json(loadMessages(q.pinsOf.all(channel.id)));
});

api.put('/channels/:channelId/pins/:messageId', (req, res) => {
  const channel = loadMessageChannel(req);
  const message = loadMessage(req, channel);
  if (!canManageMessages(req, channel)) fail(403, 'Você não tem permissão para fixar mensagens neste canal.');
  if (!isUserMessage(message)) fail(400, 'Esse tipo de mensagem não pode ser fixado.');
  if (message.pinned_at) return res.status(204).end();
  if (q.pinCount.get(channel.id).n >= MAX_PINS) fail(400, `Você atingiu o limite de ${MAX_PINS} mensagens fixadas neste canal.`);

  q.setPinned.run(new Date().toISOString(), message.id);
  if (channel.guild_id) {
    audit(channel.guild_id, req.user.id, AUDIT.MESSAGE_PIN, { target: message.author_id, options: { channel_id: channel.id, message_id: message.id } });
  }
  dispatchMessageUpdate(channel, message.id);
  dispatchPinsUpdate(channel);
  postMessage(channel, req.user, { type: MSG.CHANNEL_PINNED_MESSAGE, reference_id: message.id });
  res.status(204).end();
});

api.delete('/channels/:channelId/pins/:messageId', (req, res) => {
  const channel = loadMessageChannel(req);
  const message = loadMessage(req, channel);
  if (!canManageMessages(req, channel)) fail(403, 'Você não tem permissão para desafixar mensagens neste canal.');
  if (!message.pinned_at) return res.status(204).end();

  q.setPinned.run(null, message.id);
  if (channel.guild_id) {
    audit(channel.guild_id, req.user.id, AUDIT.MESSAGE_UNPIN, { target: message.author_id, options: { channel_id: channel.id, message_id: message.id } });
  }
  dispatchMessageUpdate(channel, message.id);
  dispatchPinsUpdate(channel);
  res.status(204).end();
});

// --- reações ---

function loadReaction(req) {
  const channel = loadMessageChannel(req);
  const message = loadMessage(req, channel);
  const emoji = req.params.emoji;
  if (emoji.length > 32 || !EMOJI.test(emoji)) fail(400, 'Emoji inválido.');
  return { channel, message, emoji };
}

api.put('/channels/:channelId/messages/:messageId/reactions/:emoji/@me', (req, res) => {
  const { channel, message, emoji } = loadReaction(req);
  const known = loadMessages([q.messageWithAuthor.get(message.id)])[0].reactions;
  // Sem "Adicionar reações" ainda dá para somar-se a uma reação que já existe, como no Discord.
  if (!known.some((r) => r.emoji === emoji) && !can(req, channel, P.ADD_REACTIONS)) fail(403, 'Você não tem permissão para adicionar reações.');
  if (!known.some((r) => r.emoji === emoji) && known.length >= MAX_REACTION_KINDS) {
    fail(400, `Uma mensagem pode ter no máximo ${MAX_REACTION_KINDS} reações diferentes.`);
  }
  q.addReaction.run(message.id, req.user.id, emoji, new Date().toISOString());
  dispatchToChannel(channel, 'MESSAGE_REACTION_ADD', {
    channel_id: channel.id, message_id: message.id, guild_id: channel.guild_id, user_id: req.user.id, emoji,
  });
  res.status(204).end();
});

api.delete('/channels/:channelId/messages/:messageId/reactions/:emoji/@me', (req, res) => {
  const { channel, message, emoji } = loadReaction(req);
  q.removeReaction.run(message.id, req.user.id, emoji);
  dispatchToChannel(channel, 'MESSAGE_REACTION_REMOVE', {
    channel_id: channel.id, message_id: message.id, guild_id: channel.guild_id, user_id: req.user.id, emoji,
  });
  res.status(204).end();
});

// Erros lançados com fail() viram respostas JSON; o resto segue para o handler geral.
api.use((err, _req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...err.extra });
  next(err);
});
