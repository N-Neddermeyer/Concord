import { Check, EllipsisVertical, MessageCircle, Search, UserX, Users, Volume2, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { confirmDialog, openMenu, openPopout, showError } from '../lib/dialogs.js';
import { REL, useStore } from '../lib/store.js';
import { STATUS_LABELS, displayName } from '../lib/util.js';
import Avatar from './Avatar.jsx';
import { CustomStatus } from './CustomStatus.jsx';
import { openDm } from './UserPopout.jsx';
import { openProfile } from './UserProfile.jsx';

const TABS = [
  ['online', 'Online'],
  ['all', 'Todos'],
  ['pending', 'Pendente'],
  ['blocked', 'Bloqueado'],
];

const call = (promise) => promise.catch((e) => showError(e.message));

export default function FriendsPage() {
  const [tab, setTab] = useState('online');
  const relationships = useStore((s) => s.relationships);
  const pendingCount = Object.values(relationships).filter((r) => r.type === REL.INCOMING).length;

  return (
    <div className="friends">
      <header className="chat-header friends-header">
        <Users size={22} className="header-icon" />
        <h1>Amigos</h1>
        <span className="header-divider" />
        <nav className="friend-tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={`tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
              {label}
              {key === 'pending' && pendingCount > 0 && <span className="badge inline">{pendingCount}</span>}
            </button>
          ))}
          <button className={`tab add-friend${tab === 'add' ? ' active' : ''}`} onClick={() => setTab('add')}>Adicionar amigo</button>
        </nav>
      </header>
      <div className="friends-body">
        <section className="friends-main">{tab === 'add' ? <AddFriend /> : <FriendList tab={tab} />}</section>
        <ActiveNow />
      </div>
    </div>
  );
}

function AddFriend() {
  const [username, setUsername] = useState('');
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('/users/@me/relationships', { method: 'POST', body: { username: username.trim() } });
      setResult({ ok: true, text: `Sucesso! Seu pedido de amizade para ${username.trim()} foi enviado.` });
      setUsername('');
    } catch (err) {
      setResult({ ok: false, text: err.message });
    }
  };

  return (
    <div className="add-friend-panel">
      <h2>Adicionar amigo</h2>
      <p className="muted">Você pode adicionar amigos com o nome de usuário deles.</p>
      <form className={`add-friend-form${result ? (result.ok ? ' ok' : ' bad') : ''}`} onSubmit={submit}>
        <input
          value={username}
          autoFocus
          placeholder="Você pode adicionar amigos com o nome de usuário deles."
          onChange={(e) => {
            setUsername(e.target.value);
            setResult(null);
          }}
        />
        <button className="button brand small" disabled={!username.trim()}>Enviar pedido de amizade</button>
      </form>
      {result && <p className={result.ok ? 'success-text' : 'error'}>{result.text}</p>}
    </div>
  );
}

