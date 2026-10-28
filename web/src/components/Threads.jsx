import { ChevronRight, MessagesSquare, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { THREAD, threadsOf } from '../lib/channels.js';
import { askText, closePopout, confirmDialog, showError } from '../lib/dialogs.js';
import { copyText } from '../lib/messages.js';
import { P, canManageThreads, channelPermissionsFor, has } from '../lib/permissions.js';
import { dispatch, getState, memberName, navigate, useStore } from '../lib/store.js';
import { ARCHIVE_OPTIONS, compareIds, formatDateTime, formatMessageTime } from '../lib/util.js';
import Avatar from './Avatar.jsx';
import Chat from './Chat.jsx';
import Markdown, { InlineMarkdown } from './Markdown.jsx';

const call = (promise) => promise.catch((e) => showError(e.message));

export const ThreadIcon = MessagesSquare;

// Abre a conversa ao lado do canal dela (quando é o canal na tela, `viewingId`); senão, em tela cheia.
export function openThread(thread, viewingId = null) {
  if (viewingId === thread.parent_id) {
    dispatch({ type: 'THREAD_PANE_OPEN', d: { channelId: thread.parent_id, threadId: thread.id } });
  } else {
    navigate(thread.guild_id, thread.id);
  }
}

export const startThread = (channelId, messageId = null) =>
  dispatch({ type: 'THREAD_PANE_OPEN', d: { channelId, threadId: null, messageId } });

const threadLink = (t) => `${location.origin}/channels/${t.guild_id}/${t.id}`;

// Menu "Mais" da conversa (cabeçalho, clique direito na barra lateral).
export function threadMenuItems(thread, state, { inPane = false } = {}) {
  const me = state.user.id;
  const perms = channelPermissionsFor(state, thread.id);
  const manager = canManageThreads(perms);
  const owner = thread.owner_id === me;
  const { archived, locked } = thread.thread_metadata ?? {};
  const joined = thread.member_ids?.includes(me);
  const patch = (body) => call(api(`/channels/${thread.id}`, { method: 'PATCH', body }));

  const rename = async () => {
    const name = await askText({ title: 'Editar conversa', label: 'Nome da conversa', initial: thread.name, maxLength: 100 });
    if (name && name !== thread.name) patch({ name });
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Excluir conversa',
      body: `Tem certeza de que deseja excluir ${thread.name}? As mensagens dela serão apagadas. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir conversa',
      danger: true,
    });
    if (ok) call(api(`/channels/${thread.id}`, { method: 'DELETE' }));
  };

  return [
    { label: 'Marcar como lida', onClick: () => thread.last_message_id && dispatch({ type: 'ACK', d: { channelId: thread.id, messageId: thread.last_message_id } }) },
    inPane && { label: 'Abrir em tela cheia', onClick: () => navigate(thread.guild_id, thread.id) },
    { separator: true },
    joined
      ? { label: 'Sair da conversa', onClick: () => call(api(`/channels/${thread.id}/thread-members/@me`, { method: 'DELETE' })) }
      : { label: 'Entrar na conversa', onClick: () => call(api(`/channels/${thread.id}/thread-members/@me`, { method: 'PUT' })) },
    (owner || manager) && !(locked && !manager) && { label: 'Editar nome', onClick: rename },
    (owner || manager) && !(locked && !manager) && (archived
      ? { label: 'Desarquivar conversa', onClick: () => patch({ archived: false }) }
      : { label: 'Arquivar conversa', onClick: () => patch({ archived: true }) }),
    manager && (locked
      ? { label: 'Desbloquear conversa', onClick: () => patch({ locked: false }) }
      : { label: 'Bloquear conversa', onClick: () => patch({ locked: true }) }),
    manager && { label: 'Excluir conversa', danger: true, onClick: remove },
    { separator: true },
    { label: 'Copiar link', onClick: () => copyText(threadLink(thread)) },
    { label: 'Copiar ID da conversa', onClick: () => copyText(thread.id) },
  ];
}

// "Fulano: última mensagem" ou "Nenhuma mensagem recente".
function LastMessage({ thread }) {
  const state = useStore((s) => s);
  const usersByName = useMemo(() => new Map(Object.values(state.users).map((u) => [u.username.toLowerCase(), u])), [state.users]);
  const last = thread.last_message;
  if (!last) return <span className="thread-last muted">Nenhuma mensagem recente</span>;
  const author = state.users[last.author.id] ?? last.author;
  return (
    <span className="thread-last">
      <Avatar user={author} size={16} />
      <b>{memberName(state, thread.guild_id, last.author.id, author)}</b>
      <span className="thread-last-text">{last.content ? <InlineMarkdown text={last.content} guildId={thread.guild_id} usersByName={usersByName} nameOf={(id, f) => memberName(state, thread.guild_id, id, f)} /> : <i>Anexo</i>}</span>
      <span className="thread-last-time">{formatMessageTime(last.timestamp)}</span>
    </span>
  );
}

// Prévia da conversa embaixo da mensagem de origem.
export function ThreadPreview({ thread, onOpen }) {
  const count = thread.message_count ?? 0;
  return (
    <button className="thread-preview" onClick={onOpen}>
      <span className="thread-preview-top">
        <b className="thread-preview-name">{thread.name}</b>
        <span className="thread-preview-count">{count} {count === 1 ? 'mensagem' : 'mensagens'} <ChevronRight size={14} /></span>
      </span>
      <LastMessage thread={thread} />
    </button>
  );
}

// Popout "Conversas" do cabeçalho do canal: ativas e arquivadas, com busca e "Criar".
export function ThreadsPopout({ channel, close }) {
  const channels = useStore((s) => s.channels);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('active');
  const { active, archived } = threadsOf(channels, channel.id);
  const list = (tab === 'active' ? active : archived).filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));
  const canCreate = has(channelPermissionsFor(getState(), channel.id), P.SEND_MESSAGES);

  return (
    <div className="threads-popout">
      <header className="threads-popout-head">
        <ThreadIcon size={22} />
        <h2>Conversas</h2>
        <div className="threads-popout-search">
          <input placeholder="Pesquisar conversas" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
          <Search size={14} />
        </div>
        {canCreate && <button className="button brand small" onClick={() => { close(); startThread(channel.id); }}>Criar</button>}
        <button className="threads-popout-close" aria-label="Fechar" onClick={close}><X size={20} /></button>
      </header>
      <nav className="threads-popout-tabs">
        <button className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>Ativas — {active.length}</button>
        <button className={tab === 'archived' ? 'active' : ''} onClick={() => setTab('archived')}>Arquivadas — {archived.length}</button>
      </nav>
      <div className="threads-popout-list">
        {!list.length && (
          <div className="threads-empty">
            <ThreadIcon size={40} />
            <h3>{query ? 'Nenhuma conversa encontrada' : tab === 'active' ? 'Ainda não há conversas.' : 'Nenhuma conversa arquivada.'}</h3>
            {!query && tab === 'active' && <p>Mantenha as conversas organizadas com as conversas. Passe o mouse numa mensagem e clique em "Criar conversa".</p>}
          </div>
        )}
        {list.map((t) => (
          <button key={t.id} className="threads-popout-item" onClick={() => { close(); openThread(t, channel.id); }}>
            <span className="threads-popout-name">
              {t.name}
              {t.thread_metadata?.locked && <span className="thread-tag">Bloqueada</span>}
            </span>
            <span className="threads-popout-meta">{t.message_count ?? 0} {t.message_count === 1 ? 'mensagem' : 'mensagens'}</span>
            <LastMessage thread={t} />
          </button>
        ))}
      </div>
    </div>
  );
}

// Painel da conversa ao lado do canal (ou o formulário de "Nova conversa").
export function ThreadPane() {
  const pane = useStore((s) => s.threadPane);
  const thread = useStore((s) => (pane.threadId ? s.channels[pane.threadId] : null));
  if (pane.threadId && !thread) return null;
  return (
    <section className="thread-pane">
      {thread ? <Chat key={thread.id} channelId={thread.id} pane /> : <ThreadCreatePane key={pane.messageId ?? 'new'} pane={pane} />}
    </section>
  );
}

// "Nova conversa": nome, arquivamento e a primeira mensagem (Enter cria e envia).
function ThreadCreatePane({ pane }) {
  const state = useStore((s) => s);
  const parent = state.channels[pane.channelId];
  const starter = pane.messageId ? state.messages[pane.channelId]?.list.find((m) => m.id === pane.messageId) : null;
  const [name, setName] = useState(() => (starter?.content ? starter.content.replace(/\s+/g, ' ').trim().slice(0, 100) : ''));
  const [duration, setDuration] = useState(1440);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const textarea = useRef(null);

  useEffect(() => {
    if (name) textarea.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => dispatch({ type: 'THREAD_PANE_CLOSE' });
  if (!parent) return null;
  const nameOf = (id, fallback) => memberName(state, parent.guild_id, id, fallback);

  const create = async () => {
    if (busy || !name.trim() || !text.trim()) return;
    setBusy(true);
    try {
      const path = starter ? `/channels/${parent.id}/messages/${starter.id}/threads` : `/channels/${parent.id}/threads`;
      const thread = await api(path, { method: 'POST', body: { name: name.trim(), auto_archive_duration: duration } });
      await api(`/channels/${thread.id}/messages`, { method: 'POST', body: { content: text.trim() } });
      dispatch({ type: 'THREAD_PANE_OPEN', d: { channelId: parent.id, threadId: thread.id } });
    } catch (e) {
      showError(e.message);
      setBusy(false);
    }
  };

  return (
    <main className="chat thread-create">
      <header className="chat-header">
        <ThreadIcon size={22} className="header-icon" />
        <h1>Nova conversa</h1>
        <span className="header-spacer" />
        <button className="header-button" aria-label="Fechar" title="Fechar" onClick={close}><X size={22} /></button>
      </header>
      <div className="thread-create-body">
        <div className="thread-create-icon"><ThreadIcon size={32} /></div>
        <label className="field">
          <span className="field-label">Nome da conversa</span>
          <input
            className="input"
            autoFocus={!name}
            value={name}
            maxLength={100}
            placeholder={starter ? 'Dê um nome a esta conversa' : 'Nova conversa'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && textarea.current?.focus()}
          />
        </label>
        <label className="field">
          <span className="field-label">Arquivar após inatividade</span>
          <select className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {ARCHIVE_OPTIONS.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}
          </select>
        </label>
        {starter && (
          <div className="thread-create-starter">
            <Avatar user={state.users[starter.author.id] ?? starter.author} size={40} />
            <div>
              <div className="message-meta">
                <span className="author">{nameOf(starter.author.id, starter.author)}</span>
                <span className="timestamp" title={formatDateTime(starter.timestamp)}>{formatMessageTime(starter.timestamp)}</span>
              </div>
              {starter.content && <div className="content"><Markdown text={starter.content} guildId={parent.guild_id} nameOf={nameOf} /></div>}
            </div>
          </div>
        )}
      </div>
      <div className="composer">
        <div className="composer-box">
          <textarea
            ref={textarea}
            rows={1}
            value={text}
            maxLength={2000}
            disabled={busy}
            placeholder="Inicie a conversa com uma mensagem"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                create();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                close();
              }
            }}
          />
        </div>
        <div className="composer-footer">
          <span className="thread-create-hint">{!name.trim() ? 'Dê um nome à conversa.' : 'Enter cria a conversa e envia a mensagem.'}</span>
        </div>
      </div>
    </main>
  );
}

// Linhas das conversas embaixo do canal na barra lateral: as que você participa (ativas) e a aberta.
export function SidebarThreads({ channel, activeId, collapsed, onMenu }) {
  const channels = useStore((s) => s.channels);
  const me = useStore((s) => s.user.id);
  const readStates = useStore((s) => s.readStates);
  const mentions = useStore((s) => s.mentions);
  const threads = Object.values(channels)
    .filter((t) => t.type === THREAD && t.parent_id === channel.id)
    .filter((t) => t.id === activeId || (!t.thread_metadata?.archived && t.member_ids?.includes(me)))
    .sort((a, b) => compareIds(a.id, b.id));
  const unreadOf = (t) => !!t.last_message_id && (!readStates[t.id] || compareIds(t.last_message_id, readStates[t.id]) > 0);
  const shown = collapsed ? threads.filter((t) => t.id === activeId || unreadOf(t)) : threads;
  if (!shown.length) return null;
  return (
    <div className="sidebar-threads">
      {shown.map((t, i) => {
        const active = t.id === activeId;
        const unread = unreadOf(t);
        return (
          <div key={t.id} className={`sidebar-thread${active ? ' active' : ''}${unread ? ' unread' : ''}${i === shown.length - 1 ? ' last' : ''}`} onContextMenu={(e) => onMenu(e, t)}>
            <span className="thread-spine" />
            <button className="sidebar-thread-main" onClick={() => { closePopout(); navigate(t.guild_id, t.id); }}>
              <span className="channel-name">{t.name}</span>
            </button>
            {mentions[t.id] > 0 && !active && <span className="badge inline">{mentions[t.id]}</span>}
          </div>
        );
      })}
    </div>
  );
}

