import { Eye, EyeOff, Hash, Paperclip, Pencil, PlusCircle, Smile, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { confirmDialog, openMenu, openModal, openPopout, showError } from '../lib/dialogs.js';
import { rememberEmoji, searchEmoji } from '../lib/emoji.js';
import { isUserMessage } from '../lib/messages.js';
import { dispatch, getState, useStore } from '../lib/store.js';
import { notifyTyping, resetTyping } from '../lib/typing.js';
import { MAX_FILES, MAX_FILE_SIZE, releasePending, toPending, uploadFiles } from '../lib/upload.js';
import { displayName } from '../lib/util.js';
import { fileIcon } from './Attachments.jsx';
import Avatar from './Avatar.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import { Modal } from './Modal.jsx';

const MAX_LENGTH = 2000;
const MAX_SUGGESTIONS = 10;
const drafts = new Map(); // channelId -> rascunho

// --- autocompletar (@membro, #canal, :emoji) ---

// Palavra sendo digitada antes do cursor que dispara sugestões, como no Discord.
function triggerAt(text, caret) {
  const m = text.slice(0, caret).match(/(?:^|\s)([@#:])([^\s@#:]*)$/);
  if (!m) return null;
  if (m[1] === ':' && m[2].length < 2) return null;
  return { char: m[1], query: m[2].toLowerCase(), start: caret - m[2].length - 1, end: caret };
}

function useSuggestions(trigger, channel) {
  const users = useStore((s) => s.users);
  const members = useStore((s) => (channel.guild_id ? s.members[channel.guild_id] : null));
  const channels = useStore((s) => s.channels);
  const me = useStore((s) => s.user);

  return useMemo(() => {
    if (!trigger) return null;
    const { char, query } = trigger;
    if (char === '@') {
      const ids = channel.guild_id ? Object.keys(members ?? {}) : [me.id, ...channel.recipients.map((u) => u.id)];
      const rank = (u) => {
        const name = displayName(u).toLowerCase();
        const username = u.username.toLowerCase();
        if (!query) return 1;
        if (username.startsWith(query) || name.startsWith(query)) return 0;
        return username.includes(query) || name.includes(query) ? 1 : -1;
      };
      const people = ids
        .map((id) => users[id])
        .filter((u) => u && rank(u) >= 0)
        .sort((a, b) => rank(a) - rank(b) || displayName(a).localeCompare(displayName(b)))
        .slice(0, MAX_SUGGESTIONS)
        .map((u) => ({ key: u.id, insert: `@${u.username} `, user: u }));
      const special = channel.guild_id
        ? [
          { key: 'everyone', insert: '@everyone ', label: '@everyone', hint: 'Notifica todos que têm permissão para ver este canal.' },
          { key: 'here', insert: '@here ', label: '@here', hint: 'Notifica todos que estão online e têm permissão para ver este canal.' },
        ].filter((s) => s.label.slice(1).startsWith(query))
        : [];
      return { title: 'Membros', items: [...people, ...special] };
    }
    if (char === '#') {
      if (!channel.guild_id) return null;
      const items = Object.values(channels)
        .filter((c) => c.guild_id === channel.guild_id && c.type === 0 && c.name.toLowerCase().includes(query))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(query)) - Number(!b.name.toLowerCase().startsWith(query)) || a.position - b.position)
        .slice(0, MAX_SUGGESTIONS)
        .map((c) => ({ key: c.id, insert: `#${c.name} `, channel: c }));
      return { title: 'Canais de texto', items };
    }
    const items = searchEmoji(query).slice(0, MAX_SUGGESTIONS).map(([emoji, keywords]) => ({
      key: emoji, insert: `${emoji} `, emoji, name: keywords.split(' ').find((w) => w.startsWith(query)) ?? keywords.split(' ')[0],
    }));
    return { title: <>Emoji correspondentes <b>:{query}</b></>, items };
  }, [trigger, channel, users, members, channels, me]);
}

function Suggestions({ list, selected, onHover, onPick }) {
  return (
    <div className="autocomplete" onMouseDown={(e) => e.preventDefault()}>
      <h3 className="autocomplete-title">{list.title}</h3>
      {list.items.map((item, i) => (
        <button
          key={item.key}
          className={`autocomplete-row${i === selected ? ' selected' : ''}`}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(item)}
        >
          {item.user && (
            <>
              <Avatar user={item.user} size={24} />
              <span className="autocomplete-name">{displayName(item.user)}</span>
              <span className="autocomplete-hint">{item.user.username}</span>
            </>
          )}
          {item.label && (
            <>
              <span className="autocomplete-name">{item.label}</span>
              <span className="autocomplete-hint">{item.hint}</span>
            </>
          )}
          {item.channel && (
            <>
              <Hash size={20} className="autocomplete-icon" />
              <span className="autocomplete-name">{item.channel.name}</span>
            </>
          )}
          {item.emoji && (
            <>
              <span className="autocomplete-emoji">{item.emoji}</span>
              <span className="autocomplete-name">:{item.name}:</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

// --- anexos antes do envio ---

function EditAttachmentModal({ close, pending }) {
  const [filename, setFilename] = useState(pending.filename);
  const [spoiler, setSpoiler] = useState(pending.spoiler);
  return (
    <Modal
      title={pending.filename}
      className="small"
      onClose={() => close(null)}
      footer={
        <>
          <button className="button link-button" onClick={() => close(null)}>Cancelar</button>
          <button className="button brand" disabled={!filename.trim()} onClick={() => close({ filename: filename.trim(), spoiler })}>Salvar</button>
        </>
      }
    >
      {pending.preview && <img className="attachment-modal-preview" src={pending.preview} alt="" />}
      <label className="field">
        <span className="field-label">Nome do arquivo</span>
        <input className="input" value={filename} maxLength={100} autoFocus onChange={(e) => setFilename(e.target.value)} />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />
        <span>Marcar como spoiler</span>
      </label>
    </Modal>
  );
}

function PendingCard({ pending, onChange, onRemove }) {
  const FileIcon = fileIcon(pending.filename, pending.file.type);
  const edit = async () => {
    const result = await openModal(EditAttachmentModal, { pending });
    if (result) onChange(result);
  };
  return (
    <li className={`upload-card${pending.spoiler ? ' spoiler' : ''}`}>
      <div className="upload-card-media">
        {pending.preview ? <img src={pending.preview} alt="" draggable={false} /> : <FileIcon size={64} strokeWidth={1.25} className="file-icon" />}
        {pending.spoiler && <span className="spoiler-badge">Spoiler</span>}
      </div>
      <div className="upload-card-name" title={pending.filename}>{pending.filename}</div>
      <div className="upload-card-actions">
        <button
          aria-label={pending.spoiler ? 'Remover spoiler' : 'Marcar como spoiler'}
          title={pending.spoiler ? 'Remover spoiler' : 'Marcar como spoiler'}
          onClick={() => onChange({ spoiler: !pending.spoiler })}
        >
          {pending.spoiler ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
        <button aria-label="Modificar anexo" title="Modificar anexo" onClick={edit}><Pencil size={20} /></button>
        <button className="danger" aria-label="Remover anexo" title="Remover anexo" onClick={onRemove}><Trash2 size={20} /></button>
      </div>
    </li>
  );
}

// --- compositor ---

export default function Composer({
  channel, placeholder, replyTo, onClearReply, onRestoreReply, onSent, onEditLast, onUpload, apiRef, textareaRef,
}) {
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  const [caret, setCaret] = useState(0);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(null); // gatilho fechado com Esc (até mudar)
  const fileInput = useRef(null);
  const plusButton = useRef(null);
  const emojiButton = useRef(null);

  // Como no Discord, o rascunho fica guardado por canal; os anexos não enviados se perdem.
  useEffect(() => {
    setDraft(drafts.get(channel.id) ?? '');
    setFiles((current) => {
      current.forEach(releasePending);
      return [];
    });
  }, [channel.id]);
  useEffect(() => {
    if (draft) drafts.set(channel.id, draft);
    else drafts.delete(channel.id);
  }, [channel.id, draft]);

  const trigger = useMemo(() => {
    const t = triggerAt(draft, caret);
    return t && dismissed !== `${t.start}:${draft.slice(t.start, t.end)}` ? t : null;
  }, [draft, caret, dismissed]);
  const suggestions = useSuggestions(trigger, channel);
  const showSuggestions = !!suggestions?.items.length;
  useEffect(() => setSelected(0), [trigger?.char, trigger?.query]);

  // Valida e prepara arquivos (escolhidos, colados ou soltos). Devolve null se recusou.
  const prepare = async (list, already) => {
    const incoming = [...list];
    if (!incoming.length) return null;
    if (already + incoming.length > MAX_FILES) {
      confirmDialog({ title: 'Muitos uploads!', body: `Você só pode enviar até ${MAX_FILES} arquivos de uma vez!`, confirmLabel: 'Ok', alertOnly: true });
      return null;
    }
    if (incoming.some((f) => f.size > MAX_FILE_SIZE)) {
      confirmDialog({ title: 'Seu arquivo é poderoso demais', body: 'O tamanho máximo para envio de arquivos é 10 MB.', confirmLabel: 'Ok', alertOnly: true });
      return null;
    }
    return Promise.all(incoming.map(toPending));
  };

  const addFiles = async (list) => {
    const pending = await prepare(list, files.length);
    if (!pending) return;
    setFiles((current) => [...current, ...pending]);
    textareaRef.current?.focus();
  };

  // Shift ao soltar: envia os arquivos na hora, sem passar pelo compositor.
  const sendFilesNow = async (list) => {
    const pending = await prepare(list, 0);
    if (pending) send({ only: pending });
  };

  const send = async ({ only } = {}) => {
    const content = only ? '' : draft.trim();
    const attached = only ?? files;
    if (!content && !attached.length) return;
    if (content.length > MAX_LENGTH) {
      const ok = await confirmDialog({
        title: 'Sua mensagem é muito longa',
        body: `O limite é de ${MAX_LENGTH} caracteres. Você pode enviá-la como um arquivo de texto.`,
        confirmLabel: 'Enviar como arquivo',
      });
      if (ok) {
        setDraft('');
        addFiles([new File([content], 'message.txt', { type: 'text/plain' })]);
      }
      return;
    }
    const reply = only ? null : replyTo;
    if (!only) {
      setDraft('');
      setFiles([]);
      onClearReply();
    }
    resetTyping(channel.id);
    onSent();

    const body = { content };
    if (reply) {
      body.message_reference = { message_id: reply.message.id };
      body.allowed_mentions = { replied_user: reply.ping };
    }
    const controller = new AbortController();
    try {
      if (attached.length) {
        onUpload({ files: attached, progress: 0, cancel: () => controller.abort() });
        body.attachments = await uploadFiles(channel.id, attached, {
          signal: controller.signal,
          onProgress: (progress) => onUpload({ files: attached, progress, cancel: () => controller.abort() }),
        });
      }
      // A resposta também chega via gateway (MESSAGE_CREATE); o store ignora duplicatas pelo id.
      const message = await api(`/channels/${channel.id}/messages`, { method: 'POST', body });
      dispatch({ type: 'MESSAGE_CREATE', d: message });
      attached.forEach(releasePending);
    } catch (e) {
      // Falhou ou foi cancelado: devolve texto e anexos ao compositor (se ele ainda estiver vazio).
      if (content) setDraft((d) => d || content);
      setFiles((current) => (current.length ? current : attached));
      if (reply) onRestoreReply(reply);
      if (e.name !== 'AbortError') showError(e.message);
    } finally {
      if (attached.length) onUpload(null);
    }
  };

  if (apiRef) apiRef.current = { addFiles, sendFilesNow };

  const insert = (item) => {
    const before = draft.slice(0, trigger.start);
    const after = draft.slice(trigger.end).replace(/^ /, '');
    const next = before + item.insert + after;
    if (item.emoji) rememberEmoji(item.emoji);
    setDraft(next);
    const pos = before.length + item.insert.length;
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const insertAtCaret = (text) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const onKeyDown = (e) => {
    if (showSuggestions) {
      const count = suggestions.items.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + count) % count);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        insert(suggestions.items[selected]);
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        setDismissed(`${trigger.start}:${draft.slice(trigger.start, trigger.end)}`);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && replyTo) {
      e.stopPropagation();
      onClearReply();
    } else if (e.key === 'ArrowUp' && !draft && !files.length) {
      // Seta para cima com o campo vazio edita a sua última mensagem.
      if (onEditLast()) e.preventDefault();
    }
  };

  const onPaste = (e) => {
    const pasted = [...e.clipboardData.files];
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
      return;
    }
    // Como no Discord: colar um texto que estoura o limite vira o anexo message.txt.
    const text = e.clipboardData.getData('text/plain');
    if (text && draft.length + text.length > MAX_LENGTH) {
      e.preventDefault();
      addFiles([new File([text], 'message.txt', { type: 'text/plain' })]);
    }
  };

  const openPlus = () =>
    openMenu({
      rect: plusButton.current.getBoundingClientRect(),
      side: 'above',
      width: 220,
      items: [{ label: 'Enviar um arquivo', icon: Paperclip, onClick: () => fileInput.current.click() }],
    });

  const openEmoji = () =>
    openPopout({
      Component: EmojiPicker,
      props: { onPick: (emoji) => { rememberEmoji(emoji); insertAtCaret(emoji); } },
      rect: emojiButton.current.getBoundingClientRect(),
      side: 'above-end',
    });

  const over = draft.length > MAX_LENGTH;

  return (
    <div className={`composer-box main${replyTo ? ' replying' : ''}`}>
      {showSuggestions && <Suggestions list={suggestions} selected={selected} onHover={setSelected} onPick={insert} />}
      {files.length > 0 && (
        <ul className="upload-area">
          {files.map((p) => (
            <PendingCard
              key={p.id}
              pending={p}
              onChange={(patch) => setFiles((list) => list.map((f) => (f.id === p.id ? { ...f, ...patch } : f)))}
              onRemove={() => {
                releasePending(p);
                setFiles((list) => list.filter((f) => f.id !== p.id));
              }}
            />
          ))}
        </ul>
      )}
      <div className="composer-row">
        <button
          ref={plusButton}
          className="composer-button attach"
          aria-label="Enviar um arquivo"
          onClick={openPlus}
          onDoubleClick={() => fileInput.current.click()}
        >
          <PlusCircle size={24} fill="currentColor" stroke="var(--bg-textarea)" />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          placeholder={placeholder}
          spellCheck
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionStart);
            if (e.target.value.trim()) notifyTyping(channel.id);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {draft.length > MAX_LENGTH - 200 && <span className={`char-count${over ? ' over' : ''}`}>{MAX_LENGTH - draft.length}</span>}
        <button ref={emojiButton} className="composer-button emoji" aria-label="Selecionar emoji" title="Selecionar emoji" onClick={openEmoji}>
          <Smile size={24} />
        </button>
      </div>
    </div>
  );
}

// Última mensagem própria editável (seta para cima).
export function lastOwnMessage(list) {
  const me = getState().user.id;
  return [...list].reverse().find((m) => m.author.id === me && isUserMessage(m));
}
