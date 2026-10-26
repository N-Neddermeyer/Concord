import { Crown, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { confirmDialog, openPopout, showError } from '../lib/dialogs.js';
import { useStore } from '../lib/store.js';
import { displayName } from '../lib/util.js';
import Avatar from './Avatar.jsx';

// Lista de membros de um grupo de DM (à direita, como no Discord). O dono pode remover pessoas.
export default function GroupMembers({ channel }) {
  const me = useStore((s) => s.user);
  const users = useStore((s) => s.users);
  const presences = useStore((s) => s.presences);
  const speaking = useStore((s) => s.speaking);

  const members = [me, ...channel.recipients.map((u) => users[u.id] ?? u)]
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const isOwner = channel.owner_id === me.id;

  const remove = async (user) => {
    const ok = await confirmDialog({
      title: `Remover ${displayName(user)}`,
      body: `Tem certeza de que deseja remover ${displayName(user)} do grupo?`,
      confirmLabel: 'Remover',
      danger: true,
    });
    if (ok) api(`/channels/${channel.id}/recipients/${user.id}`, { method: 'DELETE' }).catch((e) => showError(e.message));
  };

  return (
    <aside className="member-list">
      <h3 className="member-group">Membros — {members.length}</h3>
      {members.map((user) => {
        const status = presences[user.id] ?? 'offline';
        return (
          <div key={user.id} className={`member group-member${status === 'offline' ? ' offline' : ''}`}>
            <button
              className="group-member-main"
              onClick={(e) => openPopout({ userId: user.id, rect: e.currentTarget.getBoundingClientRect(), side: 'left' })}
            >
              <Avatar user={user} size={32} status={status} speaking={!!speaking[user.id]} />
              <span className="member-name">{displayName(user)}</span>
              {user.id === channel.owner_id && <Crown size={14} className="owner-crown" aria-label="Dono do grupo" />}
            </button>
            {isOwner && user.id !== me.id && (
              <button className="group-member-remove" aria-label={`Remover ${displayName(user)}`} title="Remover do grupo" onClick={() => remove(user)}>
                <X size={16} />
              </button>
            )}
          </div>
        );
      })}
    </aside>
  );
}
