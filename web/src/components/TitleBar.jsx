import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { native } from '../lib/native.js';

// Barra superior no estilo do Discord desktop: título ao centro e, no app Electron
// (janela sem moldura), os botões de minimizar/maximizar/fechar à direita.
export default function TitleBar({ title }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!native) return;
    native.window.isMaximized().then(setMaximized);
    return native.window.onMaximizeChange(setMaximized);
  }, []);

  return (
    <div className={`titlebar${native ? ' native' : ''}`}>
      <div className="titlebar-title">{title}</div>
      {native && (
        <div className="window-controls">
          <button aria-label="Minimizar" onClick={() => native.window.minimize()}><Minus size={16} /></button>
          <button aria-label={maximized ? 'Restaurar' : 'Maximizar'} onClick={() => native.window.maximize()}>
            {maximized ? <Copy size={13} style={{ transform: 'scaleX(-1)' }} /> : <Square size={13} />}
          </button>
          <button className="close" aria-label="Fechar" onClick={() => native.window.close()}><X size={18} /></button>
        </div>
      )}
    </div>
  );
}
