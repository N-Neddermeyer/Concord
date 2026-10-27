import { api, token } from './api.js';

// Anexos no fluxo do Discord: (1) POST /channels/:id/attachments reserva os uploads,
// (2) PUT de cada arquivo no upload_url, (3) a mensagem cita os uploaded_filename.

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_FILES = 10;

let nextId = 1;

// Arquivo escolhido no compositor, ainda não enviado.
export async function toPending(file) {
  const pending = { id: nextId++, file, filename: file.name || 'imagem.png', spoiler: false, preview: null, width: null, height: null };
  if (/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) {
    pending.preview = URL.createObjectURL(file);
    try {
      const bitmap = await createImageBitmap(file);
      pending.width = bitmap.width;
      pending.height = bitmap.height;
      bitmap.close();
    } catch {
      // imagem que o navegador não decodifica: vai como arquivo comum
    }
  } else if (/^video\//.test(file.type)) {
    Object.assign(pending, await videoSize(file));
  }
  return pending;
}

function videoSize(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (size) => {
      URL.revokeObjectURL(url);
      resolve(size);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => done({ width: video.videoWidth || null, height: video.videoHeight || null });
    video.onerror = () => done({});
    video.src = url;
  });
}

export const releasePending = (p) => p.preview && URL.revokeObjectURL(p.preview);

export const spoilerName = (p) => (p.spoiler && !p.filename.startsWith('SPOILER_') ? `SPOILER_${p.filename}` : p.filename);

function put(url, file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Authorization', token.get());
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status < 300) return resolve();
      let message = `HTTP ${xhr.status}`;
      try {
        message = JSON.parse(xhr.responseText).message ?? message;
      } catch {
        // resposta sem JSON
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Falha no envio do arquivo.'));
    xhr.onabort = () => reject(new DOMException('Envio cancelado.', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

// Envia os arquivos e devolve a lista `attachments` para o corpo da mensagem.
// onProgress(fração 0–1) acompanha o total; signal cancela.
export async function uploadFiles(channelId, files, { onProgress, signal }) {
  const { attachments } = await api(`/channels/${channelId}/attachments`, {
    method: 'POST',
    body: { files: files.map((p) => ({ id: String(p.id), filename: p.filename, file_size: p.file.size })) },
  });
  const total = files.reduce((sum, p) => sum + p.file.size, 0) || 1;
  const loaded = files.map(() => 0);
  await Promise.all(files.map((p, i) => put(attachments[i].upload_url, p.file, (bytes) => {
    loaded[i] = bytes;
    onProgress(loaded.reduce((a, b) => a + b, 0) / total);
  }, signal)));
  return files.map((p, i) => ({
    id: String(i),
    filename: spoilerName(p),
    uploaded_filename: attachments[i].upload_filename,
    width: p.width ?? undefined,
    height: p.height ?? undefined,
  }));
}

export function formatSize(bytes) {
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit ? value.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : value} ${units[unit]}`;
}
