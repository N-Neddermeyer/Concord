import { useState } from 'react';
import { parseMessageLink } from '../lib/messages.js';
import { HOME, jumpToMessage } from '../lib/store.js';
import { displayName } from '../lib/util.js';

// Markdown do Discord: **negrito**, *itálico* / _itálico_, __sublinhado__, ~~riscado~~, ||spoiler||,
// `código`, ```bloco```, > citação, >>> citação até o fim, # títulos, -# subtexto, listas,
// [texto](link), <link> e \escape. Mesma precedência das regras do simple-markdown do Discord.

const INLINE = [
  ['escape', /^\\([^0-9A-Za-z\s])/],
  ['code', /^(`+)([\s\S]*?[^`])\1(?!`)/],
  ['spoiler', /^\|\|([\s\S]+?)\|\|/],
  ['autolink', /^<(https?:\/\/[^\s>]+)>/],
  ['link', /^\[([^[\]]+)\]\(<?(https?:\/\/[^\s)>]+)>?\)/],
  ['url', /^https?:\/\/[^\s<]+[^<.,:;"')\]\s]/],
  ['everyone', /^@(everyone|here)(?![\w.])/],
  ['mention', /^@([\w.]{2,32})/],
  ['channel', /^#([\w-]{1,100})/],
  ['strong', /^\*\*([\s\S]+?)\*\*(?!\*)/],
  ['underline', /^__([\s\S]+?)__(?!_)/],
  ['em', /^\*(?=\S)((?:\*\*[\s\S]+?\*\*|[\s\S])+?)\*(?!\*)/],
  ['em', /^_((?:__|\\[\s\S]|[^\\_])+?)_(?![\p{L}\p{N}_])/u],
  ['strike', /^~~([\s\S]+?)~~/],
  ['text', /^[\s\S]+?(?=[\\`|<[@#*_~]|https?:\/\/|$)/],
];

function Spoiler({ children }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      className={`spoiler${shown ? ' shown' : ''}`}
      role={shown ? undefined : 'button'}
      aria-label={shown ? undefined : 'Spoiler'}
      onClick={(e) => {
        if (shown) return;
        e.stopPropagation();
        setShown(true);
      }}
    >
      <span className="spoiler-content" aria-hidden={!shown}>{children}</span>
    </span>
  );
}

function Link({ href, children }) {
  const internal = parseMessageLink(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={typeof children === 'string' && children !== href ? href : undefined}
      onClick={internal ? (e) => {
        e.preventDefault();
        jumpToMessage(internal.guildId === '@me' ? HOME : internal.guildId, internal.channelId, internal.messageId);
      } : undefined}
    >
      {children}
    </a>
  );
}

function inline(text, ctx, out = []) {
  let rest = text;
  while (rest) {
    let matched = false;
    for (const [type, re] of INLINE) {
      const m = rest.match(re);
      if (!m) continue;
      const node = renderInline(type, m, ctx, out.length);
      if (node === undefined) continue; // regra não se aplica aqui (ex.: @nome que não existe)
      out.push(node);
      rest = rest.slice(m[0].length);
      matched = true;
      break;
    }
    if (!matched) {
      out.push(rest[0]);
      rest = rest.slice(1);
    }
  }
  return out;
}

function renderInline(type, m, ctx, key) {
  switch (type) {
    case 'escape':
    case 'text':
      return type === 'escape' ? m[1] : m[0];
    case 'code':
      return <code key={key} className="inline-code">{m[2].trim() ? m[2].replace(/^ (.*) $/s, '$1') : m[2]}</code>;
    case 'spoiler':
      return <Spoiler key={key}>{inline(m[1], ctx)}</Spoiler>;
    case 'autolink':
    case 'url':
      return ctx.plain ? <span key={key} className="md-link">{m[1] ?? m[0]}</span> : <Link key={key} href={m[1] ?? m[0]}>{m[1] ?? m[0]}</Link>;
    case 'link':
      return ctx.plain ? <span key={key} className="md-link">{inline(m[1], ctx)}</span> : <Link key={key} href={m[2]}>{inline(m[1], ctx)}</Link>;
    case 'everyone':
      return ctx.guildId ? <span key={key} className="mention everyone">@{m[1]}</span> : undefined;
    case 'mention': {
      const user = ctx.usersByName?.get(m[1].toLowerCase());
      if (!user) return undefined;
      if (ctx.plain) return <span key={key} className="mention">@{displayName(user)}</span>;
      return <button key={key} className="mention" onClick={(e) => ctx.onMention?.(user.id, e)}>@{displayName(user)}</button>;
    }
    case 'channel': {
      const channel = ctx.channelsByName?.get(m[1].toLowerCase());
      if (!channel) return undefined;
      if (ctx.plain) return <span key={key} className="mention channel-mention">#{channel.name}</span>;
      return <button key={key} className="mention channel-mention" onClick={() => ctx.onChannel?.(channel)}>#{channel.name}</button>;
    }
    case 'strong':
      return <strong key={key}>{inline(m[1], ctx)}</strong>;
    case 'underline':
      return <u key={key}>{inline(m[1], ctx)}</u>;
    case 'em':
      return <em key={key}>{inline(m[1], ctx)}</em>;
    case 'strike':
      return <s key={key}>{inline(m[1], ctx)}</s>;
    default:
      return undefined;
  }
}

// --- blocos ---

const CODE_BLOCK = /```(?:([\w+#.-]+)\n)?\n*([\s\S]*?)\n*```/g;
const LIST_ITEM = /^( *)([-*]|\d{1,9}\.) +(.*)$/;

function blocks(text, ctx, depth = 0) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(CODE_BLOCK)) {
    if (!m[2] && !m[1]) continue;
    lineBlocks(text.slice(last, m.index).replace(/\n$/, ''), ctx, depth, out);
    out.push(
      <pre key={out.length} className="code-block"><code data-lang={m[1] || undefined}>{m[2]}</code></pre>,
    );
    last = m.index + m[0].length;
    if (text[last] === '\n') last++;
  }
  lineBlocks(text.slice(last), ctx, depth, out);
  return out;
}

