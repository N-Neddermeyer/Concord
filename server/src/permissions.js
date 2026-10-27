// Mesmos bits de permissão do Discord (subconjunto). Cabem em 32 bits, então usamos Number.
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
// Permissões do @everyone num servidor novo, como no Discord.
export const DEFAULT_PERMISSIONS = P.CREATE_INSTANT_INVITE | P.ADD_REACTIONS | P.VIEW_CHANNEL | P.SEND_MESSAGES
  | P.ATTACH_FILES | P.MENTION_EVERYONE | P.CONNECT | P.CHANGE_NICKNAME;
// Antes dos overwrites estas eram implícitas; a migração as dá ao @everyone dos servidores existentes.
export const IMPLICIT_BEFORE_OVERWRITES = P.ADD_REACTIONS | P.VIEW_CHANNEL | P.ATTACH_FILES | P.MENTION_EVERYONE | P.CHANGE_NICKNAME;
// Só estas podem ser liberadas ou negadas por canal (em "Gerenciar cargos" o canal mostra "Gerenciar permissões").
export const CHANNEL_PERMISSIONS = P.CREATE_INSTANT_INVITE | P.MANAGE_CHANNELS | P.ADD_REACTIONS | P.VIEW_CHANNEL
  | P.SEND_MESSAGES | P.MANAGE_MESSAGES | P.ATTACH_FILES | P.MENTION_EVERYONE | P.CONNECT | P.MANAGE_ROLES;

export const OVERWRITE_ROLE = 0;
export const OVERWRITE_MEMBER = 1;

// Dono tem tudo; os demais somam @everyone + cargos; Administrador libera tudo.
export function computePermissions(guild, roles, memberRoleIds, userId) {
  if (guild.owner_id === userId) return ALL_PERMISSIONS;
  let perms = 0;
  for (const role of roles) {
    if (role.id === guild.id || memberRoleIds.includes(role.id)) perms |= role.permissions;
  }
  return perms & P.ADMINISTRATOR ? ALL_PERMISSIONS : perms;
}

// Permissões no canal, na ordem do Discord: base do servidor → overwrite do @everyone →
// overwrites dos cargos do membro (juntos) → overwrite do próprio membro. Sem "Ver canal", nada vale.
export function computeOverwrites(base, overwrites, guildId, memberRoleIds, userId) {
  if (base & P.ADMINISTRATOR) return ALL_PERMISSIONS;
  let perms = base;
  const everyone = overwrites.find((o) => o.id === guildId);
  if (everyone) perms = (perms & ~everyone.deny) | everyone.allow;
  let allow = 0;
  let deny = 0;
  for (const o of overwrites) {
    if (o.type === OVERWRITE_ROLE && o.id !== guildId && memberRoleIds.includes(o.id)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  perms = (perms & ~deny) | allow;
  const member = overwrites.find((o) => o.type === OVERWRITE_MEMBER && o.id === userId);
  if (member) perms = (perms & ~member.deny) | member.allow;
  if (!(perms & P.VIEW_CHANNEL)) return 0;
  // Quem não pode enviar mensagens também não anexa nem menciona @everyone.
  if (!(perms & P.SEND_MESSAGES)) perms &= ~(P.ATTACH_FILES | P.MENTION_EVERYONE);
  return perms;
}

export const has = (perms, flag) => (perms & flag) === flag;

// Posição do cargo mais alto (hierarquia). O dono fica acima de todos.
export function highestPosition(guild, roles, memberRoleIds, userId) {
  if (guild.owner_id === userId) return Infinity;
  let top = 0;
  for (const role of roles) if (memberRoleIds.includes(role.id)) top = Math.max(top, role.position);
  return top;
}
