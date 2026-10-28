import { Crown, IdCard, MessageCircle, Pencil, UserMinus, UserX } from 'lucide-react';
import { api } from '../lib/api.js';
import { confirmDialog, openMenu, openModal, openPopout, pointRect, showError } from '../lib/dialogs.js';
import { copyText } from '../lib/messages.js';
import { P, has, hoistedRole, memberColor, permissionsFor, rankOf } from '../lib/permissions.js';
import { memberName, useStore } from '../lib/store.js';
import Avatar from './Avatar.jsx';
import { CustomStatus } from './CustomStatus.jsx';
import { BanModal, NicknameModal } from './modals.jsx';
import { openDm } from './UserPopout.jsx';
import { openProfile } from './UserProfile.jsx';

// Clique direito num membro: perfil, mensagem, apelido e moderação, conforme as permissões.
export function openMemberMenu(e, state, guildId, userId) {
  e.preventDefault();
  const guild = state.guilds[guildId];
  const perms = permissionsFor(state, guildId);
  const isMe = userId === state.user.id;
  const outranks = !isMe && userId !== guild.owner_id && rankOf(state, guildId, userId) < rankOf(state, guildId);
  const canNick = isMe ? has(perms, P.CHANGE_NICKNAME) || has(perms, P.MANAGE_NICKNAMES) : has(perms, P.MANAGE_NICKNAMES) && outranks;
  const name = memberName(state, guildId, userId);
  const user = state.users[userId];

  const kick = async () => {
    const ok = await confirmDialog({
      title: `Expulsar '${name}' do servidor`,
      body: `Tem certeza de que deseja expulsar @${user.username} do servidor? Ele(a) poderá voltar com um novo convite.`,
      confirmLabel: 'Expulsar',
      danger: true,
    });
    if (ok) api(`/guilds/${guildId}/members/${userId}`, { method: 'DELETE' }).catch((err) => showError(err.message));
  };

  const rect = pointRect(e);
  openMenu({
    rect,
    side: 'right',
    items: [
      { label: 'Perfil', onClick: () => openProfile(userId, guildId) },
      !isMe && { label: 'Mensagem', icon: MessageCircle, onClick: () => openDm(userId) },
      canNick && { separator: true },
      canNick && { label: isMe ? 'Editar perfil do servidor' : 'Alterar apelido', icon: Pencil, onClick: () => openModal(NicknameModal, { guildId, userId }) },
      outranks && (has(perms, P.KICK_MEMBERS) || has(perms, P.BAN_MEMBERS)) && { separator: true },
      outranks && has(perms, P.KICK_MEMBERS) && { label: `Expulsar ${name}`, icon: UserMinus, danger: true, onClick: kick },
      outranks && has(perms, P.BAN_MEMBERS) && { label: `Banir ${name}`, icon: UserX, danger: true, onClick: () => openModal(BanModal, { guildId, user }) },
      { separator: true },
      { label: 'Copiar ID do usuário', icon: IdCard, onClick: () => copyText(userId) },
    ],
  });
}

// Como no Discord: membros online agrupados pelo cargo "exibir separadamente" mais alto,
// depois o restante em "Online" e, por fim, "Offline".
// `only`: ids que entram na lista (membros de uma conversa).
export default function MemberList({ guildId, only = null }) {
  const allMembers = useStore((s) => s.members[guildId]);
  const activities = useStore((s) => s.activities);
  const members = only ? Object.fromEntries(Object.entries(allMembers ?? {}).filter(([id]) => only.includes(id))) : allMembers;
  const users = useStore((s) => s.users);
  const presences = useStore((s) => s.presences);
  const speaking = useStore((s) => s.speaking);
  const guild = useStore((s) => s.guilds[guildId]);
  const state = useStore((s) => s);

  const nameOf = (id) => memberName(state, guildId, id);
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
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
                onContextMenu={(e) => openMemberMenu(e, state, guildId, id)}
              >
                <Avatar user={users[id]} size={32} status={status} speaking={!!speaking[id]} />
                <span className="member-text">
                  <span className="member-name-row">
                    <span className="member-name" style={{ color: memberColor(state, guildId, id) ?? undefined }}>{nameOf(id)}</span>
                    {id === guild.owner_id && <Crown size={14} className="owner-crown" aria-label="Dono do servidor" />}
                  </span>
                  {status !== 'offline' && <CustomStatus status={activities[id]} className="member-activity" />}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
