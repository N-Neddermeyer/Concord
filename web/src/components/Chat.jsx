import {
  Archive, AtSign, ChevronRight, Ellipsis, File, FileCode, FileImage, FileText, Lock, Phone, Pin, Timer, TriangleAlert, UserPlus, Users, Video, X,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useCallLayout } from '../lib/callLayout.js';
import { acceptCall, startCall, startVideoCall } from '../lib/calls.js';
import { openMenu, openPopout, showError, useDialogs } from '../lib/dialogs.js';
import { isUserMessage } from '../lib/messages.js';
import { P, canManageThreads, channelPermissionsFor, has, memberColor } from '../lib/permissions.js';
import { useSettings } from '../lib/settings.js';
import { HOME, REL, dispatch, dmRecipient, isPrivate, memberName, navigate, privateChannelName, useStore } from '../lib/store.js';
import { useTypingUsers } from '../lib/typing.js';
import { formatSize } from '../lib/upload.js';
import { STATUS_LABELS, compareIds, displayName, formatDate } from '../lib/util.js';
import { useVoice } from '../lib/voice.js';
import AddToDmPopout from './AddToDmPopout.jsx';
import Avatar, { GroupIcon } from './Avatar.jsx';
import CallView from './CallView.jsx';
import { ChannelIcon } from './ChannelSidebar.jsx';
import Composer, { lastOwnMessage, useCooldown } from './Composer.jsx';
import Message, { openReactionPicker } from './Message.jsx';
import PinsPopout from './PinsPopout.jsx';
import { openProfile } from './UserProfile.jsx';
import { SearchBox } from './Search.jsx';
import { ThreadIcon, ThreadsPopout, openThread, startThread, threadMenuItems } from './Threads.jsx';

const PAGE_SIZE = 50;
const GROUP_WINDOW_MS = 7 * 60 * 1000;
const JUMP_MAX_PAGES = 20;

function useAck(channelId, lastId, paused) {
  useEffect(() => {
    if (!lastId || paused) return;
    const ack = () => document.hasFocus() && dispatch({ type: 'ACK', d: { channelId, messageId: lastId } });
    ack();
    window.addEventListener('focus', ack);
    return () => window.removeEventListener('focus', ack);
  }, [channelId, lastId, paused]);
}

// Nome do grupo no cabeçalho: clicar transforma em campo para renomear (qualquer participante).
function GroupName({ channel, name }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const save = () => {
    setEditing(false);
    if (value.trim() === (channel.name ?? '')) return;
    api(`/channels/${channel.id}`, { method: 'PATCH', body: { name: value.trim() } }).catch((e) => showError(e.message));
  };

  if (!editing) {
    return (
      <button className="group-name" title="Alterar nome do grupo" onClick={() => { setValue(channel.name ?? ''); setEditing(true); }}>
        <h1>{name}</h1>
      </button>
    );
  }
  return (
    <input
      className="group-name-input"
      autoFocus
      value={value}
      maxLength={100}
      placeholder={name}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setEditing(false);
        }
      }}
    />
  );
}

