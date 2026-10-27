import {
  HeadphoneOff, Headphones, Maximize, MessageSquare, MessageSquareOff, Mic, MicOff, Minimize, Monitor, MonitorUp, PhoneOff, Video,
  VideoOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  LAYOUT, fullscreenParticipant, selectParticipant, toggleChat, toggleFullScreen, useCallLayout,
} from '../lib/callLayout.js';
import { openModal } from '../lib/dialogs.js';
import { native } from '../lib/native.js';
import { memberName, useStore } from '../lib/store.js';
import { useVoice, voice } from '../lib/voice.js';
import Avatar from './Avatar.jsx';
import { Modal } from './Modal.jsx';

// Peças de vídeo compartilhadas pela chamada da DM/grupo e pelo canal de voz do servidor:
// os blocos (câmera, avatar ou tela), os controles e o seletor de "Compartilhar tela".

export function VideoTrack({ track, mirror = false, contain = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) el.play().catch(() => {});
  }, [track]);
  return <video ref={ref} className={`video-track${mirror ? ' mirror' : ''}${contain ? ' contain' : ''}`} autoPlay playsInline muted />;
}

// Blocos de quem está no canal: um por pessoa (câmera ou avatar) e um a mais por tela transmitida.
export function useVideoTiles(channelId, userIds) {
  const voiceStates = useStore((s) => s.voiceStates);
  const users = useStore((s) => s.users);
  useVoice(); // relê as trilhas quando chegam ou saem
  const tiles = [];
  for (const id of userIds) {
    const state = voiceStates[id]?.channel_id === channelId ? voiceStates[id] : null;
    const user = users[id];
    if (!user) continue;
    const camera = state?.self_video ? voice.videoTrack(id, 'camera') : null;
    tiles.push({ key: `${id}:camera`, user, state, kind: 'camera', track: camera });
    if (state?.self_stream) tiles.push({ key: `${id}:screen`, user, state, kind: 'screen', track: voice.videoTrack(id, 'screen') });
  }
  return tiles;
}

