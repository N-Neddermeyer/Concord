import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';

// Servidores STUN/TURN entregues ao cliente para montar as conexões de voz e vídeo.
// Sem nada configurado, a lista fica vazia e as conexões só funcionam na rede local.
//
// A configuração vem de variáveis de ambiente ou do arquivo ice.json na pasta de dados
// (relido a cada pedido, então dá para trocar sem reiniciar):
//   STUN_URLS / "stun":     stun:stun.exemplo.com:3478 (várias, separadas por vírgula)
//   TURN_URLS / "turn":     turn:turn.exemplo.com:3478?transport=udp, turns:...:5349
//   TURN_USERNAME / "username" e TURN_CREDENTIAL / "credential": usuário e senha fixos, ou
//   TURN_SECRET / "secret": segredo compartilhado com o coturn (use-auth-secret); cada usuário
//     recebe uma senha temporária, válida por TURN_TTL / "ttl" segundos (padrão 24 h).
//   ICE_TRANSPORT_POLICY / "policy": "relay" força tudo pelo TURN (útil para testar).

const ICE_URL = /^(stun|stuns|turn|turns):[^\s,]+$/i;
const DEFAULT_TTL = 24 * 60 * 60;

const list = (value) =>
  (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((url) => String(url).trim())
    .filter((url) => ICE_URL.test(url));

function readFile() {
  try {
    return JSON.parse(readFileSync(path.join(DATA_DIR, 'ice.json'), 'utf8'));
  } catch {
    return {};
  }
}

export function iceConfig() {
  const file = readFile();
  const env = process.env;
  const ttl = Number(env.TURN_TTL ?? file.ttl);
  return {
    stun: list(env.STUN_URLS ?? file.stun),
    turn: list(env.TURN_URLS ?? file.turn),
    username: env.TURN_USERNAME ?? file.username ?? null,
    credential: env.TURN_CREDENTIAL ?? file.credential ?? null,
    secret: env.TURN_SECRET ?? file.secret ?? null,
    ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL,
    policy: (env.ICE_TRANSPORT_POLICY ?? file.policy) === 'relay' ? 'relay' : 'all',
  };
}

// Senha temporária do TURN REST API (a mesma conta que o coturn faz com use-auth-secret):
// usuário = "expiração:id", senha = base64(HMAC-SHA1(segredo, usuário)).
function temporaryCredential(secret, userId, ttl) {
  const username = `${Math.floor(Date.now() / 1000) + ttl}:${userId}`;
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64') };
}

export function iceServersFor(userId) {
  const config = iceConfig();
  const servers = [];
  if (config.stun.length) servers.push({ urls: config.stun });
  if (config.turn.length) {
    const auth = config.secret
      ? temporaryCredential(config.secret, userId, config.ttl)
      : { username: config.username ?? '', credential: config.credential ?? '' };
    servers.push({ urls: config.turn, ...auth });
  }
  // Sem TURN não há como forçar retransmissão: "relay" sozinho deixaria a chamada sem conexão.
  return { ice_servers: servers, ice_transport_policy: config.turn.length ? config.policy : 'all', ttl: config.ttl };
}
