import { MessageCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { openModal } from '../lib/dialogs.js';
import { HOME, dmRecipient, isPrivate, isUnread, navigate, privateChannelName, useStore } from '../lib/store.js';
import Avatar, { GroupIcon, GuildIcon } from './Avatar.jsx';
import { AddGuildModal } from './modals.jsx';

function Badge({ count }) {
  if (!count) return null;
  return <span className="badge">{count > 99 ? '99+' : count}</span>;
}

function Item({ label, active, unread, mentions, onClick, className = '', children, onHover }) {
  return (
    <div className="guild-item">
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
          <Item key={id} label={guilds[id].name} active={current === id} unread={unread} mentions={count} onClick={() => navigate(id)} onHover={setTooltip}>
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
