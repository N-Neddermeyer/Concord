import { HeadphoneOff, Mic, MicOff, MonitorUp, Phone, PhoneOff, Video } from 'lucide-react';
import { acceptCall, hangUp, ringAgain } from '../lib/calls.js';
import { useStore } from '../lib/store.js';
import { displayName } from '../lib/util.js';
import { useVoice, voice } from '../lib/voice.js';
import Avatar from './Avatar.jsx';

// Área de chamada no topo da DM ou do grupo: os avatares em destaque (verde ao falar, esmaecido
// e pulsando enquanto toca) e os controles da chamada embaixo, como no Discord.
export default function CallView({ channel }) {
  const me = useStore((s) => s.user);
  const call = useStore((s) => s.calls[channel.id]);
  const voiceStates = useStore((s) => s.voiceStates);
  const speaking = useStore((s) => s.speaking);
  const users = useStore((s) => s.users);
  const session = useVoice();
  if (!call) return null;

  const inCall = session.channelId === channel.id;
  const tiles = [me, ...channel.recipients.map((u) => users[u.id] ?? u)]
    .map((user) => {
      const state = voiceStates[user.id]?.channel_id === channel.id ? voiceStates[user.id] : null;
      const ringing = call.ringing.includes(user.id);
      return { user, state, ringing };
    })
    // Quem não está na chamada só aparece enquanto toca, ou para quem está nela (com "Chamar").
    .filter((t) => t.state || t.ringing || inCall);

  return (
    <section className="call-view">
      <div className="call-tiles">
        {tiles.map(({ user, state, ringing }) => (
          <div key={user.id} className={`call-tile${ringing ? ' ringing' : ''}${!state && !ringing ? ' absent' : ''}`}>
            <div className={`call-avatar${state && speaking[user.id] ? ' speaking' : ''}`} title={displayName(user)}>
              <span className="call-ripple" />
              <span className="call-ripple delay" />
              <Avatar user={user} size={80} />
              {state?.self_deaf ? (
                <span className="call-badge"><HeadphoneOff size={14} /></span>
              ) : state?.self_mute ? (
                <span className="call-badge"><MicOff size={14} /></span>
              ) : null}
            </div>
            {!state && !ringing && inCall && (
              <button className="call-ring-button" onClick={() => ringAgain(channel.id)}>Chamar</button>
            )}
          </div>
        ))}
      </div>

      <div className="call-controls">
        {inCall ? (
          <>
            <button className="call-control" disabled title="Vídeo ainda não disponível no clone" aria-label="Ativar câmera"><Video size={24} /></button>
            <button className="call-control" disabled title="Compartilhamento de tela ainda não disponível no clone" aria-label="Compartilhar tela"><MonitorUp size={24} /></button>
            <button
              className={`call-control${session.muted ? ' off' : ''}`}
              title={session.muted ? 'Desativar mudo' : 'Silenciar'}
              aria-label={session.muted ? 'Desativar mudo' : 'Silenciar'}
              onClick={() => voice.toggleMute()}
            >
              {session.muted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <button className="call-control hangup" title="Desconectar" aria-label="Desconectar" onClick={hangUp}>
              <PhoneOff size={24} />
            </button>
          </>
        ) : (
          <button className="call-control join" title="Entrar na chamada" aria-label="Entrar na chamada" onClick={() => acceptCall(channel.id)}>
            <Phone size={24} />
          </button>
        )}
      </div>
    </section>
  );
}
