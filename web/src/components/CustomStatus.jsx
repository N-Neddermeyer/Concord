import { Smile, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { openPopout, showError } from '../lib/dialogs.js';
import { OP, gateway } from '../lib/gateway.js';
import { useStore } from '../lib/store.js';
import { STATUS_LABELS, displayName } from '../lib/util.js';
import EmojiPicker from './EmojiPicker.jsx';
import { Modal } from './Modal.jsx';

// Status personalizado de alguém: o próprio vem das configurações; o dos outros, da presença.
export const useCustomStatus = (userId) =>
  useStore((s) => (userId === s.user.id ? s.user.custom_status : s.activities[userId]) ?? null);

// Emoji + texto, numa linha (lista de membros, DMs, amigos, perfil).
export function CustomStatus({ status, className = '', emojiOnly = false }) {
  if (!status || (!status.text && !status.emoji_name)) return null;
  return (
    <span className={`custom-status ${className}`} title={status.text ?? undefined}>
      {status.emoji_name && <span className="custom-status-emoji">{status.emoji_name}</span>}
      {!emojiOnly && status.text && <span className="custom-status-text">{status.text}</span>}
    </span>
  );
}

export const saveCustomStatus = (customStatus) =>
  api('/users/@me/settings', { method: 'PATCH', body: { custom_status: customStatus } }).catch((e) => showError(e.message));

// "Limpar após", como no Discord. Hoje = meia-noite no horário local.
const CLEAR_AFTER = [
  ['today', 'Hoje', () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d; }],
  ['4h', '4 horas', () => new Date(Date.now() + 4 * 3600_000)],
  ['1h', '1 hora', () => new Date(Date.now() + 3600_000)],
  ['30m', '30 minutos', () => new Date(Date.now() + 30 * 60_000)],
  ['never', 'Não limpar', () => null],
];

const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

export function CustomStatusModal({ close }) {
  const me = useStore((s) => s.user);
  const current = me.custom_status;
  const [text, setText] = useState(current?.text ?? '');
  const [emoji, setEmoji] = useState(current?.emoji_name ?? null);
  const [clearAfter, setClearAfter] = useState(current?.expires_at ? 'keep' : 'today');
  const [status, setStatus] = useState(me.status);

  const pickEmoji = (e) => openPopout({
    Component: EmojiPicker,
    props: { onPick: setEmoji },
    rect: e.currentTarget.getBoundingClientRect(),
    side: 'below',
  });

  const save = async () => {
    const expires = clearAfter === 'keep' ? current.expires_at : CLEAR_AFTER.find(([key]) => key === clearAfter)[2]();
    const value = text.trim() || emoji ? { text: text.trim() || null, emoji_name: emoji, expires_at: expires ? new Date(expires).toISOString() : null } : null;
    if (status !== me.status) gateway.send(OP.PRESENCE_UPDATE, { status });
    await saveCustomStatus(value);
    close();
  };

  return (
    <Modal
      className="custom-status-modal"
      onClose={() => close()}
      title="Definir um status personalizado"
      footer={(
        <>
          <button className="button link-button" onClick={() => close()}>Cancelar</button>
          <button className="button brand" onClick={save}>Salvar</button>
        </>
      )}
    >
      <label className="field">
        <span className="field-label">O que está acontecendo, {displayName(me)}?</span>
        <div className="custom-status-input">
          <button className="custom-status-emoji-button" aria-label="Escolher emoji" title="Escolher emoji" onClick={pickEmoji}>
            {emoji ? <span className="custom-status-emoji">{emoji}</span> : <Smile size={20} />}
          </button>
          <input
            className="input"
            autoFocus
            value={text}
            maxLength={128}
            placeholder="O suporte chegou!"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          {(text || emoji) && (
            <button className="custom-status-clear" aria-label="Limpar" title="Limpar" onClick={() => { setText(''); setEmoji(null); }}>
              <X size={16} />
            </button>
          )}
        </div>
      </label>
      <label className="field">
        <span className="field-label">Limpar após</span>
        <select className="input" value={clearAfter} onChange={(e) => setClearAfter(e.target.value)}>
          {clearAfter === 'keep' && <option value="keep">Manter o prazo atual</option>}
          {CLEAR_AFTER.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <div className="divider custom-status-divider" />
      <label className="field">
        <span className="field-label">Status</span>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
        </select>
      </label>
    </Modal>
  );
}
