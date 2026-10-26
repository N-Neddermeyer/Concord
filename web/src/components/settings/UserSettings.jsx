import { LogOut, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { confirmDialog, openModal, showError } from '../../lib/dialogs.js';
import { pickImage } from '../../lib/image.js';
import { isDesktop, native } from '../../lib/native.js';
import { updateSettings, useSettings } from '../../lib/settings.js';
import { closeLayer, openLayer, useStore } from '../../lib/store.js';
import { displayName } from '../../lib/util.js';
import { cameraConstraints, levelOf, micConstraints } from '../../lib/voice.js';
import Avatar from '../Avatar.jsx';
import { ChangePasswordModal, ChangeUsernameModal } from '../modals.jsx';
import { ProfileCard } from '../UserPopout.jsx';
import { VideoTrack } from '../VideoCall.jsx';
import SettingsLayout, { SaveBar, ToggleRow, isDirty } from './SettingsLayout.jsx';

export default function UserSettings({ section = 'account', onLogout, onToken }) {
  const logout = async () => {
    const ok = await confirmDialog({ title: 'Sair', body: 'Tem certeza de que deseja sair?', confirmLabel: 'Sair', danger: true });
    if (ok) onLogout();
  };

  const items = [
    { header: 'Configurações de usuário' },
    { id: 'account', label: 'Minha conta' },
    { id: 'profiles', label: 'Perfis' },
    { separator: true },
    { header: 'Configurações do aplicativo' },
    { id: 'appearance', label: 'Aparência' },
    { id: 'voice', label: 'Voz e vídeo' },
    { id: 'notifications', label: 'Notificações' },
    { id: 'keybinds', label: 'Atalhos de teclado' },
    { separator: true },
    { id: 'logout', label: 'Sair', danger: true, icon: LogOut, onClick: logout },
    { separator: true },
    { note: <AppInfo /> },
  ];

  const Page = { account: Account, profiles: Profiles, appearance: Appearance, voice: VoiceSettings, notifications: Notifications, keybinds: Keybinds }[section] ?? Account;
  return (
    <SettingsLayout items={items} current={section} onSelect={(id) => openLayer({ type: 'user', section: id })} onClose={closeLayer}>
      <Page onToken={onToken} />
    </SettingsLayout>
  );
}

function AppInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    native?.app.getInfo().then(setInfo);
  }, []);
  return (
    <>
      <div>Clone Local 0.2.0</div>
      <div>{isDesktop ? `Desktop · Electron ${info?.electron ?? '…'}` : 'Navegador'}</div>
      {info && <div>{info.platform} {info.arch}</div>}
    </>
  );
}

// --- Minha conta ---

function Account({ onToken }) {
  const me = useStore((s) => s.user);
  return (
    <>
      <h2 className="page-title">Minha conta</h2>
      <div className="account-card">
        <div className="account-banner" style={{ background: me.banner_color ?? me.color }} />
        <div className="account-head">
          <div className="account-avatar"><Avatar user={me} size={80} status={me.status === 'invisible' ? 'offline' : me.status} /></div>
          <div className="account-name">{displayName(me)}</div>
          <button className="button brand small" onClick={() => openLayer({ type: 'user', section: 'profiles' })}>Editar perfil de usuário</button>
        </div>
        <div className="account-fields">
          <div className="account-field">
            <div>
              <div className="field-label">Nome exibido</div>
              <div>{me.global_name ?? <span className="muted">Você ainda não adicionou um nome exibido.</span>}</div>
            </div>
            <button className="button secondary small" onClick={() => openLayer({ type: 'user', section: 'profiles' })}>Editar</button>
          </div>
          <div className="account-field">
            <div>
              <div className="field-label">Nome de usuário</div>
              <div>{me.username}</div>
            </div>
            <button className="button secondary small" onClick={() => openModal(ChangeUsernameModal, { user: me })}>Editar</button>
          </div>
        </div>
      </div>

      <div className="divider" />
      <h3 className="section-heading">Senha e autenticação</h3>
      <button className="button brand" onClick={() => openModal(ChangePasswordModal, { onToken })}>Mudar senha</button>
      <p className="muted small">Ao trocar a senha, as outras sessões abertas precisarão entrar de novo.</p>
    </>
  );
}

// --- Perfis ---

