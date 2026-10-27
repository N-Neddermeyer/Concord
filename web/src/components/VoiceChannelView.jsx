import { Volume2 } from 'lucide-react';
import { useEffect } from 'react';
import { LAYOUT, leaveFullScreen, useCallLayout, useIdle } from '../lib/callLayout.js';
import { useStore } from '../lib/store.js';
import { useVoice, voice } from '../lib/voice.js';
import Avatar from './Avatar.jsx';
import { CallBar, CallControls, FullscreenButton, VideoGrid, useVideoTiles } from './VideoCall.jsx';

// Canal de voz aberto na área principal, como no Discord: a grade com quem está nele
// (câmera, avatar ou tela transmitida), os controles embaixo e "Tela cheia" à direita.
export default function VoiceChannelView({ channelId }) {
  const channel = useStore((s) => s.channels[channelId]);
  const voiceStates = useStore((s) => s.voiceStates);
  const users = useStore((s) => s.users);
  const session = useVoice();
  const { layout } = useCallLayout(channelId);
  const presentIds = Object.values(voiceStates).filter((v) => v.channel_id === channelId).map((v) => v.user_id);
  const tiles = useVideoTiles(channelId, presentIds);
  const connected = session.channelId === channelId;
  const fullscreen = layout === LAYOUT.FULL_SCREEN;
  const [idle, idleHandlers] = useIdle(connected);

  useEffect(() => {
    if (!connected) leaveFullScreen(channelId);
  }, [connected, channelId]);
  useEffect(() => () => leaveFullScreen(channelId), [channelId]);

  return (
    <main className={`voice-view${fullscreen ? ' layout-full-screen' : ''}${idle ? ' idle' : ''}`} {...idleHandlers}>
      <header className="voice-view-header">
        <Volume2 size={24} />
        <h1>{channel.name}</h1>
      </header>
      {connected ? (
        <>
          <VideoGrid channelId={channelId} tiles={tiles} />
          <CallBar center={<CallControls deafen />} right={<FullscreenButton channelId={channelId} />} />
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
