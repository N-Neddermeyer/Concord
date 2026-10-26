import { Volume2 } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { useVoice, voice } from '../lib/voice.js';
import Avatar from './Avatar.jsx';
import { CallControls, VideoGrid, useVideoTiles } from './VideoCall.jsx';

// Canal de voz aberto na área principal, como no Discord: a grade com quem está nele
// (câmera, avatar ou tela transmitida) e os controles embaixo.
export default function VoiceChannelView({ channelId }) {
  const channel = useStore((s) => s.channels[channelId]);
  const voiceStates = useStore((s) => s.voiceStates);
  const users = useStore((s) => s.users);
  const session = useVoice();
  const presentIds = Object.values(voiceStates).filter((v) => v.channel_id === channelId).map((v) => v.user_id);
  const tiles = useVideoTiles(channelId, presentIds);
  const connected = session.channelId === channelId;

  return (
    <main className="voice-view">
      <header className="voice-view-header">
        <Volume2 size={24} />
        <h1>{channel.name}</h1>
      </header>
      {connected ? (
        <>
          <VideoGrid tiles={tiles} />
          <CallControls deafen />
        </>
      ) : (
        <div className="voice-view-idle">
          <div className="voice-view-faces">
            {presentIds.slice(0, 5).map((id) => <Avatar key={id} user={users[id]} size={48} />)}
          </div>
          <h2>{channel.name}</h2>
          <p>{presentIds.length ? `${presentIds.length} ${presentIds.length === 1 ? 'pessoa está' : 'pessoas estão'} no canal de voz` : 'Ninguém está no canal de voz no momento'}</p>
          <button className="button success" onClick={() => voice.join(channel.guild_id, channelId)}>Entrar no canal de voz</button>
        </div>
      )}
    </main>
  );
}