function Profiles() {
  const me = useStore((s) => s.user);
  const original = { global_name: me.global_name ?? '', avatar: me.avatar, banner_color: me.banner_color, bio: me.bio };
  const [draft, setDraft] = useState(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = isDirty(draft, original);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/users/@me', { method: 'PATCH', body: draft });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="page-title">Perfis</h2>
      <div className="profile-editor">
        <div className="profile-form">
          <label className="field">
            <span className="field-label">Nome exibido</span>
            <input className="input" value={draft.global_name} maxLength={32} placeholder={me.username} onChange={(e) => set({ global_name: e.target.value })} />
          </label>
          <div className="divider" />
          <span className="field-label">Avatar</span>
          <div className="row">
            <button className="button brand small" onClick={() => pickImage(256).then((avatar) => avatar && set({ avatar })).catch((e) => showError(e.message))}>
              Mudar avatar
            </button>
            {draft.avatar && <button className="button link-button small" onClick={() => set({ avatar: null })}>Remover avatar</button>}
          </div>
          <div className="divider" />
          <span className="field-label">Cor do banner</span>
          <div className="row">
            <input type="color" className="color-input" value={draft.banner_color ?? me.color} onChange={(e) => set({ banner_color: e.target.value })} />
            {draft.banner_color && <button className="button link-button small" onClick={() => set({ banner_color: null })}>Redefinir</button>}
          </div>
          <div className="divider" />
          <label className="field">
            <span className="field-label">Sobre mim</span>
            <span className="field-help">Você pode usar até 190 caracteres.</span>
            <div className="textarea-wrap">
              <textarea className="input" rows={4} maxLength={190} value={draft.bio} onChange={(e) => set({ bio: e.target.value })} />
              <span className="char-count">{190 - draft.bio.length}</span>
            </div>
          </label>
        </div>
        <div className="profile-preview">
          <span className="field-label">Prévia</span>
          <ProfileCard user={{ ...me, ...draft, global_name: draft.global_name || null }} status={me.status === 'invisible' ? 'offline' : me.status} preview />
        </div>
      </div>
      <SaveBar visible={dirty} busy={busy} error={error} onReset={() => setDraft(original)} onSave={save} />
    </>
  );
}

// --- Aparência ---

const THEMES = [
  ['light', 'Claro', '#ffffff'],
  ['dark', 'Escuro', '#313338'],
  ['onyx', 'Ônix', '#0c0c0e'],
];

function Appearance() {
  const settings = useSettings();
  const me = useStore((s) => s.user);
  return (
    <>
      <h2 className="page-title">Aparência</h2>
      <div className="appearance-preview">
        {[0, 1].map((i) => (
          <div key={i} className={`message ${settings.messageDisplay === 'compact' ? 'compact' : ''}`}>
            {settings.messageDisplay === 'compact' ? (
              <>
                <span className="compact-time">14:{i ? '03' : '02'}</span>
                <span className="author">{displayName(me)}</span>
                <div className="content">{i ? 'Este é o tamanho e o espaçamento das mensagens.' : 'Olha só que bacana!'}</div>
              </>
            ) : (
              <>
                <Avatar user={me} size={40} />
                <div className="message-body">
                  <div className="message-meta"><span className="author">{displayName(me)}</span><span className="timestamp">Hoje às 14:0{i + 2}</span></div>
                  <div className="content">{i ? 'Este é o tamanho e o espaçamento das mensagens.' : 'Olha só que bacana!'}</div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <h3 className="section-heading">Tema</h3>
      <div className="theme-swatches">
        {THEMES.map(([id, label, color]) => (
          <button key={id} className={`theme-swatch${settings.theme === id ? ' selected' : ''}`} onClick={() => updateSettings({ theme: id })} title={label}>
            <span style={{ background: color }} />
            <small>{label}</small>
          </button>
        ))}
      </div>

      <div className="divider" />
      <h3 className="section-heading">Exibição de mensagens</h3>
      {[
        ['cozy', 'Confortável', 'Moderno, bonito e agradável aos olhos.'],
        ['compact', 'Compacto', 'Mais mensagens na tela de uma só vez.'],
      ].map(([id, label, hint]) => (
        <button key={id} className={`radio-card${settings.messageDisplay === id ? ' selected' : ''}`} onClick={() => updateSettings({ messageDisplay: id })}>
          <span><b>{label}</b><small>{hint}</small></span>
          <span className="radio-dot" />
        </button>
      ))}

      <div className="divider" />
      <h3 className="section-heading">Tamanho da fonte do chat</h3>
      <div className="slider-row">
        <input type="range" min={12} max={24} step={1} value={settings.fontSize} onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })} />
        <span>{settings.fontSize}px</span>
      </div>
      {isDesktop && (
        <>
          <h3 className="section-heading">Nível de zoom</h3>
          <ZoomSlider />
        </>
      )}
    </>
  );
}

function ZoomSlider() {
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    native.window.getZoom().then((factor) => setZoom(Math.round(factor * 100)));
  }, []);
  return (
    <div className="slider-row">
      <input type="range" min={50} max={200} step={10} value={zoom} onChange={(e) => {
        const value = Number(e.target.value);
        setZoom(value);
        native.window.setZoom(value / 100);
      }} />
      <span>{zoom}%</span>
    </div>
  );
}

