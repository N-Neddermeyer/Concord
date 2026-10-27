import { Check, Lock, Plus, RefreshCw, Shield, Slash, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { CATEGORY, TEXT } from '../../lib/channels.js';
import { confirmDialog, openMenu, openModal, showError } from '../../lib/dialogs.js';
import {
  OVERWRITE_MEMBER, OVERWRITE_ROLE, P, channelPermissionGroups, channelPermissionsFor, has, isSynced, sortedRoles,
} from '../../lib/permissions.js';
import { closeLayer, memberName, openLayer, useStore } from '../../lib/store.js';
import Avatar from '../Avatar.jsx';
import { ChannelIcon } from '../ChannelSidebar.jsx';
import { Modal } from '../Modal.jsx';
import { AccessPicker } from '../modals.jsx';
import SettingsLayout, { SaveBar, Toggle, ToggleRow, isDirty } from './SettingsLayout.jsx';

// Valores do controle deslizante do modo lento no Discord.
const SLOWMODE_STEPS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];
export function slowmodeLabel(seconds) {
  if (!seconds) return 'Desligado';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}min`;
  return `${seconds / 3600}h`;
}

export default function ChannelSettings({ channelId, section = 'overview' }) {
  const channel = useStore((s) => s.channels[channelId]);
  const perms = useStore((s) => channelPermissionsFor(s, channelId));
  if (!channel) return null;
  const isCategory = channel.type === CATEGORY;

  const remove = async () => {
    const ok = await confirmDialog({
      title: isCategory ? 'Excluir categoria' : 'Excluir canal',
      body: isCategory
        ? `Tem certeza de que deseja excluir ${channel.name}? Os canais dela não serão excluídos: eles ficarão sem categoria.`
        : `Tem certeza de que deseja excluir ${channel.type === TEXT ? '#' : ''}${channel.name}? Esta ação não pode ser desfeita.`,
      confirmLabel: isCategory ? 'Excluir categoria' : 'Excluir canal',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/channels/${channel.id}`, { method: 'DELETE' });
      closeLayer();
    } catch (e) {
      showError(e.message);
    }
  };

  const canManage = has(perms, P.MANAGE_CHANNELS);
  const canPerms = has(perms, P.MANAGE_ROLES);
  const items = [
    { header: isCategory ? channel.name : <span className="channel-header-label"><ChannelIcon channel={channel} size={12} className="" /> {channel.name}</span> },
    canManage && { id: 'overview', label: 'Visão geral' },
    canPerms && { id: 'permissions', label: 'Permissões' },
    canManage && { separator: true },
    canManage && { id: 'delete', label: isCategory ? 'Excluir categoria' : 'Excluir canal', danger: true, icon: Trash2, onClick: remove },
  ];
  const allowed = items.filter((i) => i && i.id && !i.onClick).map((i) => i.id);
  const current = allowed.includes(section) ? section : allowed[0];
  const go = (id) => openLayer({ type: 'channel', guildId: channel.guild_id, channelId, section: id });

  return (
    <SettingsLayout items={items} current={current} onSelect={go} onClose={closeLayer}>
      {current === 'overview' && <Overview key={channel.id} channel={channel} />}
      {current === 'permissions' && <Permissions key={channel.id} channel={channel} perms={perms} />}
    </SettingsLayout>
  );
}

