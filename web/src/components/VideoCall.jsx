import { HeadphoneOff, Headphones, Maximize, Mic, MicOff, Monitor, MonitorUp, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { openModal } from '../lib/dialogs.js';
import { native } from '../lib/native.js';
import { useStore } from '../lib/store.js';
import { displayName } from '../lib/util.js';
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

export function VideoTile({ tile, focused = false, onFocus, children }) {
  const me = useStore((s) => s.user.id);
  const speaking = useStore((s) => !!s.speaking[tile.user.id]);
  const ref = useRef(null);
  const { user, state, kind, track } = tile;
  const isScreen = kind === 'screen';
  const showVideo = !!track;

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else ref.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <div
      ref={ref}
      className={`video-tile${speaking && !isScreen && state ? ' speaking' : ''}${focused ? ' focused' : ''}${isScreen ? ' screen' : ''}${state ? '' : ' ringing'}`}
      style={showVideo ? undefined : { background: user.banner_color ?? '#2b2d31' }}
      onClick={onFocus}
      onDoubleClick={fullscreen}
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
        <span>{displayName(user)}</span>
      </div>
      <button className="video-tile-fullscreen" aria-label="Tela cheia" title="Tela cheia" onClick={(e) => { e.stopPropagation(); fullscreen(); }}>
        <Maximize size={16} />
      </button>
    </div>
  );
}

// Grade de blocos com foco: clicar num bloco o amplia (os outros ficam numa faixa embaixo).
export function VideoGrid({ tiles, extra = null }) {
  const [focusKey, setFocusKey] = useState(null);
  const focused = tiles.find((t) => t.key === focusKey) ?? null;
  const toggle = (key) => setFocusKey((current) => (current === key ? null : key));

  if (focused) {
    return (
      <div className="video-grid focus-mode">
        <div className="video-focus">
          <VideoTile tile={focused} focused onFocus={() => toggle(focused.key)} />
        </div>
        <div className="video-strip">
          {tiles.filter((t) => t !== focused).map((t) => <VideoTile key={t.key} tile={t} onFocus={() => toggle(t.key)} />)}
        </div>
      </div>
    );
  }
  const count = tiles.length + (extra ? 1 : 0);
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  return (
    <div className="video-grid" style={{ '--columns': columns }}>
      {tiles.map((t) => <VideoTile key={t.key} tile={t} onFocus={() => toggle(t.key)} />)}
      {extra}
    </div>
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
