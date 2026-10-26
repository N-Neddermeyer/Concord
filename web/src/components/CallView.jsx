import { HeadphoneOff, MicOff, Phone } from 'lucide-react';
import { acceptCall, hangUp, ringAgain } from '../lib/calls.js';
import { useStore } from '../lib/store.js';
import { displayName } from '../lib/util.js';
import { useVoice } from '../lib/voice.js';
import Avatar from './Avatar.jsx';
import { CallControls, VideoGrid, useVideoTiles } from './VideoCall.jsx';

// Área de chamada no topo da DM ou do grupo: os avatares em destaque (verde ao falar, esmaecido
// e pulsando enquanto toca) e os controles da chamada embaixo, como no Discord. Com alguém de
// câmera ligada ou transmitindo a tela, a área cresce e vira uma grade de vídeo.
export default function CallView({ channel }) {
  const me = useStore((s) => s.user);
  const call = useStore((s) => s.calls[channel.id]);
  const voiceStates = useStore((s) => s.voiceStates);
  const speaking = useStore((s) => s.speaking);
  const users = useStore((s) => s.users);
  const session = useVoice();
  const inCall = session.channelId === channel.id;
  const memberIds = [me.id, ...channel.recipients.map((u) => u.id)];
  const presentIds = memberIds.filter((id) => voiceStates[id]?.channel_id === channel.id);
  const ringingIds = memberIds.filter((id) => !presentIds.includes(id) && call?.ringing.includes(id));
  const videoTiles = useVideoTiles(channel.id, [...presentIds, ...ringingIds]);
  if (!call) return null;

  const tiles = [me, ...channel.recipients.map((u) => users[u.id] ?? u)]
    .map((user) => {
      const state = voiceStates[user.id]?.channel_id === channel.id ? voiceStates[user.id] : null;
      const ringing = call.ringing.includes(user.id);
      return { user, state, ringing };
    })
    // Quem não está na chamada só aparece enquanto toca, ou para quem está nela (com "Chamar").
    .filter((t) => t.state || t.ringing || inCall);

  const hasVideo = presentIds.some((id) => voiceStates[id].self_video || voiceStates[id].self_stream);

  return (
    <section className={`call-view${hasVideo ? ' has-video' : ''}`}>
      {hasVideo ? (
        <VideoGrid tiles={videoTiles} />
      ) : (
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
      )}

      {inCall ? (
        <CallControls onHangUp={hangUp} />
      ) : (
        <div className="call-controls">
          <button className="call-control join" title="Entrar na chamada" aria-label="Entrar na chamada" onClick={() => acceptCall(channel.id)}>
            <Phone size={24} />
          </button>
        </div>
      )}
    </section>
  );
}
