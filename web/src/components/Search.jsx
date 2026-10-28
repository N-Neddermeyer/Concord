import { ChevronLeft, ChevronRight, Hash, MessagesSquare, Search as SearchIcon, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { openPopout } from '../lib/dialogs.js';
import { BOOL_VALUES, FILTERS, HAS_VALUES, filterFor, parseSearch, searchChannels, searchQueryString, searchUsers } from '../lib/search.js';
import { HOME, dispatch, isThread, jumpToMessage, memberName, navigate, useStore } from '../lib/store.js';
import { displayName, formatDateTime, formatMessageTime } from '../lib/util.js';
import MessageAttachments from './Attachments.jsx';
import Avatar from './Avatar.jsx';
import Markdown from './Markdown.jsx';

const PAGE_SIZE = 25;
const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Sugestões para o último termo digitado (o que está sendo escrito agora).
function suggestionsFor(state, scope, value) {
  const last = value.endsWith(' ') || !value ? '' : value.split(/\s+/).at(-1);
  const match = last.match(/^([^:\s"]+):(.*)$/);
  const filter = match && filterFor(match[1]);
  if (!filter) {
    const options = FILTERS.filter((f) => (!f.guildOnly || scope.guildId) && (!last || f.words[0].startsWith(fold(last))));
    return { title: 'Opções de pesquisa', items: options.map((f) => ({ key: f.key, label: `${f.words[0]}:`, hint: f.hint, insert: `${f.words[0]}:`, keepOpen: true })) };
  }
  const partial = fold(match[2].replace(/^"/, ''));
  const word = `${match[1]}:`;
  if (filter.kind === 'user') {
    const users = searchUsers(state, scope)
      .filter((u) => [u.username, displayName(u), memberName(state, scope.guildId, u.id)].some((n) => fold(n).includes(partial)))
      .slice(0, 8);
    return {
      title: filter.key === 'from' ? 'De um usuário' : 'Menciona um usuário',
      items: users.map((u) => ({ key: u.id, user: u, label: memberName(state, scope.guildId, u.id), hint: u.username, insert: `${word}${u.username}` })),
    };
  }
  if (filter.kind === 'channel') {
    const channels = searchChannels(state, scope).filter((c) => fold(c.name).includes(partial.replace(/^#/, ''))).slice(0, 8);
    return { title: 'Em um canal', items: channels.map((c) => ({ key: c.id, channel: c, label: c.name, insert: `${word}${/\s/.test(c.name) ? `"${c.name}"` : c.name}` })) };
  }
  if (filter.kind === 'has') {
    return { title: 'A mensagem contém', items: HAS_VALUES.filter(([label]) => fold(label).startsWith(partial)).map(([label]) => ({ key: label, label, insert: `${word}${label}` })) };
  }
  if (filter.kind === 'bool') {
    return { title: 'Mensagens fixadas', items: BOOL_VALUES.map(([label]) => ({ key: label, label, insert: `${word}${label}` })) };
  }
  return {
    title: 'Data (dd/mm/aaaa)',
    items: ['hoje', 'ontem'].filter((d) => d.startsWith(partial)).map((d) => ({ key: d, label: d, insert: `${word}${d}` })),
  };
}

// Caixa "Buscar" no cabeçalho do canal ou da DM. Enter abre os resultados à direita.
export function SearchBox({ scope, placeholder }) {
  const state = useStore((s) => s);
  const active = useStore((s) => s.search);
  const mine = !!active && active.guildId === (scope.guildId ?? null) && active.channelId === (scope.channelId ?? null);
  const [value, setValue] = useState(mine ? active.query : '');
  const [focused, setFocused] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef(null);

  useEffect(() => {
    if (!mine) setValue('');
  }, [mine]);

  const suggestions = focused ? suggestionsFor(state, scope, value) : null;
  const items = suggestions?.items ?? [];

  const run = (query = value) => {
    if (!query.trim()) return;
    dispatch({ type: 'SEARCH_OPEN', d: { guildId: scope.guildId ?? null, channelId: scope.channelId ?? null, query: query.trim(), sort: 'desc' } });
    input.current?.blur();
  };

  const accept = (item) => {
    const base = value.endsWith(' ') || !value ? value : value.split(/\s+/).slice(0, -1).join(' ');
    const next = `${base ? `${base.trimEnd()} ` : ''}${item.insert}${item.keepOpen ? '' : ' '}`;
    setValue(next);
    setIndex(0);
    input.current?.focus();
  };

  const clear = () => {
    setValue('');
    dispatch({ type: 'SEARCH_CLOSE' });
  };

  return (
    <div className={`search-box${focused || value ? ' expanded' : ''}`}>
      <input
        ref={input}
        value={value}
        placeholder={placeholder}
        aria-label="Buscar"
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onChange={(e) => {
          setValue(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && items.length) {
            e.preventDefault();
            setIndex((i) => (i + 1) % items.length);
          } else if (e.key === 'ArrowUp' && items.length) {
            e.preventDefault();
            setIndex((i) => (i - 1 + items.length) % items.length);
          } else if (e.key === 'Tab' && items.length) {
            e.preventDefault();
            accept(items[index]);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            // Com um termo de filtro pela metade (ex.: "de:an"), Enter completa; senão pesquisa.
            const last = value.split(/\s+/).at(-1);
            if (items.length && /:/.test(last) && !value.endsWith(' ') && !items[index].keepOpen) accept(items[index]);
            else run();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            input.current.blur();
          }
        }}
      />
      {value ? (
        <button className="search-box-icon clear" aria-label="Limpar pesquisa" onMouseDown={(e) => e.preventDefault()} onClick={clear}><X size={16} /></button>
      ) : (
        <span className="search-box-icon"><SearchIcon size={16} /></span>
      )}
      {focused && items.length > 0 && (
        <div className="search-suggestions" onMouseDown={(e) => e.preventDefault()}>
          <h3>{suggestions.title}</h3>
          {items.map((item, i) => (
            <button key={item.key} className={`search-suggestion${i === index ? ' selected' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => accept(item)}>
              {item.user && <Avatar user={item.user} size={20} />}
              {item.channel && (isThread(item.channel) ? <MessagesSquare size={16} /> : <Hash size={16} />)}
              <span className="search-suggestion-label">{item.label}</span>
              {item.hint && <span className="search-suggestion-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Painel de resultados (no lugar da lista de membros), com ordem e páginas de 25.
export function SearchResults() {
  const search = useStore((s) => s.search);
  const state = useStore((s) => s);
  const [data, setData] = useState(null); // { total, messages } | { error }
  const scope = { guildId: search.guildId, channelId: search.channelId };
  const parsed = useMemo(() => parseSearch(state, scope, search.query), [search.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setData(null);
    if (parsed.errors.length) return setData({ error: parsed.errors.join(' ') });
    // NSFW só entra quando a pesquisa é num canal NSFW já liberado neste dispositivo.
    const nsfw = (parsed.params.channel_id ?? []).some((id) => state.nsfwAllowed[id]);
    const extra = { offset: search.page * PAGE_SIZE, sort_order: search.sort, ...(search.guildId && nsfw && { include_nsfw: 'true' }) };
    const path = search.guildId ? `/guilds/${search.guildId}/messages/search` : `/channels/${search.channelId}/messages/search`;
    let cancelled = false;
    api(`${path}?${searchQueryString(parsed.params, extra)}`).then(
      (r) => !cancelled && setData({ total: r.total_results, messages: r.messages.map((m) => m[0]) }),
      (e) => !cancelled && setData({ error: e.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [parsed, search.page, search.sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => dispatch({ type: 'SEARCH_OPEN', d: { ...search, ...patch } });
  const pages = data?.total ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const usersByName = new Map(Object.values(state.users).map((u) => [u.username.toLowerCase(), u]));
  const channelsByName = new Map(Object.values(state.channels).filter((c) => c.guild_id && c.guild_id === search.guildId).map((c) => [c.name.toLowerCase(), c]));
  const nameOf = (id, fallback) => memberName(state, search.guildId, id, fallback);

  const jump = (m) => {
    const channel = state.channels[m.channel_id];
    jumpToMessage(channel?.guild_id ?? HOME, m.channel_id, m.id);
  };

  return (
    <aside className="search-results">
      <header className="search-results-head">
        <span className="search-results-count">
          {data?.total !== undefined ? `${data.total.toLocaleString('pt-BR')} ${data.total === 1 ? 'resultado' : 'resultados'}` : data?.error ? 'Pesquisa' : 'Pesquisando…'}
        </span>
        <span className="search-sort">
          <button className={search.sort === 'desc' ? 'active' : ''} onClick={() => set({ sort: 'desc', page: 0 })}>Mais recentes</button>
          <button className={search.sort === 'asc' ? 'active' : ''} onClick={() => set({ sort: 'asc', page: 0 })}>Mais antigos</button>
        </span>
        <button className="search-results-close" aria-label="Fechar pesquisa" title="Fechar" onClick={() => dispatch({ type: 'SEARCH_CLOSE' })}><X size={18} /></button>
      </header>
      <div className="search-results-list">
        {!data && <div className="search-loading"><div className="spinner" /></div>}
        {data?.error && <div className="search-empty"><SearchIcon size={40} /><p>{data.error}</p></div>}
        {data?.total === 0 && (
          <div className="search-empty">
            <SearchIcon size={40} />
            <p>Nenhum resultado encontrado. Tente uma pesquisa diferente.</p>
          </div>
        )}
        {data?.messages?.map((m, i) => {
          const channel = state.channels[m.channel_id];
          const showChannel = i === 0 || data.messages[i - 1].channel_id !== m.channel_id;
          const parent = isThread(channel) ? state.channels[channel.parent_id] : null;
          const author = state.users[m.author.id] ?? m.author;
          return (
            <Fragment key={m.id}>
              {showChannel && search.guildId && (
                <button className="search-channel" onClick={() => channel && navigate(channel.guild_id, channel.id)}>
                  {parent ? <><Hash size={14} />{parent.name}<ChevronRight size={12} /><MessagesSquare size={14} /></> : <Hash size={14} />}
                  {channel?.name ?? 'canal desconhecido'}
                </button>
              )}
              <div
                className="search-result"
                role="button"
                tabIndex={0}
                onClick={(e) => !e.target.closest('a, .mention, .spoiler, .attachments') && jump(m)}
                onKeyDown={(e) => e.key === 'Enter' && jump(m)}
              >
                <Avatar user={author} size={40} />
                <div className="search-result-body">
                  <div className="message-meta">
                    <span className="author">{nameOf(m.author.id, author)}</span>
                    <span className="timestamp" title={formatDateTime(m.timestamp)}>{formatMessageTime(m.timestamp)}</span>
                  </div>
                  {m.content && (
                    <div className="content">
                      <Markdown
                        text={m.content}
                        nameOf={nameOf}
                        usersByName={usersByName}
                        channelsByName={channelsByName}
                        guildId={search.guildId}
                        onMention={(userId, e) => {
                          e.stopPropagation();
                          openPopout({ userId, guildId: search.guildId, rect: e.currentTarget.getBoundingClientRect(), side: 'left' });
                        }}
                        onChannel={(c) => navigate(c.guild_id, c.id)}
                      />
                    </div>
                  )}
                  <MessageAttachments message={m} />
                </div>
                <span className="search-jump">Ir para</span>
              </div>
            </Fragment>
          );
        })}
        {pages > 1 && (
          <div className="search-pages">
            <button className="button secondary small" disabled={search.page === 0} onClick={() => set({ page: search.page - 1 })}><ChevronLeft size={16} /> Anterior</button>
            <span>Página {search.page + 1} de {pages}</span>
            <button className="button secondary small" disabled={search.page + 1 >= pages} onClick={() => set({ page: search.page + 1 })}>Próxima <ChevronRight size={16} /></button>
          </div>
        )}
      </div>
    </aside>
  );
}
