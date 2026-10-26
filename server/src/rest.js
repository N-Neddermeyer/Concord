import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { hashPassword, newToken, verifyPassword } from './auth.js';
import { CHANNEL_DM, CHANNEL_GROUP_DM, CHANNEL_TEXT, CHANNEL_VOICE, MSG, REL, db, loadMessages, messagePayload, privateUser, publicUser, q } from './db.js';
import {
  broadcastPresence,
  buildDmChannel,
  buildGuild,
  buildMember,
  disconnectVoice,
  dispatchToChannel,
  dispatchToGuild,
  dispatchToUser,
  dispatchToUsers,
  isInCall,
  leaveVoice,
  permissionsOf,
  rankOf,
  relatedUserIds,
  ringCall,
  statusOf,
  stopRinging,
  toRole,
} from './gateway.js';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, P, has } from './permissions.js';
import { snowflake } from './snowflake.js';

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

const now = () => new Date().toISOString();

// Erro com status HTTP: as rotas lançam e o handler no fim do arquivo responde.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
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

// Servidor do qual o usuário é membro, opcionalmente exigindo uma permissão.
function loadGuild(req, permission) {
  const guild = q.guild.get(req.params.guildId);
  if (!guild || !q.member.get(guild.id, req.user.id)) fail(404, 'Servidor não encontrado.');
  const perms = permissionsOf(guild, req.user.id);
  if (permission && !has(perms, permission)) fail(403, 'Você não tem permissão para fazer isso.');
  return { guild, perms };
}

// Canal que o usuário pode ver: canal de servidor do qual é membro, ou DM da qual participa.
function loadChannel(req) {
  const channel = q.channel.get(req.params.channelId);
  const visible = channel && (channel.guild_id
    ? q.member.get(channel.guild_id, req.user.id)
    : q.dmRecipient.get(channel.id, req.user.id));
  if (!visible) fail(404, 'Canal não encontrado.');
  return channel;
}

function loadMessageChannel(req) {
  const channel = loadChannel(req);
  if (![CHANNEL_TEXT, CHANNEL_DM, CHANNEL_GROUP_DM].includes(channel.type)) fail(404, 'Canal não encontrado.');
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
  if (type === REL.FRIEND) dispatchToUser(userId, 'PRESENCE_UPDATE', { user_id: targetId, status: statusOf(targetId) });
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

// --- servidores ---

api.post('/guilds', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (name.length < 1 || name.length > 100) fail(400, 'Nome do servidor: 1 a 100 caracteres.');
  const icon = req.body?.icon ?? null;
  if (!validImage(icon)) fail(400, 'Ícone inválido ou grande demais.');

  const guildId = snowflake();
  db.transaction(() => {
    q.insertGuild.run(guildId, name, req.user.id);
    q.updateGuild.run(name, icon, guildId);
    q.insertRole.run(guildId, guildId, '@everyone', null, DEFAULT_PERMISSIONS, 0, 0);
    q.insertMember.run(guildId, req.user.id, now());
    q.insertChannel.run(snowflake(), guildId, 'geral', CHANNEL_TEXT, 0);
    q.insertChannel.run(snowflake(), guildId, 'Geral', CHANNEL_VOICE, 1);
  })();

  const guild = buildGuild(q.guild.get(guildId));
  dispatchToUser(req.user.id, 'GUILD_CREATE', guild);
  res.status(201).json(guild);
});

api.patch('/guilds/:guildId', (req, res) => {
  const { guild } = loadGuild(req, P.MANAGE_GUILD);
  const name = req.body?.name === undefined ? guild.name : String(req.body.name).trim();
  if (name.length < 1 || name.length > 100) fail(400, 'Nome do servidor: 1 a 100 caracteres.');
  const icon = req.body?.icon === undefined ? guild.icon : req.body.icon;
  if (!validImage(icon)) fail(400, 'Ícone inválido ou grande demais.');

  q.updateGuild.run(name, icon, guild.id);
  const update = { id: guild.id, name, icon, owner_id: guild.owner_id };
  dispatchToGuild(guild.id, 'GUILD_UPDATE', update);
  res.json(update);
});

