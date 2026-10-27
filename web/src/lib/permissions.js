// Mesmo cálculo do servidor (server/src/permissions.js), feito sobre o store para montar a interface.
export const P = {
  CREATE_INSTANT_INVITE: 1 << 0,
  KICK_MEMBERS: 1 << 1,
  BAN_MEMBERS: 1 << 2,
  ADMINISTRATOR: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  MANAGE_GUILD: 1 << 5,
  ADD_REACTIONS: 1 << 6,
  VIEW_AUDIT_LOG: 1 << 7,
  VIEW_CHANNEL: 1 << 10,
  SEND_MESSAGES: 1 << 11,
  MANAGE_MESSAGES: 1 << 13,
  ATTACH_FILES: 1 << 15,
  MENTION_EVERYONE: 1 << 17,
  CONNECT: 1 << 20,
  CHANGE_NICKNAME: 1 << 26,
  MANAGE_NICKNAMES: 1 << 27,
  MANAGE_ROLES: 1 << 28,
};

export const ALL_PERMISSIONS = Object.values(P).reduce((a, b) => a | b, 0);

export const OVERWRITE_ROLE = 0;
export const OVERWRITE_MEMBER = 1;

export const has = (perms, flag) => (perms & flag) === flag;

export function permissionsFor(state, guildId, userId = state.user?.id) {
  const guild = state.guilds[guildId];
  if (!guild) return 0;
  if (guild.owner_id === userId) return ALL_PERMISSIONS;
  let perms = guild.roles[guild.id]?.permissions ?? 0;
  for (const id of state.members[guildId]?.[userId]?.roles ?? []) perms |= guild.roles[id]?.permissions ?? 0;
  return has(perms, P.ADMINISTRATOR) ? ALL_PERMISSIONS : perms;
}

