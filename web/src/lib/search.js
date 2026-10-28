import { THREAD } from './channels.js';
import { memberName } from './store.js';
import { displayName, snowflakeAt } from './util.js';

// Filtros da pesquisa do Discord em português (aceita também os nomes em inglês).
export const FILTERS = [
  { key: 'from', words: ['de', 'from'], hint: 'usuário', kind: 'user' },
  { key: 'mentions', words: ['menciona', 'mentions'], hint: 'usuário', kind: 'user' },
  { key: 'has', words: ['tem', 'has'], hint: 'link, arquivo, imagem, vídeo ou som', kind: 'has' },
  { key: 'before', words: ['antes', 'before'], hint: 'data específica', kind: 'date' },
  { key: 'during', words: ['durante', 'during'], hint: 'data específica', kind: 'date' },
  { key: 'after', words: ['depois', 'after'], hint: 'data específica', kind: 'date' },
  { key: 'in', words: ['em', 'in'], hint: 'canal', kind: 'channel', guildOnly: true },
  { key: 'pinned', words: ['fixado', 'pinned'], hint: 'sim ou não', kind: 'bool' },
];

export const HAS_VALUES = [['link', 'link'], ['arquivo', 'file'], ['imagem', 'image'], ['vídeo', 'video'], ['som', 'sound']];
export const BOOL_VALUES = [['sim', true], ['não', false]];

const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const unquote = (v) => v.replace(/^"(.*)"$/, '$1');

export const filterFor = (word) => FILTERS.find((f) => f.words.includes(fold(word)));

// Tokens separados por espaço, respeitando "aspas".
export const tokenize = (query) => query.match(/(?:[^\s"]+|"[^"]*"?)+/g) ?? [];

// Quem pode aparecer em de:/menciona: (membros do servidor ou participantes da DM).
export function searchUsers(state, scope) {
  if (scope.guildId) return Object.keys(state.members[scope.guildId] ?? {}).map((id) => state.users[id]).filter(Boolean);
  const channel = state.channels[scope.channelId];
  return [state.user, ...(channel?.recipients ?? []).map((u) => state.users[u.id] ?? u)];
}

export function searchChannels(state, scope) {
  if (!scope.guildId) return [];
  return Object.values(state.channels).filter((c) => c.guild_id === scope.guildId && (c.type === 0 || c.type === THREAD));
}

function resolveUser(state, scope, value) {
  const wanted = fold(value);
  const users = searchUsers(state, scope);
  return users.find((u) => fold(u.username) === wanted)
    ?? users.find((u) => fold(memberName(state, scope.guildId, u.id)) === wanted || fold(displayName(u)) === wanted);
}

// "hoje", "ontem", dd/mm/aaaa ou aaaa-mm-dd -> início do dia (horário local).
function parseDate(value) {
  const v = fold(value);
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  if (v === 'hoje' || v === 'today') return day;
  if (v === 'ontem' || v === 'yesterday') return new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

const nextDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

// Texto da pesquisa -> parâmetros de GET .../messages/search, ou erros (usuário/canal inexistente…).
export function parseSearch(state, scope, query) {
  const params = { content: [], author_id: [], mentions: [], has: [], channel_id: [] };
  const errors = [];
  let min = null;
  let max = null;
  for (const token of tokenize(query)) {
    const match = token.match(/^([^:\s"]+):(.+)$/);
    const filter = match && filterFor(match[1]);
    if (!filter || (filter.guildOnly && !scope.guildId)) {
      params.content.push(token);
      continue;
    }
    const value = unquote(match[2]);
    if (filter.kind === 'user') {
      const user = resolveUser(state, scope, value);
      if (user) params[filter.key === 'from' ? 'author_id' : 'mentions'].push(user.id);
      else errors.push(`Não encontramos o usuário "${value}".`);
    } else if (filter.kind === 'channel') {
      const channel = searchChannels(state, scope).find((c) => fold(c.name) === fold(value.replace(/^#/, '')));
      if (channel) params.channel_id.push(channel.id);
      else errors.push(`Não encontramos o canal "${value}".`);
    } else if (filter.kind === 'has') {
      const kind = HAS_VALUES.find(([label, key]) => fold(label) === fold(value) || key === fold(value));
      if (kind) params.has.push(kind[1]);
      else errors.push(`"tem:" aceita ${HAS_VALUES.map(([label]) => label).join(', ')}.`);
    } else if (filter.kind === 'bool') {
      const bool = BOOL_VALUES.find(([label]) => fold(label) === fold(value)) ?? (['true', 'false'].includes(fold(value)) ? [value, fold(value) === 'true'] : null);
      if (bool) params.pinned = bool[1];
      else errors.push('"fixado:" aceita sim ou não.');
    } else {
      const date = parseDate(value);
      if (!date) {
        errors.push(`Data inválida: "${value}". Use dd/mm/aaaa, hoje ou ontem.`);
        continue;
      }
      // Discord: antes = até o início do dia; depois = a partir do fim do dia; durante = o dia todo.
      if (filter.key === 'before') max = date;
      if (filter.key === 'after') min = nextDay(date);
      if (filter.key === 'during') {
        min = new Date(date.getTime() - 1);
        max = nextDay(date);
      }
    }
  }
  const result = {};
  if (params.content.length) result.content = params.content.join(' ');
  for (const key of ['author_id', 'mentions', 'has', 'channel_id']) if (params[key].length) result[key] = params[key];
  if (params.pinned !== undefined) result.pinned = String(params.pinned);
  if (min) result.min_id = snowflakeAt(min.getTime());
  if (max) result.max_id = snowflakeAt(max.getTime());
  return { params: result, errors, empty: !Object.keys(result).length };
}

export function searchQueryString(params, extra) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...extra })) {
    for (const v of [value].flat()) query.append(key, v);
  }
  return query.toString();
}
