import { ChevronDown, ChevronRight, Hash, Link, Pin, Server, Shield, Trash2, UserCog, UserMinus, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { PERMISSION_GROUPS } from '../../lib/permissions.js';
import { memberName, useStore } from '../../lib/store.js';
import { displayName, formatMessageTime, snowflakeTime } from '../../lib/util.js';
import Avatar from '../Avatar.jsx';
import { slowmodeLabel } from './ChannelSettings.jsx';

// Mesmos action_type do Discord (server/src/rest.js).
const A = {
  GUILD_UPDATE: 1,
  CHANNEL_CREATE: 10,
  CHANNEL_UPDATE: 11,
  CHANNEL_DELETE: 12,
  CHANNEL_OVERWRITE_CREATE: 13,
  CHANNEL_OVERWRITE_UPDATE: 14,
  CHANNEL_OVERWRITE_DELETE: 15,
  MEMBER_KICK: 20,
  MEMBER_BAN_ADD: 22,
  MEMBER_BAN_REMOVE: 23,
  MEMBER_UPDATE: 24,
  MEMBER_ROLE_UPDATE: 25,
  ROLE_CREATE: 30,
  ROLE_UPDATE: 31,
  ROLE_DELETE: 32,
  INVITE_CREATE: 40,
  INVITE_DELETE: 42,
  MESSAGE_DELETE: 72,
  MESSAGE_PIN: 74,
  MESSAGE_UNPIN: 75,
};

// Filtro "Filtrar por ação", na ordem do Discord.
const ACTION_FILTERS = [
  [A.GUILD_UPDATE, 'Atualizar servidor'],
  [A.CHANNEL_CREATE, 'Criar canal'],
  [A.CHANNEL_UPDATE, 'Atualizar canal'],
  [A.CHANNEL_DELETE, 'Excluir canal'],
  [A.CHANNEL_OVERWRITE_CREATE, 'Criar permissão de canal'],
  [A.CHANNEL_OVERWRITE_UPDATE, 'Atualizar permissão de canal'],
  [A.CHANNEL_OVERWRITE_DELETE, 'Excluir permissão de canal'],
  [A.MEMBER_KICK, 'Expulsar membro'],
  [A.MEMBER_BAN_ADD, 'Banir membro'],
  [A.MEMBER_BAN_REMOVE, 'Revogar banimento'],
  [A.MEMBER_UPDATE, 'Atualizar membro'],
  [A.MEMBER_ROLE_UPDATE, 'Atualizar cargos do membro'],
  [A.ROLE_CREATE, 'Criar cargo'],
  [A.ROLE_UPDATE, 'Atualizar cargo'],
  [A.ROLE_DELETE, 'Excluir cargo'],
  [A.INVITE_CREATE, 'Criar convite'],
  [A.INVITE_DELETE, 'Excluir convite'],
  [A.MESSAGE_DELETE, 'Excluir mensagem'],
  [A.MESSAGE_PIN, 'Fixar mensagem'],
  [A.MESSAGE_UNPIN, 'Desafixar mensagem'],
];

const PERMISSION_NAMES = new Map(PERMISSION_GROUPS.flatMap((g) => g.items.map(([flag, label]) => [flag, label])));
const permissionList = (bits) => [...PERMISSION_NAMES].filter(([flag]) => bits & flag).map(([, label]) => label).join(', ');

// Cor e ícone de cada entrada: criar (verde), atualizar (amarelo), excluir (vermelho).
function tone(action) {
  if ([A.CHANNEL_CREATE, A.CHANNEL_OVERWRITE_CREATE, A.ROLE_CREATE, A.INVITE_CREATE, A.MEMBER_BAN_REMOVE, A.MESSAGE_PIN].includes(action)) return 'create';
  if ([A.CHANNEL_DELETE, A.CHANNEL_OVERWRITE_DELETE, A.ROLE_DELETE, A.INVITE_DELETE, A.MEMBER_KICK, A.MEMBER_BAN_ADD, A.MESSAGE_DELETE, A.MESSAGE_UNPIN].includes(action)) return 'delete';
  return 'update';
}
function ActionIcon({ action }) {
  const Icon = action === A.GUILD_UPDATE ? Server
    : action >= 10 && action < 20 ? Hash
    : action === A.MEMBER_KICK ? UserMinus
    : action === A.MEMBER_BAN_ADD || action === A.MEMBER_BAN_REMOVE ? UserX
    : action === A.MEMBER_UPDATE || action === A.MEMBER_ROLE_UPDATE ? UserCog
    : action >= 30 && action < 40 ? Shield
    : action >= 40 && action < 50 ? Link
    : action === A.MESSAGE_DELETE ? Trash2 : Pin;
  return <span className={`audit-icon ${tone(action)}`}><Icon size={16} /></span>;
}

const change = (entry, key) => entry.changes?.find((c) => c.key === key);

export default function AuditLog({ guild }) {
  const state = useStore((s) => s);
  const updated = useStore((s) => s.auditUpdated[guild.id]);
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entries, setEntries] = useState(null);
  const [users, setUsers] = useState({});
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  const fetchPage = async (before) => {
    const query = new URLSearchParams({ limit: 50 });
    if (userFilter) query.set('user_id', userFilter);
    if (actionFilter) query.set('action_type', actionFilter);
    if (before) query.set('before', before);
    const data = await api(`/guilds/${guild.id}/audit-logs?${query}`);
    setUsers((u) => ({ ...u, ...Object.fromEntries(data.users.map((x) => [x.id, x])) }));
    setHasMore(data.audit_log_entries.length === 50);
    return data.audit_log_entries;
  };

  useEffect(() => {
    let cancelled = false;
    fetchPage().then((list) => !cancelled && setEntries(list), (e) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [guild.id, userFilter, actionFilter, updated]);

  const more = () => fetchPage(entries.at(-1).id).then((list) => setEntries((e) => [...e, ...list]), (e) => setError(e.message));

  const userOf = (id) => state.users[id] ?? users[id];
  const nameOf = (id) => (state.members[guild.id]?.[id] ? memberName(state, guild.id, id) : displayName(userOf(id)));
  const who = (id) => <b className="audit-name">{nameOf(id)}</b>;
  const channelName = (entry, id = entry.target_id) => {
    const c = state.channels[id];
    const name = c?.name ?? change(entry, 'name')?.old_value ?? change(entry, 'name')?.new_value ?? 'canal excluído';
    const type = c?.type ?? change(entry, 'type')?.old_value ?? change(entry, 'type')?.new_value;
    return <b>{type === 0 ? '#' : ''}{name}</b>;
  };
  const roleName = (entry) => <b>{guild.roles[entry.target_id]?.name ?? change(entry, 'name')?.old_value ?? change(entry, 'name')?.new_value ?? 'cargo excluído'}</b>;
  const overwriteTarget = (entry) => (entry.options?.type === '1'
    ? who(entry.options.id)
    : <b>{entry.options?.id === guild.id ? '@everyone' : guild.roles[entry.options?.id]?.name ?? entry.options?.role_name ?? 'cargo excluído'}</b>);
  const isCategory = (entry) => (state.channels[entry.target_id]?.type ?? change(entry, 'type')?.old_value ?? change(entry, 'type')?.new_value) === 4;

  // Frase principal de cada entrada, no tom do registro de auditoria do Discord.
  const summary = (e) => {
    const actor = who(e.user_id);
    const channelWord = isCategory(e) ? 'a categoria' : 'o canal';
    switch (e.action_type) {
      case A.GUILD_UPDATE: return <>{actor} atualizou o servidor</>;
      case A.CHANNEL_CREATE: return <>{actor} criou {channelWord} {channelName(e)}</>;
      case A.CHANNEL_UPDATE: return <>{actor} atualizou {channelWord} {channelName(e)}</>;
      case A.CHANNEL_DELETE: return <>{actor} excluiu {channelWord} {channelName(e)}</>;
      case A.CHANNEL_OVERWRITE_CREATE: return <>{actor} criou permissões para {overwriteTarget(e)} em {channelName(e)}</>;
      case A.CHANNEL_OVERWRITE_UPDATE: return <>{actor} atualizou as permissões de {overwriteTarget(e)} em {channelName(e)}</>;
      case A.CHANNEL_OVERWRITE_DELETE: return <>{actor} removeu as permissões de {overwriteTarget(e)} em {channelName(e)}</>;
      case A.MEMBER_KICK: return <>{actor} expulsou {who(e.target_id)}</>;
      case A.MEMBER_BAN_ADD: return <>{actor} baniu {who(e.target_id)}</>;
      case A.MEMBER_BAN_REMOVE: return <>{actor} revogou o banimento de {who(e.target_id)}</>;
      case A.MEMBER_UPDATE: return e.target_id === e.user_id ? <>{actor} alterou o próprio apelido</> : <>{actor} atualizou {who(e.target_id)}</>;
      case A.MEMBER_ROLE_UPDATE: return <>{actor} atualizou os cargos de {who(e.target_id)}</>;
      case A.ROLE_CREATE: return <>{actor} criou o cargo {roleName(e)}</>;
      case A.ROLE_UPDATE: return <>{actor} atualizou o cargo {roleName(e)}</>;
      case A.ROLE_DELETE: return <>{actor} excluiu o cargo {roleName(e)}</>;
      case A.INVITE_CREATE: return <>{actor} criou o convite <b>{change(e, 'code')?.new_value}</b></>;
      case A.INVITE_DELETE: return <>{actor} excluiu o convite <b>{change(e, 'code')?.old_value}</b></>;
      case A.MESSAGE_DELETE: return <>{actor} excluiu uma mensagem de {who(e.target_id)} em {channelName(e, e.options?.channel_id)}</>;
      case A.MESSAGE_PIN: return <>{actor} fixou uma mensagem de {who(e.target_id)} em {channelName(e, e.options?.channel_id)}</>;
      case A.MESSAGE_UNPIN: return <>{actor} desafixou uma mensagem de {who(e.target_id)} em {channelName(e, e.options?.channel_id)}</>;
      default: return <>{actor} fez uma alteração</>;
    }
  };

  // Linhas de detalhe (o que mudou).
  const details = (e) => {
    const lines = [];
    const channel = (id) => (id ? <b>#{state.channels[id]?.name ?? 'canal excluído'}</b> : null);
    for (const c of e.changes ?? []) {
      const { key, old_value: from, new_value: to } = c;
      if (key === 'name') lines.push(from !== undefined && to !== undefined ? <>Alterou o nome de <b>{from}</b> para <b>{to}</b></> : to !== undefined ? <>Definiu o nome como <b>{to}</b></> : null);
      else if (key === 'topic') lines.push(to ? <>Alterou o tópico para <b>{to}</b></> : <>Removeu o tópico</>);
      else if (key === 'nsfw') lines.push(to ? <>Marcou como canal com restrição de idade</> : <>Removeu a restrição de idade</>);
      else if (key === 'rate_limit_per_user') lines.push(<>Alterou o modo lento de <b>{slowmodeLabel(from ?? 0)}</b> para <b>{slowmodeLabel(to ?? 0)}</b></>);
      else if (key === 'parent_id') lines.push(to ? <>Moveu para a categoria <b>{state.channels[to]?.name ?? 'excluída'}</b></> : <>Tirou da categoria</>);
      else if (key === 'icon_hash') lines.push(to ? <>Alterou o ícone</> : <>Removeu o ícone</>);
      else if (key === 'banner_hash') lines.push(to ? <>Alterou o banner</> : <>Removeu o banner</>);
      else if (key === 'system_channel_id') lines.push(to ? <>Definiu o canal de mensagens do sistema como {channel(to)}</> : <>Desativou as mensagens do sistema</>);
      else if (key === 'system_channel_flags') lines.push((to ?? 0) & 1 ? <>Desativou a mensagem de boas-vindas</> : <>Ativou a mensagem de boas-vindas</>);
      else if (key === 'nick') lines.push(to ? <>Alterou o apelido para <b>{to}</b></> : <>Removeu o apelido <b>{from}</b></>);
      else if (key === '$add') lines.push(<>Adicionou {to.length > 1 ? 'os cargos' : 'o cargo'} <b>{to.map((r) => r.name).join(', ')}</b></>);
      else if (key === '$remove') lines.push(<>Removeu {to.length > 1 ? 'os cargos' : 'o cargo'} <b>{to.map((r) => r.name).join(', ')}</b></>);
      else if (key === 'color') lines.push(to ? <>Alterou a cor para <span className="audit-color" style={{ background: to }} /> <b>{to}</b></> : <>Removeu a cor</>);
      else if (key === 'hoist') lines.push(to ? <>Passou a exibir os membros separadamente</> : <>Deixou de exibir os membros separadamente</>);
      else if (key === 'permissions' || key === 'allow' || key === 'deny') {
        const added = (to ?? 0) & ~(from ?? 0);
        const removed = (from ?? 0) & ~(to ?? 0);
        const verb = key === 'deny' ? ['Negou', 'Deixou de negar'] : key === 'allow' ? ['Permitiu', 'Deixou de permitir'] : ['Concedeu', 'Removeu'];
        if (added) lines.push(<>{verb[0]} <b>{permissionList(added)}</b></>);
        if (removed) lines.push(<>{verb[1]} <b>{permissionList(removed)}</b></>);
      }
    }
    if (e.reason) lines.push(<>Motivo: <i>{e.reason}</i></>);
    return lines.filter(Boolean);
  };

  const memberIds = Object.keys(state.members[guild.id] ?? {});
  return (
    <>
      <div className="row space-between audit-head">
        <h2 className="page-title">Registro de auditoria</h2>
        <div className="row">
          <label className="audit-filter">
            <span>Filtrar por usuário</span>
            <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="">Todos</option>
              {memberIds.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
            </select>
          </label>
          <label className="audit-filter">
            <span>Filtrar por ação</span>
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="">Todos</option>
              {ACTION_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {entries && entries.length === 0 && (
        <div className="table-empty">
          <b>Nenhum registro ainda</b>
          <br />
          Quando os moderadores começarem a moderar, você poderá moderar a moderação aqui.
        </div>
      )}
      <div className="audit-list">
        {entries?.map((e) => {
          const lines = details(e);
          const expanded = open === e.id;
          return (
            <div key={e.id} className={`audit-entry${expanded ? ' open' : ''}`}>
              <button className="audit-row" disabled={!lines.length} onClick={() => setOpen(expanded ? null : e.id)}>
                <ActionIcon action={e.action_type} />
                <Avatar user={userOf(e.user_id)} size={40} />
                <span className="audit-text">
                  <span>{summary(e)}</span>
                  <small className="muted">{formatMessageTime(snowflakeTime(e.id))}</small>
                </span>
                {lines.length > 0 && (expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />)}
              </button>
              {expanded && (
                <ul className="audit-changes">
                  {lines.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {hasMore && <button className="button secondary wide" onClick={more}>Carregar mais</button>}
    </>
  );
}
