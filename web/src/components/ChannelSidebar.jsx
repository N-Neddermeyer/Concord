import { ChevronDown, ChevronRight, Hash, HeadphoneOff, LogOut, MicOff, Plus, Settings, UserPlus, Video, Volume2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { closeMenu, confirmDialog, openMenu, openModal, openPopout, showError, useDialogs } from '../lib/dialogs.js';
import { P, has, permissionsFor } from '../lib/permissions.js';
import { dispatch, isUnread, navigate, openLayer, useStore } from '../lib/store.js';
import { displayName } from '../lib/util.js';
import { voice } from '../lib/voice.js';
import Avatar from './Avatar.jsx';
import { CreateChannelModal, InviteModal } from './modals.jsx';

const TEXT = 0;
const VOICE = 2;
const SETTINGS_PERMS = P.MANAGE_GUILD | P.MANAGE_ROLES | P.KICK_MEMBERS | P.BAN_MEMBERS;

export default function ChannelSidebar({ guildId, activeChannelId }) {
  const guild = useStore((s) => s.guilds[guildId]);
  const channels = useStore((s) => s.channels);
  const voiceStates = useStore((s) => s.voiceStates);
  const users = useStore((s) => s.users);
  const speaking = useStore((s) => s.speaking);
  const mentions = useStore((s) => s.mentions);
  const collapsed = useStore((s) => s.collapsed);
  const me = useStore((s) => s.user);
  const perms = useStore((s) => permissionsFor(s, guildId));
  const state = useStore((s) => s);
  const menuOpen = useDialogs().menu?.owner === 'guild-header';

  const list = Object.values(channels)
    .filter((c) => c.guild_id === guildId)
    .sort((a, b) => a.position - b.position);
  const canManageChannels = has(perms, P.MANAGE_CHANNELS);
  const canInvite = has(perms, P.CREATE_INSTANT_INVITE);

  const leave = async () => {
    const ok = await confirmDialog({
      title: `Sair de '${guild.name}'`,
      body: `Tem certeza de que deseja sair de ${guild.name}? Você não poderá voltar a este servidor a menos que seja convidado novamente.`,
      confirmLabel: 'Sair do servidor',
      danger: true,
    });
    if (ok) api(`/users/@me/guilds/${guildId}`, { method: 'DELETE' }).catch((e) => showError(e.message));
  };

  const openGuildMenu = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openMenu({
      owner: 'guild-header',
      rect: { ...rect.toJSON(), left: rect.left + 8 },
      side: 'below',
      width: rect.width - 16,
      items: [
        canInvite && { label: 'Convidar pessoas', icon: UserPlus, brand: true, onClick: () => openModal(InviteModal, { guildId }) },
        (perms & SETTINGS_PERMS) !== 0 && { label: 'Configurações do servidor', icon: Settings, onClick: () => openLayer({ type: 'guild', guildId, section: 'overview' }) },
        canManageChannels && { label: 'Criar canal', icon: Plus, onClick: () => openModal(CreateChannelModal, { guildId }) },
        guild.owner_id !== me.id && { separator: true },
        guild.owner_id !== me.id && { label: 'Sair do servidor', icon: LogOut, danger: true, onClick: leave },
      ],
    });
  };

  const section = (type, title) => {
    const key = `${guildId}:${type}`;
    const isCollapsed = !!collapsed[key];
    const items = list.filter((c) => c.type === type);
    return (
      <div className="channel-section">
        <div className="category">
          <button className="category-toggle" onClick={() => dispatch({ type: 'TOGGLE_CATEGORY', d: key })}>
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>{title}</span>
          </button>
          {canManageChannels && (
            <button className="category-add" aria-label="Criar canal" title="Criar canal" onClick={() => openModal(CreateChannelModal, { guildId, type })}>
              <Plus size={16} />
            </button>
          )}
        </div>
        {items.map((c) => {
          const active = c.id === activeChannelId;
          const unread = type === TEXT && isUnread(state, c);
          const participants = type === VOICE ? Object.values(voiceStates).filter((v) => v.channel_id === c.id) : [];
          if (isCollapsed && !active && !unread && participants.length === 0) return null;
          return (
            <div key={c.id}>
              <div className={`channel${active ? ' active' : ''}${unread ? ' unread' : ''}`}>
                {unread && !active && <span className="channel-pill" />}
                <button
                  className="channel-main"
                  onClick={() => {
                    navigate(guildId, c.id);
                    if (type === VOICE) voice.join(guildId, c.id);
                  }}
                >
                  {type === TEXT ? <Hash size={20} className="channel-icon" /> : <Volume2 size={20} className="channel-icon" />}
                  <span className="channel-name">{c.name}</span>
                </button>
                <span className="channel-actions">
                  {canInvite && (
                    <button aria-label="Criar convite" title="Criar convite" onClick={() => openModal(InviteModal, { guildId })}>
                      <UserPlus size={16} />
                    </button>
                  )}
                  {canManageChannels && (
                    <button aria-label="Editar canal" title="Editar canal" onClick={() => openLayer({ type: 'channel', guildId, channelId: c.id, section: 'overview' })}>
                      <Settings size={16} />
                    </button>
                  )}
                </span>
                {mentions[c.id] > 0 && !active && <span className="badge inline">{mentions[c.id]}</span>}
              </div>
              {participants.map((v) => (
                <button
                  key={v.user_id}
                  className="voice-user"
                  onClick={(e) => openPopout({ userId: v.user_id, guildId, rect: e.currentTarget.getBoundingClientRect() })}
                >
                  <Avatar user={users[v.user_id]} size={24} speaking={!!speaking[v.user_id]} />
                  <span className={speaking[v.user_id] ? 'speaking-name' : ''}>{displayName(users[v.user_id])}</span>
                  <span className="voice-flags">
                    {v.self_stream && <span className="live-pill small">Ao vivo</span>}
                    {v.self_video && <Video size={14} />}
                    {v.self_mute && !v.self_deaf && <MicOff size={14} />}
                    {v.self_deaf && <HeadphoneOff size={14} />}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <button
        className={`guild-header${menuOpen ? ' open' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => (menuOpen ? closeMenu() : openGuildMenu(e))}
      >
        <span>{guild.name}</span>
        {menuOpen ? <X size={18} /> : <ChevronDown size={18} />}
      </button>
      <div className="channel-list">
        {section(TEXT, 'Canais de texto')}
        {section(VOICE, 'Canais de voz')}
      </div>
    </>
  );
}