api.delete('/guilds/:guildId', (req, res) => {
  const { guild } = loadGuild(req);
  if (guild.owner_id !== req.user.id) fail(403, 'Só o dono pode excluir o servidor.');
  const memberIds = q.memberIds.all(guild.id).map((m) => m.user_id);
  disconnectVoice((v) => v.guild_id === guild.id);
  q.deleteGuild.run(guild.id);
  dispatchToUsers(memberIds, 'GUILD_DELETE', { id: guild.id });
  res.status(204).end();
});

function removeMember(guild, userId) {
  disconnectVoice((v) => v.guild_id === guild.id && v.user_id === userId);
  const user = q.userById.get(userId);
  q.deleteMember.run(guild.id, userId);
  dispatchToGuild(guild.id, 'GUILD_MEMBER_REMOVE', { guild_id: guild.id, user: publicUser(user) });
  dispatchToUser(userId, 'GUILD_DELETE', { id: guild.id });
}

api.delete('/users/@me/guilds/:guildId', (req, res) => {
  const { guild } = loadGuild(req);
  if (guild.owner_id === req.user.id) fail(400, 'O dono não pode sair do servidor. Transfira-o ou exclua-o.');
  removeMember(guild, req.user.id);
  res.status(204).end();
});

// --- canais ---

api.post('/guilds/:guildId/channels', (req, res) => {
  const { guild } = loadGuild(req, P.MANAGE_CHANNELS);
  const type = req.body?.type === CHANNEL_VOICE ? CHANNEL_VOICE : CHANNEL_TEXT;
  const name = channelName(req.body?.name, type);

  const id = snowflake();
  q.insertChannel.run(id, guild.id, name, type, q.nextChannelPosition.get(guild.id).pos);
  const channel = q.channel.get(id);
  dispatchToGuild(guild.id, 'CHANNEL_CREATE', channel);
  res.status(201).json(channel);
});

function channelName(raw, type) {
  let name = String(raw ?? '').trim();
  if (type === CHANNEL_TEXT) name = name.toLowerCase().replace(/\s+/g, '-');
  if (name.length < 1 || name.length > 100) fail(400, 'Nome do canal: 1 a 100 caracteres.');
  return name;
}

function loadManagedChannel(req) {
  const channel = loadChannel(req);
  if (!channel.guild_id) fail(400, 'Não é possível editar uma mensagem direta.');
  req.params.guildId = channel.guild_id;
  loadGuild(req, P.MANAGE_CHANNELS);
  return channel;
}

api.patch('/channels/:channelId', (req, res) => {
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
  const channel = loadManagedChannel(req);
  const name = req.body?.name === undefined ? channel.name : channelName(req.body.name, channel.type);
  const topic = req.body?.topic === undefined ? channel.topic : String(req.body.topic ?? '');
  if (topic.length > 1024) fail(400, 'O tópico pode ter no máximo 1024 caracteres.');

  q.updateChannel.run(name, topic, channel.id);
  const updated = q.channel.get(channel.id);
  dispatchToGuild(channel.guild_id, 'CHANNEL_UPDATE', updated);
  res.json(updated);
});

api.delete('/channels/:channelId', (req, res) => {
  if (q.channel.get(req.params.channelId)?.type === CHANNEL_GROUP_DM) {
    removeFromGroup(loadGroup(req), req.user, req.user.id);
    return res.status(204).end();
  }
  const channel = loadManagedChannel(req);
  disconnectVoice((v) => v.channel_id === channel.id);
  q.deleteChannel.run(channel.id);
  dispatchToGuild(channel.guild_id, 'CHANNEL_DELETE', { id: channel.id, guild_id: channel.guild_id });
  res.status(204).end();
});

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
  broadcastRoles(guild.id);
  res.status(201).json(toRole(q.role.get(id)));
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
  broadcastRoles(guild.id);
  res.json(toRole(q.role.get(role.id)));
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
  db.transaction(() => {
    q.deleteRole.run(role.id);
    normalizeRolePositions(guild.id);
  })();
  broadcastRoles(guild.id);
  for (const userId of holders) dispatchMemberUpdate(guild.id, userId);
  res.status(204).end();
});

