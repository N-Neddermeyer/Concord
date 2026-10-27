// Snowflakes têm o mesmo tamanho, mas comparar o comprimento antes deixa a ordem segura.
export const compareIds = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

export const displayName = (user) => user?.global_name || user?.username || 'Usuário desconhecido';

export const STATUS_LABELS = {
  online: 'Online',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  invisible: 'Invisível',
  offline: 'Offline',
};

export const formatDateTime = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const formatTime = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const formatDate = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

export const formatShortDate = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });

// "Hoje às 14:03" / "Ontem às 09:12" / data completa, como no cabeçalho das mensagens.
export function formatMessageTime(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `Hoje às ${formatTime(iso)}`;
  if (date.toDateString() === yesterday.toDateString()) return `Ontem às ${formatTime(iso)}`;
  return formatDateTime(iso);
}

export const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 3);

// Converte uma cor #rrggbb em rgba para fundos translúcidos.
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Instante (ISO) embutido num Snowflake: 42 bits de milissegundos desde 2015-01-01.
export const snowflakeTime = (id) => new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString();
