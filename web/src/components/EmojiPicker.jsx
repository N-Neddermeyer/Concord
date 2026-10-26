import { Search } from 'lucide-react';
import { useState } from 'react';
import { EMOJI_CATEGORIES, recentEmoji, searchEmoji } from '../lib/emoji.js';

// Seletor de emoji para reações: busca, usados recentemente e categorias.
export default function EmojiPicker({ onPick, close }) {
  const [query, setQuery] = useState('');
  const pick = (emoji) => {
    onPick(emoji);
    close();
  };

  const sections = query.trim()
    ? [{ name: 'Resultados', emojis: searchEmoji(query) }]
    : [{ name: 'Usados recentemente', emojis: recentEmoji().map((e) => [e, '']) }, ...EMOJI_CATEGORIES];

  return (
    <div className="emoji-picker">
      <div className="emoji-search">
        <input placeholder="Encontre o emoji perfeito" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
        <Search size={16} />
      </div>
      <div className="emoji-sections">
        {sections.map((section) => (
          <section key={section.name}>
            <h3>{section.name}</h3>
            <div className="emoji-grid">
              {section.emojis.map(([emoji, keywords]) => (
                <button key={emoji} className="emoji-button" title={keywords.split(' ')[0] || emoji} onClick={() => pick(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
        {query.trim() && !sections[0].emojis.length && <p className="muted center">Nenhum emoji encontrado.</p>}
      </div>
    </div>
  );
}
