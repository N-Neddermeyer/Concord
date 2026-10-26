import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { showError } from '../lib/dialogs.js';
import { HOME, REL, navigate, useStore } from '../lib/store.js';
import { displayName } from '../lib/util.js';
import Avatar from './Avatar.jsx';

const MAX_GROUP_SIZE = 10;

// "Adicionar amigos à MD": numa DM individual cria um grupo novo (o amigo da conversa +
// os escolhidos); num grupo, adiciona os escolhidos a ele. Mesmo comportamento do Discord.
export default function AddToDmPopout({ channel, close }) {
  const relationships = useStore((s) => s.relationships);
  const users = useStore((s) => s.users);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  const memberIds = channel.recipients.map((u) => u.id);
  const room = MAX_GROUP_SIZE - 1 - memberIds.length - selected.length;
  const friends = Object.entries(relationships)
    .filter(([id, r]) => r.type === REL.FRIEND && !memberIds.includes(id))
    .map(([id]) => users[id])
    .filter((u) => `${u.username} ${u.global_name ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));

  const toggle = (id) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : room > 0 ? [...list, id] : list));

  const submit = async () => {
    setBusy(true);
    try {
      if (channel.type === 1) {
        const group = await api('/users/@me/channels', { method: 'POST', body: { recipients: [...memberIds, ...selected] } });
        navigate(HOME, group.id);
      } else {
        for (const id of selected) await api(`/channels/${channel.id}/recipients/${id}`, { method: 'PUT' });
      }
      close();
    } catch (e) {
      showError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="add-dm-popout">
      <header>
        <h2>Selecionar amigos</h2>
        <p>{room > 0 ? `Você pode adicionar mais ${room} ${room === 1 ? 'amigo' : 'amigos'}.` : 'Este grupo atingiu o limite de participantes.'}</p>
        <div className="add-dm-search">
          {selected.map((id) => (
            <button key={id} className="add-dm-chip" onClick={() => toggle(id)}>{displayName(users[id])} <X size={12} /></button>
          ))}
          <input
            autoFocus
            value={query}
            placeholder={selected.length ? '' : 'Digite o nome de usuário de um amigo'}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Backspace' && !query && selected.length && toggle(selected.at(-1))}
          />
        </div>
      </header>
      <div className="add-dm-list">
        {friends.length === 0 && <p className="muted center">Nenhum amigo encontrado que não esteja nesta MD.</p>}
        {friends.map((u) => {
          const checked = selected.includes(u.id);
          return (
            <button key={u.id} className={`add-dm-item${checked ? ' checked' : ''}`} onClick={() => toggle(u.id)}>
              <Avatar user={u} size={32} />
              <span className="add-dm-name">{displayName(u)}</span>
              <span className="add-dm-username">{u.username}</span>
              <span className="checkbox">{checked && <Check size={14} />}</span>
            </button>
          );
        })}
      </div>
      <footer>
        <button className="button brand wide" disabled={busy || !selected.length} onClick={submit}>
          {channel.type === 1 ? 'Criar MD em grupo' : 'Adicionar à MD'}
        </button>
      </footer>
    </div>
  );
}
