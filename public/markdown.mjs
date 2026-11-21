// Markdown 解析：块级（段落/标题/列表/代码/表格/引用/分隔线）与行内（粗体/代码/链接）。
export function parseMarkdownBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
      paragraph = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushParagraph();
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', text: code.join('\n') });
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
      flushParagraph();
      const header = splitTableRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+/);
    if (/^\s*[-*•]\s+/.test(line) || ordered) {
      flushParagraph();
      const items = [];
      const isOrdered = Boolean(ordered);
      while (i < lines.length) {
        const unorderedMatch = lines[i].match(/^\s*[-*•]\s+(.*)$/);
        const orderedMatch = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (isOrdered ? !orderedMatch : !unorderedMatch) break;
        items.push(isOrdered ? orderedMatch[1] : unorderedMatch[1]);
        i += 1;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    if (trimmed === '') {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraph.push(line);
    i += 1;
  }
  flushParagraph();
  return blocks;
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function parseInline(text) {
  const tokens = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`\n]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let lastIndex = 0;
  for (const match of String(text || '').matchAll(pattern)) {
    if (match.index > lastIndex) tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    const token = match[0];
    if (token.startsWith('**')) {
      tokens.push({ type: 'bold', text: token.slice(2, -2) });
    } else if (token.startsWith('`')) {
      tokens.push({ type: 'code', text: token.slice(1, -1) });
    } else {
      const m = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      tokens.push({ type: 'link', text: m[1], href: m[2] });
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) tokens.push({ type: 'text', text: text.slice(lastIndex) });
  return tokens;
}

export function isSafeLink(href) {
  return /^https?:\/\//i.test(href) || href.startsWith('/');
}
