import {
  ChevronDown, ChevronRight, FolderPlus, Hash, HeadphoneOff, IdCard, Link, Lock, LogOut, MicOff, Pencil, Plus, Settings, Trash2, TriangleAlert,
  UserPlus, Video, Volume2, X,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { CATEGORY, TEXT, VOICE, channelTree, reorderPayload, sidebarOrder } from '../lib/channels.js';
import { closeMenu, confirmDialog, openMenu, openModal, openPopout, pointRect, showError, useDialogs } from '../lib/dialogs.js';
import { copyText } from '../lib/messages.js';
import { P, channelPermissionsFor, has, isPrivateChannel, isSynced, permissionsFor } from '../lib/permissions.js';
import { dispatch, isUnread, memberName, navigate, openLayer, useStore } from '../lib/store.js';
import { voice } from '../lib/voice.js';
import Avatar from './Avatar.jsx';
import { CreateCategoryModal, CreateChannelModal, InviteModal, NicknameModal } from './modals.jsx';

const SETTINGS_PERMS = P.MANAGE_GUILD | P.MANAGE_ROLES | P.KICK_MEMBERS | P.BAN_MEMBERS | P.VIEW_AUDIT_LOG;

// Ícone do canal como no Discord: # ou alto-falante, com cadeado (privado) ou alerta (NSFW).
export function ChannelIcon({ channel, size = 20, className = 'channel-icon' }) {
  const Icon = channel.type === VOICE ? Volume2 : Hash;
  const Badge = channel.nsfw ? TriangleAlert : isPrivateChannel(channel) ? Lock : null;
  return (
    <span className={`channel-icon-wrap ${className}`} style={{ width: size, height: size }}>
      <Icon size={size} />
      {Badge && <span className="channel-icon-badge"><Badge size={Math.round(size * 0.45)} strokeWidth={3} /></span>}
    </span>
  );
}

const channelLink = (c) => `${location.origin}/channels/${c.guild_id}/${c.id}`;
const markRead = (list) => {
  for (const c of list) if (c.last_message_id) dispatch({ type: 'ACK', d: { channelId: c.id, messageId: c.last_message_id } });
};

async function deleteChannel(channel) {
  const isCategory = channel.type === CATEGORY;
  const ok = await confirmDialog({
    title: isCategory ? 'Excluir categoria' : 'Excluir canal',
    body: isCategory
      ? `Tem certeza de que deseja excluir ${channel.name}? Os canais dela não serão excluídos: eles ficarão sem categoria.`
      : `Tem certeza de que deseja excluir ${channel.type === TEXT ? '#' : ''}${channel.name}? Esta ação não pode ser desfeita.`,
    confirmLabel: isCategory ? 'Excluir categoria' : 'Excluir canal',
    danger: true,
  });
  if (ok) api(`/channels/${channel.id}`, { method: 'DELETE' }).catch((e) => showError(e.message));
}

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
  const [drag, setDrag] = useState(null); // id do canal/categoria arrastado
  const [drop, setDrop] = useState(null); // { id, where: 'before' | 'after' | 'into' }

  const { loose, categories } = channelTree(channels, guildId);
  const canManageChannels = has(perms, P.MANAGE_CHANNELS);
  const canInvite = has(perms, P.CREATE_INSTANT_INVITE);
  const isOwner = guild.owner_id === me.id;
  const canNick = isOwner || has(perms, P.CHANGE_NICKNAME) || has(perms, P.MANAGE_NICKNAMES);
  const channelPerms = (c) => channelPermissionsFor(state, c.id);
  const canEdit = (c) => (channelPerms(c) & (P.MANAGE_CHANNELS | P.MANAGE_ROLES)) !== 0;
  const editChannel = (c) => openLayer({ type: 'channel', guildId, channelId: c.id, section: 'overview' });

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
        canManageChannels && { label: 'Criar categoria', icon: FolderPlus, onClick: () => openModal(CreateCategoryModal, { guildId }) },
        canNick && { separator: true },
        canNick && { label: 'Editar perfil do servidor', icon: Pencil, onClick: () => openModal(NicknameModal, { guildId, userId: me.id }) },
        !isOwner && { separator: true },
        !isOwner && { label: 'Sair do servidor', icon: LogOut, danger: true, onClick: leave },
      ],
    });
  };

  const channelMenu = (e, c) => {
    e.preventDefault();
    const cp = channelPerms(c);
    openMenu({
      rect: pointRect(e),
      side: 'right',
      items: [
        c.type === TEXT && { label: 'Marcar como lido', disabled: !isUnread(state, c), onClick: () => markRead([c]) },
        c.type === TEXT && { separator: true },
        has(cp, P.CREATE_INSTANT_INVITE) && { label: 'Convidar pessoas', icon: UserPlus, brand: true, onClick: () => openModal(InviteModal, { guildId }) },
        { label: 'Copiar link', icon: Link, onClick: () => copyText(channelLink(c)) },
        canEdit(c) && { separator: true },
        canEdit(c) && { label: 'Editar canal', icon: Settings, onClick: () => editChannel(c) },
        has(cp, P.MANAGE_CHANNELS) && { label: 'Excluir canal', icon: Trash2, danger: true, onClick: () => deleteChannel(c) },
        { separator: true },
        { label: 'Copiar ID do canal', icon: IdCard, onClick: () => copyText(c.id) },
      ],
    });
  };

  const categoryMenu = (e, category, children) => {
    e.preventDefault();
    const cp = channelPerms(category);
    const allCollapsed = categories.every(({ category: x }) => collapsed[x.id]);
    openMenu({
      rect: pointRect(e),
      side: 'right',
      items: [
        { label: 'Marcar como lida', disabled: !children.some((c) => c.type === TEXT && isUnread(state, c)), onClick: () => markRead(children.filter((c) => c.type === TEXT)) },
        { separator: true },
        { label: 'Recolher categoria', checked: !!collapsed[category.id], onClick: () => dispatch({ type: 'TOGGLE_CATEGORY', d: category.id }) },
        {
          label: 'Recolher todas as categorias',
          checked: allCollapsed,
          onClick: () => {
            for (const { category: x } of categories) if (!!collapsed[x.id] === allCollapsed) dispatch({ type: 'TOGGLE_CATEGORY', d: x.id });
          },
        },
        canEdit(category) && { separator: true },
        canEdit(category) && { label: 'Editar categoria', icon: Settings, onClick: () => editChannel(category) },
        has(cp, P.MANAGE_CHANNELS) && { label: 'Excluir categoria', icon: Trash2, danger: true, onClick: () => deleteChannel(category) },
        { separator: true },
        { label: 'Copiar ID da categoria', icon: IdCard, onClick: () => copyText(category.id) },
      ],
    });
  };

  const listMenu = (e) => {
    if (e.target !== e.currentTarget || !(canManageChannels || canInvite)) return;
    e.preventDefault();
    openMenu({
      rect: pointRect(e),
      side: 'right',
      items: [
        canManageChannels && { label: 'Criar canal', icon: Plus, onClick: () => openModal(CreateChannelModal, { guildId }) },
        canManageChannels && { label: 'Criar categoria', icon: FolderPlus, onClick: () => openModal(CreateCategoryModal, { guildId }) },
        canInvite && { label: 'Convidar pessoas', icon: UserPlus, brand: true, onClick: () => openModal(InviteModal, { guildId }) },
      ],
    });
  };

  // --- arrastar para reordenar (só com Gerenciar canais) ---

  const dragProps = (c) => (canManageChannels ? {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', c.id);
      setDrag(c.id);
    },
    onDragEnd: () => {
      setDrag(null);
      setDrop(null);
    },
  } : {});

  const dropProps = (target) => ({
    onDragOver: (e) => {
      if (!drag || drag === target.id) return;
      const dragged = channels[drag];
      const rect = e.currentTarget.getBoundingClientRect();
      const y = (e.clientY - rect.top) / rect.height;
      let where;
      if (dragged.type === CATEGORY) {
        if (target.type !== CATEGORY) return; // categorias só se encaixam entre categorias
        where = y < 0.5 ? 'before' : 'after';
      } else if (target.type === CATEGORY) {
        where = y < 0.3 ? 'before' : 'into';
      } else {
        where = y < 0.5 ? 'before' : 'after';
      }
      e.preventDefault();
      if (drop?.id !== target.id || drop.where !== where) setDrop({ id: target.id, where });
    },
    onDrop: (e) => {
      e.preventDefault();
      if (drag && drop) applyDrop(drag, drop);
      setDrag(null);
      setDrop(null);
    },
  });

  const applyDrop = (dragId, target) => {
    const order = sidebarOrder(channels, guildId);
    const dragged = channels[dragId];
    const moving = dragged.type === CATEGORY ? order.filter((c) => c.id === dragId || c.parent_id === dragId) : [dragged];
    const rest = order.filter((c) => !moving.includes(c));
    const anchor = channels[target.id];
    let index = rest.indexOf(anchor);
    if (target.where === 'into') index += 1;
    else if (target.where === 'after') {
      // Depois de uma categoria = depois do último canal dela.
      const last = anchor.type === CATEGORY ? rest.filter((c) => c.parent_id === anchor.id).at(-1) ?? anchor : anchor;
      index = rest.indexOf(last) + 1;
    }
    rest.splice(index, 0, ...moving);

    let parent = null;
    const layout = rest.map((c) => {
      if (c.type === CATEGORY) {
        parent = c.id;
        return { id: c.id, parent_id: null };
      }
      // Canal sincronizado que muda de categoria continua sincronizado (com a nova).
      const changed = c.id === dragId && (c.parent_id ?? null) !== parent;
      const wasSynced = c.parent_id ? isSynced(c, channels[c.parent_id]) : !c.permission_overwrites?.length;
      return { id: c.id, parent_id: parent, lock: changed && !!parent && wasSynced };
    });
    const changes = reorderPayload(channels, guildId, layout);
    if (changes.length) api(`/guilds/${guildId}/channels`, { method: 'PATCH', body: changes }).catch((e) => showError(e.message));
  };

  const dropClass = (id) => (drop?.id === id ? ` drop-${drop.where}` : '') + (drag === id ? ' dragging' : '');

  const channelRow = (c, isCollapsed) => {
    const active = c.id === activeChannelId;
    const unread = c.type === TEXT && isUnread(state, c);
    const participants = c.type === VOICE ? Object.values(voiceStates).filter((v) => v.channel_id === c.id) : [];
    if (isCollapsed && !active && !unread && participants.length === 0) return null;
    const cp = channelPerms(c);
    return (
      <div key={c.id} {...dragProps(c)} {...dropProps(c)} className={`channel-wrap${dropClass(c.id)}`}>
        <div className={`channel${active ? ' active' : ''}${unread ? ' unread' : ''}`} onContextMenu={(e) => channelMenu(e, c)}>
          {unread && !active && <span className="channel-pill" />}
          <button
            className="channel-main"
            onClick={() => {
              navigate(guildId, c.id);
              if (c.type === VOICE) voice.join(guildId, c.id);
            }}
          >
            <ChannelIcon channel={c} />
            <span className="channel-name">{c.name}</span>
          </button>
          <span className="channel-actions">
            {has(cp, P.CREATE_INSTANT_INVITE) && (
              <button aria-label="Criar convite" title="Criar convite" onClick={() => openModal(InviteModal, { guildId })}>
                <UserPlus size={16} />
              </button>
            )}
            {canEdit(c) && (
              <button aria-label="Editar canal" title="Editar canal" onClick={() => editChannel(c)}>
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
            <span className={speaking[v.user_id] ? 'speaking-name' : ''}>{memberName(state, guildId, v.user_id)}</span>
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
  };

  return (
    <>
      <div className={`guild-header-wrap${guild.banner ? ' with-banner' : ''}`}>
        {guild.banner && <div className="guild-banner" style={{ backgroundImage: `url(${guild.banner})` }} />}
        <button
          className={`guild-header${menuOpen ? ' open' : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => (menuOpen ? closeMenu() : openGuildMenu(e))}
        >
          <span>{guild.name}</span>
          {menuOpen ? <X size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>
      <div className={`channel-list${drag ? ' dragging-active' : ''}`} onContextMenu={listMenu}>
        {loose.length > 0 && <div className="channel-section loose">{loose.map((c) => channelRow(c, false))}</div>}
        {categories.map(({ category, children }) => {
          const isCollapsed = !!collapsed[category.id];
          const cp = channelPerms(category);
          return (
            <div key={category.id} className="channel-section">
              <div
                className={`category${dropClass(category.id)}`}
                {...dragProps(category)}
                {...dropProps(category)}
                onContextMenu={(e) => categoryMenu(e, category, children)}
              >
                <button className="category-toggle" onClick={() => dispatch({ type: 'TOGGLE_CATEGORY', d: category.id })}>
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <span>{category.name}</span>
                </button>
                {has(cp, P.MANAGE_CHANNELS) && (
                  <button
                    className="category-add"
                    aria-label="Criar canal"
                    title="Criar canal"
                    onClick={() => openModal(CreateChannelModal, { guildId, parentId: category.id, type: children.some((c) => c.type === TEXT) || !children.length ? TEXT : VOICE })}
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
              {children.map((c) => channelRow(c, isCollapsed))}
            </div>
          );
        })}
      </div>
    </>
  );
}

