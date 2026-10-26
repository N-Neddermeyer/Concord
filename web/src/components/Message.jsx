import {
  ArrowLeft, ArrowRight, Copy, CornerUpLeft, Ellipsis, IdCard, Link, MessageSquareDot, Pencil, Phone, PhoneMissed, Pin,
  PinOff, Reply, SmilePlus, Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { openMenu, openPopout, showError } from '../lib/dialogs.js';
import { recentEmoji } from '../lib/emoji.js';
import {
  copyText, deleteMessage, editMessage, isUserMessage, markUnread, messageLink, parseMessageLink, pinMessage, toggleReaction,
  unpinMessage,
} from '../lib/messages.js';
import { HOME, jumpToMessage } from '../lib/store.js';
import { displayName, formatDateTime, formatMessageTime, formatTime } from '../lib/util.js';
import Avatar from './Avatar.jsx';
import EmojiPicker from './EmojiPicker.jsx';

const TOKEN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])|(@[\w.]{2,32})/g;

// Texto da mensagem com links clicáveis (links de mensagem do app pulam até ela) e menções destacadas.
export function Content({ text, usersByName, onMention }) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) {
      const internal = parseMessageLink(match[1]);
      parts.push(
        <a
          key={match.index}
          href={match[1]}
          target="_blank"
          rel="noreferrer"
          onClick={internal ? (e) => {
            e.preventDefault();
            jumpToMessage(internal.guildId === '@me' ? HOME : internal.guildId, internal.channelId, internal.messageId);
          } : undefined}
        >
          {match[1]}
        </a>,
      );
    } else {
      const user = usersByName.get(match[2].slice(1).toLowerCase());
      parts.push(user ? (
        <button key={match.index} className="mention" onClick={(e) => onMention(user.id, e)}>@{displayName(user)}</button>
      ) : match[2]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

// "alguns segundos", "um minuto", "5 minutos", "uma hora"… como no Discord.
function durationText(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'alguns segundos';
  if (minutes < 2) return 'um minuto';
  if (minutes < 60) return `${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  return hours < 2 ? 'uma hora' : `${hours} horas`;
}

const Time = ({ iso }) => <span className="timestamp" title={formatDateTime(iso)}>{formatMessageTime(iso)}</span>;

// --- mensagens de sistema (chamada, grupo, fixar) ---

function SystemMessage({ message: m, ctx }) {
  const name = (user) => <button className="author" onClick={(e) => ctx.onPopout(user.id, e)}>{displayName(ctx.users[user.id] ?? user)}</button>;
  const actor = name(m.author);
  let icon;
  let tone = '';
  let text;

  if (m.type === 3) {
    const { participants, ended_timestamp: ended } = m.call;
    const missed = ended && m.author.id !== ctx.me.id && !participants.includes(ctx.me.id);
    const duration = ended ? durationText(new Date(ended) - new Date(m.timestamp)) : null;
    tone = missed ? 'missed' : ended ? 'ended' : 'ongoing';
    icon = missed ? <PhoneMissed size={18} /> : <Phone size={18} />;
    text = missed ? <>Você perdeu uma chamada de {actor} que durou {duration}.</>
      : ended ? <>{actor} iniciou uma chamada que durou {duration}.</>
      : <>{actor} iniciou uma chamada.{!ctx.inThisCall && <> <button className="link" onClick={ctx.onJoinCall}>Entrar na chamada</button></>}</>;
  } else if (m.type === 1) {
    tone = 'join';
    icon = <ArrowRight size={18} />;
    text = <>{actor} adicionou {m.meta?.user ? name(m.meta.user) : 'alguém'} ao grupo.</>;
  } else if (m.type === 2) {
    tone = 'leave';
    icon = <ArrowLeft size={18} />;
    text = m.meta?.user_id === m.author.id ? <>{actor} saiu do grupo.</> : <>{actor} removeu {m.meta?.user ? name(m.meta.user) : 'alguém'} do grupo.</>;
  } else if (m.type === 4) {
    icon = <Pencil size={18} />;
    text = m.content ? <>{actor} alterou o nome do canal: <b>{m.content}</b></> : <>{actor} removeu o nome do grupo.</>;
  } else if (m.type === 6) {
    icon = <Pin size={18} />;
    text = (
      <>
        {actor} fixou <button className="link strong" onClick={() => ctx.onJump(m.message_reference?.message_id)}>uma mensagem</button> neste canal.
        Veja todas as <button className="link strong" onClick={ctx.onOpenPins}>mensagens fixadas</button>.
      </>
    );
  } else {
    return null;
  }

  return (
    <div className={`message system-message ${tone}`} id={`msg-${m.id}`}>
      <span className="system-icon">{icon}</span>
      <div className="system-text">{text} <Time iso={m.timestamp} /></div>
    </div>
  );
}

// --- edição inline ---

function Editor({ message, onDone }) {
  const [value, setValue] = useState(message.content);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = async () => {
    const content = value.trim();
    if (content === message.content) return onDone();
    if (!content) {
      // Salvar vazio = excluir (com confirmação), como no Discord.
      if (await deleteMessage(message)) onDone();
      return;
    }
    try {
      await editMessage(message, content);
      onDone();
    } catch (e) {
      showError(e.message);
    }
  };

  return (
    <div className="message-editor">
      <div className="composer-box">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          maxLength={2000}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onDone();
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            }
          }}
        />
      </div>
      <div className="editor-hint">
        esc para <button className="link" onClick={onDone}>cancelar</button> • enter para <button className="link" onClick={save}>salvar</button>
      </div>
    </div>
  );
}

// --- mensagem de usuário ---

function Reactions({ message, ctx }) {
  if (!message.reactions?.length) return null;
  return (
    <div className="reactions">
      {message.reactions.map((r) => {
        const names = r.user_ids.map((id) => displayName(ctx.users[id])).join(', ');
        return (
          <button
            key={r.emoji}
            className={`reaction${r.user_ids.includes(ctx.me.id) ? ' me' : ''}`}
            title={`${names} reagiu com ${r.emoji}`}
            onClick={() => toggleReaction(message, r.emoji)}
          >
            <span className="reaction-emoji">{r.emoji}</span>
            <span className="reaction-count">{r.user_ids.length}</span>
          </button>
        );
      })}
      <button className="reaction add" aria-label="Adicionar reação" title="Adicionar reação" onClick={(e) => ctx.openPicker(message, e.currentTarget.getBoundingClientRect())}>
        <SmilePlus size={16} />
      </button>
    </div>
  );
}

function ReplyPreview({ message, ctx }) {
  const ref = message.referenced_message;
  if (!ref) {
    return <div className="reply-preview"><span className="reply-spine" /><span className="reply-deleted">A mensagem original foi excluída</span></div>;
  }
  const author = ctx.users[ref.author.id] ?? ref.author;
  return (
    <div className="reply-preview">
      <span className="reply-spine" />
      <Avatar user={author} size={16} />
      <button className="reply-author" style={{ color: ctx.colorOf(ref.author.id) }} onClick={(e) => ctx.onPopout(ref.author.id, e)}>
        {message.reply_ping ? '@' : ''}{displayName(author)}
      </button>
      <button className="reply-content" onClick={() => ctx.onJump(ref.id)}>{ref.content || 'Clique para ver o anexo'}</button>
    </div>
  );
}

export function messageMenuItems(message, ctx, anchorRect) {
  const own = message.author.id === ctx.me.id;
  return [
    {
      custom: (close) => (
        <div className="menu-reactions">
          {recentEmoji().slice(0, 4).map((emoji) => (
            <button key={emoji} onClick={() => { close(); toggleReaction(message, emoji); }}>{emoji}</button>
          ))}
        </div>
      ),
    },
    { label: 'Adicionar reação', icon: SmilePlus, onClick: () => ctx.openPicker(message, anchorRect) },
    own && { label: 'Editar mensagem', icon: Pencil, onClick: () => ctx.onEdit(message.id) },
    ctx.canPin && (message.pinned
      ? { label: 'Desafixar mensagem', icon: PinOff, onClick: () => unpinMessage(message) }
      : { label: 'Fixar mensagem', icon: Pin, onClick: () => pinMessage(message) }),
    ctx.canSend && { label: 'Responder', icon: Reply, onClick: () => ctx.onReply(message) },
    { separator: true },
    { label: 'Copiar texto', icon: Copy, onClick: () => copyText(message.content) },
    { label: 'Marcar como não lida', icon: MessageSquareDot, onClick: () => markUnread(message, ctx.list) },
    { label: 'Copiar link da mensagem', icon: Link, onClick: () => copyText(messageLink(ctx.channel, message)) },
    (own || ctx.canManage) && { label: 'Excluir mensagem', icon: Trash2, danger: true, onClick: () => deleteMessage(message) },
    { separator: true },
    { label: 'Copiar ID da mensagem', icon: IdCard, onClick: () => copyText(message.id) },
  ];
}

export default function Message({ message: m, grouped, ctx }) {
  if (!isUserMessage(m)) return <SystemMessage message={m} ctx={ctx} />;

  const author = ctx.users[m.author.id] ?? m.author;
  const own = m.author.id === ctx.me.id;
  const editing = ctx.editingId === m.id;
  const isReply = !!m.message_reference;
  const showHeader = !grouped || isReply;
  const mentioned = (m.reply_ping && m.referenced_message?.author.id === ctx.me.id)
    || m.content.toLowerCase().includes(`@${ctx.me.username.toLowerCase()}`);

  const openMore = (rect, side = 'left') =>
    openMenu({ rect, side, width: 220, owner: `message-${m.id}`, items: messageMenuItems(m, ctx, rect) });

  const body = editing
    ? <Editor message={m} onDone={() => ctx.onEdit(null)} />
    : (
      <div className="content">
        <Content text={m.content} usersByName={ctx.usersByName} onMention={ctx.onPopout} />
        {m.edited_timestamp && <span className="edited" title={formatDateTime(m.edited_timestamp)}> (editado)</span>}
      </div>
    );

  const className = [
    'message',
    ctx.compact ? 'compact' : '',
    showHeader ? '' : 'grouped',
    mentioned ? 'mentioned' : '',
    ctx.highlightId === m.id ? 'highlight' : '',
    editing ? 'editing' : '',
    ctx.menuFor === m.id ? 'menu-open' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      id={`msg-${m.id}`}
      onContextMenu={(e) => {
        if (e.target.closest('a, textarea')) return;
        e.preventDefault();
        openMore({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }, 'below');
      }}
    >
      {isReply && <ReplyPreview message={m} ctx={ctx} />}
      <div className="message-row">
        {ctx.compact ? (
          <span className="compact-time" title={formatDateTime(m.timestamp)}>{formatTime(m.timestamp)}</span>
        ) : showHeader ? (
          <button className="message-avatar" onClick={(e) => ctx.onPopout(m.author.id, e)}><Avatar user={author} size={40} /></button>
        ) : (
          <span className="gutter-time" title={formatDateTime(m.timestamp)}>{formatTime(m.timestamp)}</span>
        )}
        <div className="message-body">
          {ctx.compact ? (
            <>
              <button className="author" style={{ color: ctx.colorOf(m.author.id) }} onClick={(e) => ctx.onPopout(m.author.id, e)}>{displayName(author)}</button>
              {body}
            </>
          ) : (
            <>
              {showHeader && (
                <div className="message-meta">
                  <button className="author" style={{ color: ctx.colorOf(m.author.id) }} onClick={(e) => ctx.onPopout(m.author.id, e)}>{displayName(author)}</button>
                  <Time iso={m.timestamp} />
                </div>
              )}
              {body}
            </>
          )}
          <Reactions message={m} ctx={ctx} />
        </div>
      </div>

      {!editing && (
        <div className="message-toolbar">
          <button aria-label="Adicionar reação" title="Adicionar reação" onClick={(e) => ctx.openPicker(m, e.currentTarget.getBoundingClientRect())}>
            <SmilePlus size={18} />
          </button>
          {own ? (
            <button aria-label="Editar" title="Editar" onClick={() => ctx.onEdit(m.id)}><Pencil size={18} /></button>
          ) : ctx.canSend && (
            <button aria-label="Responder" title="Responder" onClick={() => ctx.onReply(m)}><CornerUpLeft size={18} /></button>
          )}
          {own && ctx.canSend && (
            <button aria-label="Responder" title="Responder" onClick={() => ctx.onReply(m)}><CornerUpLeft size={18} /></button>
          )}
          <button aria-label="Mais" title="Mais" onClick={(e) => openMore(e.currentTarget.getBoundingClientRect())}>
            <Ellipsis size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

// Abre o seletor de emoji ao lado do elemento clicado e reage com o escolhido.
export function openReactionPicker(message, rect) {
  openPopout({ Component: EmojiPicker, props: { onPick: (emoji) => toggleReaction(message, emoji) }, rect, side: 'left' });
}