// Clique destaca o bloco; duplo clique ou o botão do canto põem o bloco em tela cheia
// (destaca e entra em tela cheia, como o handleFullscreenParticipant do Discord).
export function VideoTile({ tile, focused = false, fullscreen = false, onFocus, onFullscreen, children }) {
  const me = useStore((s) => s.user.id);
  const speaking = useStore((s) => !!s.speaking[tile.user.id]);
  const name = useStore((s) => memberName(s, tile.state?.guild_id, tile.user.id, tile.user)); // apelido no canal de voz
  const { user, state, kind, track } = tile;
  const isScreen = kind === 'screen';
  const showVideo = !!track;
  const label = fullscreen && focused ? 'Sair da tela cheia' : 'Tela cheia';

  return (
    <div
      className={`video-tile${speaking && !isScreen && state ? ' speaking' : ''}${focused ? ' focused' : ''}${isScreen ? ' screen' : ''}${state ? '' : ' ringing'}`}
      style={showVideo ? undefined : { background: user.banner_color ?? '#2b2d31' }}
      onClick={onFocus}
      onDoubleClick={onFullscreen}
    >
      {showVideo ? (
        <VideoTrack track={track} mirror={!isScreen && user.id === me} contain={isScreen || focused} />
      ) : isScreen ? (
        <div className="video-tile-waiting"><Monitor size={32} /> Carregando transmissão…</div>
      ) : (
        <div className="video-tile-avatar">
          <span className="call-avatar">
            <span className="call-ripple" />
            <span className="call-ripple delay" />
            <Avatar user={user} size={80} />
          </span>
        </div>
      )}
      {children}
      <div className="video-tile-label">
        {isScreen && <span className="live-pill">Ao vivo</span>}
        {!isScreen && state?.self_deaf ? <HeadphoneOff size={14} /> : !isScreen && state?.self_mute ? <MicOff size={14} /> : null}
        <span>{name}</span>
      </div>
      <button
        className="video-tile-fullscreen"
        aria-label={label}
        title={label}
        onClick={(e) => { e.stopPropagation(); onFullscreen?.(); }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {fullscreen && focused ? <Minimize size={16} /> : <Maximize size={16} />}
      </button>
    </div>
  );
}

// Grade de blocos com foco: clicar num bloco o amplia (os outros ficam numa faixa embaixo).
// O destaque fica no layout do canal, então sobrevive a entrar e sair da tela cheia.
export function VideoGrid({ channelId, tiles, extra = null }) {
  const { layout, selected } = useCallLayout(channelId);
  const me = useStore((s) => s.user.id);
  const fullscreen = layout === LAYOUT.FULL_SCREEN;
  const focused = tiles.find((t) => t.key === selected) ?? null;

  // Quando alguém começa a transmitir a tela, ela vai para o destaque (se nada estiver em destaque).
  const remoteScreens = tiles.filter((t) => t.kind === 'screen' && t.user.id !== me).map((t) => t.key).join(',');
  const seenScreens = useRef(new Set());
  useEffect(() => {
    const keys = remoteScreens ? remoteScreens.split(',') : [];
    const fresh = keys.find((k) => !seenScreens.current.has(k));
    seenScreens.current = new Set(keys);
    if (fresh && !focused) selectParticipant(channelId, fresh);
  }, [remoteScreens]); // só quando muda o conjunto de telas
  const props = (t) => ({
    tile: t,
    fullscreen,
    onFocus: () => selectParticipant(channelId, selected === t.key ? null : t.key),
    onFullscreen: () => fullscreenParticipant(channelId, t.key),
  });

  if (focused) {
    return (
      <div className="video-grid focus-mode">
        <div className="video-focus">
          <VideoTile {...props(focused)} focused />
        </div>
        {tiles.length > 1 && (
          <div className="video-strip">
            {tiles.filter((t) => t !== focused).map((t) => <VideoTile key={t.key} {...props(t)} />)}
          </div>
        )}
      </div>
    );
  }
  const count = tiles.length + (extra ? 1 : 0);
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  return (
    <div className="video-grid" style={{ '--columns': columns }}>
      {tiles.map((t) => <VideoTile key={t.key} {...props(t)} />)}
      {extra}
    </div>
  );
}

// --- barra de baixo da chamada (esquerda: chat; centro: controles; direita: tela cheia) ---

export function CallBar({ left = null, center, right = null }) {
  return (
    <div className="call-bar">
      <div className="call-bar-side left">{left}</div>
      {center}
      <div className="call-bar-side right">{right}</div>
    </div>
  );
}

export function ToggleChatButton({ channelId }) {
  const { layout } = useCallLayout(channelId);
  const chatOpen = layout === LAYOUT.NORMAL;
  const label = chatOpen ? 'Ocultar chat' : 'Mostrar chat';
  return (
    <button className="call-bar-button" aria-label={label} title={label} onClick={() => toggleChat(channelId)}>
      {chatOpen ? <MessageSquareOff size={22} /> : <MessageSquare size={22} />}
    </button>
  );
}

export function FullscreenButton({ channelId }) {
  const { layout } = useCallLayout(channelId);
  const full = layout === LAYOUT.FULL_SCREEN;
  const label = full ? 'Sair da tela cheia' : 'Tela cheia';
  return (
    <button className="call-bar-button" aria-label={label} title={label} onClick={() => toggleFullScreen(channelId)}>
      {full ? <Minimize size={22} /> : <Maximize size={22} />}
    </button>
  );
}

// --- compartilhar tela ---

export function toggleScreenShare() {
  if (voice.screen) return voice.stopScreen();
  if (native?.screen) return openModal(ScreenShareModal);
  voice.startScreen(); // navegador: o seletor é o do próprio navegador
}

const FRAME_RATES = [15, 30, 60];

function ScreenShareModal({ close }) {
  const [sources, setSources] = useState(null);
  const [tab, setTab] = useState('window');
  const [selected, setSelected] = useState(null);
  const [frameRate, setFrameRate] = useState(30);

  useEffect(() => {
    native.screen.getSources().then(setSources).catch(() => setSources([]));
  }, []);

  const list = (sources ?? []).filter((s) => s.kind === tab);
  const go = () => {
    native.screen.select(selected);
    close();
    voice.startScreen({ frameRate });
  };

  return (
    <Modal
      title="Compartilhar tela"
      onClose={close}
      className="screen-share-modal"
      footer={
        <>
          <div className="screen-share-quality">
            <span className="field-label">Taxa de quadros</span>
            <div className="segmented">
              {FRAME_RATES.map((fps) => (
                <button key={fps} className={fps === frameRate ? 'active' : ''} onClick={() => setFrameRate(fps)}>{fps} FPS</button>
              ))}
            </div>
          </div>
          <button className="button link-button" onClick={close}>Cancelar</button>
          <button className="button brand" disabled={!selected} onClick={go}>Ao vivo</button>
        </>
      }
    >
      <div className="screen-share-tabs">
        <button className={tab === 'window' ? 'active' : ''} onClick={() => setTab('window')}>Aplicativos</button>
        <button className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')}>Telas</button>
      </div>
      {!sources ? (
        <div className="screen-share-empty"><div className="spinner" /></div>
      ) : list.length === 0 ? (
        <div className="screen-share-empty muted">{tab === 'window' ? 'Nenhum aplicativo aberto para compartilhar.' : 'Nenhuma tela encontrada.'}</div>
      ) : (
        <div className="screen-share-grid">
          {list.map((s) => (
            <button
              key={s.id}
              className={`screen-source${selected === s.id ? ' selected' : ''}`}
              onClick={() => setSelected(s.id)}
              onDoubleClick={() => {
                setSelected(s.id);
                native.screen.select(s.id);
                close();
                voice.startScreen({ frameRate });
              }}
            >
              <img src={s.thumbnail} alt="" draggable={false} />
              <span className="screen-source-name">
                {s.icon && <img src={s.icon} alt="" draggable={false} />}
                <span>{s.name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// --- controles ---

export function CallControls({ onHangUp = () => voice.leave(), deafen = false }) {
  const session = useVoice();
  return (
    <div className="call-controls">
      <button
        className={`call-control${session.video ? ' on' : ''}`}
        title={session.video ? 'Desligar câmera' : 'Ligar câmera'}
        aria-label={session.video ? 'Desligar câmera' : 'Ligar câmera'}
        onClick={() => voice.toggleVideo()}
      >
        {session.video ? <Video size={24} /> : <VideoOff size={24} />}
      </button>
      <button
        className={`call-control${session.streaming ? ' on' : ''}`}
        title={session.streaming ? 'Parar de transmitir' : 'Compartilhar tela'}
        aria-label={session.streaming ? 'Parar de transmitir' : 'Compartilhar tela'}
        onClick={toggleScreenShare}
      >
        <MonitorUp size={24} />
      </button>
      <button
        className={`call-control${session.muted ? ' off' : ''}`}
        title={session.muted ? 'Desativar mudo' : 'Silenciar'}
        aria-label={session.muted ? 'Desativar mudo' : 'Silenciar'}
        onClick={() => voice.toggleMute()}
      >
        {session.muted ? <MicOff size={24} /> : <Mic size={24} />}
      </button>
      {deafen && (
        <button
          className={`call-control${session.deafened ? ' off' : ''}`}
          title={session.deafened ? 'Desativar ensurdecer' : 'Ensurdecer'}
          aria-label={session.deafened ? 'Desativar ensurdecer' : 'Ensurdecer'}
          onClick={() => voice.toggleDeafen()}
        >
          {session.deafened ? <HeadphoneOff size={24} /> : <Headphones size={24} />}
        </button>
      )}
      <button className="call-control hangup" title="Desconectar" aria-label="Desconectar" onClick={onHangUp}>
        <PhoneOff size={24} />
      </button>
    </div>
  );
}
