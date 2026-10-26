import { X } from 'lucide-react';
import { useEffect } from 'react';
import { hasOpenModal } from '../../lib/dialogs.js';

// Tela cheia de configurações: menu à esquerda, conteúdo à direita e o botão "ESC".
// items: [{ header }, { id, label, danger, icon, onClick }, { separator: true }]
export default function SettingsLayout({ items, current, onSelect, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !hasOpenModal() && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="settings-layer">
      <nav className="settings-sidebar">
        <div className="settings-nav">
          {items.filter(Boolean).map((item, i) => {
            if (item.header) return <h3 key={i} className="settings-header">{item.header}</h3>;
            if (item.separator) return <div key={i} className="settings-separator" />;
            if (item.note) return <div key={i} className="settings-note">{item.note}</div>;
            return (
              <button
                key={item.id}
                className={`settings-item${current === item.id ? ' active' : ''}${item.danger ? ' danger' : ''}`}
                onClick={() => (item.onClick ? item.onClick() : onSelect(item.id))}
              >
                <span>{item.label}</span>
                {item.icon && <item.icon size={16} />}
              </button>
            );
          })}
        </div>
      </nav>
      <div className="settings-content">
        <div className="settings-page">{children}</div>
        <div className="settings-close">
          <button onClick={onClose} aria-label="Fechar"><X size={18} /></button>
          <span>ESC</span>
        </div>
      </div>
    </div>
  );
}

// Barra "Cuidado — você tem alterações que não foram salvas!", como no Discord.
export function SaveBar({ visible, onReset, onSave, busy, error }) {
  if (!visible) return null;
  return (
    <div className="save-bar">
      <span>{error ? <span className="error">{error}</span> : 'Cuidado — você tem alterações que não foram salvas!'}</span>
      <button className="button link-button" onClick={onReset}>Redefinir</button>
      <button className="button success" disabled={busy} onClick={onSave}>Salvar alterações</button>
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`toggle${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

export function ToggleRow({ title, description, checked, onChange, disabled }) {
  return (
    <div className="toggle-row">
      <div>
        <div className="toggle-title">{title}</div>
        {description && <div className="toggle-description">{description}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// Guarda o rascunho de um formulário e diz se há alterações em relação ao original.
export function isDirty(draft, original) {
  return Object.keys(draft).some((k) => draft[k] !== original[k]);
}
