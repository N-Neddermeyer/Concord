import { ChevronLeft, ChevronRight, Download, ExternalLink, File, FileArchive, FileAudio, FileCode, FileText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openModal } from '../lib/dialogs.js';
import { formatSize } from '../lib/upload.js';

// Anexos de uma mensagem no visual do Discord: imagens e vídeos em mosaico (uma sozinha fica
// no tamanho natural, até 550×350), áudio com player e os demais como cartão de arquivo.

const MAX_W = 550;
const MAX_H = 350;

const kindOf = (a) => {
  const type = a.content_type ?? '';
  if (/^image\/(png|jpeg|gif|webp|avif)$/.test(type)) return 'image';
  if (/^video\/(mp4|webm|ogg|quicktime)$/.test(type)) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'file';
};

const isSpoiler = (a) => a.filename.startsWith('SPOILER_');

function fit(a) {
  if (!a.width || !a.height) return { maxWidth: MAX_W, maxHeight: MAX_H };
  const scale = Math.min(1, MAX_W / a.width, MAX_H / a.height);
  return { width: Math.round(a.width * scale), height: Math.round(a.height * scale) };
}

function SpoilerCover({ children }) {
  const [shown, setShown] = useState(false);
  if (shown) return children;
  return (
    <div className="spoiler-media" onClick={(e) => { e.stopPropagation(); setShown(true); }}>
      <div className="spoiler-media-blur">{children}</div>
      <span className="spoiler-badge">Spoiler</span>
    </div>
  );
}

function Media({ attachment: a, single, onOpen }) {
  const kind = kindOf(a);
  const style = single ? fit(a) : undefined;
  const media = kind === 'image' ? (
    <button className="media-item" style={style} onClick={onOpen} aria-label={`Imagem: ${a.filename}`}>
      <img src={a.url} alt={a.filename} loading="lazy" draggable={false} />
    </button>
  ) : (
    <div className="media-item video" style={style}>
      <video src={a.url} controls preload="metadata" />
    </div>
  );
  return isSpoiler(a) ? <SpoilerCover>{media}</SpoilerCover> : media;
}

const FILE_ICONS = [
  [/\.(zip|rar|7z|tar|gz)$/i, FileArchive],
  [/\.(js|jsx|ts|tsx|py|c|cpp|cs|java|json|html|css|sh|ps1|rs|go)$/i, FileCode],
  [/\.(txt|md|pdf|docx?|odt|rtf)$/i, FileText],
];

export const fileIcon = (filename, type = '') =>
  type.startsWith('audio/') ? FileAudio : FILE_ICONS.find(([re]) => re.test(filename))?.[1] ?? File;

function FileCard({ attachment: a }) {
  const audio = kindOf(a) === 'audio';
  const Icon = fileIcon(a.filename, a.content_type ?? '');
  const card = (
    <div className={`file-card${audio ? ' audio' : ''}`}>
      <div className="file-card-row">
        <Icon size={36} strokeWidth={1.5} className="file-icon" />
        <div className="file-info">
          <a className="file-name" href={a.url} download={a.filename} title={a.filename}>{a.filename}</a>
          <span className="file-size">{formatSize(a.size)}</span>
        </div>
        <a className="file-download" href={a.url} download={a.filename} aria-label="Baixar" title="Baixar"><Download size={24} /></a>
      </div>
      {audio && <audio src={a.url} controls preload="metadata" />}
    </div>
  );
  return isSpoiler(a) ? <SpoilerCover>{card}</SpoilerCover> : card;
}

export default function MessageAttachments({ message }) {
  const attachments = message.attachments ?? [];
  if (!attachments.length) return null;
  const visual = attachments.filter((a) => kindOf(a) === 'image' || kindOf(a) === 'video');
  const images = visual.filter((a) => kindOf(a) === 'image');
  const others = attachments.filter((a) => !visual.includes(a));
  const open = (a) => openModal(MediaViewer, { items: images, index: images.indexOf(a) });

  return (
    <div className="attachments">
      {visual.length > 0 && (
        <div className={`mosaic count-${Math.min(visual.length, 10)}`}>
          {visual.map((a) => <Media key={a.id} attachment={a} single={visual.length === 1} onOpen={() => open(a)} />)}
        </div>
      )}
      {others.map((a) => <FileCard key={a.id} attachment={a} />)}
    </div>
  );
}

// Visualizador de imagem (clique na imagem): setas trocam entre as imagens da mensagem.
function MediaViewer({ close, items, index: initial }) {
  const [index, setIndex] = useState(initial);
  const a = items[index];
  const many = items.length > 1;
  const go = (delta) => setIndex((i) => (i + delta + items.length) % items.length);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="media-viewer" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <header className="media-viewer-bar">
        <div className="media-viewer-title">
          <span>{a.filename}</span>
          <small>{a.width && a.height ? `${a.width} × ${a.height} · ` : ''}{formatSize(a.size)}</small>
        </div>
        <a className="media-viewer-button" href={a.url} download={a.filename} aria-label="Baixar" title="Baixar"><Download size={20} /></a>
        <a className="media-viewer-button" href={a.url} target="_blank" rel="noreferrer" aria-label="Abrir no navegador" title="Abrir no navegador">
          <ExternalLink size={20} />
        </a>
        <button className="media-viewer-button" onClick={() => close()} aria-label="Fechar" title="Fechar"><X size={22} /></button>
      </header>
      <div className="media-viewer-stage" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        {many && <button className="media-viewer-nav prev" onClick={() => go(-1)} aria-label="Anterior"><ChevronLeft size={28} /></button>}
        <img src={a.url} alt={a.filename} />
        {many && <button className="media-viewer-nav next" onClick={() => go(1)} aria-label="Próxima"><ChevronRight size={28} /></button>}
      </div>
      {many && <div className="media-viewer-count">{index + 1} de {items.length}</div>}
    </div>
  );
}
