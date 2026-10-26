import { useState } from 'react';
import { api } from '../lib/api.js';

export default function Auth({ onToken }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api(`/auth/${mode}`, { method: 'POST', body: { username, password } });
      onToken(token);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const registering = mode === 'register';
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <header>
          <h1>{registering ? 'Criar uma conta' : 'Boas-vindas de volta!'}</h1>
          {!registering && <p>Estamos muito animados em ver você novamente!</p>}
        </header>
        <label className={`field${error ? ' invalid' : ''}`}>
          <span className="field-label">
            Nome de usuário <span className="required">*</span>
            {error && <em> — {error}</em>}
          </span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required autoComplete="username" />
        </label>
        <label className={`field${error ? ' invalid' : ''}`}>
          <span className="field-label">Senha <span className="required">*</span></span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={registering ? 'new-password' : 'current-password'}
          />
        </label>
        <button className="button brand wide big" disabled={busy}>{registering ? 'Continuar' : 'Entrar'}</button>
        <p className="auth-switch">
          {registering ? 'Já tem uma conta? ' : 'Precisando de uma conta? '}
          <button type="button" className="link" onClick={() => { setMode(registering ? 'login' : 'register'); setError(null); }}>
            {registering ? 'Entrar' : 'Registre-se'}
          </button>
        </p>
      </form>
    </div>
  );
}
