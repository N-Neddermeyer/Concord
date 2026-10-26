import { Phone, X } from 'lucide-react';
import { acceptCall, declineCall, incomingCalls } from '../lib/calls.js';
import { HOME, dmRecipient, navigate, privateChannelName, useStore } from '../lib/store.js';
import Avatar, { GroupIcon } from './Avatar.jsx';

// Popup de chamada recebida: avatar de quem liga com as ondas do toque, recusar e atender.
export default function IncomingCall() {
  const state = useStore((s) => s);
  const calls = incomingCalls(state);
  if (!calls.length) return null;

  return (
    <div className="incoming-calls">
      {calls.map((call) => {
        const channel = state.channels[call.channel_id];
        if (!channel) return null;
        const name = privateChannelName(state, channel);
        return (
          <div key={call.channel_id} className="incoming-call" role="alertdialog" aria-label={`Chamada recebida de ${name}`}>
            <button className="incoming-avatar" onClick={() => navigate(HOME, channel.id)} title="Abrir conversa">
              <span className="call-ripple" />
              <span className="call-ripple delay" />
              {channel.type === 1 ? <Avatar user={dmRecipient(state, channel)} size={80} /> : <GroupIcon channel={channel} size={80} />}
            </button>
            <div className="incoming-name">{name}</div>
            <div className="incoming-label">Chamada recebida…</div>
            <div className="incoming-actions">
              <button className="call-control hangup small" title="Recusar" aria-label="Recusar" onClick={() => declineCall(channel.id)}>
                <X size={22} />
              </button>
              <button className="call-control join small" title="Atender" aria-label="Atender" onClick={() => acceptCall(channel.id)}>
                <Phone size={22} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
