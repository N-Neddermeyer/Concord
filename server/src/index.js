import express from 'express';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachGateway } from './gateway.js';
import { api } from './rest.js';

const PORT = Number(process.env.PORT ?? 3001);
// --lan escuta em todas as interfaces, para outras máquinas da rede conectarem.
const HOST = process.env.HOST ?? (process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);

// Em produção (`npm run build` + `npm start`) o próprio servidor entrega o cliente.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'JSON inválido.' });
  console.error(err);
  res.status(500).json({ message: 'Erro interno.' });
});

const server = http.createServer(app);
attachGateway(server);
server.listen(PORT, HOST, () => console.log(`Servidor em http://${HOST}:${PORT}`));