// Permissões num canal, aplicando os overwrites na ordem do Discord:
// @everyone → cargos do membro (juntos) → o próprio membro. Sem "Ver canal", nada vale.
export function applyOverwrites(base, overwrites, guildId, roleIds, userId) {
  if (has(base, P.ADMINISTRATOR)) return ALL_PERMISSIONS;
  let perms = base;
  const everyone = overwrites.find((o) => o.id === guildId);
  if (everyone) perms = (perms & ~everyone.deny) | everyone.allow;
  let allow = 0;
  let deny = 0;
  for (const o of overwrites) {
    if (o.type === OVERWRITE_ROLE && o.id !== guildId && roleIds.includes(o.id)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  perms = (perms & ~deny) | allow;
  const member = overwrites.find((o) => o.type === OVERWRITE_MEMBER && o.id === userId);
  if (member) perms = (perms & ~member.deny) | member.allow;
  if (!has(perms, P.VIEW_CHANNEL)) return 0;
  if (!has(perms, P.SEND_MESSAGES)) perms &= ~(P.ATTACH_FILES | P.MENTION_EVERYONE);
  return perms;
}

export function channelPermissionsFor(state, channelId, userId = state.user?.id) {
  const channel = state.channels[channelId];
  if (!channel?.guild_id) return ALL_PERMISSIONS;
  const roleIds = state.members[channel.guild_id]?.[userId]?.roles ?? [];
  return applyOverwrites(permissionsFor(state, channel.guild_id, userId), channel.permission_overwrites ?? [], channel.guild_id, roleIds, userId);
}

// "Canal privado": o @everyone não vê (como o cadeado do Discord na barra lateral).
export const isPrivateChannel = (channel) =>
  !!channel?.permission_overwrites?.some((o) => o.id === channel.guild_id && has(o.deny, P.VIEW_CHANNEL));

// Sincronizado com a categoria: mesmos overwrites que ela.
export function isSynced(channel, parent) {
  if (!parent) return false;
  const key = (list) => JSON.stringify([...(list ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1)).map((o) => [o.id, o.type, o.allow, o.deny]));
  return key(channel.permission_overwrites) === key(parent.permission_overwrites);
}

export function rankOf(state, guildId, userId = state.user?.id) {
  const guild = state.guilds[guildId];
  if (!guild) return 0;
  if (guild.owner_id === userId) return Infinity;
  let top = 0;
  for (const id of state.members[guildId]?.[userId]?.roles ?? []) top = Math.max(top, guild.roles[id]?.position ?? 0);
  return top;
}

// Cargos do mais alto para o mais baixo (como aparecem nas configurações).
export const sortedRoles = (guild) =>
  Object.values(guild?.roles ?? {}).sort((a, b) => b.position - a.position || (a.id < b.id ? -1 : 1));

export function memberRoles(state, guildId, userId) {
  const guild = state.guilds[guildId];
  const ids = state.members[guildId]?.[userId]?.roles ?? [];
  return sortedRoles(guild).filter((r) => ids.includes(r.id));
}

// Cor do nome: a do cargo colorido mais alto.
export const memberColor = (state, guildId, userId) =>
  guildId ? (memberRoles(state, guildId, userId).find((r) => r.color)?.color ?? null) : null;

// Grupo separado na lista de membros: o cargo "exibir separadamente" mais alto.
export const hoistedRole = (state, guildId, userId) => memberRoles(state, guildId, userId).find((r) => r.hoist) ?? null;

// Descrições no mesmo tom das configurações de cargo do Discord.
export const PERMISSION_GROUPS = [
  {
    title: 'Permissões gerais do servidor',
    items: [
      [P.VIEW_CHANNEL, 'Ver canais', 'Permite que os membros vejam os canais por padrão (exceto os canais privados).'],
      [P.MANAGE_CHANNELS, 'Gerenciar canais', 'Permite que os membros criem, editem ou excluam canais.'],
      [P.MANAGE_ROLES, 'Gerenciar cargos', 'Permite que os membros criem cargos e editem ou excluam cargos abaixo do seu cargo mais alto.'],
      [P.VIEW_AUDIT_LOG, 'Ver registro de auditoria', 'Permite que os membros vejam um registro de quem fez quais alterações neste servidor.'],
      [P.MANAGE_GUILD, 'Gerenciar servidor', 'Permite que os membros alterem o nome, o ícone e o banner do servidor e vejam todos os convites.'],
    ],
  },
  {
    title: 'Permissões de associação',
    items: [
      [P.CREATE_INSTANT_INVITE, 'Criar convite', 'Permite que os membros convidem novas pessoas para este servidor.'],
      [P.CHANGE_NICKNAME, 'Alterar apelido', 'Permite que os membros alterem o próprio apelido, um nome personalizado só para este servidor.'],
      [P.MANAGE_NICKNAMES, 'Gerenciar apelidos', 'Permite que os membros alterem os apelidos de outros membros.'],
      [P.KICK_MEMBERS, 'Expulsar membros', 'Permite que os membros removam outros membros do servidor.'],
      [P.BAN_MEMBERS, 'Banir membros', 'Permite que os membros banam permanentemente outros membros do servidor.'],
    ],
  },
  {
    title: 'Permissões de canal de texto',
    items: [
      [P.SEND_MESSAGES, 'Enviar mensagens', 'Permite que os membros enviem mensagens em canais de texto.'],
      [P.ATTACH_FILES, 'Anexar arquivos', 'Permite que os membros enviem arquivos ou mídias nos canais de texto.'],
      [P.ADD_REACTIONS, 'Adicionar reações', 'Permite que os membros adicionem novas reações a uma mensagem. Sem ela, ainda dá para usar as reações que já existem.'],
      [P.MENTION_EVERYONE, 'Mencionar @everyone e @here', 'Permite que os membros usem @everyone e @here para notificar todos no canal.'],
      [P.MANAGE_MESSAGES, 'Gerenciar mensagens', 'Permite que os membros excluam e fixem mensagens de outros membros.'],
    ],
  },
  {
    title: 'Permissões de canal de voz',
    items: [[P.CONNECT, 'Conectar', 'Permite que os membros entrem em canais de voz e ouçam os outros.']],
  },
  {
    title: 'Permissões avançadas',
    items: [
      [P.ADMINISTRATOR, 'Administrador', 'Membros com esta permissão terão todas as permissões e passarão por cima de todas as permissões de canal. Esta é uma permissão perigosa!'],
    ],
  },
];

// Permissões que um canal pode liberar ou negar (tela "Permissões" do canal), por tipo de canal.
const CHANNEL_ITEMS = {
  general: [
    [P.VIEW_CHANNEL, 'Ver canal', 'Permite que os membros vejam este canal.'],
    [P.MANAGE_CHANNELS, 'Gerenciar canal', 'Permite que os membros alterem o nome, a descrição e as configurações deste canal.'],
    [P.MANAGE_ROLES, 'Gerenciar permissões', 'Permite que os membros alterem as permissões deste canal.'],
    [P.CREATE_INSTANT_INVITE, 'Criar convite', 'Permite que os membros convidem novas pessoas para este servidor.'],
  ],
  text: [
    [P.SEND_MESSAGES, 'Enviar mensagens', 'Permite que os membros enviem mensagens neste canal.'],
    [P.ATTACH_FILES, 'Anexar arquivos', 'Permite que os membros enviem arquivos ou mídias neste canal.'],
    [P.ADD_REACTIONS, 'Adicionar reações', 'Permite que os membros adicionem novas reações a mensagens neste canal.'],
    [P.MENTION_EVERYONE, 'Mencionar @everyone e @here', 'Permite que os membros usem @everyone e @here neste canal.'],
    [P.MANAGE_MESSAGES, 'Gerenciar mensagens', 'Permite que os membros excluam e fixem mensagens de outros membros neste canal.'],
  ],
  voice: [[P.CONNECT, 'Conectar', 'Permite que os membros entrem neste canal de voz e ouçam os outros.']],
};

export function channelPermissionGroups(type) {
  const groups = [{ title: type === 4 ? 'Permissões gerais da categoria' : 'Permissões gerais do canal', items: CHANNEL_ITEMS.general }];
  if (type === 0 || type === 4) groups.push({ title: 'Permissões de canal de texto', items: CHANNEL_ITEMS.text });
  if (type === 2 || type === 4) groups.push({ title: 'Permissões de canal de voz', items: CHANNEL_ITEMS.voice });
  return groups;
}
