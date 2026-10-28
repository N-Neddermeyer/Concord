import { IdCard, MessageCircle } from 'lucide-react';
import { openMenu, pointRect } from '../lib/dialogs.js';
import { copyText } from '../lib/messages.js';
import { useSettings } from '../lib/settings.js';
import { setUserAudio, userAudio, voice } from '../lib/voice.js';
import { openMemberMenu } from './MemberList.jsx';
import { openDm } from './UserPopout.jsx';
import { openProfile } from './UserProfile.jsx';

// Volume por pessoa na chamada (como no Discord): "Volume do usuário" de 0 a 200% e "Silenciar",
// e o mesmo para a transmissão de tela. Vale só para mim e fica salvo neste dispositivo.

// A pessoa está na mesma chamada que eu (e não sou eu)?
export function inMyCall(state, userId) {
  return !!voice.channelId && userId !== state.user.id && state.voiceStates[userId]?.channel_id === voice.channelId;
}

function VolumeSlider({ userId, stream = false }) {
  useSettings(); // relê ao arrastar
  const key = stream ? 'streamVolume' : 'volume';
  const value = userAudio(userId)[key];
  const label = stream ? 'Volume da transmissão' : 'Volume do usuário';
  return (
    <div className="menu-slider">
      <div className="menu-slider-label">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={200}
        value={value}
        aria-label={label}
        style={{ '--fill': `${value / 2}%` }}
        onChange={(e) => setUserAudio(userId, { [key]: Number(e.target.value) })}
      />
    </div>
  );
}

// Itens de volume para menus de usuário; vazio se a pessoa não está na minha chamada.
// `only: 'stream'` dá só os da transmissão (menu do bloco da tela).
export function voiceMenuItems(state, userId, { only = null } = {}) {
  if (!inMyCall(state, userId)) return [];
  const prefs = userAudio(userId);
  const items = [];
  if (only !== 'stream') {
    items.push(
      { separator: true },
      { custom: () => <VolumeSlider userId={userId} /> },
      { label: 'Silenciar', checked: prefs.muted, onClick: () => setUserAudio(userId, { muted: !prefs.muted }) },
    );
  }
  if (state.voiceStates[userId].self_stream) {
    items.push(
      { separator: true },
      { custom: () => <VolumeSlider userId={userId} stream /> },
      { label: 'Silenciar transmissão', checked: prefs.streamMuted, onClick: () => setUserAudio(userId, { streamMuted: !prefs.streamMuted }) },
    );
  }
  return only === 'stream' ? items.slice(1) : items;
}

// Clique direito em quem está na chamada: no servidor, o menu do membro; na DM/grupo, um menu curto.
export function openVoiceUserMenu(e, state, userId, guildId) {
  if (guildId) return openMemberMenu(e, state, guildId, userId);
  e.preventDefault();
  const isMe = userId === state.user.id;
  openMenu({
    rect: pointRect(e),
    side: 'right',
    items: [
      { label: 'Perfil', onClick: () => openProfile(userId) },
      !isMe && { label: 'Mensagem', icon: MessageCircle, onClick: () => openDm(userId) },
      ...voiceMenuItems(state, userId),
      { separator: true },
      { label: 'Copiar ID do usuário', icon: IdCard, onClick: () => copyText(userId) },
    ],
  });
}

// Ícone de "silenciado por você" ao lado do nome.
export function useLocallyMuted(userId) {
  useSettings();
  return userAudio(userId).muted;
}
