import { Ellipsis, MessageCircle, Pencil, UserPlus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { closePopout, confirmDialog, openMenu, openModal, showError } from '../lib/dialogs.js';
import { copyText } from '../lib/messages.js';
import { REL, navigate, openLayer, useStore } from '../lib/store.js';
import { displayName, formatShortDate, snowflakeTime } from '../lib/util.js';
import Avatar, { GuildIcon } from './Avatar.jsx';
import { CustomStatus, useCustomStatus } from './CustomStatus.jsx';
import { Modal } from './Modal.jsx';
import { openDm } from './UserPopout.jsx';

const call = (promise) => promise.catch((e) => showError(e.message));

export const openProfile = (userId, guildId = null) => {
  closePopout();
  return openModal(UserProfileModal, { userId, guildId });
};

// Nota pessoal sobre o usuário ("Clique para adicionar uma nota"): salva ao sair do campo.
export function NoteField({ userId }) {
  const saved = useStore((s) => s.notes[userId] ?? '');
  const [value, setValue] = useState(saved);
  const ref = useRef(null);
  useEffect(() => setValue(saved), [saved]);
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const save = () => {
    if (value.trim() === saved) return;
    call(api(`/users/@me/notes/${userId}`, { method: 'PUT', body: { note: value.trim() } }));
  };

  return (
    <textarea
      ref={ref}
      className="note-field"
      rows={1}
      maxLength={256}
      value={value}
      placeholder="Clique para adicionar uma nota"
      aria-label="Nota"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// Perfil completo, como o modal do Discord: Sobre mim, servidores e amigos em comum.
export function UserProfileModal({ close, userId: initialId, guildId }) {
  const [userId, setUserId] = useState(initialId);
  const user = useStore((s) => s.users[userId]);
  const me = useStore((s) => s.user);
  const status = useStore((s) => s.presences[userId] ?? 'offline');
  const relationship = useStore((s) => s.relationships[userId]);
  const guilds = useStore((s) => s.guilds);
  const custom = useCustomStatus(userId);
  const joinedAt = useStore((s) => (guildId ? s.members[guildId]?.[userId]?.joined_at : null));
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('about');

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setTab('about');
    api(`/users/${userId}/profile`).then((p) => !cancelled && setProfile(p), (e) => !cancelled && setProfile({ error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const shown = user ?? profile?.user;
  if (!shown) {
    return (
      <Modal className="profile-modal" onClose={() => close()}>
        <div className="profile-modal-loading">{profile?.error ?? 'Carregando…'}</div>
      </Modal>
    );
  }

  const isMe = userId === me.id;
  const mutualGuilds = (profile?.mutual_guilds ?? []).filter((g) => guilds[g.id]);
  const mutualFriends = profile?.mutual_friends ?? [];
  const nick = guildId ? mutualGuilds.find((g) => g.id === guildId)?.nick : null;

  const relate = (method, body) => call(api(`/users/@me/relationships/${userId}`, { method, body }));
  const removeFriend = async () => {
    const ok = await confirmDialog({
      title: `Remover '${displayName(shown)}'`,
      body: `Tem certeza de que deseja remover ${displayName(shown)} da sua lista de amigos?`,
      confirmLabel: 'Remover amizade',
      danger: true,
    });
    if (ok) relate('DELETE');
  };
  const block = async () => {
    const ok = await confirmDialog({
      title: `Bloquear ${displayName(shown)}?`,
      body: 'As mensagens dessa pessoa ficarão ocultas para você, ela não poderá te mandar mensagens diretas e a amizade será desfeita.',
      confirmLabel: 'Bloquear',
      danger: true,
    });
    if (ok) relate('PUT', { type: REL.BLOCKED });
  };

  const more = (e) => openMenu({
    rect: e.currentTarget.getBoundingClientRect(),
    side: 'below-end',
    items: [
      relationship?.type === REL.FRIEND && { label: 'Remover amizade', danger: true, onClick: removeFriend },
      relationship?.type === REL.BLOCKED
        ? { label: 'Desbloquear', onClick: () => relate('DELETE') }
        : { label: 'Bloquear', danger: true, onClick: block },
      { separator: true },
      { label: 'Copiar ID do usuário', onClick: () => copyText(userId) },
    ],
  });

  let friendButton = null;
  if (!isMe && relationship?.type !== REL.BLOCKED && relationship?.type !== REL.FRIEND) {
    friendButton = relationship?.type === REL.OUTGOING
      ? <button className="button secondary" disabled>Pedido enviado</button>
      : <button className="button success" onClick={() => relate('PUT', {})}><UserPlus size={16} /> {relationship?.type === REL.INCOMING ? 'Aceitar pedido' : 'Adicionar amigo'}</button>;
  }

  return (
    <Modal className="profile-modal" onClose={() => close()}>
      <div className="profile-modal-banner" style={{ background: shown.banner_color ?? shown.color }} />
      <div className="profile-modal-head">
        <div className="profile-modal-avatar"><Avatar user={shown} size={120} status={status} /></div>
        <div className="profile-modal-actions">
          {isMe ? (
            <button className="button secondary" onClick={() => { close(); openLayer({ type: 'user', section: 'profiles' }); }}>
              <Pencil size={16} /> Editar perfil
            </button>
          ) : (
            <>
              {relationship?.type !== REL.BLOCKED && (
                <button className="button brand" onClick={() => { close(); openDm(userId); }}><MessageCircle size={16} /> Enviar mensagem</button>
              )}
              {friendButton}
              <button className="button secondary icon-only" aria-label="Mais" title="Mais" onClick={more}><Ellipsis size={18} /></button>
            </>
          )}
        </div>
      </div>
      <div className="profile-modal-card">
        <div className="profile-modal-names">
          <h2>{nick || displayName(shown)}</h2>
          <div className="profile-username">{shown.username}{nick && <span className="muted"> · {displayName(shown)}</span>}</div>
          {custom && <div className="profile-custom-status"><CustomStatus status={custom} /></div>}
        </div>
        <nav className="profile-tabs">
          <button className={`profile-tab${tab === 'about' ? ' active' : ''}`} onClick={() => setTab('about')}>Sobre mim</button>
          {!isMe && (
            <>
              <button className={`profile-tab${tab === 'guilds' ? ' active' : ''}`} onClick={() => setTab('guilds')}>
                {mutualGuilds.length ? `${mutualGuilds.length} ${mutualGuilds.length === 1 ? 'servidor em comum' : 'servidores em comum'}` : 'Nenhum servidor em comum'}
              </button>
              <button className={`profile-tab${tab === 'friends' ? ' active' : ''}`} onClick={() => setTab('friends')}>
                {mutualFriends.length ? `${mutualFriends.length} ${mutualFriends.length === 1 ? 'amigo em comum' : 'amigos em comum'}` : 'Nenhum amigo em comum'}
              </button>
            </>
          )}
        </nav>
        <div className="profile-tab-body">
          {tab === 'about' && (
            <div className="profile-about">
              {shown.bio && (
                <section>
                  <h3>Sobre mim</h3>
                  <p className="profile-bio">{shown.bio}</p>
                </section>
              )}
              <section>
                <h3>Membro desde</h3>
                <p className="profile-since">
                  <span title="No Discord">{formatShortDate(snowflakeTime(userId))}</span>
                  {joinedAt && <><span className="profile-since-dot" /><span title={`Em ${guilds[guildId]?.name}`}>{guilds[guildId]?.name}: {formatShortDate(joinedAt)}</span></>}
                </p>
              </section>
              {!isMe && (
                <section>
                  <h3>Nota</h3>
                  <NoteField userId={userId} />
                </section>
              )}
            </div>
          )}
          {tab === 'guilds' && (
            <div className="profile-list">
              {!profile && <p className="muted">Carregando…</p>}
              {profile && !mutualGuilds.length && <p className="profile-empty">Nenhum servidor em comum.</p>}
              {mutualGuilds.map((g) => (
                <button key={g.id} className="profile-list-item" onClick={() => { close(); navigate(g.id); }}>
                  <span className="profile-list-guild"><GuildIcon guild={guilds[g.id]} size={40} /></span>
                  <span className="profile-list-text">
                    <b>{guilds[g.id].name}</b>
                    {g.nick && <small>{g.nick}</small>}
                  </span>
                </button>
              ))}
            </div>
          )}
          {tab === 'friends' && (
            <div className="profile-list">
              {!profile && <p className="muted">Carregando…</p>}
              {profile && !mutualFriends.length && <p className="profile-empty">Nenhum amigo em comum.</p>}
              {mutualFriends.map((u) => (
                <button key={u.id} className="profile-list-item" onClick={() => setUserId(u.id)}>
                  <MutualFriendAvatar user={u} />
                  <span className="profile-list-text"><b>{displayName(u)}</b><small>{u.username}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function MutualFriendAvatar({ user }) {
  const status = useStore((s) => s.presences[user.id] ?? 'offline');
  const live = useStore((s) => s.users[user.id]);
  return <Avatar user={live ?? user} size={40} status={status} />;
}