function FriendList({ tab }) {
  const relationships = useStore((s) => s.relationships);
  const users = useStore((s) => s.users);
  const presences = useStore((s) => s.presences);
  const activities = useStore((s) => s.activities);
  const [query, setQuery] = useState('');

  const wanted = {
    online: (r, id) => r.type === REL.FRIEND && (presences[id] ?? 'offline') !== 'offline',
    all: (r) => r.type === REL.FRIEND,
    pending: (r) => r.type === REL.INCOMING || r.type === REL.OUTGOING,
    blocked: (r) => r.type === REL.BLOCKED,
  }[tab];

  const rows = Object.entries(relationships)
    .filter(([id, r]) => wanted(r, id))
    .map(([id, r]) => ({ id, type: r.type, user: users[id] }))
    .filter(({ user }) => `${user.username} ${user.global_name ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => displayName(a.user).localeCompare(displayName(b.user)));

  const title = { online: 'Online', all: 'Todos os amigos', pending: 'Pendente', blocked: 'Bloqueado' }[tab];
  const empty = {
    online: 'Ninguém está online no momento. Que tal adicionar alguns amigos?',
    all: 'Você ainda não tem amigos. Use “Adicionar amigo” para enviar um pedido pelo nome de usuário.',
    pending: 'Não há pedidos de amizade pendentes. Que tal adicionar alguém?',
    blocked: 'Você não bloqueou ninguém.',
  }[tab];

  const removeFriend = async (user) => {
    const ok = await confirmDialog({
      title: `Remover '${displayName(user)}'`,
      body: `Tem certeza de que deseja remover ${displayName(user)} da sua lista de amigos?`,
      confirmLabel: 'Remover amizade',
      danger: true,
    });
    if (ok) call(api(`/users/@me/relationships/${user.id}`, { method: 'DELETE' }));
  };

  const block = async (user) => {
    const ok = await confirmDialog({
      title: `Bloquear ${displayName(user)}?`,
      body: 'As mensagens dessa pessoa ficarão ocultas para você, ela não poderá te mandar mensagens diretas e a amizade será desfeita.',
      confirmLabel: 'Bloquear',
      danger: true,
    });
    if (ok) call(api(`/users/@me/relationships/${user.id}`, { method: 'PUT', body: { type: REL.BLOCKED } }));
  };

  const subtitle = (row) => {
    if (row.type === REL.INCOMING) return 'Pedido de amizade recebido';
    if (row.type === REL.OUTGOING) return 'Pedido de amizade enviado';
    if (row.type === REL.BLOCKED) return 'Bloqueado';
    const status = presences[row.id] ?? 'offline';
    return status !== 'offline' && activities[row.id] ? <CustomStatus status={activities[row.id]} /> : STATUS_LABELS[status];
  };

  return (
    <>
      <div className="friend-search">
        <input placeholder="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Search size={18} />
      </div>
      <h3 className="friends-count">{title} — {rows.length}</h3>
      {rows.length === 0 && <div className="friends-empty">{empty}</div>}
      <div className="friend-rows">
        {rows.map((row) => (
          <div
            key={row.id}
            className="friend-row"
            onClick={() => row.type === REL.FRIEND && openDm(row.id)}
          >
            <button
              className="friend-identity"
              onClick={(e) => {
                e.stopPropagation();
                openPopout({ userId: row.id, rect: e.currentTarget.getBoundingClientRect() });
              }}
            >
              <Avatar user={row.user} size={32} status={row.type === REL.FRIEND ? (presences[row.id] ?? 'offline') : undefined} />
              <span className="friend-text">
                <span className="friend-name">{displayName(row.user)} <span className="friend-username">{row.user.username}</span></span>
                <span className="friend-sub">{subtitle(row)}</span>
              </span>
            </button>
            <div className="friend-actions" onClick={(e) => e.stopPropagation()}>
              {row.type === REL.FRIEND && (
                <>
                  <button className="round-button" aria-label="Enviar mensagem" title="Enviar mensagem" onClick={() => openDm(row.id)}>
                    <MessageCircle size={20} />
                  </button>
                  <button
                    className="round-button"
                    aria-label="Mais"
                    title="Mais"
                    onClick={(e) =>
                      openMenu({
                        rect: e.currentTarget.getBoundingClientRect(),
                        side: 'below',
                        items: [
                          { label: 'Ver perfil', onClick: () => openProfile(row.id) },
                          { separator: true },
                          { label: 'Remover amizade', danger: true, onClick: () => removeFriend(row.user) },
                          { label: 'Bloquear', danger: true, onClick: () => block(row.user) },
                        ],
                      })
                    }
                  >
                    <EllipsisVertical size={20} />
                  </button>
                </>
              )}
              {row.type === REL.INCOMING && (
                <button className="round-button accept" aria-label="Aceitar" title="Aceitar"
                  onClick={() => call(api(`/users/@me/relationships/${row.id}`, { method: 'PUT', body: {} }))}>
                  <Check size={20} />
                </button>
              )}
              {(row.type === REL.INCOMING || row.type === REL.OUTGOING) && (
                <button className="round-button deny" aria-label={row.type === REL.INCOMING ? 'Ignorar' : 'Cancelar'} title={row.type === REL.INCOMING ? 'Ignorar' : 'Cancelar'}
                  onClick={() => call(api(`/users/@me/relationships/${row.id}`, { method: 'DELETE' }))}>
                  <X size={20} />
                </button>
              )}
              {row.type === REL.BLOCKED && (
                <button className="round-button deny" aria-label="Desbloquear" title="Desbloquear"
                  onClick={() => call(api(`/users/@me/relationships/${row.id}`, { method: 'DELETE' }))}>
                  <UserX size={20} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// Coluna "Ativo agora": amigos em canais de voz (as únicas atividades que o clone conhece).
function ActiveNow() {
  const relationships = useStore((s) => s.relationships);
  const voiceStates = useStore((s) => s.voiceStates);
  const users = useStore((s) => s.users);
  const channels = useStore((s) => s.channels);
  const guilds = useStore((s) => s.guilds);

  const active = Object.values(voiceStates).filter((v) => relationships[v.user_id]?.type === REL.FRIEND);
  return (
    <aside className="active-now">
      <h2>Ativo agora</h2>
      {active.length === 0 ? (
        <div className="active-empty">
          <h3>Por enquanto está tudo quieto…</h3>
          <p>Quando um amigo entrar em um canal de voz, a atividade dele vai aparecer aqui!</p>
        </div>
      ) : (
        active.map((v) => (
          <div key={v.user_id} className="active-card">
            <div className="active-user">
              <Avatar user={users[v.user_id]} size={32} status="online" />
              <span>
                <b>{displayName(users[v.user_id])}</b>
                <small>Em um canal de voz</small>
              </span>
            </div>
            <div className="active-where"><Volume2 size={14} /> {v.guild_id ? `${channels[v.channel_id]?.name} · ${guilds[v.guild_id]?.name}` : 'Chamada privada'}</div>
          </div>
        ))
      )}
    </aside>
  );
}
