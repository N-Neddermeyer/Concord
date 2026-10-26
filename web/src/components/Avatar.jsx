import { Users } from 'lucide-react';
import { initials } from '../lib/util.js';

// Avatar redondo: imagem do usuário ou a inicial sobre a cor padrão, com o indicador de status.
export default function Avatar({ user, size = 32, status, speaking = false }) {
  const statusSize = Math.max(10, Math.round(size * 0.3));
  return (
    <span
      className={`avatar${speaking ? ' speaking' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.42, background: user?.avatar ? 'transparent' : (user?.color ?? '#5865f2') }}
    >
      {user?.avatar ? <img src={user.avatar} alt="" draggable={false} /> : (user?.username?.[0]?.toUpperCase() ?? '?')}
      {status && <span className={`status ${status}`} style={{ width: statusSize, height: statusSize }} title={status} />}
    </span>
  );
}

export function GuildIcon({ guild, size = 48 }) {
  if (guild.icon) return <img className="guild-img" src={guild.icon} alt="" style={{ width: size, height: size }} draggable={false} />;
  return <span className="guild-initials" style={{ fontSize: guild.name.length > 12 ? size * 0.25 : size * 0.33 }}>{initials(guild.name)}</span>;
}

const GROUP_COLORS = ['#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459e', '#00a8fc', '#9b59b6'];

// Ícone padrão de grupo de DM: cor fixa por grupo com o desenho de pessoas.
export function GroupIcon({ channel, size = 32 }) {
  const color = GROUP_COLORS[Number(BigInt(channel.id) % BigInt(GROUP_COLORS.length))];
  return (
    <span className="avatar group-icon" style={{ width: size, height: size, background: color }}>
      <Users size={Math.round(size * 0.55)} />
    </span>
  );
}
