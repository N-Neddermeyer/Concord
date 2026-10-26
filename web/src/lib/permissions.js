// Mesmo cálculo do servidor (server/src/permissions.js), feito sobre o store para montar a interface.
export const P = {
  CREATE_INSTANT_INVITE: 1 << 0,
  KICK_MEMBERS: 1 << 1,
  BAN_MEMBERS: 1 << 2,
  ADMINISTRATOR: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  MANAGE_GUILD: 1 << 5,
  SEND_MESSAGES: 1 << 11,
  MANAGE_MESSAGES: 1 << 13,
  CONNECT: 1 << 20,
  MANAGE_ROLES: 1 << 28,
};

export const ALL_PERMISSIONS = Object.values(P).reduce((a, b) => a | b, 0);

export const has = (perms, flag) => (perms & flag) === flag;

export function permissionsFor(state, guildId, userId = state.user?.id) {
  const guild = state.guilds[guildId];
  if (!guild) return 0;
  if (guild.owner_id === userId) return ALL_PERMISSIONS;
  let perms = guild.roles[guild.id]?.permissions ?? 0;
  for (const id of state.members[guildId]?.[userId]?.roles ?? []) perms |= guild.roles[id]?.permissions ?? 0;
  return has(perms, P.ADMINISTRATOR) ? ALL_PERMISSIONS : perms;
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
      [P.MANAGE_CHANNELS, 'Gerenciar canais', 'Permite que os membros criem, editem ou excluam canais.'],
      [P.MANAGE_ROLES, 'Gerenciar cargos', 'Permite que os membros criem cargos e editem ou excluam cargos abaixo do seu cargo mais alto.'],
      [P.MANAGE_GUILD, 'Gerenciar servidor', 'Permite que os membros alterem o nome e o ícone do servidor e vejam todos os convites.'],
    ],
  },
  {
    title: 'Permissões de associação',
    items: [
      [P.CREATE_INSTANT_INVITE, 'Criar convite', 'Permite que os membros convidem novas pessoas para este servidor.'],
      [P.KICK_MEMBERS, 'Expulsar membros', 'Permite que os membros removam outros membros do servidor.'],
      [P.BAN_MEMBERS, 'Banir membros', 'Permite que os membros banam permanentemente outros membros do servidor.'],
    ],
  },
  {
    title: 'Permissões de canal de texto',
    items: [
      [P.SEND_MESSAGES, 'Enviar mensagens', 'Permite que os membros enviem mensagens em canais de texto.'],
      [P.MANAGE_MESSAGES, 'Gerenciar mensagens', 'Permite que os membros excluam mensagens de outros membros.'],
    ],
  },
  {
    title: 'Permissões de canal de voz',
    items: [[P.CONNECT, 'Conectar', 'Permite que os membros entrem em canais de voz e ouçam os outros.']],
  },
  {
    title: 'Permissões avançadas',
    items: [
      [P.ADMINISTRATOR, 'Administrador', 'Membros com esta permissão terão todas as permissões. Esta é uma permissão perigosa!'],
    ],
  },
];
