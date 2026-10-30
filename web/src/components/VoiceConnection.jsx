import { Signal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { memberName, useStore } from '../lib/store.js';
import { voice } from '../lib/voice.js';
import Avatar from './Avatar.jsx';

// "Conexão de voz" (clique em "Voz conectada"): por quem está na chamada, por onde a conexão passa
// e o ping. Atualiza a cada segundo enquanto aberto.

const ROUTES = {
  local: ['Direta', 'Pela rede local ou direto pela internet.'],
  stun: ['Direta (STUN)', 'Atravessa o roteador com a ajuda do servidor STUN.'],
  relay: ['Retransmitida (TURN)', 'Passa pelo servidor TURN, quando a conexão direta não é possível.'],
};

const pingClass = (ms) => (ms === null ? '' : ms < 100 ? 'good' : ms < 250 ? 'fair' : 'bad');

export function VoiceConnectionPopout() {
  const [stats, setStats] = useState(null);
  const state = useStore((s) => s);
  const guildId = voice.guildId;

  useEffect(() => {
    let alive = true;
    const load = () => voice.connectionStats().then((s) => alive && setStats(s));
    load();
    const timer = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const servers = voice.ice?.ice_servers ?? [];
  const stunCount = servers.filter((s) => [s.urls].flat().some((u) => /^stuns?:/i.test(u))).length;
  const turnCount = servers.filter((s) => [s.urls].flat().some((u) => /^turns?:/i.test(u))).length;
  const pings = (stats ?? []).map((s) => s.ping).filter((p) => p !== null);
  const average = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;

  return (
    <div className="voice-connection">
      <div className="voice-connection-header">
        <Signal size={18} />
        <div>
          <h3>Conexão de voz</h3>
          <span className={`voice-connection-ping ${pingClass(average)}`}>
            {average === null ? 'Sem medição de ping ainda' : `Ping médio: ${average} ms`}
          </span>
        </div>
      </div>
      {stats === null ? (
        <div className="voice-connection-empty"><div className="spinner" /></div>
      ) : stats.length === 0 ? (
        <p className="voice-connection-empty muted small">Ninguém mais na chamada.</p>
      ) : (
        <ul className="voice-connection-list">
          {stats.map((s) => {
            const user = state.users[s.userId];
            const [route, hint] = ROUTES[s.route] ?? [s.state === 'connected' ? 'Conectando…' : stateLabel(s.state), null];
            return (
              <li key={s.userId}>
                <Avatar user={user} size={24} />
                <div className="voice-connection-who">
                  <span className="voice-connection-name">{memberName(state, guildId, s.userId)}</span>
                  <span className="voice-connection-route" title={hint ?? undefined}>
                    {route}{s.protocol ? ` · ${s.protocol.toUpperCase()}` : ''}
                  </span>
                </div>
                <span className={`voice-connection-ping ${pingClass(s.ping)}`}>{s.ping === null ? '—' : `${s.ping} ms`}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="voice-connection-footer muted small">
        {stunCount || turnCount
          ? `Configurado no servidor: ${[stunCount && 'STUN', turnCount && 'TURN'].filter(Boolean).join(' e ')}${voice.ice?.ice_transport_policy === 'relay' ? ' (só TURN)' : ''}.`
          : 'Sem STUN/TURN configurado: só funciona na rede local.'}
      </p>
    </div>
  );
}

function stateLabel(state) {
  return { new: 'Conectando…', connecting: 'Conectando…', disconnected: 'Reconectando…', failed: 'Falhou', closed: 'Encerrada' }[state] ?? state;
}
