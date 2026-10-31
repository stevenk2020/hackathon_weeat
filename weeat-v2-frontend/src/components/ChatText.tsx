import { Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <Fragment key={index}>{part}</Fragment>);
}

export function ChatText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    const bullet = lines[i].match(/^\s*[-*•]\s+(.+)$/);
    const number = lines[i].match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (bullet || number) {
      const ordered = Boolean(number), items: ReactNode[] = [];
      const start = number ? Number(number[1]) : 1;
      while (i < lines.length) {
        const match = ordered ? lines[i].match(/^\s*\d+[.)]\s+(.+)$/) : lines[i].match(/^\s*[-*•]\s+(.+)$/);
        if (!match) break;
        items.push(<li key={i}>{inline(match[1])}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={i} start={start}>{items}</ol> : <ul key={i}>{items}</ul>);
      continue;
    }
    const paragraph: ReactNode[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(?:[-*•]|\d+[.)])\s+/.test(lines[i])) {
      if (paragraph.length) paragraph.push(<br key={`br-${i}`}/>);
      paragraph.push(<Fragment key={i}>{inline(lines[i])}</Fragment>);
      i++;
    }
    blocks.push(<p key={i}>{paragraph}</p>);
  }
  return <div className="chat-text">{blocks}</div>;
}
