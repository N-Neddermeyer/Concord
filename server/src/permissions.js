// Mesmos bits de permissão do Discord (subconjunto). Cabem em 32 bits, então usamos Number.
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
export const DEFAULT_PERMISSIONS = P.CREATE_INSTANT_INVITE | P.SEND_MESSAGES | P.CONNECT;

// Dono tem tudo; os demais somam @everyone + cargos; Administrador libera tudo.
export function computePermissions(guild, roles, memberRoleIds, userId) {
  if (guild.owner_id === userId) return ALL_PERMISSIONS;
  let perms = 0;
  for (const role of roles) {
    if (role.id === guild.id || memberRoleIds.includes(role.id)) perms |= role.permissions;
  }
  return perms & P.ADMINISTRATOR ? ALL_PERMISSIONS : perms;
}

export const has = (perms, flag) => (perms & flag) === flag;

// Posição do cargo mais alto (hierarquia). O dono fica acima de todos.
export function highestPosition(guild, roles, memberRoleIds, userId) {
  if (guild.owner_id === userId) return Infinity;
  let top = 0;
  for (const role of roles) if (memberRoleIds.includes(role.id)) top = Math.max(top, role.position);
  return top;
}
