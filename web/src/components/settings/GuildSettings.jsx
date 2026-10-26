import { ArrowDown, ArrowLeft, ArrowUp, EllipsisVertical, Plus, Search, Shield, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { confirmDialog, openMenu, openModal, openPopout, showError } from '../../lib/dialogs.js';
import { pickImage } from '../../lib/image.js';
import { P, PERMISSION_GROUPS, has, memberColor, permissionsFor, rankOf, sortedRoles } from '../../lib/permissions.js';
import { closeLayer, openLayer, useStore } from '../../lib/store.js';
import { displayName, formatShortDate } from '../../lib/util.js';
import Avatar from '../Avatar.jsx';
import { BanModal, DeleteGuildModal } from '../modals.jsx';
import SettingsLayout, { SaveBar, Toggle, isDirty } from './SettingsLayout.jsx';

const ROLE_COLORS = [
  '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b',
  '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457', '#c27c0e', '#a84300', '#992d22', '#979c9f', '#546e7a',
];

const call = (promise) => promise.catch((e) => showError(e.message));

export default function GuildSettings({ guildId, section = 'overview' }) {
  const guild = useStore((s) => s.guilds[guildId]);
  const perms = useStore((s) => permissionsFor(s, guildId));
  const me = useStore((s) => s.user);
  if (!guild) return null;

  const deleteGuild = async () => {
    if (await openModal(DeleteGuildModal, { guild })) closeLayer();
  };

  const go = (id) => openLayer({ type: 'guild', guildId, section: id });
  const items = [
    { header: guild.name },
    has(perms, P.MANAGE_GUILD) && { id: 'overview', label: 'Visão geral' },
    has(perms, P.MANAGE_ROLES) && { id: 'roles', label: 'Cargos' },
    { separator: true },
    { header: 'Gestão de membros' },
    (perms & (P.KICK_MEMBERS | P.BAN_MEMBERS | P.MANAGE_ROLES)) !== 0 && { id: 'members', label: 'Membros' },
    has(perms, P.MANAGE_GUILD) && { id: 'invites', label: 'Convites' },
    has(perms, P.BAN_MEMBERS) && { id: 'bans', label: 'Banimentos' },
    guild.owner_id === me.id && { separator: true },
    guild.owner_id === me.id && { id: 'delete', label: 'Excluir servidor', danger: true, icon: Trash2, onClick: deleteGuild },
  ];
  const allowed = items.filter((i) => i && i.id && !i.onClick).map((i) => i.id);
  const current = allowed.includes(section) ? section : allowed[0];
  const Page = { overview: Overview, roles: Roles, members: Members, invites: Invites, bans: Bans }[current];

  return (
    <SettingsLayout items={items} current={current} onSelect={go} onClose={closeLayer}>
      {Page && <Page guild={guild} perms={perms} />}
    </SettingsLayout>
  );
}

// --- Visão geral ---

function Overview({ guild }) {
  const original = { name: guild.name, icon: guild.icon };
  const [draft, setDraft] = useState(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/guilds/${guild.id}`, { method: 'PATCH', body: draft });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="page-title">Visão geral do servidor</h2>
      <div className="overview">
        <div className="overview-icon">
          <button
            className="icon-upload big"
            style={draft.icon ? { backgroundImage: `url(${draft.icon})` } : undefined}
            onClick={() => pickImage(256).then((icon) => icon && setDraft((d) => ({ ...d, icon }))).catch((e) => showError(e.message))}
          >
            {!draft.icon && <><Upload size={24} /><span>ENVIAR IMAGEM</span></>}
          </button>
          {draft.icon && <button className="button link-button small" onClick={() => setDraft((d) => ({ ...d, icon: null }))}>Remover</button>}
          <p className="muted small">Recomendamos uma imagem de pelo menos 512x512 para o servidor.</p>
        </div>
        <label className="field grow">
          <span className="field-label">Nome do servidor</span>
          <input className="input" value={draft.name} maxLength={100} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </label>
      </div>
      <SaveBar visible={isDirty(draft, original)} busy={busy} error={error} onReset={() => setDraft(original)} onSave={save} />
    </>
  );
}

// --- Cargos ---

function Roles({ guild, perms }) {
  const [selected, setSelected] = useState(null);
  const members = useStore((s) => s.members[guild.id]);
  const myRank = useStore((s) => rankOf(s, guild.id));
  const roles = sortedRoles(guild);

  const create = async () => {
    try {
      const role = await api(`/guilds/${guild.id}/roles`, { method: 'POST', body: { name: 'novo cargo' } });
      setSelected(role.id);
    } catch (e) {
      showError(e.message);
    }
  };

  if (selected && guild.roles[selected]) {
    return <RoleEditor guild={guild} perms={perms} roleId={selected} onSelect={setSelected} onCreate={create} myRank={myRank} />;
  }

  const count = (roleId) => Object.values(members ?? {}).filter((m) => m.roles.includes(roleId)).length;
  return (
    <>
      <h2 className="page-title">Cargos</h2>
      <p className="muted">Use cargos para agrupar os membros do servidor e definir permissões.</p>
      <button className="everyone-card" onClick={() => setSelected(guild.id)}>
        <Shield size={24} />
        <span>
          <b>Permissões padrão</b>
          <small>@everyone · aplica-se a todos os membros do servidor</small>
        </span>
        <ArrowLeft size={18} style={{ transform: 'rotate(180deg)' }} />
      </button>
      <div className="row space-between">
        <p className="muted small">Os membros usam a cor do cargo mais alto que tiverem nesta lista.</p>
        <button className="button brand" onClick={create}>Criar cargo</button>
      </div>
      <div className="table">
        <div className="table-head"><span>Cargos — {roles.length - 1}</span><span>Membros</span></div>
        {roles.filter((r) => r.id !== guild.id).map((r) => (
          <button key={r.id} className="table-row role-row" onClick={() => setSelected(r.id)}>
            <span className="role-name"><span className="role-dot big" style={{ background: r.color ?? '#99aab5' }} />{r.name}</span>
            <span>{count(r.id)}</span>
          </button>
        ))}
        {roles.length === 1 && <div className="table-empty">Nenhum cargo ainda. Crie um para organizar os membros.</div>}
      </div>
    </>
  );
}

function RoleEditor({ guild, perms, roleId, onSelect, onCreate, myRank }) {
  const role = guild.roles[roleId];
  const isEveryone = roleId === guild.id;
  const editable = isEveryone || role.position < myRank;
  const [tab, setTab] = useState(isEveryone ? 'permissions' : 'display');
  const original = { name: role.name, color: role.color, hoist: role.hoist, permissions: role.permissions };
  const [draft, setDraft] = useState(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const roles = sortedRoles(guild);

  useEffect(() => {
    setDraft({ name: role.name, color: role.color, hoist: role.hoist, permissions: role.permissions });
    setError(null);
    if (isEveryone) setTab('permissions');
  }, [roleId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/guilds/${guild.id}/roles/${roleId}`, { method: 'PATCH', body: draft });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Excluir cargo '${role.name}'`,
      body: 'Tem certeza? Esta ação não pode ser desfeita.',
      confirmLabel: 'Confirmar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/guilds/${guild.id}/roles/${roleId}`, { method: 'DELETE' });
      onSelect(null);
    } catch (e) {
      showError(e.message);
    }
  };

  // Troca de lugar com o vizinho (as posições crescem para cima).
  const move = (r, direction) => {
    const ordered = roles.filter((x) => x.id !== guild.id);
    const index = ordered.findIndex((x) => x.id === r.id);
    const other = ordered[index - direction];
    if (!other) return;
    call(api(`/guilds/${guild.id}/roles`, { method: 'PATCH', body: [{ id: r.id, position: other.position }, { id: other.id, position: r.position }] }));
  };

  const togglePermission = (flag) => setDraft((d) => ({ ...d, permissions: d.permissions ^ flag }));
  const canGrant = (flag) => has(perms, P.ADMINISTRATOR) || has(perms, flag) || has(draft.permissions, flag);

  return (
    <>
      <div className="role-editor">
        <div className="role-list">
          <div className="role-list-head">
            <button className="button link-button small" onClick={() => onSelect(null)}><ArrowLeft size={16} /> Voltar</button>
            <button className="icon-button" aria-label="Criar cargo" title="Criar cargo" onClick={onCreate}><Plus size={18} /></button>
          </div>
          {roles.map((r) => (
            <div key={r.id} className={`role-list-item${r.id === roleId ? ' active' : ''}`}>
              <button onClick={() => onSelect(r.id)}>
                <span className="role-dot" style={{ background: r.color ?? '#99aab5' }} />
                <span className="role-list-name">{r.name}</span>
              </button>
              {r.id !== guild.id && r.position < myRank && (
                <span className="role-move">
                  <button aria-label="Subir" onClick={() => move(r, 1)} disabled={r.position + 1 >= myRank}><ArrowUp size={14} /></button>
                  <button aria-label="Descer" onClick={() => move(r, -1)} disabled={r.position <= 1}><ArrowDown size={14} /></button>
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="role-detail">
          <div className="row space-between">
            <h2 className="page-title small">Editar cargo — {role.name}</h2>
            {!isEveryone && editable && (
              <button className="icon-button danger" aria-label="Excluir cargo" title="Excluir cargo" onClick={remove}><Trash2 size={18} /></button>
            )}
          </div>
          {!editable && <div className="warning-box">Você só pode editar cargos abaixo do seu cargo mais alto.</div>}
          <nav className="tabs">
            {!isEveryone && <button className={tab === 'display' ? 'active' : ''} onClick={() => setTab('display')}>Exibição</button>}
            <button className={tab === 'permissions' ? 'active' : ''} onClick={() => setTab('permissions')}>Permissões</button>
            {!isEveryone && <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Gerenciar membros</button>}
          </nav>

          <fieldset disabled={!editable} className="plain-fieldset">
            {tab === 'display' && (
              <>
                <label className="field">
                  <span className="field-label">Nome do cargo <span className="required">*</span></span>
                  <input className="input" value={draft.name} maxLength={100} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                </label>
                <div className="divider" />
                <span className="field-label">Cor do cargo <span className="required">*</span></span>
                <p className="muted small">Os membros usam a cor do cargo mais alto que têm na lista de cargos.</p>
                <div className="color-grid">
                  <button className={`color-swatch default${draft.color === null ? ' selected' : ''}`} title="Padrão" onClick={() => setDraft((d) => ({ ...d, color: null }))} />
                  <label className="color-swatch custom" style={{ background: draft.color && !ROLE_COLORS.includes(draft.color) ? draft.color : undefined }} title="Cor personalizada">
                    <input type="color" value={draft.color ?? '#99aab5'} onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))} />
                  </label>
                  <div className="color-swatches">
                    {ROLE_COLORS.map((c) => (
                      <button key={c} className={`color-swatch small${draft.color === c ? ' selected' : ''}`} style={{ background: c }} onClick={() => setDraft((d) => ({ ...d, color: c }))} />
                    ))}
                  </div>
                </div>
                <div className="divider" />
                <div className="toggle-row">
                  <div>
                    <div className="toggle-title">Exibir os membros do cargo separadamente dos membros online</div>
                  </div>
                  <Toggle checked={draft.hoist} onChange={(hoist) => setDraft((d) => ({ ...d, hoist }))} />
                </div>
              </>
            )}

            {tab === 'permissions' && PERMISSION_GROUPS.map((group) => (
              <section key={group.title}>
                <h3 className="section-heading">{group.title}</h3>
                {group.items.map(([flag, label, description]) => (
                  <div key={flag} className="toggle-row">
                    <div>
                      <div className="toggle-title">{label}</div>
                      <div className="toggle-description">{description}</div>
                    </div>
                    <Toggle checked={has(draft.permissions, flag)} disabled={!editable || !canGrant(flag)} onChange={() => togglePermission(flag)} />
                  </div>
                ))}
              </section>
            ))}
          </fieldset>

          {tab === 'members' && <RoleMembers guild={guild} role={role} editable={editable} />}
        </div>
      </div>
      <SaveBar visible={editable && isDirty(draft, original)} busy={busy} error={error} onReset={() => setDraft(original)} onSave={save} />
    </>
  );
}

function RoleMembers({ guild, role, editable }) {
  const members = useStore((s) => s.members[guild.id]);
  const users = useStore((s) => s.users);
  const [query, setQuery] = useState('');

  const setRoles = (userId, roles) => call(api(`/guilds/${guild.id}/members/${userId}`, { method: 'PATCH', body: { roles } }));
  const withRole = Object.entries(members ?? {}).filter(([, m]) => m.roles.includes(role.id));
  const without = Object.entries(members ?? {}).filter(([, m]) => !m.roles.includes(role.id));

  const add = (e) =>
    openMenu({
      rect: e.currentTarget.getBoundingClientRect(),
      side: 'below',
      width: 240,
      items: without.length
        ? without.map(([id, m]) => ({ label: displayName(users[id]), onClick: () => setRoles(id, [...m.roles, role.id]) }))
        : [{ label: 'Todos os membros já têm este cargo', disabled: true, onClick: () => {} }],
    });

  return (
    <>
      <div className="row">
        <div className="search-input">
          <input placeholder="Buscar membros" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Search size={16} />
        </div>
        <button className="button brand small" disabled={!editable} onClick={add}>Adicionar membros</button>
      </div>
      {withRole.length === 0 && <div className="table-empty">Nenhum membro tem este cargo.</div>}
      {withRole
        .filter(([id]) => displayName(users[id]).toLowerCase().includes(query.toLowerCase()))
        .map(([id, m]) => (
          <div key={id} className="role-member">
            <Avatar user={users[id]} size={32} />
            <span>{displayName(users[id])}</span>
            <span className="muted small">{users[id].username}</span>
            {editable && (
              <button className="icon-button" aria-label="Remover membro do cargo" title="Remover" onClick={() => setRoles(id, m.roles.filter((r) => r !== role.id))}>
                <X size={16} />
              </button>
            )}
          </div>
        ))}
    </>
  );
}

// --- Membros ---

function Members({ guild, perms }) {
  const members = useStore((s) => s.members[guild.id]);
  const users = useStore((s) => s.users);
  const state = useStore((s) => s);
  const myRank = rankOf(state, guild.id);
  const [query, setQuery] = useState('');
  const roles = sortedRoles(guild).filter((r) => r.id !== guild.id);

  const setRoles = (userId, list) => call(api(`/guilds/${guild.id}/members/${userId}`, { method: 'PATCH', body: { roles: list } }));

  const kick = async (user) => {
    const ok = await confirmDialog({
      title: `Expulsar '${displayName(user)}' do servidor`,
      body: `Tem certeza de que deseja expulsar @${user.username} do servidor? Ele(a) poderá voltar com um novo convite.`,
      confirmLabel: 'Expulsar',
      danger: true,
    });
    if (ok) call(api(`/guilds/${guild.id}/members/${user.id}`, { method: 'DELETE' }));
  };

  const rows = Object.entries(members ?? {})
    .filter(([id]) => `${users[id].username} ${users[id].global_name ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort(([a], [b]) => displayName(users[a]).localeCompare(displayName(users[b])));

  return (
    <>
      <h2 className="page-title">Membros do servidor</h2>
      <div className="row space-between">
        <h3 className="section-heading">{rows.length} membros</h3>
        <div className="search-input">
          <input placeholder="Buscar por nome de usuário" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Search size={16} />
        </div>
      </div>
      <div className="table">
        <div className="table-head members-grid"><span>Nome</span><span>Membro desde</span><span>Cargos</span><span /></div>
        {rows.map(([id, m]) => {
          const user = users[id];
          const outranked = id !== guild.owner_id && id !== state.user.id && rankOf(state, guild.id, id) < myRank;
          const memberRoleList = roles.filter((r) => m.roles.includes(r.id));
          const assignable = roles.filter((r) => !m.roles.includes(r.id) && r.position < myRank);
          return (
            <div key={id} className="table-row members-grid">
              <button className="member-cell" onClick={(e) => openPopout({ userId: id, guildId: guild.id, rect: e.currentTarget.getBoundingClientRect() })}>
                <Avatar user={user} size={32} />
                <span>
                  <b style={{ color: memberColor(state, guild.id, id) ?? undefined }}>{displayName(user)}</b>
                  <small className="muted">{user.username}{id === guild.owner_id ? ' · dono' : ''}</small>
                </span>
              </button>
              <span className="muted small">{formatShortDate(m.joined_at)}</span>
              <span className="role-pills">
                {memberRoleList.map((r) => (
                  <span key={r.id} className="role-pill">
                    <span className="role-dot" style={{ background: r.color ?? '#99aab5' }} />
                    {r.name}
                    {has(perms, P.MANAGE_ROLES) && r.position < myRank && (
                      <button aria-label={`Remover ${r.name}`} onClick={() => setRoles(id, m.roles.filter((x) => x !== r.id))}><X size={12} /></button>
                    )}
                  </span>
                ))}
                {has(perms, P.MANAGE_ROLES) && assignable.length > 0 && (
                  <button
                    className="role-pill add"
                    aria-label="Adicionar cargo"
                    onClick={(e) => openMenu({
                      rect: e.currentTarget.getBoundingClientRect(),
                      side: 'below',
                      items: assignable.map((r) => ({ label: r.name, onClick: () => setRoles(id, [...m.roles, r.id]) })),
                    })}
                  >
                    <Plus size={12} />
                  </button>
                )}
              </span>
              <span>
                {outranked && (perms & (P.KICK_MEMBERS | P.BAN_MEMBERS)) !== 0 && (
                  <button
                    className="icon-button"
                    aria-label="Mais opções"
                    onClick={(e) => openMenu({
                      rect: e.currentTarget.getBoundingClientRect(),
                      side: 'below',
                      items: [
                        has(perms, P.KICK_MEMBERS) && { label: `Expulsar ${displayName(user)}`, danger: true, onClick: () => kick(user) },
                        has(perms, P.BAN_MEMBERS) && { label: `Banir ${displayName(user)}`, danger: true, onClick: () => openModal(BanModal, { guildId: guild.id, user }) },
                      ],
                    })}
                  >
                    <EllipsisVertical size={18} />
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// --- Convites e banimentos (buscados via REST ao abrir, como no Discord) ---

function useFetched(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = () => api(path).then(setData, (e) => setError(e.message));
  useEffect(() => {
    reload();
  }, [path]);
  return [data, error, reload];
}

function Invites({ guild }) {
  const [invites, error, reload] = useFetched(`/guilds/${guild.id}/invites`);
  const revoke = (code) => call(api(`/invites/${code}`, { method: 'DELETE' }).then(reload));
  return (
    <>
      <h2 className="page-title">Convites</h2>
      <p className="muted">Aqui está uma lista de todos os convites ativos. Você pode revogar qualquer um deles.</p>
      {error && <p className="error">{error}</p>}
      <div className="table">
        <div className="table-head invites-grid"><span>Convidador</span><span>Código do convite</span><span>Usos</span><span>Criado</span><span /></div>
        {invites?.map((i) => (
          <div key={i.code} className="table-row invites-grid">
            <span className="member-cell"><Avatar user={i.inviter} size={24} /><span>{displayName(i.inviter)}</span></span>
            <span className="mono">{i.code}</span>
            <span>{i.uses}</span>
            <span className="muted small">{i.created_at ? formatShortDate(i.created_at) : '—'}</span>
            <span><button className="icon-button danger" aria-label="Revogar convite" title="Revogar convite" onClick={() => revoke(i.code)}><X size={16} /></button></span>
          </div>
        ))}
        {invites?.length === 0 && <div className="table-empty">Nenhum convite ativo.</div>}
      </div>
    </>
  );
}

function Bans({ guild }) {
  const [bans, error, reload] = useFetched(`/guilds/${guild.id}/bans`);
  const [query, setQuery] = useState('');

  const revoke = async (ban) => {
    const ok = await confirmDialog({
      title: `'${displayName(ban.user)}'`,
      body: ban.reason ? `Motivo do banimento: ${ban.reason}` : 'Nenhum motivo informado.',
      confirmLabel: 'Revogar banimento',
      danger: true,
    });
    if (ok) call(api(`/guilds/${guild.id}/bans/${ban.user.id}`, { method: 'DELETE' }).then(reload));
  };

  const list = (bans ?? []).filter((b) => b.user.username.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <h2 className="page-title">Banimentos do servidor</h2>
      <p className="muted">Por padrão, os banimentos são feitos por conta. Clique em um banimento para revogá-lo.</p>
      <div className="search-input wide">
        <input placeholder="Buscar banimentos por nome de usuário" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Search size={16} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table">
        {list.map((b) => (
          <button key={b.user.id} className="table-row ban-row" onClick={() => revoke(b)}>
            <Avatar user={b.user} size={32} />
            <span><b>{displayName(b.user)}</b> <small className="muted">{b.user.username}</small></span>
            <span className="muted small">{b.reason}</span>
          </button>
        ))}
        {bans && list.length === 0 && <div className="table-empty">Nenhum banimento.</div>}
      </div>
    </>
  );
}
