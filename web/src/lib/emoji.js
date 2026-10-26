// Emojis do seletor de reações (subconjunto, com palavras-chave em português para a busca).
export const EMOJI_CATEGORIES = [
  {
    name: 'Pessoas',
    emojis: [
      ['😀', 'sorriso feliz'], ['😃', 'feliz alegre'], ['😄', 'rindo feliz'], ['😁', 'sorrisao'], ['😆', 'gargalhada'],
      ['😅', 'suor nervoso'], ['😂', 'chorando de rir risada'], ['🤣', 'rolando de rir'], ['🙂', 'sorriso leve'], ['😉', 'piscada'],
      ['😊', 'corado feliz'], ['😇', 'anjo'], ['🥰', 'apaixonado coracoes'], ['😍', 'olhos de coracao amor'], ['😘', 'beijo'],
      ['😋', 'delicia'], ['😛', 'lingua'], ['😜', 'brincadeira lingua'], ['🤪', 'maluco'], ['🤔', 'pensando hmm'],
      ['🤨', 'desconfiado'], ['😐', 'neutro'], ['😑', 'sem expressao'], ['😶', 'sem boca'], ['🙄', 'revirando olhos'],
      ['😏', 'sorriso de lado'], ['😬', 'careta'], ['😌', 'aliviado'], ['😴', 'dormindo sono'], ['😷', 'mascara doente'],
      ['🤒', 'febre'], ['🤯', 'mente explodindo'], ['🥳', 'festa'], ['😎', 'oculos legal'], ['🤓', 'nerd'],
      ['😕', 'confuso'], ['😟', 'preocupado'], ['😮', 'surpreso uau'], ['😲', 'chocado'], ['😳', 'envergonhado'],
      ['🥺', 'por favor'], ['😢', 'chorando triste'], ['😭', 'chorando muito'], ['😱', 'grito medo'], ['😤', 'bufando'],
      ['😡', 'bravo raiva'], ['🤬', 'xingando'], ['💀', 'caveira morri'], ['🤡', 'palhaco'], ['👻', 'fantasma'],
      ['👍', 'joinha positivo sim'], ['👎', 'negativo nao'], ['👌', 'ok'], ['✌️', 'paz'], ['🤞', 'dedos cruzados sorte'],
      ['👏', 'palmas aplausos'], ['🙌', 'celebrar maos'], ['🙏', 'por favor obrigado reza'], ['💪', 'forca braco'], ['👀', 'olhos olhando'],
      ['👋', 'tchau oi aceno'], ['🤝', 'aperto de mao acordo'],
    ],
  },
  {
    name: 'Natureza',
    emojis: [
      ['🐶', 'cachorro'], ['🐱', 'gato'], ['🐭', 'rato'], ['🦊', 'raposa'], ['🐻', 'urso'], ['🐼', 'panda'],
      ['🐸', 'sapo'], ['🐵', 'macaco'], ['🦄', 'unicornio'], ['🐝', 'abelha'], ['🦋', 'borboleta'], ['🌸', 'flor cerejeira'],
      ['🌹', 'rosa'], ['🌻', 'girassol'], ['🌲', 'arvore'], ['🔥', 'fogo'], ['🌈', 'arco iris'], ['☀️', 'sol'],
      ['🌙', 'lua'], ['⭐', 'estrela'], ['⚡', 'raio'], ['❄️', 'neve'],
    ],
  },
  {
    name: 'Comidas',
    emojis: [
      ['🍎', 'maca'], ['🍌', 'banana'], ['🍉', 'melancia'], ['🍓', 'morango'], ['🍕', 'pizza'], ['🍔', 'hamburguer'],
      ['🍟', 'batata frita'], ['🌭', 'cachorro quente'], ['🍿', 'pipoca'], ['🍩', 'rosquinha'], ['🍪', 'biscoito'], ['🎂', 'bolo aniversario'],
      ['☕', 'cafe'], ['🍺', 'cerveja'], ['🍷', 'vinho'], ['🥤', 'refrigerante'],
    ],
  },
  {
    name: 'Atividades',
    emojis: [
      ['⚽', 'futebol bola'], ['🏀', 'basquete'], ['🎮', 'videogame jogo'], ['🎲', 'dado'], ['🎯', 'alvo'], ['🎸', 'guitarra'],
      ['🎧', 'fone musica'], ['🎉', 'festa confete'], ['🎁', 'presente'], ['🏆', 'trofeu'], ['🥇', 'medalha ouro'], ['🚀', 'foguete'],
    ],
  },
  {
    name: 'Símbolos',
    emojis: [
      ['❤️', 'coracao amor'], ['🧡', 'coracao laranja'], ['💛', 'coracao amarelo'], ['💚', 'coracao verde'], ['💙', 'coracao azul'],
      ['💜', 'coracao roxo'], ['🖤', 'coracao preto'], ['💔', 'coracao partido'], ['💯', 'cem'], ['✅', 'certo feito'],
      ['❌', 'errado x'], ['❓', 'pergunta'], ['❗', 'exclamacao'], ['⚠️', 'aviso'], ['💤', 'sono'], ['💬', 'balao fala'],
      ['➕', 'mais'], ['🆗', 'ok'],
    ],
  },
];

const ALL = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
const DEFAULT_RECENT = ['👍', '❤️', '😂', '😮'];

export function searchEmoji(query) {
  const q = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return ALL.filter(([, keywords]) => keywords.includes(q));
}

// Usados recentemente (mostrados no topo do seletor e no menu de 3 pontos).
export function recentEmoji() {
  try {
    const saved = JSON.parse(localStorage.getItem('recentEmoji') ?? '[]');
    return [...new Set([...saved, ...DEFAULT_RECENT])].slice(0, 8);
  } catch {
    return DEFAULT_RECENT;
  }
}

export function rememberEmoji(emoji) {
  try {
    const list = [emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, 8);
    localStorage.setItem('recentEmoji', JSON.stringify(list));
  } catch {
    // sem armazenamento: só não lembra
  }
}
