import express from 'express';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTACHMENTS_DIR, q } from './db.js';
import { attachGateway } from './gateway.js';
import { api } from './rest.js';

const PORT = Number(process.env.PORT ?? 3001);
// --lan escuta em todas as interfaces, para outras máquinas da rede conectarem.
const HOST = process.env.HOST ?? (process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1');

const app = express();
// O corpo dos uploads é o arquivo cru (mesmo que seja um .json), lido pela própria rota.
const isUpload = (req) => req.url.startsWith('/api/uploads/');
app.use(express.json({ limit: '1mb', type: (req) => !isUpload(req) && /json/.test(req.headers['content-type'] ?? '') }));
app.use('/api', api);

// Anexos ("CDN"). Só imagem, vídeo e áudio abrem no navegador; o resto é sempre download, para
// que um .html enviado nunca rode com a origem do app (onde fica o token).
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|ogg|quicktime)|audio\/[\w.+-]+)$/;
app.get('/attachments/:key/:filename', (req, res) => {
  const a = q.attachmentByKey.get(req.params.key);
  if (!a || !a.uploaded) return res.status(404).end();
  const inline = INLINE_TYPES.test(a.content_type ?? '');
  res.set({
    'Content-Type': inline ? a.content_type : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  res.sendFile(path.join(ATTACHMENTS_DIR, a.upload_key, 'file'), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// Em produção (`npm run build` + `npm start`) o próprio servidor entrega o cliente.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'JSON inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'O tamanho máximo de arquivo é 10 MB.' });
  console.error(err);
  res.status(500).json({ message: 'Erro interno.' });
});

const server = http.createServer(app);
attachGateway(server);
server.listen(PORT, HOST, () => {
  console.log(`Servidor em http://${HOST}:${PORT}`);
  if (HOST !== '0.0.0.0') return;
  // Endereços para a segunda máquina digitar (ou para gerar o instalador).
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
  for (const a of addresses) console.log(`  na rede: http://${a.address}:${PORT}`);
});
