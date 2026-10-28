import { MessageCircle, Pencil, UserPlus } from 'lucide-react';
import { api } from '../lib/api.js';
import { closePopout, showError } from '../lib/dialogs.js';
import { memberRoles } from '../lib/permissions.js';
import { HOME, REL, getState, navigate, openLayer, useStore } from '../lib/store.js';
import { displayName, formatShortDate } from '../lib/util.js';
import Avatar from './Avatar.jsx';
import { CustomStatus, useCustomStatus } from './CustomStatus.jsx';
import { useAnchoredPosition } from './Modal.jsx';
import { NoteField, openProfile } from './UserProfile.jsx';

// Abre (ou cria) a DM com o usuário e navega até ela.
export async function openGroup(userIds) {
  try {
    const channel = await api('/users/@me/channels', { method: 'POST', body: { recipients: userIds } });
    navigate(HOME, channel.id);
  } catch (e) {
    showError(e.message);
  }
}

export async function openDm(userId) {
  const existing = Object.values(getState().channels).find((c) => c.type === 1 && c.recipients[0]?.id === userId);
  try {
    const channel = existing ?? (await api('/users/@me/channels', { method: 'POST', body: { recipient_id: userId } }));
    navigate(HOME, channel.id);
  } catch (e) {
    showError(e.message);
  }
}

export function ProfileCard({ user, status, guildId, children, preview = false, onOpenProfile }) {
  const state = useStore((s) => s);
  const custom = useCustomStatus(user.id);
  const roles = guildId ? memberRoles(state, guildId, user.id).filter((r) => r.id !== guildId) : [];
  const joinedAt = guildId ? state.members[guildId]?.[user.id]?.joined_at : null;
  const nick = guildId ? state.members[guildId]?.[user.id]?.nick : null;
  return (
    <div className="profile-card">
      <div className="profile-banner" style={{ background: user.banner_color ?? user.color }} />
      {onOpenProfile ? (
        <button className="profile-avatar clickable" aria-label="Ver perfil completo" title="Ver perfil completo" onClick={onOpenProfile}>
          <Avatar user={user} size={80} status={status} />
        </button>
      ) : (
        <div className="profile-avatar">
          <Avatar user={user} size={80} status={status} />
        </div>
      )}
      <div className="profile-body">
        <div className="profile-names">
          <div className="profile-display">{nick || displayName(user)}</div>
          <div className="profile-username">{user.username}{nick && <span className="muted"> · {displayName(user)}</span>}</div>
          {custom && <div className="profile-custom-status"><CustomStatus status={custom} /></div>}
        </div>
        {(user.bio || preview) && (
          <section>
            <h3>Sobre mim</h3>
            <p className="profile-bio">{user.bio || <span className="muted">Conte um pouco sobre você.</span>}</p>
          </section>
        )}
        {joinedAt && (
          <section>
            <h3>Membro desde</h3>
            <p>{formatShortDate(joinedAt)}</p>
          </section>
        )}
        {roles.length > 0 && (
          <section>
            <h3>Cargos</h3>
            <div className="role-pills">
              {roles.map((r) => (
                <span key={r.id} className="role-pill">
                  <span className="role-dot" style={{ background: r.color ?? '#99aab5' }} />
                  {r.name}
                </span>
              ))}
            </div>
          </section>
        )}
        {children}
      </div>
    </div>
  );
}

export default function UserPopout({ userId, guildId, rect, side = 'right' }) {
  const user = useStore((s) => s.users[userId]);
  const me = useStore((s) => s.user);
  const status = useStore((s) => s.presences[userId] ?? 'offline');
  const relationship = useStore((s) => s.relationships[userId]);
  const [ref, pos] = useAnchoredPosition(rect, side);
  if (!user) return null;

  const isMe = userId === me.id;
  const addFriend = () =>
    api(`/users/@me/relationships/${userId}`, { method: 'PUT', body: {} }).catch((e) => showError(e.message));

  let friendButton = null;
  if (!isMe && relationship?.type !== REL.BLOCKED) {
    if (relationship?.type === REL.FRIEND) friendButton = null;
    else if (relationship?.type === REL.OUTGOING) friendButton = <button className="button secondary" disabled>Pedido enviado</button>;
    else friendButton = (
      <button className="button secondary" onClick={addFriend}>
        <UserPlus size={16} /> {relationship?.type === REL.INCOMING ? 'Aceitar pedido' : 'Adicionar amigo'}
      </button>
    );
  }

  return (
    <div className="popout" ref={ref} style={pos} onMouseDown={(e) => e.stopPropagation()}>
      <ProfileCard user={user} status={status} guildId={guildId} onOpenProfile={() => openProfile(userId, guildId)}>
        {!isMe && (
          <section>
            <h3>Nota</h3>
            <NoteField userId={userId} />
          </section>
        )}
        <div className="profile-actions">
          {isMe ? (
            <button
              className="button secondary"
              onClick={() => {
                closePopout();
                openLayer({ type: 'user', section: 'profiles' });
              }}
            >
              <Pencil size={16} /> Editar perfil
            </button>
          ) : (
            <>
              <button
                className="button brand"
                onClick={() => {
                  closePopout();
                  openDm(userId);
                }}
              >
                <MessageCircle size={16} /> Enviar mensagem
              </button>
              {friendButton}
            </>
          )}
        </div>
        <button className="link profile-full-link" onClick={() => openProfile(userId, guildId)}>Ver perfil completo</button>
      </ProfileCard>
    </div>
  );
}