// --- membros, expulsões e banimentos ---

function dispatchMemberUpdate(guildId, userId) {
  dispatchToGuild(guildId, 'GUILD_MEMBER_UPDATE', { guild_id: guildId, ...buildMember(guildId, q.userById.get(userId)) });
}

function loadTargetMember(req, guild) {
  if (!q.member.get(guild.id, req.params.userId)) fail(404, 'Membro não encontrado.');
  return req.params.userId;
}

// Expulsar/banir exige estar acima do alvo na hierarquia; o dono nunca é alvo.
function checkOutranks(req, guild, targetId) {
  if (targetId === req.user.id) fail(400, 'Você não pode fazer isso consigo mesmo.');
  if (targetId === guild.owner_id || rankOf(guild, targetId) >= rankOf(guild, req.user.id)) {
    fail(403, 'Este membro tem um cargo igual ou superior ao seu.');
  }
}

api.patch('/guilds/:guildId/members/:userId', (req, res) => {
  const { guild } = loadGuild(req, P.MANAGE_ROLES);
  const userId = loadTargetMember(req, guild);
  const wanted = Array.isArray(req.body?.roles) ? [...new Set(req.body.roles.map(String))] : fail(400, 'Informe os cargos.');

  const roles = q.roles.all(guild.id);
  const current = q.memberRoles.all(guild.id, userId).map((r) => r.role_id);
  const rank = rankOf(guild, req.user.id);
  const changed = [...wanted.filter((id) => !current.includes(id)), ...current.filter((id) => !wanted.includes(id))];
  for (const id of changed) {
    const role = roles.find((r) => r.id === id);
    if (!role || role.id === guild.id) fail(400, 'Cargo inválido.');
    if (role.position >= rank) fail(403, 'Você só pode atribuir cargos abaixo do seu cargo mais alto.');
  }

  db.transaction(() => {
    for (const id of changed) {
      if (wanted.includes(id)) q.addMemberRole.run(guild.id, userId, id);
      else q.removeMemberRole.run(guild.id, userId, id);
    }
  })();
  dispatchMemberUpdate(guild.id, userId);
  res.json(buildMember(guild.id, q.userById.get(userId)));
});

api.delete('/guilds/:guildId/members/:userId', (req, res) => {
  const { guild } = loadGuild(req, P.KICK_MEMBERS);
  const userId = loadTargetMember(req, guild);
  checkOutranks(req, guild, userId);
  removeMember(guild, userId);
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

  q.insertBan.run(guild.id, target.id, String(req.body?.reason ?? '').slice(0, 512), now());
  if (q.member.get(guild.id, target.id)) removeMember(guild, target.id);
  res.status(204).end();
});

api.delete('/guilds/:guildId/bans/:userId', (req, res) => {
  const { guild } = loadGuild(req, P.BAN_MEMBERS);
  if (!q.ban.get(guild.id, req.params.userId)) fail(404, 'Banimento não encontrado.');
  q.deleteBan.run(guild.id, req.params.userId);
  res.status(204).end();
});

// --- convites ---

api.post('/guilds/:guildId/invites', (req, res) => {
  const { guild } = loadGuild(req, P.CREATE_INSTANT_INVITE);
  const code = randomBytes(6).toString('base64url');
  q.insertInvite.run(code, guild.id, req.user.id, now());
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
  res.status(204).end();
});

