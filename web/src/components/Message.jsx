import {
  ArrowLeft, ArrowRight, Copy, CornerUpLeft, Ellipsis, IdCard, Image as ImageIcon, Link, MessageSquareDot, MessagesSquare, Pencil, Phone,
  PhoneMissed, Pin, PinOff, Reply, SmilePlus, Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { openMenu, openPopout, showError } from '../lib/dialogs.js';
import { recentEmoji } from '../lib/emoji.js';
import {
  copyText, deleteMessage, editMessage, isUserMessage, markUnread, messageLink, pinMessage, toggleReaction, unpinMessage,
} from '../lib/messages.js';
import { formatDateTime, formatMessageTime, formatTime } from '../lib/util.js';
import MessageAttachments from './Attachments.jsx';
import Avatar from './Avatar.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import Markdown, { InlineMarkdown, isJumbo } from './Markdown.jsx';
import { ThreadPreview } from './Threads.jsx';

// Texto da mensagem com markdown, links (os de mensagem do app pulam até ela) e menções.
export function Content({ text, ...ctx }) {
  return <Markdown text={text} {...ctx} />;
}

const markdownProps = (ctx) => ({
  nameOf: ctx.nameOf,
  usersByName: ctx.usersByName,
  channelsByName: ctx.channelsByName,
  guildId: ctx.channel.guild_id,
  onMention: ctx.onPopout,
  onChannel: ctx.onChannel,
});

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

// Mensagens de boas-vindas do Discord (tipo 7); a escolhida depende do instante da mensagem.
const WELCOME = [
  (u) => <>{u} entrou na festa.</>,
  (u) => <>{u} está aqui.</>,
  (u) => <>Boas-vindas, {u}. Esperamos que você tenha trazido pizza.</>,
  (u) => <>Um {u} selvagem apareceu.</>,
  (u) => <>{u} acabou de chegar.</>,
  (u) => <>{u} acabou de deslizar para dentro do servidor.</>,
  (u) => <>{u} acabou de aparecer!</>,
  (u) => <>Boas-vindas, {u}. Diga oi!</>,
  (u) => <>{u} pulou para dentro do servidor.</>,
  (u) => <>Todos deem boas-vindas a {u}!</>,
  (u) => <>Que bom que você está aqui, {u}.</>,
  (u) => <>Bom te ver, {u}.</>,
  (u) => <>Oba, você chegou, {u}!</>,
];

// --- mensagens de sistema (chamada, grupo, fixar) ---

function SystemMessage({ message: m, ctx }) {
  const name = (user) => <button className="author" onClick={(e) => ctx.onPopout(user.id, e)}>{ctx.nameOf(user.id, user)}</button>;
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
  } else if (m.type === 7) {
    tone = 'join';
    icon = <ArrowRight size={18} />;
    text = WELCOME[new Date(m.timestamp).getTime() % WELCOME.length](actor);
  } else if (m.type === 18) {
    // Conversa criada sem mensagem de origem.
    const thread = ctx.threadOf(m.meta?.thread_id);
    icon = <MessagesSquare size={18} />;
    text = (
      <>
        {actor} iniciou uma conversa:{' '}
        {thread ? <button className="link strong" onClick={() => ctx.onOpenThread(thread)}>{thread.name}</button> : <b>{m.content}</b>}.
        Veja todas as <button className="link strong" onClick={ctx.onOpenThreads}>conversas</button>.
      </>
    );
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

// Primeira mensagem de uma conversa (tipo 21): mostra a mensagem de origem.
function StarterMessage({ message, ctx }) {
  const ref = message.referenced_message;
  if (!ref) return <div className="message system-message starter-missing" id={`msg-${message.id}`}><span className="system-icon"><MessagesSquare size={18} /></span><div className="system-text">A mensagem original foi excluída.</div></div>;
  const author = ctx.users[ref.author.id] ?? ref.author;
  return (
    <div className="message starter-message" id={`msg-${message.id}`}>
      <div className="message-row">
        <button className="message-avatar" onClick={(e) => ctx.onPopout(ref.author.id, e)}><Avatar user={author} size={40} /></button>
        <div className="message-body">
          <div className="message-meta">
            <button className="author" style={{ color: ctx.colorOf(ref.author.id) }} onClick={(e) => ctx.onPopout(ref.author.id, e)}>{ctx.nameOf(ref.author.id, author)}</button>
            <Time iso={ref.timestamp} />
          </div>
          {ref.content && <div className={`content${isJumbo(ref.content) ? ' jumbo' : ''}`}><Markdown text={ref.content} {...markdownProps(ctx)} /></div>}
          <MessageAttachments message={ref} />
        </div>
      </div>
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
    // Com anexos, apagar o texto só remove o texto; sem anexos, é excluir a mensagem.
    if (!content && !message.attachments?.length) {
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
        const names = r.user_ids.map((id) => ctx.nameOf(id)).join(', ');
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
      {ctx.canReact && (
        <button className="reaction add" aria-label="Adicionar reação" title="Adicionar reação" onClick={(e) => ctx.openPicker(message, e.currentTarget.getBoundingClientRect())}>
          <SmilePlus size={16} />
        </button>
      )}
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
        {message.reply_ping ? '@' : ''}{ctx.nameOf(ref.author.id, author)}
      </button>
      <button className="reply-content" onClick={() => ctx.onJump(ref.id)}>
        {ref.content ? <InlineMarkdown text={ref.content} {...markdownProps(ctx)} /> : <i>Clique para ver o anexo</i>}
      </button>
      {!!ref.attachments?.length && <ImageIcon size={16} className="reply-attachment-icon" />}
    </div>
  );
}

export function messageMenuItems(message, ctx, anchorRect) {
  const own = message.author.id === ctx.me.id;
  return [
    ctx.canReact && {
      custom: (close) => (
        <div className="menu-reactions">
          {recentEmoji().slice(0, 4).map((emoji) => (
            <button key={emoji} onClick={() => { close(); toggleReaction(message, emoji); }}>{emoji}</button>
          ))}
        </div>
      ),
    },
    ctx.canReact && { label: 'Adicionar reação', icon: SmilePlus, onClick: () => ctx.openPicker(message, anchorRect) },
    own && { label: 'Editar mensagem', icon: Pencil, onClick: () => ctx.onEdit(message.id) },
    ctx.canPin && (message.pinned
      ? { label: 'Desafixar mensagem', icon: PinOff, onClick: () => unpinMessage(message) }
      : { label: 'Fixar mensagem', icon: Pin, onClick: () => pinMessage(message) }),
    ctx.canSend && { label: 'Responder', icon: Reply, onClick: () => ctx.onReply(message) },
    ctx.canCreateThread && !ctx.threadOf(message.id) && { label: 'Criar conversa', icon: MessagesSquare, onClick: () => ctx.onCreateThread(message) },
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
  if (m.type === 21) return <StarterMessage message={m} ctx={ctx} />;
  if (!isUserMessage(m)) return <SystemMessage message={m} ctx={ctx} />;
  const thread = ctx.threadOf(m.id);

  const author = ctx.users[m.author.id] ?? m.author;
  const own = m.author.id === ctx.me.id;
  const editing = ctx.editingId === m.id;
  const isReply = !!m.message_reference;
  const showHeader = !grouped || isReply;
  const lower = m.content.toLowerCase();
  const mentioned = (m.reply_ping && m.referenced_message?.author.id === ctx.me.id)
    || lower.includes(`@${ctx.me.username.toLowerCase()}`)
    || !!m.mention_everyone; // @everyone/@here só destacam se o autor tinha permissão

  const openMore = (rect, side = 'left') =>
    openMenu({ rect, side, width: 220, owner: `message-${m.id}`, items: messageMenuItems(m, ctx, rect) });

  const body = editing
    ? <Editor message={m} onDone={() => ctx.onEdit(null)} />
    : (m.content || m.edited_timestamp) && (
      <div className={`content${isJumbo(m.content) ? ' jumbo' : ''}`}>
        <Markdown text={m.content} {...markdownProps(ctx)} />
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
              <button className="author" style={{ color: ctx.colorOf(m.author.id) }} onClick={(e) => ctx.onPopout(m.author.id, e)}>{ctx.nameOf(m.author.id, author)}</button>
              {body}
            </>
          ) : (
            <>
              {showHeader && (
                <div className="message-meta">
                  <button className="author" style={{ color: ctx.colorOf(m.author.id) }} onClick={(e) => ctx.onPopout(m.author.id, e)}>{ctx.nameOf(m.author.id, author)}</button>
                  <Time iso={m.timestamp} />
                </div>
              )}
              {body}
            </>
          )}
          <MessageAttachments message={m} />
          <Reactions message={m} ctx={ctx} />
          {thread && <ThreadPreview thread={thread} onOpen={() => ctx.onOpenThread(thread)} />}
        </div>
      </div>

      {!editing && (
        <div className="message-toolbar">
          {ctx.canReact && (
            <button aria-label="Adicionar reação" title="Adicionar reação" onClick={(e) => ctx.openPicker(m, e.currentTarget.getBoundingClientRect())}>
              <SmilePlus size={18} />
            </button>
          )}
          {own ? (
            <button aria-label="Editar" title="Editar" onClick={() => ctx.onEdit(m.id)}><Pencil size={18} /></button>
          ) : ctx.canSend && (
            <button aria-label="Responder" title="Responder" onClick={() => ctx.onReply(m)}><CornerUpLeft size={18} /></button>
          )}
          {own && ctx.canSend && (
            <button aria-label="Responder" title="Responder" onClick={() => ctx.onReply(m)}><CornerUpLeft size={18} /></button>
          )}
          {ctx.canCreateThread && !thread && (
            <button aria-label="Criar conversa" title="Criar conversa" onClick={() => ctx.onCreateThread(m)}><MessagesSquare size={18} /></button>
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
