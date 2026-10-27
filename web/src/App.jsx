import { useEffect, useState } from 'react';
import Auth from './components/Auth.jsx';
import ChannelSidebar from './components/ChannelSidebar.jsx';
import Chat, { NoTextChannel } from './components/Chat.jsx';
import FriendsPage from './components/FriendsPage.jsx';
import GroupMembers from './components/GroupMembers.jsx';
import GuildBar from './components/GuildBar.jsx';
import IncomingCall from './components/IncomingCall.jsx';
import MemberList from './components/MemberList.jsx';
import DialogHost from './components/Modal.jsx';
import { QuickSwitcher } from './components/modals.jsx';
import PrivateSidebar from './components/PrivateSidebar.jsx';
import ChannelSettings from './components/settings/ChannelSettings.jsx';
import GuildSettings from './components/settings/GuildSettings.jsx';
import UserSettings from './components/settings/UserSettings.jsx';
import TitleBar from './components/TitleBar.jsx';
import UserPanel, { VoicePanel } from './components/UserPanel.jsx';
import VoiceChannelView from './components/VoiceChannelView.jsx';
import { token } from './lib/api.js';
import { firstTextChannel } from './lib/channels.js';
import { closeAllModals, hasOpenModal, openModal } from './lib/dialogs.js';
import { gateway } from './lib/gateway.js';
import { HOME, dispatch, privateChannelName, useStore } from './lib/store.js';
import { displayName } from './lib/util.js';
import { voice } from './lib/voice.js';

export default function App() {
  const [authToken, setAuthToken] = useState(token.get());
  const connection = useStore((s) => s.connection);
  const ready = useStore((s) => s.ready);

  useEffect(() => {
    if (!authToken) return;
    gateway.connect(authToken);
    return () => {
      voice.cleanup();
      gateway.close();
      closeAllModals();
      dispatch({ type: 'RESET' });
    };
  }, [authToken]);

  useEffect(() => {
    if (connection === 'unauthorized') setAuthToken(null);
  }, [connection]);

  const logout = () => {
    token.clear();
    setAuthToken(null);
  };

  // Trocar a senha gera um token novo: guardamos para as próximas reconexões.
  const replaceToken = (value) => {
    token.set(value);
    gateway.token = value;
  };

  if (!authToken) {
    return (
      <div className="app-shell">
        <TitleBar title="" />
        <Auth
          onToken={(value) => {
            token.set(value);
            setAuthToken(value);
          }}
        />
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="app-shell">
        <TitleBar title="" />
        <div className="splash">
          <div className="spinner" />
          <p>Conectando…</p>
        </div>
      </div>
    );
  }
  return <Main onLogout={logout} onToken={replaceToken} />;
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === 'k' && !e.shiftKey) {
        if (!hasOpenModal()) openModal(QuickSwitcher);
      } else if (key === 'm' && e.shiftKey) {
        voice.toggleMute();
      } else if (key === 'd' && e.shiftKey) {
        voice.toggleDeafen();
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Main({ onLogout, onToken }) {
  const state = useStore((s) => s);
  const { nav, guilds, channels, connection, layer, showMembers } = state;
  useShortcuts();

  const guildId = nav.guildId === HOME || guilds[nav.guildId] ? nav.guildId : HOME;
  const isHome = guildId === HOME;

  // Canal aberto: o escolhido por último (texto ou voz), se ainda existir; senão o primeiro de texto.
  let channelId = nav.channels[guildId] ?? null;
  if (channelId && !channels[channelId]) channelId = null;
  if (!isHome && !channelId) channelId = firstTextChannel(channels, guildId)?.id ?? null;
  if (!isHome && ![0, 2].includes(channels[channelId]?.type)) channelId = null;

  const channel = channels[channelId];
  const isVoice = channel?.type === 2;
  const title = isHome
    ? (channel ? privateChannelName(state, channel) : 'Amigos')
    : guilds[guildId].name;

  useEffect(() => {
    document.title = channel && !isHome ? `${isVoice ? '' : '#'}${channel.name} | ${guilds[guildId].name}` : title;
  }, [title, channel, isHome, isVoice, guilds, guildId]);

  return (
    <div className="app-shell">
      <TitleBar title={title} />
      {connection !== 'connected' && <div className="banner">Reconectando ao servidor…</div>}
      <div className="app">
        <div className="sidebar-area">
          <GuildBar />
          <aside className="sidebar">
            {isHome ? <PrivateSidebar activeChannelId={channelId} /> : <ChannelSidebar guildId={guildId} activeChannelId={channelId} />}
          </aside>
          <div className="panels">
            <VoicePanel />
            <UserPanel />
          </div>
        </div>

        <div className="main-content">
          {isHome && !channel && <FriendsPage />}
          {channel && !isVoice && <Chat key={channelId} channelId={channelId} />}
          {isVoice && <VoiceChannelView key={channelId} channelId={channelId} />}
          {!isHome && !channel && <NoTextChannel />}
          {!isHome && showMembers && channel && !isVoice && <MemberList guildId={guildId} />}
          {isHome && showMembers && channel?.type === 3 && <GroupMembers channel={channel} />}
        </div>
      </div>

      {layer?.type === 'user' && <UserSettings section={layer.section} onLogout={onLogout} onToken={onToken} />}
      {layer?.type === 'guild' && <GuildSettings guildId={layer.guildId} section={layer.section} />}
      {layer?.type === 'channel' && <ChannelSettings channelId={layer.channelId} section={layer.section} />}
      <IncomingCall />
      <DialogHost />
    </div>
  );
}
