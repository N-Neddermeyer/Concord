// Ordem dos canais de um servidor como na barra lateral do Discord: primeiro os sem categoria,
// depois cada categoria com os seus; dentro de cada grupo, canais de texto antes dos de voz.

export const TEXT = 0;
export const VOICE = 2;
export const CATEGORY = 4;
export const THREAD = 11;

const byPosition = (a, b) => a.position - b.position || (a.id < b.id ? -1 : 1);
const sortChildren = (list) => [...list].sort((a, b) => (a.type === VOICE) - (b.type === VOICE) || byPosition(a, b));

// { loose: [canais sem categoria], categories: [{ category, children }] }
export function channelTree(channels, guildId) {
  const mine = Object.values(channels).filter((c) => c.guild_id === guildId && c.type !== THREAD);
  const categories = mine.filter((c) => c.type === CATEGORY).sort(byPosition);
  const known = new Set(categories.map((c) => c.id));
  return {
    loose: sortChildren(mine.filter((c) => c.type !== CATEGORY && !known.has(c.parent_id))),
    categories: categories.map((category) => ({ category, children: sortChildren(mine.filter((c) => c.parent_id === category.id)) })),
  };
}

// Lista plana na ordem da barra lateral (categorias incluídas).
export function sidebarOrder(channels, guildId) {
  const { loose, categories } = channelTree(channels, guildId);
  return [...loose, ...categories.flatMap(({ category, children }) => [category, ...children])];
}

// Primeiro canal de texto na ordem da barra (o que abre ao entrar no servidor).
export const firstTextChannel = (channels, guildId) => sidebarOrder(channels, guildId).find((c) => c.type === TEXT) ?? null;

// Conversas de um canal: as ativas primeiro (mais recentes no topo), depois as arquivadas.
export function threadsOf(channels, channelId) {
  const list = Object.values(channels).filter((c) => c.type === THREAD && c.parent_id === channelId);
  const recent = (a, b) => ((b.last_message_id ?? b.id) > (a.last_message_id ?? a.id) ? 1 : -1);
  return {
    active: list.filter((t) => !t.thread_metadata?.archived).sort(recent),
    archived: list.filter((t) => t.thread_metadata?.archived).sort(recent),
  };
}

// Posições novas depois de arrastar: renumera tudo na ordem da barra e devolve só o que mudou
// ([{ id, position, parent_id, lock_permissions }] para PATCH /guilds/:id/channels).
export function reorderPayload(channels, guildId, layout) {
  const changes = [];
  layout.forEach(({ id, parent_id: parentId, lock }, position) => {
    const c = channels[id];
    if (c.position === position && (c.parent_id ?? null) === parentId && !lock) return;
    changes.push({ id, position, parent_id: parentId, ...(lock && { lock_permissions: true }) });
  });
  return changes;
}
