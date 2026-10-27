import { MessageCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { openModal, showError } from '../lib/dialogs.js';
import { HOME, dispatch, dmRecipient, isPrivate, isUnread, navigate, privateChannelName, useStore } from '../lib/store.js';
import Avatar, { GroupIcon, GuildIcon } from './Avatar.jsx';
import { AddGuildModal } from './modals.jsx';

function Badge({ count }) {
  if (!count) return null;
  return <span className="badge">{count > 99 ? '99+' : count}</span>;
}

function Item({ label, active, unread, mentions, onClick, className = '', children, onHover, dragProps, dropClass = '' }) {
  return (
    <div className={`guild-item${dropClass}`} {...dragProps}>
      <span className={`pill${active ? ' active' : unread ? ' unread' : ''}`} />
      <button
        className={`guild-icon ${className}${active ? ' active' : ''}`}
        aria-label={label}
        onClick={onClick}
        onMouseEnter={(e) => onHover({ label, top: e.currentTarget.getBoundingClientRect() })}
        onMouseLeave={() => onHover(null)}
      >
        {children}
      </button>
      <Badge count={mentions} />
    </div>
  );
}

export default function GuildBar() {
  const guilds = useStore((s) => s.guilds);
  const guildOrder = useStore((s) => s.guildOrder);
  const current = useStore((s) => s.nav.guildId);
  const channels = useStore((s) => s.channels);
  const mentions = useStore((s) => s.mentions);
  const state = useStore((s) => s);
  const [tooltip, setTooltip] = useState(null);
  const [drag, setDrag] = useState(null); // servidor arrastado
  const [drop, setDrop] = useState(null); // { id, where: 'before' | 'after' }

  // Arrastar servidores muda a ordem na barra (guild_positions, salva na conta como no Discord).
  const dragProps = (id) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setDrag(id);
      setTooltip(null);
    },
    onDragEnd: () => {
      setDrag(null);
      setDrop(null);
    },
    onDragOver: (e) => {
      if (!drag || drag === id) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const where = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      if (drop?.id !== id || drop.where !== where) setDrop({ id, where });
    },
    onDrop: (e) => {
      e.preventDefault();
      if (drag && drop) {
        const order = guildOrder.filter((g) => g !== drag);
        order.splice(order.indexOf(drop.id) + (drop.where === 'after' ? 1 : 0), 0, drag);
        dispatch({ type: 'GUILD_ORDER', d: order });
        api('/users/@me/settings', { method: 'PATCH', body: { guild_positions: order } }).catch((err) => showError(err.message));
      }
      setDrag(null);
      setDrop(null);
    },
  });
  const dropClass = (id) => (drop?.id === id ? ` drop-${drop.where}` : '') + (drag === id ? ' dragging' : '');

  const unreadDms = Object.values(channels).filter((c) => isPrivate(c) && mentions[c.id]);
  const guildStatus = (guildId) => {
    let unread = false;
    let count = 0;
    for (const c of Object.values(channels)) {
      if (c.guild_id !== guildId || c.type !== 0) continue;
      unread ||= isUnread(state, c);
      count += mentions[c.id] ?? 0;
    }
    return { unread, count };
  };

  return (
    <nav className="guild-bar">
      <Item label="Mensagens diretas" active={current === HOME} onClick={() => navigate(HOME)} onHover={setTooltip} className="home">
        <MessageCircle size={26} />
      </Item>

      {unreadDms.map((c) => {
        return (
          <Item key={c.id} label={privateChannelName(state, c)} unread mentions={mentions[c.id]} onClick={() => navigate(HOME, c.id)} onHover={setTooltip} className="dm">
            {c.type === 1 ? <Avatar user={dmRecipient(state, c)} size={48} /> : <GroupIcon channel={c} size={48} />}
          </Item>
        );
      })}

      <div className="guild-separator" />

      {guildOrder.map((id) => {
        const { unread, count } = guildStatus(id);
        return (
          <Item
            key={id}
            label={guilds[id].name}
            active={current === id}
            unread={unread}
            mentions={count}
            onClick={() => navigate(id)}
            onHover={setTooltip}
            dragProps={dragProps(id)}
            dropClass={dropClass(id)}
          >
            <GuildIcon guild={guilds[id]} />
          </Item>
        );
      })}

      <Item label="Adicionar um servidor" onClick={() => openModal(AddGuildModal)} onHover={setTooltip} className="action">
        <Plus size={24} />
      </Item>

      {tooltip && (
        <div className="tooltip right" style={{ top: tooltip.top.top + tooltip.top.height / 2, left: tooltip.top.right + 12 }}>
          {tooltip.label}
        </div>
      )}
    </nav>
  );
}
