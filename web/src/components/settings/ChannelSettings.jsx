import { Hash, Trash2, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { confirmDialog, showError } from '../../lib/dialogs.js';
import { closeLayer, useStore } from '../../lib/store.js';
import SettingsLayout, { SaveBar, isDirty } from './SettingsLayout.jsx';

export default function ChannelSettings({ channelId }) {
  const channel = useStore((s) => s.channels[channelId]);
  if (!channel) return null;

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Excluir canal',
      body: `Tem certeza de que deseja excluir ${channel.type === 0 ? '#' : ''}${channel.name}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir canal',
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

  const Icon = channel.type === 0 ? Hash : Volume2;
  const items = [
    { header: <span className="channel-header-label"><Icon size={12} /> {channel.name}</span> },
    { id: 'overview', label: 'Visão geral' },
    { separator: true },
    { id: 'delete', label: 'Excluir canal', danger: true, icon: Trash2, onClick: remove },
  ];
  return (
    <SettingsLayout items={items} current="overview" onSelect={() => {}} onClose={closeLayer}>
      <Overview channel={channel} />
    </SettingsLayout>
  );
}

function Overview({ channel }) {
  const original = { name: channel.name, topic: channel.topic ?? '' };
  const [draft, setDraft] = useState(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isText = channel.type === 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/channels/${channel.id}`, { method: 'PATCH', body: draft });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="page-title">Visão geral</h2>
      <label className="field">
        <span className="field-label">Nome do canal</span>
        <input
          className="input"
          value={isText ? draft.name.toLowerCase().replace(/\s+/g, '-') : draft.name}
          maxLength={100}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
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
                onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
              />
              <span className="char-count">{1024 - draft.topic.length}</span>
            </div>
          </label>
        </>
      )}
      <SaveBar visible={isDirty(draft, original)} busy={busy} error={error} onReset={() => setDraft(original)} onSave={save} />
    </>
  );
}