// --- Voz e vídeo ---

function useDevices() {
  const [devices, setDevices] = useState({ input: [], output: [], video: [] });
  useEffect(() => {
    const refresh = () =>
      navigator.mediaDevices.enumerateDevices().then((list) => setDevices({
        input: list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default'),
        output: list.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default'),
        video: list.filter((d) => d.kind === 'videoinput'),
      }));
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, []);
  return devices;
}

function VoiceSettings() {
  const settings = useSettings();
  const devices = useDevices();
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const test = useRef(null);

  // Teste de microfone: mede o nível e toca o próprio áudio de volta.
  const stopTest = () => {
    const t = test.current;
    if (!t) return;
    clearInterval(t.timer);
    t.stream.getTracks().forEach((track) => track.stop());
    t.audio.srcObject = null;
    t.context.close();
    test.current = null;
    setTesting(false);
    setLevel(0);
  };

  const startTest = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(micConstraints());
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      const audio = new Audio();
      audio.srcObject = stream;
      if (settings.outputDevice !== 'default') audio.setSinkId?.(settings.outputDevice).catch(() => {});
      audio.volume = Math.min(settings.outputVolume, 100) / 100;
      audio.play().catch(() => {});
      const timer = setInterval(() => setLevel(levelOf(analyser, buffer)), 50);
      test.current = { stream, context, audio, timer };
      setTesting(true);
    } catch (e) {
      showError(`Não foi possível acessar o microfone: ${e.message}`);
    }
  };

  useEffect(() => stopTest, []);
  // Reinicia o teste quando o dispositivo ou o processamento mudam.
  useEffect(() => {
    if (!test.current) return;
    stopTest();
    startTest();
  }, [settings.inputDevice, settings.outputDevice, settings.echoCancellation, settings.noiseSuppression, settings.autoGainControl]);

  const db = level > 0 ? Math.max(-100, 20 * Math.log10(level)) : -100;
  const meterPercent = ((db + 100) / 100) * 100;
  const thresholdPercent = settings.sensitivity + 100;

  return (
    <>
      <h2 className="page-title">Configurações de voz</h2>
      <div className="two-columns">
        <label className="field">
          <span className="field-label">Dispositivo de entrada</span>
          <select className="input" value={settings.inputDevice} onChange={(e) => updateSettings({ inputDevice: e.target.value })}>
            <option value="default">Padrão</option>
            {devices.input.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microfone ${i + 1}`}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Dispositivo de saída</span>
          <select className="input" value={settings.outputDevice} onChange={(e) => updateSettings({ outputDevice: e.target.value })}>
            <option value="default">Padrão</option>
            {devices.output.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Alto-falante ${i + 1}`}</option>)}
          </select>
        </label>
      </div>
      <div className="two-columns">
        <div />
        <label className="field">
          <span className="field-label">Volume de saída</span>
          <div className="slider-row">
            <input type="range" min={0} max={100} value={settings.outputVolume} onChange={(e) => updateSettings({ outputVolume: Number(e.target.value) })} />
            <span>{settings.outputVolume}%</span>
          </div>
        </label>
      </div>

      <h3 className="section-heading">Teste de microfone</h3>
      <p className="muted small">Está com problemas no microfone? Comece um teste e diga algo engraçado — vamos reproduzir sua voz para você.</p>
      <div className="mic-test">
        <button className={`button ${testing ? 'secondary' : 'brand'}`} onClick={testing ? stopTest : startTest}>
          {testing ? 'Parar teste' : 'Vamos verificar'}
        </button>
        <div className="level-meter"><span style={{ width: `${testing ? meterPercent : 0}%` }} /></div>
      </div>

      <div className="divider" />
      <h3 className="section-heading">Sensibilidade de entrada</h3>
      <ToggleRow
        title="Determinar automaticamente a sensibilidade de entrada"
        checked={settings.autoSensitivity}
        onChange={(autoSensitivity) => updateSettings({ autoSensitivity })}
      />
      {!settings.autoSensitivity && (
        <div className="sensitivity">
          <div className="level-meter threshold">
            <span style={{ width: `${testing ? meterPercent : 0}%` }} className={meterPercent > thresholdPercent ? 'open' : ''} />
            <i style={{ left: `${thresholdPercent}%` }} />
          </div>
          <input type="range" min={-100} max={0} value={settings.sensitivity} onChange={(e) => updateSettings({ sensitivity: Number(e.target.value) })} />
          <p className="muted small">{settings.sensitivity} dB — sua voz só é transmitida acima desse nível{testing ? '' : ' (comece o teste acima para ver o medidor)'}.</p>
        </div>
      )}

      <div className="divider" />
      <h3 className="section-heading">Processamento de voz</h3>
      <ToggleRow title="Cancelamento de eco" checked={settings.echoCancellation} onChange={(echoCancellation) => updateSettings({ echoCancellation })} />
      <ToggleRow title="Supressão de ruído" description="Reduz ruídos de fundo do seu microfone." checked={settings.noiseSuppression} onChange={(noiseSuppression) => updateSettings({ noiseSuppression })} />
      <ToggleRow title="Controle automático de ganho" checked={settings.autoGainControl} onChange={(autoGainControl) => updateSettings({ autoGainControl })} />

      <div className="divider" />
      <VideoSettings devices={devices.video} />
    </>
  );
}

