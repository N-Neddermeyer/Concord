// Tecla do "Pressione para falar": KeyboardEvent.code (ou botão do mouse) -> nome exibido e o
// código virtual do Windows, que o desktop usa para ler a tecla com a janela fora de foco.

const NAMED = {
  Space: ['Espaço', 32], Tab: ['Tab', 9], CapsLock: ['Caps Lock', 20], Backspace: ['Backspace', 8], Enter: ['Enter', 13],
  ShiftLeft: ['Shift esquerdo', 160], ShiftRight: ['Shift direito', 161],
  ControlLeft: ['Ctrl esquerdo', 162], ControlRight: ['Ctrl direito', 163],
  AltLeft: ['Alt esquerdo', 164], AltRight: ['Alt direito', 165],
  ArrowLeft: ['Seta esquerda', 37], ArrowUp: ['Seta para cima', 38], ArrowRight: ['Seta direita', 39], ArrowDown: ['Seta para baixo', 40],
  Insert: ['Insert', 45], Delete: ['Delete', 46], Home: ['Home', 36], End: ['End', 35], PageUp: ['Page Up', 33], PageDown: ['Page Down', 34],
  Pause: ['Pause', 19], ScrollLock: ['Scroll Lock', 145], NumLock: ['Num Lock', 144],
  // Pontuação: o nome vem do próprio evento (depende do layout do teclado, ABNT2 ou US).
  Backquote: [null, 192], Minus: [null, 189], Equal: [null, 187], BracketLeft: [null, 219], BracketRight: [null, 221],
  Backslash: [null, 220], Semicolon: [null, 186], Quote: [null, 222], Comma: [null, 188], Period: [null, 190], Slash: [null, 191],
  IntlBackslash: [null, 226], IntlRo: [null, 193],
  NumpadAdd: ['Num +', 107], NumpadSubtract: ['Num -', 109], NumpadMultiply: ['Num *', 106], NumpadDivide: ['Num /', 111],
  NumpadDecimal: ['Num ,', 110], NumpadEnter: ['Num Enter', 13],
  Mouse3: ['Botão do meio do mouse', 4], Mouse4: ['Mouse 4', 5], Mouse5: ['Mouse 5', 6],
};

const MOUSE = { 1: 'Mouse3', 3: 'Mouse4', 4: 'Mouse5' }; // MouseEvent.button -> código

// Tecla de um evento de teclado ou mouse; null se não serve (Esc cancela a gravação;
// os botões esquerdo e direito do mouse não podem ser usados).
export function keyFromEvent(e) {
  if (e.type.startsWith('mouse')) {
    const code = MOUSE[e.button];
    return code ? { code, name: NAMED[code][0], vk: NAMED[code][1] } : null;
  }
  const { code } = e;
  if (!code || code === 'Escape') return null;
  const char = e.key?.length === 1 && e.key !== ' ' ? e.key.toUpperCase() : null;
  let match;
  if ((match = /^Numpad(\d)$/.exec(code))) return { code, name: `Num ${match[1]}`, vk: 96 + Number(match[1]) };
  if (NAMED[code]) return { code, name: NAMED[code][0] ?? char ?? code, vk: NAMED[code][1] };
  if ((match = /^Key([A-Z])$/.exec(code))) return { code, name: char ?? match[1], vk: match[1].charCodeAt(0) };
  if ((match = /^Digit(\d)$/.exec(code))) return { code, name: match[1], vk: 48 + Number(match[1]) };
  if ((match = /^F(\d{1,2})$/.exec(code)) && Number(match[1]) <= 24) return { code, name: code, vk: 111 + Number(match[1]) };
  // Outras teclas funcionam só com a janela em foco.
  return { code, name: char ?? code, vk: null };
}

// Código da tecla de um evento, no mesmo formato de keyFromEvent (para comparar com a gravada).
export const eventCode = (e) => (e.type.startsWith('mouse') ? MOUSE[e.button] ?? null : e.code);