function lineBlocks(text, ctx, depth, out) {
  if (!text) return;
  const lines = text.split('\n');
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    out.push(<span key={out.length} className="md-text">{inline(paragraph.join('\n'), ctx)}</span>);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (depth === 0 && (m = line.match(/^>>> ?([\s\S]*)$/))) {
      flush();
      const rest = [m[1], ...lines.slice(i + 1)].join('\n');
      out.push(<blockquote key={out.length}>{blocks(rest, ctx, 1)}</blockquote>);
      return;
    }
    if (depth === 0 && /^> /.test(line)) {
      flush();
      const quoted = [];
      while (i < lines.length && /^> /.test(lines[i])) quoted.push(lines[i++].slice(2));
      i--;
      out.push(<blockquote key={out.length}>{blocks(quoted.join('\n'), ctx, 1)}</blockquote>);
      continue;
    }
    if ((m = line.match(/^(#{1,3}) +(\S.*)$/))) {
      flush();
      const Tag = `h${m[1].length}`;
      out.push(<Tag key={out.length} className="md-heading">{inline(m[2], ctx)}</Tag>);
      continue;
    }
    if ((m = line.match(/^-# +(\S.*)$/))) {
      flush();
      out.push(<small key={out.length} className="md-subtext">{inline(m[1], ctx)}</small>);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && (m = lines[i].match(LIST_ITEM))) {
        const item = { level: Math.min(Math.floor(m[1].length / 2), 10), ordered: /\d/.test(m[2]), start: parseInt(m[2], 10), text: m[3] };
        // Trocar entre "- " e "1. " no nível de cima começa outra lista.
        if (items.length && item.level === 0 && item.ordered !== items[0].ordered) break;
        items.push(item);
        i++;
      }
      i--;
      out.push(<List key={out.length} items={items} ctx={ctx} />);
      continue;
    }
    paragraph.push(line);
  }
  flush();
}

// Itens com recuo de 2 espaços viram sublista do item anterior.
function List({ items, ctx, level = 0 }) {
  const groups = [];
  for (const item of items) {
    if (item.level > level && groups.length) groups.at(-1).children.push(item);
    else groups.push({ ...item, children: [] });
  }
  const ordered = groups[0]?.ordered;
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className="md-list" start={ordered && groups[0].start !== 1 ? groups[0].start : undefined}>
      {groups.map((g, i) => (
        <li key={i}>
          {inline(g.text, ctx)}
          {g.children.length > 0 && <List items={g.children} ctx={ctx} level={level + 1} />}
        </li>
      ))}
    </Tag>
  );
}

// Mensagem só com emojis (até 27): emojis grandes, como no Discord.
const ONLY_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|\s)+$/u;
export function isJumbo(text) {
  if (!ONLY_EMOJI.test(text)) return false;
  const count = [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(text)].filter((s) => s.segment.trim()).length;
  return count > 0 && count <= 27;
}

export default function Markdown({ text, ...ctx }) {
  return <>{blocks(text, ctx)}</>;
}

// Versão de uma linha (prévia de resposta): só formatação inline, sem nada clicável.
export function InlineMarkdown({ text, ...ctx }) {
  return <>{inline(text.replace(/\n+/g, ' '), { ...ctx, plain: true })}</>;
}
