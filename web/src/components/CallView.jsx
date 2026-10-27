import { HeadphoneOff, MicOff, Phone, Users } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CALL_CHAT_RESERVE, CALL_MIN_HEIGHT, LAYOUT, leaveFullScreen, useCallLayout, useIdle } from '../lib/callLayout.js';
import { acceptCall, hangUp, ringAgain } from '../lib/calls.js';
import { updateSettings, useSettings } from '../lib/settings.js';
import { privateChannelName, useStore } from '../lib/store.js';
import { displayName } from '../lib/util.js';
import { useVoice } from '../lib/voice.js';
import Avatar from './Avatar.jsx';
import { CallBar, CallControls, FullscreenButton, ToggleChatButton, VideoGrid, useVideoTiles } from './VideoCall.jsx';

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

// Alça na borda de baixo da chamada: arrastar ajusta a altura (de 230 px até a altura do canal
// menos 200), e a altura final fica salva, como o callHeaderHeight do Discord.
function ResizeHandle({ target, maxHeight, onResize, onResizeEnd }) {
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startHeight = target.current.getBoundingClientRect().height;
    let height = startHeight;
    document.body.classList.add('resizing-call');
    const move = (ev) => {
      height = Math.round(clamp(startHeight + ev.clientY - startY, CALL_MIN_HEIGHT, maxHeight));
      onResize(height);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing-call');
      onResizeEnd(height);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  return <div className="call-resize-handle" role="separator" aria-orientation="horizontal" aria-label="Redimensionar chamada" onPointerDown={onPointerDown} />;
}

// Área de chamada no topo da DM ou do grupo, no modelo do Discord: só voz é a faixa com os
// avatares (verde ao falar, esmaecido e pulsando enquanto toca); com câmera ou tela vira a grade
// de vídeo, com "Ocultar chat" (a chamada ocupa o canal) e "Tela cheia". Fora da tela cheia e com
// o chat visível, a altura se ajusta arrastando a borda de baixo.
export default function CallView({ channel }) {
  const me = useStore((s) => s.user);
  const call = useStore((s) => s.calls[channel.id]);
  const voiceStates = useStore((s) => s.voiceStates);
  const speaking = useStore((s) => s.speaking);
  const users = useStore((s) => s.users);
  const state = useStore((s) => s);
  const session = useVoice();
  const { callHeaderHeight } = useSettings();
  const { layout: storedLayout } = useCallLayout(channel.id);
  const ref = useRef(null);
  const [maxHeight, setMaxHeight] = useState(null);
  const [dragHeight, setDragHeight] = useState(null);

  const inCall = session.channelId === channel.id;
  const memberIds = [me.id, ...channel.recipients.map((u) => u.id)];
  const presentIds = memberIds.filter((id) => voiceStates[id]?.channel_id === channel.id);
  const ringingIds = memberIds.filter((id) => !presentIds.includes(id) && call?.ringing.includes(id));
  const videoTiles = useVideoTiles(channel.id, [...presentIds, ...ringingIds]);
  const hasVideo = !!call && presentIds.some((id) => voiceStates[id].self_video || voiceStates[id].self_stream);
  // Sem vídeo é sempre o layout mínimo; com vídeo vale o escolhido (padrão: com chat).
  const layout = hasVideo ? storedLayout : LAYOUT.MINIMUM;
  const resizable = layout === LAYOUT.MINIMUM || layout === LAYOUT.NORMAL;
  const [idle, idleHandlers] = useIdle(hasVideo && layout !== LAYOUT.MINIMUM);

  // Altura máxima = canal menos 200 px (acompanha o tamanho da janela).
  const hasCall = !!call;
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => setMaxHeight(Math.max(CALL_MIN_HEIGHT, parent.clientHeight - CALL_CHAT_RESERVE));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [hasCall]);

  // A tela cheia acaba quando o vídeo acaba, quando a pessoa sai da chamada ou quando a área some.
  useEffect(() => {
    if (!hasVideo || !inCall) leaveFullScreen(channel.id);
  }, [hasVideo, inCall, channel.id]);
  useEffect(() => () => leaveFullScreen(channel.id), [channel.id]);

  if (!call) return null;

  const tiles = [me, ...channel.recipients.map((u) => users[u.id] ?? u)]
    .map((user) => {
      const voiceState = voiceStates[user.id]?.channel_id === channel.id ? voiceStates[user.id] : null;
      const ringing = call.ringing.includes(user.id);
      return { user, state: voiceState, ringing };
    })
    // Quem não está na chamada só aparece enquanto toca, ou para quem está nela (com "Chamar").
    .filter((t) => t.state || t.ringing || inCall);

  const height = dragHeight ?? callHeaderHeight;
  const style = resizable && height != null && maxHeight != null
    ? { height: clamp(height, CALL_MIN_HEIGHT, maxHeight), minHeight: CALL_MIN_HEIGHT, maxHeight }
    : undefined;

  const controls = inCall ? (
    <CallControls onHangUp={hangUp} />
  ) : (
    <div className="call-controls">
      <button className="call-control join" title="Entrar na chamada" aria-label="Entrar na chamada" onClick={() => acceptCall(channel.id)}>
        <Phone size={24} />
      </button>
    </div>
  );

  return (
    <section
      ref={ref}
      className={`call-view layout-${layout}${hasVideo ? ' has-video' : ''}${idle ? ' idle' : ''}`}
      style={style}
      {...idleHandlers}
    >
      {layout === LAYOUT.FULL_SCREEN && (
        <header className="call-view-header">
          <Users size={20} />
          <h1>{privateChannelName(state, channel)}</h1>
        </header>
      )}
      {hasVideo ? (
        <VideoGrid channelId={channel.id} tiles={videoTiles} />
      ) : (
        <div className="call-tiles">
          {tiles.map(({ user, state: voiceState, ringing }) => (
            <div key={user.id} className={`call-tile${ringing ? ' ringing' : ''}${!voiceState && !ringing ? ' absent' : ''}`}>
              <div className={`call-avatar${voiceState && speaking[user.id] ? ' speaking' : ''}`} title={displayName(user)}>
                <span className="call-ripple" />
                <span className="call-ripple delay" />
                <Avatar user={user} size={80} />
                {voiceState?.self_deaf ? (
                  <span className="call-badge"><HeadphoneOff size={14} /></span>
                ) : voiceState?.self_mute ? (
                  <span className="call-badge"><MicOff size={14} /></span>
                ) : null}
              </div>
              {!voiceState && !ringing && inCall && (
                <button className="call-ring-button" onClick={() => ringAgain(channel.id)}>Chamar</button>
              )}
            </div>
          ))}
        </div>
      )}

      <CallBar
        left={hasVideo && inCall ? <ToggleChatButton channelId={channel.id} /> : null}
        center={controls}
        right={hasVideo && inCall ? <FullscreenButton channelId={channel.id} /> : null}
      />

      {resizable && maxHeight != null && (
        <ResizeHandle
          target={ref}
          maxHeight={maxHeight}
          onResize={setDragHeight}
          onResizeEnd={(h) => {
            setDragHeight(null);
            updateSettings({ callHeaderHeight: h });
          }}
        />
      )}
    </section>
  );
}
