import { AtSign, Hash, Phone, Pin, UserPlus, Users, Video, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { acceptCall, startCall, startVideoCall } from '../lib/calls.js';
import { openPopout, showError, useDialogs } from '../lib/dialogs.js';
import { isUserMessage } from '../lib/messages.js';
import { P, has, memberColor, permissionsFor } from '../lib/permissions.js';
import { useSettings } from '../lib/settings.js';
import { REL, dispatch, dmRecipient, isPrivate, privateChannelName, useStore } from '../lib/store.js';
import { STATUS_LABELS, compareIds, displayName, formatDate } from '../lib/util.js';
import { useVoice } from '../lib/voice.js';
import AddToDmPopout from './AddToDmPopout.jsx';
import Avatar, { GroupIcon } from './Avatar.jsx';
import CallView from './CallView.jsx';
import Message, { openReactionPicker } from './Message.jsx';
import PinsPopout from './PinsPopout.jsx';

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

export default function Chat({ channelId }) {
  const channel = useStore((s) => s.channels[channelId]);
  const guildId = channel.guild_id;
  const entry = useStore((s) => s.messages[channelId]);
  const me = useStore((s) => s.user);
  const users = useStore((s) => s.users);
  const relationships = useStore((s) => s.relationships);
  const presences = useStore((s) => s.presences);
  const showMembers = useStore((s) => s.showMembers);
  const perms = useStore((s) => (guildId ? permissionsFor(s, guildId) : 0));
  const readState = useStore((s) => s.readStates[channelId]);
  const manualUnread = useStore((s) => !!s.manualUnread[channelId]);
  const jump = useStore((s) => (s.jump?.channelId === channelId ? s.jump : null));
  const call = useStore((s) => s.calls[channelId]);
  const state = useStore((s) => s);
  const { messageDisplay } = useSettings();
  const session = useVoice();
  const menuOwner = useDialogs().menu?.owner;
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null); // { message, ping }
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

  const isPrivateChannel = isPrivate(channel);
  const isDm = channel.type === 1;
  const isGroup = channel.type === 3;
  const recipient = isDm ? dmRecipient(state, channel) : null;
  const blocked = isDm && relationships[recipient.id]?.type === REL.BLOCKED;
  const canSend = isPrivateChannel ? !blocked : has(perms, P.SEND_MESSAGES);
  const canManage = has(perms, P.MANAGE_MESSAGES);
  const canPin = isPrivateChannel || canManage;
  const title = isPrivateChannel ? privateChannelName(state, channel) : channel.name;

  const usersByName = useMemo(() => new Map(Object.values(users).map((u) => [u.username.toLowerCase(), u])), [users]);

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
  const hasCall = !!call;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [hasCall]);

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

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    const reply = replyTo;
    setDraft('');
    setReplyTo(null);
    stickToBottom.current = true;
    try {
      const body = { content };
      if (reply) {
        body.message_reference = { message_id: reply.message.id };
        body.allowed_mentions = { replied_user: reply.ping };
      }
      // A resposta também chega via gateway (MESSAGE_CREATE); o store ignora duplicatas pelo id.
      const message = await api(`/channels/${channelId}/messages`, { method: 'POST', body });
      dispatch({ type: 'MESSAGE_CREATE', d: message });
    } catch (e) {
      setDraft(content);
      setReplyTo(reply);
      showError(e.message);
    }
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
    compact: messageDisplay === 'compact',
    canSend,
    canManage: canManage,
    canPin,
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
  };

  const firstUnread = unreadMarker
    ? list.find((m) => compareIds(m.id, unreadMarker) > 0 && m.author.id !== me.id)?.id
    : null;

  return (
    <main className="chat">
      <header className="chat-header">
        {isDm && (
          <>
            <Avatar user={recipient} size={24} status={presences[recipient.id] ?? 'offline'} />
            <h1>{title}</h1>
            <span className="header-status">{STATUS_LABELS[presences[recipient.id] ?? 'offline']}</span>
          </>
        )}
        {isGroup && (
          <>
            <GroupIcon channel={channel} size={24} />
            <GroupName channel={channel} name={title} />
          </>
        )}
        {!isPrivateChannel && (
          <>
            <Hash size={24} className="header-icon" />
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
        {(isGroup || !isPrivateChannel) && (
          <button
            className={`header-button${showMembers ? ' active' : ''}`}
            aria-label={showMembers ? 'Ocultar lista de membros' : 'Mostrar lista de membros'}
            title={showMembers ? 'Ocultar lista de membros' : 'Mostrar lista de membros'}
            onClick={() => dispatch({ type: 'TOGGLE_MEMBERS' })}
          >
            <Users size={22} />
          </button>
        )}
      </header>

      {isPrivateChannel && <CallView channel={channel} />}

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
            {!isPrivateChannel && (
              <>
                <div className="start-icon"><Hash size={44} /></div>
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
      </div>

      <div className="composer">
        {replyTo && (
          <div className="reply-bar">
            <span>Respondendo a <b>{displayName(users[replyTo.message.author.id] ?? replyTo.message.author)}</b></span>
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
        {canSend ? (
          <div className={`composer-box${replyTo ? ' replying' : ''}`}>
            <textarea
              ref={composer}
              rows={1}
              value={draft}
              placeholder={isDm ? `Conversar com @${title}` : isGroup ? `Conversar em ${title}` : `Conversar em #${title}`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                } else if (e.key === 'Escape' && replyTo) {
                  e.stopPropagation();
                  setReplyTo(null);
                } else if (e.key === 'ArrowUp' && !draft) {
                  // Seta para cima com o campo vazio edita a sua última mensagem.
                  const last = [...list].reverse().find((m) => m.author.id === me.id && isUserMessage(m));
                  if (last) {
                    e.preventDefault();
                    setEditingId(last.id);
                  }
                }
              }}
              maxLength={2000}
            />
            {draft.length > 1800 && <span className={`char-count${draft.length >= 2000 ? ' over' : ''}`}>{2000 - draft.length}</span>}
          </div>
        ) : (
          <div className="composer-box disabled">
            {blocked ? 'Você não pode enviar mensagens para um usuário que você bloqueou.' : 'Você não tem permissão para enviar mensagens neste canal.'}
          </div>
        )}
      </div>
    </main>
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