api.post('/invites/:code', (req, res) => {
  // Aceita o código puro ou um link colado (…/convite/CODIGO).
  const code = req.params.code.split('/').pop();
  const invite = q.invite.get(code);
  if (!invite) fail(404, 'O convite é inválido ou expirou.');
  if (q.ban.get(invite.guild_id, req.user.id)) fail(403, 'Você está banido deste servidor.');

  if (!q.member.get(invite.guild_id, req.user.id)) {
    const joined_at = now();
    q.insertMember.run(invite.guild_id, req.user.id, joined_at);
    q.useInvite.run(invite.code);
    dispatchToGuild(invite.guild_id, 'GUILD_MEMBER_ADD', {
      guild_id: invite.guild_id,
      user: publicUser(req.user),
      roles: [],
      joined_at,
      status: statusOf(req.user.id),
    });
    broadcastPresence(req.user.id);
  }
  const guild = buildGuild(q.guild.get(invite.guild_id));
  dispatchToUser(req.user.id, 'GUILD_CREATE', guild);
  res.json(guild);
});

// --- mensagens ---

api.get('/channels/:channelId/messages', (req, res) => {
  const channel = loadMessageChannel(req);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const before = typeof req.query.before === 'string' ? req.query.before : null;
  res.json(loadMessages(q.messagesBefore.all({ channel: channel.id, before, limit })));
});

// Grava e distribui uma mensagem (normal, resposta ou de sistema) no canal.
function postMessage(channel, author, { content = '', type = MSG.DEFAULT, reference_id = null, reply_ping = false, meta = null }) {
  const id = snowflake();
  db.transaction(() => {
    q.insertMessage.run(id, channel.id, author.id, content, type, reference_id, reply_ping ? 1 : 0, meta && JSON.stringify(meta));
    q.touchChannel.run(id, channel.id);
  })();
  // Primeira mensagem de uma DM: o outro lado ainda não conhece o canal.
  if (!channel.guild_id && !channel.last_message_id) dispatchDmChannel(channel.id, 'CHANNEL_CREATE');

  const message = messagePayload(id);
  dispatchToChannel(channel, 'MESSAGE_CREATE', { ...message, guild_id: channel.guild_id });
  return message;
}

// Em servidor, fixar exige Gerenciar mensagens; em DM e grupo, qualquer participante pode.
function canManageMessages(req, channel) {
  if (!channel.guild_id) return true;
  req.params.guildId = channel.guild_id;
  return has(loadGuild(req).perms, P.MANAGE_MESSAGES);
}

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
  if (content.length < 1 || content.length > 2000) fail(400, 'A mensagem precisa ter de 1 a 2000 caracteres.');

  if (channel.guild_id) {
    req.params.guildId = channel.guild_id;
    loadGuild(req, P.SEND_MESSAGES);
  } else if (channel.type === CHANNEL_DM) {
    const other = dmRecipientIds(channel.id).find((id) => id !== req.user.id);
    const blocked = q.relationship.get(req.user.id, other)?.type === REL.BLOCKED
      || q.relationship.get(other, req.user.id)?.type === REL.BLOCKED;
    if (blocked) fail(403, 'Sua mensagem não pôde ser entregue. Isso acontece quando um dos dois bloqueou o outro.');
  }

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
  });
  res.status(201).json(message);
});

api.patch('/channels/:channelId/messages/:messageId', (req, res) => {
  const channel = loadMessageChannel(req);
  const message = loadMessage(req, channel);
  if (message.author_id !== req.user.id || !isUserMessage(message)) fail(403, 'Você só pode editar suas próprias mensagens.');
  const content = String(req.body?.content ?? '').trim();
  if (content.length < 1 || content.length > 2000) fail(400, 'A mensagem precisa ter de 1 a 2000 caracteres.');

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

  q.deleteMessage.run(message.id);
  dispatchToChannel(channel, 'MESSAGE_DELETE', { id: message.id, channel_id: channel.id, guild_id: channel.guild_id });
  if (message.pinned_at) dispatchPinsUpdate(channel);
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
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  next(err);
});
