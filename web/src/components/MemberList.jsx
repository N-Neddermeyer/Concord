import { Crown } from 'lucide-react';
import { openPopout } from '../lib/dialogs.js';
import { hoistedRole, memberColor } from '../lib/permissions.js';
import { useStore } from '../lib/store.js';
import { displayName } from '../lib/util.js';
import Avatar from './Avatar.jsx';

// Como no Discord: membros online agrupados pelo cargo "exibir separadamente" mais alto,
// depois o restante em "Online" e, por fim, "Offline".
export default function MemberList({ guildId }) {
  const members = useStore((s) => s.members[guildId]);
  const users = useStore((s) => s.users);
  const presences = useStore((s) => s.presences);
  const speaking = useStore((s) => s.speaking);
  const guild = useStore((s) => s.guilds[guildId]);
  const state = useStore((s) => s);

  const byName = (a, b) => displayName(users[a]).localeCompare(displayName(users[b]));
  const groups = new Map(); // chave -> { title, position, ids }
  for (const id of Object.keys(members ?? {})) {
    const status = presences[id] ?? 'offline';
    let key = 'online';
    let title = 'Online';
    let position = -1;
    if (status === 'offline') {
      key = 'offline';
      title = 'Offline';
      position = -2;
    } else {
      const role = hoistedRole(state, guildId, id);
      if (role) [key, title, position] = [role.id, role.name, role.position];
    }
    if (!groups.has(key)) groups.set(key, { key, title, position, ids: [] });
    groups.get(key).ids.push(id);
  }
  const ordered = [...groups.values()].sort((a, b) => b.position - a.position);

  return (
    <aside className="member-list">
      {ordered.map((group) => (
        <div key={group.key}>
          <h3 className="member-group">{group.title} — {group.ids.length}</h3>
          {group.ids.sort(byName).map((id) => {
            const status = presences[id] ?? 'offline';
            return (
              <button
                key={id}
                className={`member${status === 'offline' ? ' offline' : ''}`}
                onClick={(e) => openPopout({ userId: id, guildId, rect: e.currentTarget.getBoundingClientRect(), side: 'left' })}
              >
                <Avatar user={users[id]} size={32} status={status} speaking={!!speaking[id]} />
                <span className="member-name" style={{ color: memberColor(state, guildId, id) ?? undefined }}>{displayName(users[id])}</span>
                {id === guild.owner_id && <Crown size={14} className="owner-crown" aria-label="Dono do servidor" />}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