// `pane`: conversa aberta no painel ao lado do canal (cabeçalho compacto, sem pesquisa).
export default function Chat({ channelId, pane = false }) {
  const channel = useStore((s) => s.channels[channelId]);
  const guildId = channel.guild_id;
  const guildName = useStore((s) => s.guilds[guildId]?.name);
  const parent = useStore((s) => (channel.type === 11 ? s.channels[channel.parent_id] : null));
  const entry = useStore((s) => s.messages[channelId]);
  const me = useStore((s) => s.user);
  const users = useStore((s) => s.users);
  const relationships = useStore((s) => s.relationships);
  const presences = useStore((s) => s.presences);
  const showMembers = useStore((s) => s.showMembers);
  const perms = useStore((s) => (guildId ? channelPermissionsFor(s, channelId) : 0));
  const nsfwAllowed = useStore((s) => !!s.nsfwAllowed[channelId]);
  const readState = useStore((s) => s.readStates[channelId]);
  const manualUnread = useStore((s) => !!s.manualUnread[channelId]);
  const jump = useStore((s) => (s.jump?.channelId === channelId ? s.jump : null));
  const call = useStore((s) => s.calls[channelId]);
  const state = useStore((s) => s);
  const { messageDisplay } = useSettings();
  const session = useVoice();
  const menuOwner = useDialogs().menu?.owner;
  const [replyTo, setReplyTo] = useState(null); // { message, ping }
  const [upload, setUpload] = useState(null); // { files, progress, cancel } enquanto envia anexos
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const composerApi = useRef(null);
  const typingIds = useTypingUsers(channelId);
  const [editingId, setEditingId] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [revealed, setRevealed] = useState({});
  // Onde começa o "NOVO": o marcador de leitura ao abrir o canal (ou ao marcar como não lida).
  const [unreadMarker, setUnreadMarker] = useState(() =>
    readState && channel.last_message_id && compareIds(channel.last_message_id, readState) > 0 ? readState : null);
  const scroller = useRef(null);
  const composer = useRef(null);
  const stickToBottom = useRef(true);
  const restoreFrom = useRef(null); // altura antes de carregar mensagens antigas
  const pinButton = useRef(null);
  const addButton = useRef(null);
  const threadsButton = useRef(null);

  const isPrivateChannel = isPrivate(channel);
  const isDm = channel.type === 1;
  const isGroup = channel.type === 3;
  const recipient = isDm ? dmRecipient(state, channel) : null;
  const blocked = isDm && relationships[recipient.id]?.type === REL.BLOCKED;
  // Conversa: arquivada ainda aceita mensagem (desarquiva); bloqueada, só de quem gerencia.
  const isThreadChannel = channel.type === 11;
  const threadMeta = channel.thread_metadata ?? {};
  const threadManager = canManageThreads(perms);
  const threadLocked = isThreadChannel && threadMeta.locked && !threadManager;
  const canSend = isPrivateChannel ? !blocked : has(perms, P.SEND_MESSAGES) && !threadLocked;
  const canManage = has(perms, P.MANAGE_MESSAGES);
  const canAttach = isPrivateChannel || has(perms, P.ATTACH_FILES);
  const canReact = isPrivateChannel || has(perms, P.ADD_REACTIONS);
  // Modo lento não vale para quem gerencia o canal ou as mensagens.
  const slowmode = !isPrivateChannel && !has(perms, P.MANAGE_MESSAGES) && !has(perms, P.MANAGE_CHANNELS) ? channel.rate_limit_per_user ?? 0 : 0;
  const nameOf = (userId, fallback) => memberName(state, guildId, userId, fallback);
  const ageGate = !!channel.nsfw && !nsfwAllowed;
  const canPin = isPrivateChannel || canManage;
  const title = isPrivateChannel ? privateChannelName(state, channel) : channel.name;

  const usersByName = useMemo(() => new Map(Object.values(users).map((u) => [u.username.toLowerCase(), u])), [users]);
  const channels = useStore((s) => s.channels);
  const channelsByName = useMemo(() => {
    if (!guildId) return null;
    const map = new Map();
    for (const c of Object.values(channels)) if (c.guild_id === guildId && !map.has(c.name.toLowerCase())) map.set(c.name.toLowerCase(), c);
    return map;
  }, [channels, guildId]);

  useEffect(() => {
    if (manualUnread) setUnreadMarker(readState ?? null);
  }, [manualUnread, readState]);

  const load = useCallback(
    async (before) => {
      const query = new URLSearchParams({ limit: PAGE_SIZE });
      if (before) query.set('before', before);
      const messages = await api(`/channels/${channelId}/messages?${query}`);
      dispatch({ type: 'MESSAGES_LOADED', d: { channelId, messages, hasMore: messages.length === PAGE_SIZE } });
      return messages;
    },
    [channelId],
  );

  useEffect(() => {
    if (!entry) load().catch((e) => showError(e.message));
  }, [entry, load]);

  useEffect(() => composer.current?.focus(), [channelId]);

  const list = entry?.list ?? [];
  useAck(channelId, entry ? list.at(-1)?.id ?? channel.last_message_id : null, manualUnread);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restoreFrom.current != null) {
      el.scrollTop = el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entry?.list]);

  // A área de chamada aparece/some acima da lista: quem estava no fim continua no fim.
  // (Com "Ocultar chat" ou tela cheia a lista fica escondida e perde a rolagem; ao voltar, idem.)
  const hasCall = !!call;
  const uploading = !!upload;
  const { layout: callLayout } = useCallLayout(channelId);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [hasCall, uploading, callLayout]);

  // Pular até uma mensagem (fixadas, resposta, link): carrega páginas antigas até achá-la.
  useEffect(() => {
    if (!jump || !entry) return;
    let cancelled = false;
    (async () => {
      let current = entry;
      for (let page = 0; page < JUMP_MAX_PAGES && !current.list.some((m) => m.id === jump.messageId); page++) {
        if (!current.hasMore || compareIds(current.list[0]?.id ?? '0', jump.messageId) < 0) break;
        const older = await load(current.list[0].id);
        current = { list: [...older, ...current.list], hasMore: older.length === PAGE_SIZE };
        if (cancelled) return;
      }
      dispatch({ type: 'JUMP_DONE', d: jump.nonce });
      requestAnimationFrame(() => {
        const el = document.getElementById(`msg-${jump.messageId}`);
        if (!el) return showError('Não foi possível encontrar essa mensagem. Ela pode ter sido excluída.');
        stickToBottom.current = false;
        el.scrollIntoView({ block: 'center' });
        setHighlightId(jump.messageId);
        setTimeout(() => setHighlightId((id) => (id === jump.messageId ? null : id)), 2000);
      });
    })().catch((e) => showError(e.message));
    return () => {
      cancelled = true;
    };
  }, [jump, entry, load]);

  const onScroll = async () => {
    const el = scroller.current;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 80 && entry?.hasMore && !loadingOlder) {
      setLoadingOlder(true);
      restoreFrom.current = el.scrollHeight;
      try {
        await load(entry.list[0]?.id);
      } finally {
        setLoadingOlder(false);
      }
    }
  };

  // Arrastar arquivos sobre o chat: sobreposição "Enviar para #canal"; Shift ao soltar envia direto.
  const onDragEnter = (e) => {
    if (!canSend || !canAttach || ageGate || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = () => {
    if (dragDepth.current && --dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e) => {
    if (!dragging) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.shiftKey) composerApi.current?.sendFilesNow(e.dataTransfer.files);
    else composerApi.current?.addFiles(e.dataTransfer.files);
  };

  const startReply = (message) => {
    setEditingId(null);
    setReplyTo({ message, ping: message.author.id !== me.id });
    composer.current?.focus();
  };

  const openFloating = (Component, props, ref) =>
    openPopout({ Component, props, rect: ref.current.getBoundingClientRect(), side: 'below-end' });

  const popout = (userId, event) => openPopout({ userId, guildId, rect: event.currentTarget.getBoundingClientRect() });

  const ctx = {
    me,
    users,
    channel,
    list,
    usersByName,
    channelsByName,
    onChannel: (c) => navigate(c.guild_id, c.id),
    compact: messageDisplay === 'compact',
    canSend,
    canManage: canManage,
    canPin,
    canReact,
    nameOf,
    editingId,
    highlightId,
    menuFor: menuOwner?.startsWith('message-') ? menuOwner.slice(8) : null,
    inThisCall: session.channelId === channelId,
    colorOf: (userId) => memberColor(state, guildId, userId) ?? undefined,
    onPopout: popout,
    onEdit: (id) => {
      setEditingId(id);
      if (!id) composer.current?.focus();
    },
    onReply: startReply,
    onJump: (messageId) => messageId && dispatch({ type: 'JUMP', d: { guildId: guildId ?? '@me', channelId, messageId } }),
    onOpenPins: () => openFloating(PinsPopout, { channel, canPin }, pinButton),
    onJoinCall: () => acceptCall(channelId),
    openPicker: openReactionPicker,
    threadOf: (id) => (id && channels[id]?.type === 11 ? channels[id] : null),
    canCreateThread: channel.type === 0 && has(perms, P.SEND_MESSAGES),
    onCreateThread: (message) => startThread(channelId, message.id),
    onOpenThread: (thread) => openThread(thread, channelId),
    onOpenThreads: () => threadsButton.current && openFloating(ThreadsPopout, { channel }, threadsButton),
  };

  const firstUnread = unreadMarker
    ? list.find((m) => compareIds(m.id, unreadMarker) > 0 && m.author.id !== me.id)?.id
    : null;

  return (
    <main className="chat" onDragEnter={onDragEnter} onDragOver={(e) => dragging && e.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-box">
            <div className="drop-icons"><FileText size={40} /><FileImage size={48} /><FileCode size={40} /></div>
            <h2>Enviar para <b>{isDm ? `@${title}` : isGroup || isThreadChannel ? title : `#${title}`}</b></h2>
            <p>Você pode adicionar comentários antes de enviar. Segure Shift para enviar diretamente.</p>
          </div>
        </div>
      )}
      <header className="chat-header">
        {isDm && (
          <>
            <Avatar user={recipient} size={24} status={presences[recipient.id] ?? 'offline'} />
            <button className="header-name-button" title="Ver perfil" onClick={() => openProfile(recipient.id)}><h1>{title}</h1></button>
            <span className="header-status">{STATUS_LABELS[presences[recipient.id] ?? 'offline']}</span>
          </>
        )}
        {isGroup && (
          <>
            <GroupIcon channel={channel} size={24} />
            <GroupName channel={channel} name={title} />
          </>
        )}
        {isThreadChannel && (
          <>
            {!pane && parent && (
              <>
                <button className="header-parent" onClick={() => navigate(guildId, parent.id)} title={`Ir para #${parent.name}`}>
                  <ChannelIcon channel={parent} size={20} className="header-icon" />
                  <span>{parent.name}</span>
                </button>
                <ChevronRight size={16} className="header-icon" />
              </>
            )}
            <ThreadIcon size={22} className="header-icon" />
            <h1 className="header-thread-name">{title}</h1>
            {threadMeta.archived && <span className="thread-tag" title="Arquivada"><Archive size={12} /> Arquivada</span>}
            {threadMeta.locked && <span className="thread-tag" title="Bloqueada"><Lock size={12} /> Bloqueada</span>}
          </>
        )}
        {!isPrivateChannel && !isThreadChannel && (
          <>
            <ChannelIcon channel={channel} size={24} className="header-icon" />
            <h1>{title}</h1>
            {channel.topic && <><span className="header-divider" /><span className="header-topic" title={channel.topic}>{channel.topic}</span></>}
          </>
        )}
        <span className="header-spacer" />
        {isPrivateChannel && (
          <>
            <button
              className="header-button"
              aria-label={call ? 'Entrar na chamada' : 'Iniciar chamada de voz'}
              title={call ? 'Entrar na chamada' : 'Iniciar chamada de voz'}
              disabled={blocked || session.channelId === channelId}
              onClick={() => (call ? acceptCall(channelId) : startCall(channelId))}
            >
              <Phone size={22} />
            </button>
            <button
              className="header-button"
              aria-label="Iniciar chamada de vídeo"
              title="Iniciar chamada de vídeo"
              disabled={blocked || (session.channelId === channelId && session.video)}
              onClick={() => startVideoCall(channelId)}
            >
              <Video size={24} />
            </button>
          </>
        )}
        {channel.type === 0 && (
          <button ref={threadsButton} className="header-button" aria-label="Conversas" title="Conversas" onClick={ctx.onOpenThreads}>
            <ThreadIcon size={22} />
          </button>
        )}
        <button ref={pinButton} className="header-button" aria-label="Mensagens fixadas" title="Mensagens fixadas" onClick={ctx.onOpenPins}>
          <Pin size={22} />
        </button>
        {isPrivateChannel && (
          <button
            ref={addButton}
            className="header-button"
            aria-label="Adicionar amigos à MD"
            title="Adicionar amigos à MD"
            disabled={blocked}
            onClick={() => openFloating(AddToDmPopout, { channel }, addButton)}
          >
            <UserPlus size={22} />
          </button>
        )}
        {isThreadChannel && (
          <button
            className="header-button"
            aria-label="Mais"
            title="Mais"
            onClick={(e) => openMenu({ rect: e.currentTarget.getBoundingClientRect(), side: 'below-end', items: threadMenuItems(channel, state, { inPane: pane }) })}
          >
            <Ellipsis size={22} />
          </button>
        )}
        {(isGroup || !isPrivateChannel) && !pane && (
          <button
            className={`header-button${showMembers ? ' active' : ''}`}
            aria-label={showMembers ? 'Ocultar lista de membros' : 'Mostrar lista de membros'}
            title={showMembers ? 'Ocultar lista de membros' : 'Mostrar lista de membros'}
            onClick={() => dispatch({ type: 'TOGGLE_MEMBERS' })}
          >
            <Users size={22} />
          </button>
        )}
        {pane && (
          <button className="header-button" aria-label="Fechar conversa" title="Fechar" onClick={() => dispatch({ type: 'THREAD_PANE_CLOSE' })}>
            <X size={22} />
          </button>
        )}
        {!pane && (
          <SearchBox
            scope={guildId ? { guildId } : { channelId }}
            placeholder={guildId ? `Buscar em ${guildName}` : 'Buscar'}
          />
        )}
      </header>

      {isPrivateChannel && <CallView channel={channel} />}

      {ageGate ? <AgeGate channel={channel} /> : (<>
      <div className={`messages ${messageDisplay}`} ref={scroller} onScroll={onScroll}>
        {entry && !entry.hasMore && (
          <div className="channel-start">
            {isDm && (
              <>
                <Avatar user={recipient} size={80} />
                <h2>{displayName(recipient)}</h2>
                <div className="start-username">{recipient.username}</div>
                <p>Este é o começo do seu histórico de mensagens diretas com <b>{displayName(recipient)}</b>.</p>
              </>
            )}
            {isGroup && (
              <>
                <GroupIcon channel={channel} size={80} />
                <h2>{title}</h2>
                <p>Boas-vindas ao início do grupo <b>{title}</b>.</p>
              </>
            )}
            {isThreadChannel && (
              <>
                <div className="start-icon"><ThreadIcon size={36} /></div>
                <h2>{channel.name}</h2>
                <p>Iniciada por <b>{nameOf(channel.owner_id)}</b></p>
              </>
            )}
            {!isPrivateChannel && !isThreadChannel && (
              <>
                <div className="start-icon"><ChannelIcon channel={channel} size={44} className="" /></div>
                <h2>Boas-vindas a #{channel.name}!</h2>
                <p>Este é o começo do canal #{channel.name}.</p>
              </>
            )}
          </div>
        )}
        {loadingOlder && <div className="muted center">Carregando…</div>}
        {list.map((m, i) => {
          const prev = list[i - 1];
          const newDay = !prev || new Date(prev.timestamp).toDateString() !== new Date(m.timestamp).toDateString();
          const grouped = !newDay && m.id !== firstUnread && isUserMessage(prev) && isUserMessage(m)
            && prev.author.id === m.author.id && new Date(m.timestamp) - new Date(prev.timestamp) < GROUP_WINDOW_MS;
          const isBlocked = relationships[m.author.id]?.type === REL.BLOCKED && !revealed[m.id];

          return (
            <Fragment key={m.id}>
              {newDay && <div className="day-divider"><span>{formatDate(m.timestamp)}</span></div>}
              {m.id === firstUnread && <div className="new-divider"><span>Novo</span></div>}
              {isBlocked ? (
                <div className="blocked-message">
                  1 mensagem bloqueada — <button className="link" onClick={() => setRevealed((r) => ({ ...r, [m.id]: true }))}>Mostrar mensagem</button>
                </div>
              ) : (
                <Message message={m} grouped={grouped} ctx={ctx} />
              )}
            </Fragment>
          );
        })}
        {upload && <UploadProgress upload={upload} />}
      </div>

      <div className="composer">
        {replyTo && (
          <div className="reply-bar">
            <span>Respondendo a <b>{nameOf(replyTo.message.author.id, replyTo.message.author)}</b></span>
            {replyTo.message.author.id !== me.id && (
              <button
                className={`reply-ping${replyTo.ping ? ' on' : ''}`}
                title={replyTo.ping ? 'Clique para desativar a menção ao autor' : 'Clique para mencionar o autor'}
                onClick={() => setReplyTo((r) => ({ ...r, ping: !r.ping }))}
              >
                <AtSign size={16} /> {replyTo.ping ? 'ATIVADO' : 'DESATIVADO'}
              </button>
            )}
            <button className="reply-close" aria-label="Cancelar resposta" onClick={() => setReplyTo(null)}><X size={16} /></button>
          </div>
        )}
        {isThreadChannel && (threadMeta.archived || threadMeta.locked) && (
          <div className="thread-status-bar">
            {threadMeta.locked ? <Lock size={16} /> : <Archive size={16} />}
            {threadMeta.locked
              ? (threadManager ? 'Esta conversa está bloqueada. Você ainda pode falar nela porque gerencia mensagens.' : 'Esta conversa está bloqueada.')
              : 'Esta conversa está arquivada. Envie uma mensagem para desarquivá-la.'}
          </div>
        )}
        {canSend ? (
          <Composer
            channel={channel}
            placeholder={isDm ? `Conversar com @${title}` : isGroup || isThreadChannel ? `Conversar em ${title}` : `Conversar em #${title}`}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            onRestoreReply={setReplyTo}
            onSent={() => { stickToBottom.current = true; }}
            onEditLast={() => {
              const last = lastOwnMessage(list);
              if (last) setEditingId(last.id);
              return !!last;
            }}
            onUpload={setUpload}
            apiRef={composerApi}
            textareaRef={composer}
            canAttach={canAttach}
            slowmode={slowmode}
          />
        ) : (
          <div className="composer-box disabled">
            {blocked ? 'Você não pode enviar mensagens para um usuário que você bloqueou.'
              : threadLocked ? 'Esta conversa está bloqueada. Só quem gerencia mensagens pode falar nela.'
              : 'Você não tem permissão para enviar mensagens neste canal.'}
          </div>
        )}
        <div className="composer-footer">
          <TypingIndicator ids={typingIds} nameOf={nameOf} />
          {!isPrivateChannel && channel.rate_limit_per_user > 0 && canSend && <SlowmodeIndicator channel={channel} immune={!slowmode} />}
        </div>
      </div>
      </>)}
    </main>
  );
}

