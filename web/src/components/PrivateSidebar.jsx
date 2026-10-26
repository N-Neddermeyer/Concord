import { Phone, Plus, Users, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { confirmDialog, openModal, showError } from '../lib/dialogs.js';
import { HOME, REL, dispatch, dmRecipient, isPrivate, navigate, privateChannelName, useStore } from '../lib/store.js';
import { compareIds, displayName } from '../lib/util.js';
import Avatar, { GroupIcon } from './Avatar.jsx';
import { NewDmModal, QuickSwitcher } from './modals.jsx';
import { openDm, openGroup } from './UserPopout.jsx';

export default function PrivateSidebar({ activeChannelId }) {
  const channels = useStore((s) => s.channels);
  const closedDms = useStore((s) => s.closedDms);
  const presences = useStore((s) => s.presences);
  const mentions = useStore((s) => s.mentions);
  const relationships = useStore((s) => s.relationships);
  const calls = useStore((s) => s.calls);
  const state = useStore((s) => s);

  const pending = Object.values(relationships).filter((r) => r.type === REL.INCOMING).length;
  const dms = Object.values(channels)
    .filter((c) => isPrivate(c) && (!closedDms[c.id] || c.id === activeChannelId))
    .sort((a, b) => compareIds(b.last_message_id ?? b.id, a.last_message_id ?? a.id));

  return (
    <>
      <div className="search-header">
        <button className="search-button" onClick={() => openModal(QuickSwitcher)}>Encontre ou comece uma conversa</button>
      </div>
      <div className="channel-list">
        <button className={`nav-item${!activeChannelId ? ' active' : ''}`} onClick={() => navigate(HOME, null)}>
          <Users size={22} />
          <span>Amigos</span>
          {pending > 0 && <span className="badge inline">{pending}</span>}
        </button>

        <div className="category dm-header">
          <span>Mensagens diretas</span>
          <button className="category-add" aria-label="Criar MD" title="Criar MD" onClick={() => openModal(NewDmModal, { onPick: (ids) => (ids.length === 1 ? openDm(ids[0]) : openGroup(ids)) })}>
            <Plus size={16} />
          </button>
        </div>

        {dms.map((c) => {
          if (c.type === 3) return <GroupItem key={c.id} channel={c} active={c.id === activeChannelId} mentions={mentions[c.id]} inCall={!!calls[c.id]} name={privateChannelName(state, c)} />;
          const user = dmRecipient(state, c);
          const status = presences[user.id] ?? 'offline';
          return (
            <div key={c.id} className={`dm-item${c.id === activeChannelId ? ' active' : ''}${mentions[c.id] ? ' unread' : ''}`}>
              <button className="dm-main" onClick={() => navigate(HOME, c.id)}>
                <Avatar user={user} size={32} status={status} />
                <span className="dm-name">{displayName(user)}</span>
                {calls[c.id] && <Phone size={14} className="dm-call" aria-label="Chamada em andamento" />}
              </button>
              {mentions[c.id] > 0 && <span className="badge inline">{mentions[c.id]}</span>}
              <button className="dm-close" aria-label="Fechar MD" onClick={() => dispatch({ type: 'CLOSE_DM', d: c.id })}>
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function GroupItem({ channel, active, mentions, inCall, name }) {
  const leave = async () => {
    const ok = await confirmDialog({
      title: `Sair de '${name}'`,
      body: `Tem certeza de que deseja sair de ${name}? Você não poderá voltar a esse grupo a menos que seja adicionado novamente.`,
      confirmLabel: 'Sair do grupo',
      danger: true,
    });
    if (ok) api(`/channels/${channel.id}`, { method: 'DELETE' }).catch((e) => showError(e.message));
  };
  const count = channel.recipients.length + 1;
  return (
    <div className={`dm-item${active ? ' active' : ''}${mentions ? ' unread' : ''}`}>
      <button className="dm-main" onClick={() => navigate(HOME, channel.id)}>
        <GroupIcon channel={channel} size={32} />
        <span className="dm-text">
          <span className="dm-name">{name}</span>
          <span className="dm-sub">{count} {count === 1 ? 'membro' : 'membros'}</span>
        </span>
        {inCall && <Phone size={14} className="dm-call" aria-label="Chamada em andamento" />}
      </button>
      {mentions > 0 && <span className="badge inline">{mentions}</span>}
      <button className="dm-close" aria-label="Sair do grupo" title="Sair do grupo" onClick={leave}>
        <X size={16} />
      </button>
    </div>
  );
}
