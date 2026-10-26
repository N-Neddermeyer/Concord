import { HeadphoneOff, Headphones, Mic, MicOff, MonitorUp, PhoneOff, Settings, Signal, Video, VideoOff } from 'lucide-react';
import { OP, gateway } from '../lib/gateway.js';
import { openMenu } from '../lib/dialogs.js';
import { HOME, isPrivate, navigate, openLayer, privateChannelName, useStore } from '../lib/store.js';
import { STATUS_LABELS, displayName } from '../lib/util.js';
import { useVoice, voice } from '../lib/voice.js';
import Avatar from './Avatar.jsx';
import { toggleScreenShare } from './VideoCall.jsx';

const STATUS_OPTIONS = [
  ['online', null],
  ['idle', null],
  ['dnd', 'Você não receberá notificações na área de trabalho'],
  ['invisible', 'Você não aparecerá online, mas continuará com acesso a tudo'],
];

const statusIcon = (status) => () => <span className={`status-icon ${status === 'invisible' ? 'offline' : status}`} />;

export function VoicePanel() {
  const session = useVoice();
  const channel = useStore((s) => s.channels[session.channelId]);
  const guild = useStore((s) => s.guilds[session.guildId]);
  const privateName = useStore((s) => (isPrivate(channel) ? privateChannelName(s, channel) : null));
  if (!session.channelId) return null;

  return (
    <div className="voice-panel">
      <div className="voice-panel-row">
        <button className="voice-info" onClick={() => navigate(session.guildId ?? HOME, session.channelId)}>
          <div className="voice-connected"><Signal size={16} /> Voz conectada</div>
          <div className="voice-where">{privateName ? (channel.type === 1 ? `@${privateName}` : privateName) : `${channel?.name} / ${guild?.name}`}</div>
        </button>
        <button className="panel-button" aria-label="Desconectar" title="Desconectar" onClick={() => voice.leave()}>
          <PhoneOff size={20} />
        </button>
      </div>
      <div className="voice-panel-actions">
        <button className={`voice-action${session.video ? ' on' : ''}`} onClick={() => voice.toggleVideo()} title={session.video ? 'Desligar câmera' : 'Ligar câmera'}>
          {session.video ? <Video size={20} /> : <VideoOff size={20} />}
          <span>Câmera</span>
        </button>
        <button className={`voice-action${session.streaming ? ' on' : ''}`} onClick={toggleScreenShare} title={session.streaming ? 'Parar de transmitir' : 'Compartilhar tela'}>
          <MonitorUp size={20} />
          <span>{session.streaming ? 'Parar' : 'Tela'}</span>
        </button>
      </div>
    </div>
  );
}

export default function UserPanel() {
  const me = useStore((s) => s.user);
  const speaking = useStore((s) => !!s.speaking[s.user.id]);
  const session = useVoice();
  const status = me.status === 'invisible' ? 'offline' : me.status;

  const chooseStatus = (e) =>
    openMenu({
      rect: e.currentTarget.getBoundingClientRect(),
      side: 'above',
      width: 260,
      items: STATUS_OPTIONS.map(([value, hint]) => ({
        label: hint ? <><b>{STATUS_LABELS[value]}</b><small className="menu-hint">{hint}</small></> : <b>{STATUS_LABELS[value]}</b>,
        icon: statusIcon(value),
        onClick: () => gateway.send(OP.PRESENCE_UPDATE, { status: value }),
      })),
    });

  return (
    <div className="user-panel">
      <button className="user-panel-me" onClick={chooseStatus} aria-label="Definir status">
        <Avatar user={me} size={32} status={status} speaking={speaking} />
        <span className="user-panel-names">
          <span className="user-panel-display">{displayName(me)}</span>
          <span className="user-panel-sub">
            <span className="sub-status">{STATUS_LABELS[me.status]}</span>
            <span className="sub-username">{me.username}</span>
          </span>
        </span>
      </button>
      <button
        className={`panel-button${session.muted ? ' off' : ''}`}
        aria-label={session.muted ? 'Desativar mudo' : 'Silenciar'}
        title={session.muted ? 'Desativar mudo' : 'Silenciar'}
        onClick={() => voice.toggleMute()}
      >
        {session.muted ? <MicOff size={20} /> : <Mic size={20} />}
      </button>
      <button
        className={`panel-button${session.deafened ? ' off' : ''}`}
        aria-label={session.deafened ? 'Desativar ensurdecer' : 'Ensurdecer'}
        title={session.deafened ? 'Desativar ensurdecer' : 'Ensurdecer'}
        onClick={() => voice.toggleDeafen()}
      >
        {session.deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
      </button>
      <button className="panel-button" aria-label="Configurações de usuário" title="Configurações de usuário"
        onClick={() => openLayer({ type: 'user', section: 'account' })}>
        <Settings size={20} />
      </button>
    </div>
  );
}
