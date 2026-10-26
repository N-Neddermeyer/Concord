import { useSyncExternalStore } from 'react';

// Pilha de modais e popouts flutuantes, renderizada por <DialogHost/>. Substitui
// alert/confirm/prompt do navegador pelos diálogos no visual do app.

let snapshot = { modals: [], popout: null, menu: null };
const listeners = new Set();
let nextId = 1;

function set(patch) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

export const useDialogs = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );

// Abre um componente de modal; ele recebe `close(result)` e a promessa resolve com o resultado.
export function openModal(Component, props = {}) {
  return new Promise((resolve) => {
    const id = nextId++;
    const close = (result) => {
      set({ modals: snapshot.modals.filter((m) => m.id !== id) });
      resolve(result);
    };
    set({ modals: [...snapshot.modals, { id, Component, props, close }] });
  });
}

export const closeAllModals = () => {
  for (const m of [...snapshot.modals]) m.close(undefined);
};

export const hasOpenModal = () => snapshot.modals.length > 0 || snapshot.popout !== null || snapshot.menu !== null;

// Registrados pelo DialogHost para evitar importação circular com os componentes.
const builtins = {};
export const registerBuiltinDialogs = (dialogs) => Object.assign(builtins, dialogs);

export const confirmDialog = (options) => openModal(builtins.Confirm, options);
export const showError = (message) => openModal(builtins.Confirm, { title: 'Ops!', body: message, confirmLabel: 'Ok', alertOnly: true });
export const askText = (options) => openModal(builtins.Prompt, options);

// Popout de perfil, ancorado no elemento clicado.
export const openPopout = (popout) => set({ popout, menu: null });
export const closePopout = () => set({ popout: null });

// Menu suspenso: items = [{ label, onClick, danger, color, separator }].
export const openMenu = (menu) => set({ menu, popout: null });
export const closeMenu = () => set({ menu: null });
