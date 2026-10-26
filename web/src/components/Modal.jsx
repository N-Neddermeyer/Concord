import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { closeMenu, closePopout, registerBuiltinDialogs, useDialogs } from '../lib/dialogs.js';
import UserPopout from './UserPopout.jsx';

export function Modal({ title, subtitle, children, footer, onClose, className = '', closeButton = true }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true">
        {closeButton && (
          <button className="modal-close" onClick={() => onClose()} aria-label="Fechar"><X size={24} /></button>
        )}
        {title && (
          <header className="modal-header">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </header>
        )}
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

function ConfirmModal({ close, title, body, confirmLabel = 'Confirmar', danger = false, alertOnly = false }) {
  return (
    <Modal
      title={title}
      onClose={() => close(false)}
      className="small"
      closeButton={false}
      footer={
        <>
          {!alertOnly && <button className="button link-button" onClick={() => close(false)}>Cancelar</button>}
          <button className={`button ${danger ? 'danger' : 'brand'}`} onClick={() => close(true)} autoFocus>{confirmLabel}</button>
        </>
      }
    >
      <p className="modal-text">{body}</p>
    </Modal>
  );
}

function PromptModal({ close, title, label, initial = '', placeholder, confirmLabel = 'Salvar', maxLength = 100 }) {
  const [value, setValue] = useState(initial);
  return (
    <Modal
      title={title}
      onClose={() => close(null)}
      className="small"
      footer={
        <>
          <button className="button link-button" onClick={() => close(null)}>Cancelar</button>
          <button className="button brand" disabled={!value.trim()} onClick={() => close(value.trim())}>{confirmLabel}</button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">{label}</span>
        <input
          className="input"
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && close(value.trim())}
        />
      </label>
    </Modal>
  );
}

registerBuiltinDialogs({ Confirm: ConfirmModal, Prompt: PromptModal });

// Posiciona um elemento flutuante junto ao retângulo âncora, sem sair da janela.
export function useAnchoredPosition(rect, side = 'right', gap = 8) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    // Tamanho de layout (sem o scale da animação de entrada).
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    let left = side === 'left' ? rect.left - width - gap
      : side === 'below' ? rect.left
      : side === 'below-end' ? rect.right - width
      : rect.right + gap;
    let top = side === 'below' || side === 'below-end' ? rect.bottom + gap : side === 'above' ? rect.top - height - gap : rect.top;
    if (side === 'above') left = rect.left;
    if (side === 'right' && left + width > innerWidth - 8) left = rect.left - width - gap;
    left = Math.max(8, Math.min(left, innerWidth - width - 8));
    top = Math.max(8, Math.min(top, innerHeight - height - 8));
    setPos({ left, top });
  }, [rect, side, gap]);
  return [ref, pos];
}

function Menu({ menu }) {
  const [ref, pos] = useAnchoredPosition(menu.rect, menu.side ?? 'below', 4);
  return (
    <div className="menu" ref={ref} style={{ ...pos, minWidth: menu.width ?? 188 }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.filter(Boolean).map((item, i) =>
        item.custom ? (
          <div key={i}>{item.custom(closeMenu)}</div>
        ) : item.separator ? (
          <div key={i} className="menu-separator" />
        ) : (
          <button
            key={i}
            className={`menu-item${item.danger ? ' danger' : ''}${item.brand ? ' brand' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              closeMenu();
              item.onClick();
            }}
          >
            <span>{item.label}</span>
            {item.icon && <item.icon size={18} />}
          </button>
        ),
      )}
    </div>
  );
}

function Floating({ popout }) {
  const [ref, pos] = useAnchoredPosition(popout.rect, popout.side ?? 'below', popout.gap ?? 8);
  const { Component, props } = popout;
  return (
    <div className="floating" ref={ref} style={pos} onMouseDown={(e) => e.stopPropagation()}>
      <Component {...props} close={closePopout} />
    </div>
  );
}

// Renderiza modais, popouts (perfil e genéricos) e menus suspensos; Esc fecha o de cima.
export default function DialogHost() {
  const { modals, popout, menu } = useDialogs();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (menu) closeMenu();
      else if (popout) closePopout();
      else if (modals.length) modals.at(-1).close(undefined);
      else return;
      e.stopPropagation();
    };
    const onDown = () => {
      if (menu) closeMenu();
      if (popout) closePopout();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [modals, popout, menu]);

  return (
    <>
      {modals.map(({ id, Component, props, close }) => <Component key={id} {...props} close={close} />)}
      {popout && (popout.Component ? <Floating popout={popout} /> : <UserPopout {...popout} />)}
      {menu && <Menu menu={menu} />}
    </>
  );
}
