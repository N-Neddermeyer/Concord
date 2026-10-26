import { Pin, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { unpinMessage } from '../lib/messages.js';
import { HOME, jumpToMessage, useStore } from '../lib/store.js';
import { displayName, formatMessageTime } from '../lib/util.js';
import Avatar from './Avatar.jsx';
import { Content } from './Message.jsx';

// Popout "Mensagens fixadas" do cabeçalho do canal.
export default function PinsPopout({ channel, canPin, close }) {
  const version = useStore((s) => s.pinsUpdated[channel.id]);
  const users = useStore((s) => s.users);
  const [pins, setPins] = useState(null);
  const [error, setError] = useState(null);
  const usersByName = useMemo(() => new Map(Object.values(users).map((u) => [u.username.toLowerCase(), u])), [users]);

  useEffect(() => {
    api(`/channels/${channel.id}/pins`).then(setPins, (e) => setError(e.message));
  }, [channel.id, version]);

  const jump = (m) => {
    close();
    jumpToMessage(channel.guild_id ?? HOME, channel.id, m.id);
  };

  return (
    <div className="pins-popout">
      <header><Pin size={20} /> <h2>Mensagens fixadas</h2></header>
      <div className="pins-list">
        {error && <p className="error">{error}</p>}
        {pins && !pins.length && (
          <div className="pins-empty">
            <div className="pins-empty-icon"><Pin size={32} /></div>
            <p>Este canal não tem nenhuma mensagem fixada… ainda.</p>
          </div>
        )}
        {pins?.map((m) => {
          const author = users[m.author.id] ?? m.author;
          return (
            <div key={m.id} className="pin-item">
              <div className="pin-actions">
                <button className="button secondary small" onClick={() => jump(m)}>Pular</button>
                {canPin && (
                  <button className="icon-button" aria-label="Desafixar" title="Desafixar" onClick={(e) => unpinMessage(m, e.shiftKey)}>
                    <X size={16} />
                  </button>
                )}
              </div>
              <Avatar user={author} size={40} />
              <div className="pin-body">
                <div className="message-meta">
                  <span className="author">{displayName(author)}</span>
                  <span className="timestamp">{formatMessageTime(m.timestamp)}</span>
                </div>
                <div className="content">
                  <Content text={m.content} usersByName={usersByName} onMention={() => {}} />
                  {m.edited_timestamp && <span className="edited"> (editado)</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