// Prévia da câmera escolhida, como em "Configurações de vídeo" do Discord.
function VideoSettings({ devices }) {
  const settings = useSettings();
  const [preview, setPreview] = useState(null);
  const current = useRef(null); // stream da prévia, para parar ao sair da página

  const show = (stream) => {
    current.current?.getTracks().forEach((t) => t.stop());
    current.current = stream;
    setPreview(stream);
  };
  const stop = () => show(null);
  const start = async () => {
    try {
      show(await navigator.mediaDevices.getUserMedia(cameraConstraints()));
    } catch (e) {
      showError(`Não foi possível acessar a câmera: ${e.message}`);
    }
  };
  useEffect(() => () => current.current?.getTracks().forEach((t) => t.stop()), []);
  // Troca de câmera durante o teste: reabre a prévia com a nova.
  useEffect(() => {
    if (current.current) start();
  }, [settings.videoDevice]);

  return (
    <>
      <h2 className="page-title">Configurações de vídeo</h2>
      <div className="camera-preview">
        {preview ? (
          <VideoTrack track={preview.getVideoTracks()[0]} mirror />
        ) : (
          <div className="camera-preview-empty">
            <VideoOff size={40} />
            <button className="button brand" onClick={start}>Testar vídeo</button>
          </div>
        )}
      </div>
      {preview && <button className="button secondary" onClick={stop}>Parar teste</button>}
      <label className="field">
        <span className="field-label">Câmera</span>
        <select className="input" value={settings.videoDevice} onChange={(e) => updateSettings({ videoDevice: e.target.value })}>
          <option value="default">Padrão</option>
          {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Câmera ${i + 1}`}</option>)}
        </select>
      </label>
    </>
  );
}

// --- Notificações ---

function Notifications() {
  const settings = useSettings();
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));

  const toggleDesktop = async (enabled) => {
    if (enabled && permission !== 'granted' && 'Notification' in window) {
      setPermission(await Notification.requestPermission());
    }
    updateSettings({ desktopNotifications: enabled });
  };

  return (
    <>
      <h2 className="page-title">Notificações</h2>
      <ToggleRow
        title="Ativar notificações na área de trabalho"
        description={permission === 'denied' ? 'As notificações estão bloqueadas pelo sistema ou pelo navegador.' : 'Avisa sobre mensagens diretas e menções (@seu_nome) quando o app não está em foco.'}
        checked={settings.desktopNotifications && permission === 'granted'}
        disabled={permission === 'denied'}
        onChange={toggleDesktop}
      />
      <ToggleRow title="Sons" description="Toca sons ao receber mensagens, entrar e sair de canais de voz e silenciar." checked={settings.sounds} onChange={(sounds) => updateSettings({ sounds })} />
      <p className="muted small">No status “Não perturbe”, nenhuma notificação é exibida.</p>
    </>
  );
}

// --- Atalhos de teclado ---

const KEYBINDS = [
  ['Busca rápida', ['Ctrl', 'K']],
  ['Ativar/desativar mudo', ['Ctrl', 'Shift', 'M']],
  ['Ativar/desativar ensurdecer', ['Ctrl', 'Shift', 'D']],
  ['Fechar configurações / modais', ['Esc']],
  ['Pular a confirmação ao excluir mensagem', ['Shift', 'Clique']],
  ['Nova linha na mensagem', ['Shift', 'Enter']],
];

function Keybinds() {
  return (
    <>
      <h2 className="page-title">Atalhos de teclado</h2>
      <div className="keybinds">
        {KEYBINDS.map(([label, keys]) => (
          <div key={label} className="keybind">
            <span>{label}</span>
            <span>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
