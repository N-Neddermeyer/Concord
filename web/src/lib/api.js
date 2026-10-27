import { isDesktop } from './native.js';

// No navegador o token fica no sessionStorage, para poder abrir duas abas com usuários
// diferentes. No app desktop fica no localStorage, para continuar logado ao reabrir.
const storage = isDesktop ? localStorage : sessionStorage;

export const token = {
  get: () => storage.getItem('token'),
  set: (value) => storage.setItem('token', value),
  clear: () => storage.removeItem('token'),
};

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token.get()) headers.Authorization = token.get();

  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.message ?? `HTTP ${res.status}`), { status: res.status, data });
  return data;
}
