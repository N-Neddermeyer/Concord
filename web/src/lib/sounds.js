import { getSettings } from './settings.js';

// Efeitos sonoros sintetizados (o Discord usa arquivos próprios; aqui são tons simples).
// Cada tom: [frequência, início, duração] em segundos.
const TONES = {
  message: [[880, 0, 0.08], [1320, 0.07, 0.12]],
  join: [[523, 0, 0.1], [784, 0.09, 0.16]],
  leave: [[784, 0, 0.1], [523, 0.09, 0.16]],
  mute: [[660, 0, 0.07], [440, 0.06, 0.1]],
  unmute: [[440, 0, 0.07], [660, 0.06, 0.1]],
  // Toque de chamada recebida: arpejo curto repetido duas vezes.
  ringing: [[784, 0, 0.12], [988, 0.13, 0.12], [1175, 0.26, 0.2], [784, 0.6, 0.12], [988, 0.73, 0.12], [1175, 0.86, 0.2]],
  // "Chamando…" do lado de quem liga: dois bipes graves.
  calling: [[440, 0, 0.35], [440, 0.5, 0.35]],
};

const LOOP_INTERVAL = { ringing: 2200, calling: 2600 };

let context = null;
const loops = new Map(); // nome -> timer

function play(name, volume = 0.15) {
  try {
    context ??= new AudioContext();
    context.resume().catch(() => {});
    const start = context.currentTime;
    for (const [freq, offset, duration] of TONES[name]) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(volume, start + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
      osc.connect(gain).connect(context.destination);
      osc.start(start + offset);
      osc.stop(start + offset + duration + 0.02);
    }
  } catch {
    // sem áudio disponível (ex.: navegador bloqueou o AudioContext)
  }
}

export function playSound(name) {
  if (getSettings().sounds && TONES[name]) play(name);
}

// Toques de chamada repetem até stopLoop (ou até outro toque assumir).
export function startLoop(name) {
  if (loops.has(name) || !getSettings().sounds) return;
  play(name, 0.12);
  loops.set(name, setInterval(() => play(name, 0.12), LOOP_INTERVAL[name]));
}

export function stopLoop(name) {
  clearInterval(loops.get(name));
  loops.delete(name);
}