// Portão de idade dos canais NSFW (com restrição de idade), como no Discord.
function AgeGate({ channel }) {
  return (
    <div className="age-gate">
      <div className="age-gate-icon"><TriangleAlert size={56} /></div>
      <h2>Canal com restrição de idade</h2>
      <p>Este canal contém material adulto marcado com restrição de idade. Deseja continuar?</p>
      <div className="row">
        <button className="button secondary" onClick={() => navigate(HOME)}>Não</button>
        <button className="button brand" onClick={() => dispatch({ type: 'NSFW_ALLOW', d: channel.id })}>Continuar</button>
      </div>
    </div>
  );
}

// Ícone de ampulheta à direita, embaixo do compositor; mostra a contagem depois de enviar.
function SlowmodeIndicator({ channel, immune }) {
  const left = useCooldown(channel.id);
  const seconds = channel.rate_limit_per_user;
  const label = seconds < 60 ? `${seconds} segundos` : seconds < 3600 ? `${seconds / 60} minutos` : `${seconds / 3600} horas`;
  const title = immune ? 'O modo lento está ativado, mas você está imune.' : `Modo lento ativado. Os membros só podem enviar uma mensagem a cada ${label}.`;
  return (
    <div className="slowmode-indicator" title={title}>
      {left > 0 && <span>{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</span>}
      <Timer size={16} />
      {left === 0 && <span>Modo lento ativado</span>}
    </div>
  );
}

// "Fulano está digitando…" embaixo do compositor, com os três pontos animados.
function TypingIndicator({ ids, nameOf }) {
  if (!ids.length) return <div className="typing-indicator" />;
  const names = ids.map((id) => <b key={id}>{nameOf(id)}</b>);
  const text = ids.length === 1 ? <>{names[0]} está digitando…</>
    : ids.length === 2 ? <>{names[0]} e {names[1]} estão digitando…</>
    : ids.length === 3 ? <>{names[0]}, {names[1]} e {names[2]} estão digitando…</>
    : <>Várias pessoas estão digitando…</>;
  return (
    <div className="typing-indicator" aria-live="polite">
      <span className="typing-dots"><i /><i /><i /></span>
      <span className="typing-text">{text}</span>
    </div>
  );
}

// Envio de anexos em andamento: aparece no fim da lista, com progresso e cancelar.
function UploadProgress({ upload }) {
  const { files, progress, cancel } = upload;
  const label = files.length === 1 ? files[0].filename : `Enviando ${files.length} arquivos`;
  const total = files.reduce((sum, p) => sum + p.file.size, 0);
  return (
    <div className="upload-progress">
      <File size={36} strokeWidth={1.5} className="file-icon" />
      <div className="upload-progress-body">
        <div className="upload-progress-name"><span>{label}</span><small>{formatSize(total)}</small></div>
        <div className="upload-progress-bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      </div>
      <button className="upload-progress-cancel" aria-label="Cancelar envio" title="Cancelar" onClick={cancel}><X size={20} /></button>
    </div>
  );
}

export function NoTextChannel() {
  return (
    <main className="chat empty">
      <div className="empty-state">
        <AtSign size={48} />
        <h2>Nenhum canal de texto</h2>
        <p>Este servidor não tem canais de texto que você possa ver.</p>
      </div>
    </main>
  );
}
