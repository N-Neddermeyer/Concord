import { Check, ChevronRight, Copy, Hash, Lock, Search, Upload, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { pickImage } from '../lib/image.js';
import { OVERWRITE_MEMBER, OVERWRITE_ROLE, P, channelPermissionsFor, has, permissionsFor, sortedRoles } from '../lib/permissions.js';
import { HOME, REL, dmRecipient, getState, memberName, navigate, privateChannelName, useStore } from '../lib/store.js';
import { displayName } from '../lib/util.js';
import Avatar, { GroupIcon, GuildIcon } from './Avatar.jsx';
import { Modal } from './Modal.jsx';
import { Toggle } from './settings/SettingsLayout.jsx';

function useSubmit(action) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (...args) => {
    setBusy(true);
    setError(null);
    try {
      return await action(...args);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return [run, busy, error];
}

// --- criar / entrar em servidor (mesmo fluxo em etapas do Discord) ---

export function AddGuildModal({ close }) {
  const me = useStore((s) => s.user);
  const [step, setStep] = useState('start');
  const [name, setName] = useState(`Servidor de ${displayName(me)}`);
  const [icon, setIcon] = useState(null);
  const [code, setCode] = useState('');

  const [create, creating, createError] = useSubmit(async () => {
    const guild = await api('/guilds', { method: 'POST', body: { name, icon } });
    navigate(guild.id);
    close(guild);
  });
  const [join, joining, joinError] = useSubmit(async () => {
    const guild = await api(`/invites/${encodeURIComponent(code.trim())}`, { method: 'POST' });
    navigate(guild.id);
    close(guild);
  });

  if (step === 'create') {
    return (
      <Modal
        title="Personalize o seu servidor"
        subtitle="Deixe o seu novo servidor com a sua cara, com um nome e um ícone. Você pode mudar isso depois."
        onClose={close}
        className="centered"
        footer={
          <>
            <button className="button link-button" onClick={() => setStep('start')}>Voltar</button>
            <button className="button brand" disabled={creating || !name.trim()} onClick={create}>Criar</button>
          </>
        }
      >
        <button
          className="icon-upload"
          onClick={() => pickImage(128).then((img) => img && setIcon(img)).catch(() => {})}
          style={icon ? { backgroundImage: `url(${icon})` } : undefined}
        >
          {!icon && (<><Upload size={24} /><span>ENVIAR</span></>)}
        </button>
        <label className="field">
          <span className="field-label">Nome do servidor</span>
          <input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} />
        </label>
        {createError && <p className="error">{createError}</p>}
      </Modal>
    );
  }

  if (step === 'join') {
    return (
      <Modal
        title="Entre em um servidor"
        subtitle="Insira um convite abaixo para entrar em um servidor existente."
        onClose={close}
        className="centered"
        footer={
          <>
            <button className="button link-button" onClick={() => setStep('start')}>Voltar</button>
            <button className="button brand" disabled={joining || !code.trim()} onClick={join}>Entrar no servidor</button>
          </>
        }
      >
        <label className="field">
          <span className="field-label">Link de convite <span className="required">*</span></span>
          <input className="input" value={code} placeholder="hTKzmak" onChange={(e) => setCode(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === 'Enter' && code.trim() && join()} />
        </label>
        {joinError && <p className="error">{joinError}</p>}
        <div className="field-hint">
          <span className="field-label">Os convites são parecidos com</span>
          <p>hTKzmak<br />…/convite/hTKzmak</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Crie seu servidor"
      subtitle="Seu servidor é onde você e seus amigos se encontram. Crie o seu e comece a conversar."
      onClose={close}
      className="centered"
      footer={
        <div className="footer-stack">
          <h3>Já tem um convite?</h3>
          <button className="button secondary wide" onClick={() => setStep('join')}>Entre em um servidor</button>
        </div>
      }
    >
      <button className="option-card" onClick={() => setStep('create')}>
        <span>Criar o meu</span>
        <ChevronRight size={20} />
      </button>
    </Modal>
  );
}

// --- canal e categoria ---

// Overwrites de um canal privado: os da categoria (se houver), o @everyone sem "Ver canal" e
// "Ver canal" para quem foi escolhido. Quem cria entra junto, a menos que já passe por cima de tudo.
function privateOverwrites(state, guildId, parentId, picked) {
  const guild = state.guilds[guildId];
  const base = (parentId ? state.channels[parentId]?.permission_overwrites ?? [] : []).map((o) => ({ ...o }));
  const upsert = (id, type, allow, deny) => {
    let o = base.find((x) => x.id === id);
    if (!o) base.push((o = { id, type, allow: 0, deny: 0 }));
    o.allow = (o.allow | allow) & ~deny;
    o.deny = (o.deny | deny) & ~allow;
  };
  upsert(guild.id, OVERWRITE_ROLE, 0, P.VIEW_CHANNEL);
  for (const { id, type } of picked) upsert(id, type, P.VIEW_CHANNEL, 0);
  const me = state.user.id;
  if (guild.owner_id !== me && !has(permissionsFor(state, guildId), P.ADMINISTRATOR) && !picked.some((p) => p.id === me)) {
    upsert(me, OVERWRITE_MEMBER, P.VIEW_CHANNEL, 0);
  }
  return base;
}

// Escolher cargos e membros (canal privado: "Adicionar membros ou cargos"). exclude: ids já escolhidos antes.
export function AccessPicker({ guildId, picked, onChange, exclude = [] }) {
  const state = useStore((s) => s);
  const [query, setQuery] = useState('');
  const guild = state.guilds[guildId];
  const q = query.toLowerCase();
  const roles = sortedRoles(guild).filter((r) => r.id !== guild.id && !exclude.includes(r.id) && r.name.toLowerCase().includes(q));
  const members = Object.keys(state.members[guildId] ?? {})
    .filter((id) => id !== guild.owner_id && !exclude.includes(id) && `${memberName(state, guildId, id)} ${state.users[id]?.username}`.toLowerCase().includes(q))
    .sort((a, b) => memberName(state, guildId, a).localeCompare(memberName(state, guildId, b)));
  const isPicked = (id) => picked.some((p) => p.id === id);
  const toggle = (id, type) => onChange(isPicked(id) ? picked.filter((p) => p.id !== id) : [...picked, { id, type }]);

  return (
    <>
      <input className="input" placeholder="Buscar membros e cargos" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
      <div className="pick-list access-list">
        {roles.length > 0 && <h3 className="pick-heading">Cargos</h3>}
        {roles.map((r) => (
          <button key={r.id} className={`pick-item${isPicked(r.id) ? ' selected' : ''}`} onClick={() => toggle(r.id, OVERWRITE_ROLE)}>
            <span className="role-dot big" style={{ background: r.color ?? '#99aab5' }} />
            <span>{r.name}</span>
            <span className="checkbox">{isPicked(r.id) && <Check size={14} />}</span>
          </button>
        ))}
        {members.length > 0 && <h3 className="pick-heading">Membros</h3>}
        {members.map((id) => (
          <button key={id} className={`pick-item${isPicked(id) ? ' selected' : ''}`} onClick={() => toggle(id, OVERWRITE_MEMBER)}>
            <Avatar user={state.users[id]} size={24} />
            <span>{memberName(state, guildId, id)}</span>
            <span className="muted small">{state.users[id]?.username}</span>
            <span className="checkbox">{isPicked(id) && <Check size={14} />}</span>
          </button>
        ))}
        {!roles.length && !members.length && <p className="muted center">Nenhum resultado.</p>}
      </div>
    </>
  );
}

function PrivateToggle({ label, checked, onChange }) {
  return (
    <div className="private-toggle">
      <Lock size={18} />
      <div>
        <div className="toggle-title">{label}</div>
        <div className="toggle-description">Somente membros e cargos selecionados poderão ver {label === 'Categoria privada' ? 'esta categoria' : 'este canal'}.</div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

export function CreateChannelModal({ close, guildId, type: initialType = 0, parentId = null }) {
  const state = useStore((s) => s);
  const parent = parentId ? state.channels[parentId] : null;
  const canPrivate = has(parentId ? channelPermissionsFor(state, parentId) : permissionsFor(state, guildId), P.MANAGE_ROLES);
  const [type, setType] = useState(initialType);
  const [name, setName] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [step, setStep] = useState('main');
  const [picked, setPicked] = useState([]);
  const [create, busy, error] = useSubmit(async () => {
    const body = { name, type, parent_id: parentId };
    if (isPrivate) body.permission_overwrites = privateOverwrites(getState(), guildId, parentId, picked);
    const channel = await api(`/guilds/${guildId}/channels`, { method: 'POST', body });
    if (type === 0) navigate(guildId, channel.id);
    close(channel);
  });
  const shown = type === 0 ? name.toLowerCase().replace(/\s+/g, '-') : name;
  const Icon = type === 0 ? Hash : Volume2;

  if (step === 'access') {
    return (
      <Modal
        title="Adicionar membros ou cargos"
        subtitle={<span className="channel-subtitle"><Icon size={14} /> {shown}</span>}
        onClose={close}
        footer={
          <>
            <button className="button link-button" onClick={create} disabled={busy}>Pular</button>
            <button className="button brand" disabled={busy} onClick={create}>Criar canal</button>
          </>
        }
      >
        <AccessPicker guildId={guildId} picked={picked} onChange={setPicked} />
        {error && <p className="error">{error}</p>}
      </Modal>
    );
  }

  return (
    <Modal
      title="Criar canal"
      subtitle={parent ? `em ${parent.name}` : undefined}
      onClose={close}
      footer={
        <>
          <button className="button link-button" onClick={() => close()}>Cancelar</button>
          {isPrivate
            ? <button className="button brand" disabled={!name.trim()} onClick={() => setStep('access')}>Avançar</button>
            : <button className="button brand" disabled={busy || !name.trim()} onClick={create}>Criar canal</button>}
        </>
      }
    >
      <span className="field-label">Tipo de canal</span>
      {[
        [0, Hash, 'Texto', 'Envie mensagens, imagens, GIFs, emojis, opiniões e piadas'],
        [2, Volume2, 'Voz', 'Converse por voz com outras pessoas'],
      ].map(([value, TypeIcon, label, hint]) => (
        <button key={value} className={`radio-card${type === value ? ' selected' : ''}`} onClick={() => setType(value)}>
          <TypeIcon size={24} />
          <span><b>{label}</b><small>{hint}</small></span>
          <span className="radio-dot" />
        </button>
      ))}
      <label className="field">
        <span className="field-label">Nome do canal</span>
        <div className="input-with-icon">
          {isPrivate ? <Lock size={16} /> : <Icon size={16} />}
          <input className="input" value={shown} placeholder="novo-canal" maxLength={100} autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && (isPrivate ? setStep('access') : create())} />
        </div>
      </label>
      {canPrivate && <PrivateToggle label="Canal privado" checked={isPrivate} onChange={setPrivate} />}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

export function CreateCategoryModal({ close, guildId }) {
  const canPrivate = useStore((s) => has(permissionsFor(s, guildId), P.MANAGE_ROLES));
  const [name, setName] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [step, setStep] = useState('main');
  const [picked, setPicked] = useState([]);
  const [create, busy, error] = useSubmit(async () => {
    const body = { name, type: 4 };
    if (isPrivate) body.permission_overwrites = privateOverwrites(getState(), guildId, null, picked);
    close(await api(`/guilds/${guildId}/channels`, { method: 'POST', body }));
  });

  if (step === 'access') {
    return (
      <Modal
        title="Adicionar membros ou cargos"
        subtitle={name}
        onClose={close}
        footer={
          <>
            <button className="button link-button" onClick={create} disabled={busy}>Pular</button>
            <button className="button brand" disabled={busy} onClick={create}>Criar categoria</button>
          </>
        }
      >
        <AccessPicker guildId={guildId} picked={picked} onChange={setPicked} />
        {error && <p className="error">{error}</p>}
      </Modal>
    );
  }

  return (
    <Modal
      title="Criar categoria"
      onClose={close}
      footer={
        <>
          <button className="button link-button" onClick={() => close()}>Cancelar</button>
          {isPrivate
            ? <button className="button brand" disabled={!name.trim()} onClick={() => setStep('access')}>Avançar</button>
            : <button className="button brand" disabled={busy || !name.trim()} onClick={create}>Criar categoria</button>}
        </>
      }
    >
      <label className="field">
        <span className="field-label">Nome da categoria</span>
        <input className="input" value={name} placeholder="Nova categoria" maxLength={100} autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && (isPrivate ? setStep('access') : create())} />
      </label>
      {canPrivate && <PrivateToggle label="Categoria privada" checked={isPrivate} onChange={setPrivate} />}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

// --- apelido ("Alterar apelido" / "Editar perfil do servidor") ---

export function NicknameModal({ close, guildId, userId }) {
  const state = useStore((s) => s);
  const isMe = userId === state.user.id;
  const user = state.users[userId];
  const current = state.members[guildId]?.[userId]?.nick ?? '';
  const [nick, setNick] = useState(current);
  const [save, busy, error] = useSubmit(async (value) => {
    await api(`/guilds/${guildId}/members/${isMe ? '@me' : userId}`, { method: 'PATCH', body: { nick: value } });
    close(true);
  });

  return (
    <Modal
      title="Alterar apelido"
      onClose={close}
      className="small"
      footer={
        <>
          <button className="button link-button" onClick={() => close(false)}>Cancelar</button>
          <button className="button brand" disabled={busy} onClick={() => save(nick)}>Salvar</button>
        </>
      }
    >
      {!isMe && <div className="warning-box">Apelidos podem ser vistos por todos neste servidor. Não os altere sem um bom motivo.</div>}
      <label className="field">
        <span className="field-label">Apelido</span>
        <input className="input" value={nick} maxLength={32} placeholder={displayName(user)} autoFocus
          onChange={(e) => setNick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save(nick)} />
      </label>
      <button className="button link-button small reset-nick" disabled={busy || !current} onClick={() => save('')}>Redefinir apelido</button>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

// --- convite ---

export function InviteModal({ close, guildId }) {
  const guild = useStore((s) => s.guilds[guildId]);
  const relationships = useStore((s) => s.relationships);
  const users = useStore((s) => s.users);
  const members = useStore((s) => s.members[guildId]);
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState({});

  useEffect(() => {
    api(`/guilds/${guildId}/invites`, { method: 'POST' }).then((i) => setCode(i.code), (e) => setError(e.message));
  }, [guildId]);

  const friends = Object.entries(relationships)
    .filter(([id, r]) => r.type === REL.FRIEND && !members?.[id])
    .map(([id]) => users[id]);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Como no Discord, "Convidar" um amigo manda o convite por DM.
  const inviteFriend = async (user) => {
    const dm = await api('/users/@me/channels', { method: 'POST', body: { recipient_id: user.id } });
    await api(`/channels/${dm.id}/messages`, { method: 'POST', body: { content: `Entre no servidor ${guild.name}! Código do convite: ${code}` } });
    setSent((s) => ({ ...s, [user.id]: true }));
  };

  return (
    <Modal title={`Convide amigos para ${guild.name}`} onClose={close} className="invite-modal">
      {friends.length > 0 && (
        <div className="invite-friends">
          {friends.map((u) => (
            <div key={u.id} className="invite-friend">
              <Avatar user={u} size={32} />
              <span>{displayName(u)}</span>
              <button className="button outline-green small" disabled={!code || sent[u.id]} onClick={() => inviteFriend(u)}>
                {sent[u.id] ? 'Enviado' : 'Convidar'}
              </button>
            </div>
          ))}
        </div>
      )}
      <span className="field-label">Ou envie um código de convite para um amigo</span>
      <div className="copy-field">
        <input className="input" readOnly value={code ?? 'Gerando…'} onFocus={(e) => e.target.select()} />
        <button className={`button ${copied ? 'success' : 'brand'}`} disabled={!code} onClick={copy}>
          <Copy size={14} /> {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Quem receber o código entra pelo botão “Adicionar um servidor” → “Entre em um servidor”.</p>
    </Modal>
  );
}

// --- nova DM (escolher amigo) ---

export function NewDmModal({ close, onPick }) {
  const relationships = useStore((s) => s.relationships);
  const users = useStore((s) => s.users);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const toggle = (id) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length < 9 ? [...list, id] : list));
  const friends = Object.entries(relationships)
    .filter(([, r]) => r.type === REL.FRIEND)
    .map(([id]) => users[id])
    .filter((u) => `${u.username} ${u.global_name ?? ''}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <Modal
      title="Selecionar amigos"
      subtitle={`Você pode adicionar mais ${9 - selected.length} amigos.`}
      onClose={close}
      className="small"
      footer={
        <button className="button brand wide" disabled={!selected.length} onClick={() => { close(); onPick(selected); }}>
          {selected.length > 1 ? 'Criar MD em grupo' : 'Criar MD'}
        </button>
      }
    >
      <input className="input" placeholder="Digite o nome de usuário de um amigo" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
      <div className="pick-list">
        {friends.length === 0 && <p className="muted center">Nenhum amigo encontrado.</p>}
        {friends.map((u) => (
          <button key={u.id} className={`pick-item${selected.includes(u.id) ? ' selected' : ''}`} onClick={() => toggle(u.id)}>
            <Avatar user={u} size={32} />
            <span>{displayName(u)}</span>
            <span className="muted">{u.username}</span>
            <span className="checkbox">{selected.includes(u.id) && <Check size={14} />}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// --- busca rápida (Ctrl+K) ---

export function QuickSwitcher({ close }) {
  const state = useStore((s) => s);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const results = useMemo(() => {
    const q = query.toLowerCase().replace(/^[#@*]/, '');
    const items = [];
    for (const c of Object.values(state.channels)) {
      if (c.type === 1) {
        const u = dmRecipient(state, c);
        items.push({ key: c.id, kind: 'dm', label: displayName(u), hint: u.username, user: u, go: () => navigate(HOME, c.id) });
      } else if (c.type === 3) {
        items.push({ key: c.id, kind: 'group', label: privateChannelName(state, c), hint: 'Grupo', channel: c, go: () => navigate(HOME, c.id) });
      } else if (c.type === 0) {
        items.push({ key: c.id, kind: 'text', label: c.name, hint: state.guilds[c.guild_id]?.name, go: () => navigate(c.guild_id, c.id) });
      }
    }
    for (const id of state.guildOrder) {
      const g = state.guilds[id];
      items.push({ key: id, kind: 'guild', label: g.name, guild: g, go: () => navigate(id) });
    }
    return items.filter((i) => !q || i.label.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q)).slice(0, 12);
  }, [state, query]);

  const choose = (item) => {
    if (!item) return;
    close();
    item.go();
  };

  return (
    <Modal onClose={close} className="quick-switcher" closeButton={false}>
      <input
        className="input big"
        placeholder="Para onde você quer ir?"
        value={query}
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter') choose(results[index]);
          else return;
          e.preventDefault();
        }}
      />
      <div className="pick-list">
        {results.map((item, i) => (
          <button key={item.key} className={`pick-item${i === index ? ' selected' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => choose(item)}>
            {item.kind === 'dm' && <Avatar user={item.user} size={20} />}
            {item.kind === 'group' && <GroupIcon channel={item.channel} size={20} />}
            {item.kind === 'text' && <Hash size={18} />}
            {item.kind === 'guild' && <span className="mini-guild"><GuildIcon guild={item.guild} size={20} /></span>}
            <span>{item.label}</span>
            {item.hint && <span className="muted small">{item.hint}</span>}
          </button>
        ))}
        {results.length === 0 && <p className="muted center"><Search size={16} /> Nada encontrado.</p>}
      </div>
      <p className="muted small">DICA: use as setas ↑ ↓ e Enter para navegar.</p>
    </Modal>
  );
}

// --- moderação ---

export function BanModal({ close, guildId, user }) {
  const [reason, setReason] = useState('');
  const [ban, busy, error] = useSubmit(async () => {
    await api(`/guilds/${guildId}/bans/${user.id}`, { method: 'PUT', body: { reason } });
    close(true);
  });
  return (
    <Modal
      title={`Banir ${displayName(user)}`}
      onClose={close}
      className="small"
      footer={
        <>
          <button className="button link-button" onClick={() => close(false)}>Cancelar</button>
          <button className="button danger" disabled={busy} onClick={ban}>Banir</button>
        </>
      }
    >
      <p className="modal-text">Tem certeza de que deseja banir <b>@{user.username}</b>? Ele(a) será removido(a) e não poderá voltar a menos que o banimento seja revogado.</p>
      <label className="field">
        <span className="field-label">Motivo do banimento</span>
        <textarea className="input" rows={3} maxLength={512} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

export function DeleteGuildModal({ close, guild }) {
  const [typed, setTyped] = useState('');
  const [remove, busy, error] = useSubmit(async () => {
    await api(`/guilds/${guild.id}`, { method: 'DELETE' });
    close(true);
  });
  return (
    <Modal
      title={`Excluir '${guild.name}'`}
      onClose={close}
      className="small"
      footer={
        <>
          <button className="button link-button" onClick={() => close(false)}>Cancelar</button>
          <button className="button danger" disabled={busy || typed !== guild.name} onClick={remove}>Excluir servidor</button>
        </>
      }
    >
      <div className="warning-box">Tem certeza de que deseja excluir <b>{guild.name}</b>? Esta ação não pode ser desfeita.</div>
      <label className="field">
        <span className="field-label">Insira o nome do servidor</span>
        <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
      </label>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

// --- conta ---

export function ChangeUsernameModal({ close, user }) {
  const [username, setUsername] = useState(user.username);
  const [password, setPassword] = useState('');
  const [save, busy, error] = useSubmit(async () => {
    await api('/users/@me', { method: 'PATCH', body: { username, password } });
    close(true);
  });
  return (
    <Modal
      title="Altere seu nome de usuário"
      subtitle="Insira um novo nome de usuário e sua senha atual."
      onClose={close}
      className="small centered"
      footer={
        <>
          <button className="button link-button" onClick={() => close(false)}>Cancelar</button>
          <button className="button brand" disabled={busy || !username.trim() || !password} onClick={save}>Concluído</button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Nome de usuário</span>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span className="field-label">Senha atual</span>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()} />
      </label>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

export function ChangePasswordModal({ close, onToken }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [save, busy, error] = useSubmit(async () => {
    if (next !== confirm) throw new Error('As senhas não coincidem.');
    const { token } = await api('/users/@me', { method: 'PATCH', body: { password: current, new_password: next } });
    onToken(token);
    close(true);
  });
  return (
    <Modal
      title="Atualize sua senha"
      subtitle="Insira sua senha atual e uma nova senha."
      onClose={close}
      className="small centered"
      footer={
        <>
          <button className="button link-button" onClick={() => close(false)}>Cancelar</button>
          <button className="button brand" disabled={busy || !current || !next} onClick={save}>Concluído</button>
        </>
      }
    >
      {[
        ['Senha atual', current, setCurrent],
        ['Nova senha', next, setNext],
        ['Confirmar nova senha', confirm, setConfirm],
      ].map(([label, value, setter], i) => (
        <label key={label} className="field">
          <span className="field-label">{label}</span>
          <input className="input" type="password" value={value} autoFocus={i === 0} onChange={(e) => setter(e.target.value)} />
        </label>
      ))}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