function useSave(channel) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async (body) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/channels/${channel.id}`, { method: 'PATCH', body });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return [save, busy, error];
}

// --- Visão geral ---

function Overview({ channel }) {
  const isText = channel.type === TEXT;
  const isCategory = channel.type === CATEGORY;
  const original = { name: channel.name, topic: channel.topic ?? '', rate_limit_per_user: channel.rate_limit_per_user ?? 0, nsfw: !!channel.nsfw };
  const [draft, setDraft] = useState(original);
  const [save, busy, error] = useSave(channel);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const step = Math.max(0, SLOWMODE_STEPS.indexOf(draft.rate_limit_per_user));

  const body = isCategory ? { name: draft.name } : isText ? draft : { name: draft.name, nsfw: draft.nsfw };
  return (
    <>
      <h2 className="page-title">Visão geral</h2>
      <label className="field">
        <span className="field-label">{isCategory ? 'Nome da categoria' : 'Nome do canal'}</span>
        <input
          className="input"
          value={isText ? draft.name.toLowerCase().replace(/\s+/g, '-') : draft.name}
          maxLength={100}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      {isText && (
        <>
          <div className="divider" />
          <label className="field">
            <span className="field-label">Tópico do canal</span>
            <div className="textarea-wrap">
              <textarea
                className="input"
                rows={4}
                maxLength={1024}
                placeholder="Diga a todos como usar este canal!"
                value={draft.topic}
                onChange={(e) => set({ topic: e.target.value })}
              />
              <span className="char-count">{1024 - draft.topic.length}</span>
            </div>
          </label>
          <div className="divider" />
          <div className="field">
            <span className="field-label">Modo lento</span>
            <div className="slowmode">
              <input
                type="range"
                min={0}
                max={SLOWMODE_STEPS.length - 1}
                value={step}
                aria-label="Modo lento"
                onChange={(e) => set({ rate_limit_per_user: SLOWMODE_STEPS[Number(e.target.value)] })}
              />
              <div className="slowmode-marks">
                {SLOWMODE_STEPS.map((v, i) => (
                  <span key={v} className={i === step ? 'active' : ''} style={{ left: `${(i / (SLOWMODE_STEPS.length - 1)) * 100}%` }}>{slowmodeLabel(v)}</span>
                ))}
              </div>
            </div>
            <p className="muted small">Os membros só poderão enviar uma mensagem por esse intervalo, a menos que tenham a permissão Gerenciar canal ou Gerenciar mensagens.</p>
          </div>
        </>
      )}
      {!isCategory && (
        <>
          <div className="divider" />
          <ToggleRow
            title="Canal com restrição de idade"
            description="Os usuários precisarão confirmar que são maiores de idade para ver o conteúdo deste canal."
            checked={draft.nsfw}
            onChange={(nsfw) => set({ nsfw })}
          />
        </>
      )}
      <SaveBar visible={isDirty(draft, original)} busy={busy} error={error} onReset={() => setDraft(original)} onSave={() => save(body)} />
    </>
  );
}

// --- Permissões ---

const clone = (list) => (list ?? []).map((o) => ({ ...o }));
const sameList = (a, b) => JSON.stringify([...a].sort((x, y) => (x.id < y.id ? -1 : 1))) === JSON.stringify([...b].sort((x, y) => (x.id < y.id ? -1 : 1)));

function Permissions({ channel, perms }) {
  const state = useStore((s) => s);
  const guild = state.guilds[channel.guild_id];
  const parent = channel.parent_id ? state.channels[channel.parent_id] : null;
  const original = channel.permission_overwrites ?? [];
  const [draft, setDraft] = useState(() => clone(original));
  const [selected, setSelected] = useState(guild.id);
  const [save, busy, error] = useSave(channel);
  const isCategory = channel.type === CATEGORY;

  // Chegou atualização do servidor (outra pessoa salvou ou acabamos de salvar): recomeça dela.
  useEffect(() => setDraft(clone(channel.permission_overwrites)), [channel.permission_overwrites]);

  const everyone = draft.find((o) => o.id === guild.id) ?? { id: guild.id, type: OVERWRITE_ROLE, allow: 0, deny: 0 };
  const isPrivate = has(everyone.deny, P.VIEW_CHANNEL);
  const canGrant = (flag) => has(perms, P.ADMINISTRATOR) || has(perms, flag);

  const update = (id, type, fn) => setDraft((list) => {
    const current = list.find((o) => o.id === id) ?? { id, type, allow: 0, deny: 0 };
    const next = fn({ ...current });
    return [...list.filter((o) => o.id !== id), next];
  });
  const setState = (id, type, flag, value) => update(id, type, (o) => ({
    ...o,
    allow: value === 'allow' ? o.allow | flag : o.allow & ~flag,
    deny: value === 'deny' ? o.deny | flag : o.deny & ~flag,
  }));
  const removeOverwrite = (id) => {
    setDraft((list) => list.filter((o) => o.id !== id));
    if (selected === id) setSelected(guild.id);
  };

  const togglePrivate = (value) => {
    setState(guild.id, OVERWRITE_ROLE, P.VIEW_CHANNEL, value ? 'deny' : 'neutral');
  };

  // Quem tem acesso a um canal privado: cargos e membros com "Ver canal" liberado.
  const access = draft.filter((o) => o.id !== guild.id && has(o.allow, P.VIEW_CHANNEL));
  const addAccess = async () => {
    const picked = await openModal(AddAccessModal, { guildId: guild.id, exclude: access.map((o) => o.id) });
    for (const p of picked ?? []) setState(p.id, p.type, P.VIEW_CHANNEL, 'allow');
  };

  const label = (o) => {
    if (o.type === OVERWRITE_ROLE) return guild.roles[o.id]?.name ?? 'cargo excluído';
    return memberName(state, guild.id, o.id);
  };
  const entries = [
    everyone,
    ...sortedRoles(guild).filter((r) => r.id !== guild.id).map((r) => draft.find((o) => o.id === r.id)).filter(Boolean),
    ...draft.filter((o) => o.type === OVERWRITE_MEMBER),
  ];
  const current = entries.find((o) => o.id === selected) ?? everyone;

  const addOverwrite = (e) => {
    const taken = new Set(draft.map((o) => o.id));
    const roles = sortedRoles(guild).filter((r) => r.id !== guild.id && !taken.has(r.id));
    const members = Object.keys(state.members[guild.id] ?? {}).filter((id) => !taken.has(id));
    const pick = (id, type) => {
      update(id, type, (o) => o);
      setSelected(id);
    };
    openMenu({
      rect: e.currentTarget.getBoundingClientRect(),
      side: 'below',
      width: 220,
      items: [
        ...roles.map((r) => ({ label: r.name, icon: Shield, onClick: () => pick(r.id, OVERWRITE_ROLE) })),
        roles.length > 0 && members.length > 0 && { separator: true },
        ...members.map((id) => ({ label: memberName(state, guild.id, id), onClick: () => pick(id, OVERWRITE_MEMBER) })),
        !roles.length && !members.length && { label: 'Nada para adicionar', disabled: true, onClick: () => {} },
      ],
    });
  };

  const synced = parent && isSynced({ permission_overwrites: draft }, parent);
  return (
    <>
      <h2 className="page-title">Permissões {isCategory ? 'da categoria' : 'do canal'}</h2>
      <p className="muted">Use as permissões para personalizar quem pode fazer o quê {isCategory ? 'nesta categoria' : 'neste canal'}.</p>

      {parent && (
        <div className={`sync-banner${synced ? ' synced' : ''}`}>
          {synced ? <Check size={18} /> : <RefreshCw size={18} />}
          <span>
            {synced ? 'Permissões sincronizadas com a categoria: ' : 'As permissões não estão sincronizadas com a categoria: '}
            <b>{parent.name}</b>
          </span>
          {!synced && <button className="button brand small" onClick={() => setDraft(clone(parent.permission_overwrites))}>Sincronizar agora</button>}
        </div>
      )}

      <div className="private-card">
        <div className="private-toggle">
          <Lock size={18} />
          <div>
            <div className="toggle-title">{isCategory ? 'Categoria privada' : 'Canal privado'}</div>
            <div className="toggle-description">
              Ao tornar {isCategory ? 'uma categoria privada' : 'um canal privado'}, somente membros e cargos selecionados poderão vê-{isCategory ? 'la' : 'lo'}.
            </div>
          </div>
          <Toggle checked={isPrivate} disabled={!canGrant(P.VIEW_CHANNEL)} onChange={togglePrivate} />
        </div>
        {isPrivate && (
          <div className="access">
            <div className="row space-between">
              <h3 className="section-heading">Quem pode acessar {isCategory ? 'esta categoria' : 'este canal'}?</h3>
              <button className="button brand small" onClick={addAccess}>Adicionar membros ou cargos</button>
            </div>
            {access.length === 0 && <div className="table-empty">Só quem passa por cima das permissões (dono e administradores) vê {isCategory ? 'esta categoria' : 'este canal'}.</div>}
            {access.map((o) => (
              <div key={o.id} className="access-row">
                {o.type === OVERWRITE_ROLE
                  ? <span className="role-dot big" style={{ background: guild.roles[o.id]?.color ?? '#99aab5' }} />
                  : <Avatar user={state.users[o.id]} size={24} />}
                <span>{label(o)}</span>
                <span className="muted small">{o.type === OVERWRITE_ROLE ? 'Cargo' : 'Membro'}</span>
                <button className="icon-button" aria-label="Remover acesso" title="Remover" onClick={() => setState(o.id, o.type, P.VIEW_CHANNEL, 'neutral')}>
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <h3 className="section-heading">Permissões avançadas</h3>
      <div className="overwrite-editor">
        <div className="overwrite-list">
          <div className="role-list-head">
            <span className="field-label">Cargos/membros</span>
            <button className="icon-button" aria-label="Adicionar cargo ou membro" title="Adicionar cargo ou membro" onClick={addOverwrite}><Plus size={18} /></button>
          </div>
          {entries.map((o) => (
            <div key={o.id} className={`role-list-item${o.id === current.id ? ' active' : ''}`}>
              <button onClick={() => setSelected(o.id)}>
                {o.type === OVERWRITE_ROLE
                  ? <span className="role-dot" style={{ background: guild.roles[o.id]?.color ?? '#99aab5' }} />
                  : <Avatar user={state.users[o.id]} size={16} />}
                <span className="role-list-name">{o.id === guild.id ? '@everyone' : label(o)}</span>
              </button>
              {o.id !== guild.id && (
                <span className="role-move">
                  <button aria-label="Remover" title="Remover" onClick={() => removeOverwrite(o.id)}><X size={14} /></button>
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="overwrite-detail">
          {channelPermissionGroups(channel.type).map((group) => (
            <section key={group.title}>
              <h3 className="section-heading">{group.title}</h3>
              {group.items.map(([flag, title, description]) => (
                <div key={flag} className="toggle-row">
                  <div>
                    <div className="toggle-title">{title}</div>
                    <div className="toggle-description">{description}</div>
                  </div>
                  <TriState
                    value={has(current.allow, flag) ? 'allow' : has(current.deny, flag) ? 'deny' : 'neutral'}
                    disabled={!canGrant(flag)}
                    onChange={(value) => setState(current.id, current.type, flag, value)}
                  />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
      <SaveBar
        visible={!sameList(draft, original)}
        busy={busy}
        error={error}
        onReset={() => setDraft(clone(original))}
        onSave={() => save({ permission_overwrites: draft })}
      />
    </>
  );
}

// ✗ negar · / herdar · ✓ permitir, como nas permissões avançadas do Discord.
function TriState({ value, onChange, disabled }) {
  return (
    <div className={`tri-state${disabled ? ' disabled' : ''}`} role="radiogroup">
      {[
        ['deny', X, 'Negar'],
        ['neutral', Slash, 'Herdar'],
        ['allow', Check, 'Permitir'],
      ].map(([v, Icon, title]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          aria-label={title}
          title={title}
          disabled={disabled}
          className={`${v}${value === v ? ' on' : ''}`}
          onClick={() => onChange(v)}
        >
          <Icon size={16} strokeWidth={3} />
        </button>
      ))}
    </div>
  );
}

function AddAccessModal({ close, guildId, exclude }) {
  const [picked, setPicked] = useState([]);
  return (
    <Modal
      title="Adicionar membros ou cargos"
      onClose={() => close([])}
      footer={
        <>
          <button className="button link-button" onClick={() => close([])}>Cancelar</button>
          <button className="button brand" disabled={!picked.length} onClick={() => close(picked)}>Concluído</button>
        </>
      }
    >
      <AccessPicker guildId={guildId} picked={picked} onChange={setPicked} exclude={exclude} />
    </Modal>
  );
}
