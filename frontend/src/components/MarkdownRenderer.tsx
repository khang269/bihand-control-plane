import React from 'react';

interface MarkdownProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownProps> = ({ content }) => {
  if (!content) return <span className="text-muted-foreground italic">No content provided.</span>;

  // Regex to split by code blocks: ```[language]\n[code]\n```
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="markdown-body space-y-4 text-sm text-foreground leading-relaxed">
      {parts.map((part, index) => {
        if (part.startsWith('```')) {
          // It's a code block - kept on a fixed dark treatment (like WindowFrame) for legibility
          // regardless of site theme.
          const lines = part.split('\n');
          const firstLine = lines[0].replace('```', '').trim();
          const language = firstLine || 'code';
          const code = lines.slice(1, lines.length - 1).join('\n');

          return (
            <div key={index} className="my-4 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
              <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-400 font-mono select-none">
                <span>{language.toUpperCase()}</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(code)}
                  className="hover:text-zinc-100 transition-colors"
                >
                  Copy
                </button>
              </div>
              <pre className="p-4 overflow-x-auto font-mono text-xs text-zinc-100 leading-normal scrollbar-thin">
                <code>{code}</code>
              </pre>
            </div>
          );
        } else {
          // Standard text with headers, lists, bold, inline code, links
          const lines = part.split('\n');
          const renderedElements: React.ReactNode[] = [];
          let listBuffer: React.ReactNode[] = [];
          let currentListType: 'ul' | 'ol' | null = null;

          const flushList = (key: string) => {
            if (listBuffer.length > 0) {
              if (currentListType === 'ol') {
                renderedElements.push(
                  <ol key={`ol-${key}`} className="list-decimal pl-6 my-2 space-y-1.5 text-foreground">
                    {listBuffer}
                  </ol>
                );
              } else {
                renderedElements.push(
                  <ul key={`ul-${key}`} className="list-disc pl-6 my-2 space-y-1.5 text-foreground">
                    {listBuffer}
                  </ul>
                );
              }
              listBuffer = [];
              currentListType = null;
            }
          };

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // 1. Headers
            if (trimmed.startsWith('# ')) {
              flushList(`h1-${i}`);
              renderedElements.push(
                <h1 key={i} className="text-xl font-bold text-foreground border-b border-border pb-1 mt-6 mb-3">
                  {renderInlineFormatting(trimmed.substring(2))}
                </h1>
              );
            } else if (trimmed.startsWith('## ')) {
              flushList(`h2-${i}`);
              renderedElements.push(
                <h2 key={i} className="text-lg font-bold text-foreground mt-5 mb-2 border-b border-border/40 pb-1">
                  {renderInlineFormatting(trimmed.substring(3))}
                </h2>
              );
            } else if (trimmed.startsWith('### ')) {
              flushList(`h3-${i}`);
              renderedElements.push(
                <h3 key={i} className="text-md font-semibold text-foreground mt-4 mb-1">
                  {renderInlineFormatting(trimmed.substring(4))}
                </h3>
              );
            } else if (trimmed.startsWith('#### ')) {
              flushList(`h4-${i}`);
              renderedElements.push(
                <h4 key={i} className="text-sm font-semibold text-foreground mt-3 mb-1">
                  {renderInlineFormatting(trimmed.substring(5))}
                </h4>
              );
            }
            // 2. Horizontal Rules
            else if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
              flushList(`hr-${i}`);
              renderedElements.push(<hr key={i} className="border-border my-6" />);
            }
            // 3. Bullet lists (- or * or +)
            else if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('+ ')) {
              if (currentListType !== 'ul') {
                flushList(`list-switch-ul-${i}`);
                currentListType = 'ul';
              }
              listBuffer.push(
                <li key={`li-${i}`} className="pl-1 leading-relaxed">
                  {renderInlineFormatting(trimmed.substring(2))}
                </li>
              );
            }
            // 4. Ordered lists (1. 2. etc.)
            else if (/^\d+\.\s/.test(trimmed)) {
              if (currentListType !== 'ol') {
                flushList(`list-switch-ol-${i}`);
                currentListType = 'ol';
              }
              const contentText = trimmed.replace(/^\d+\.\s/, '');
              listBuffer.push(
                <li key={`li-ol-${i}`} className="pl-1 leading-relaxed">
                  {renderInlineFormatting(contentText)}
                </li>
              );
            }
            // 5. Blockquotes (>)
            else if (trimmed.startsWith('>')) {
              flushList(`blockquote-${i}`);
              const contentText = trimmed.replace(/^>\s?/, '');
              renderedElements.push(
                <blockquote key={i} className="border-l-4 border-purple-500/40 bg-purple-500/5 px-4 py-2.5 my-3 rounded-r text-muted-foreground italic">
                  {renderInlineFormatting(contentText)}
                </blockquote>
              );
            }
            // 6. Empty Line
            else if (trimmed === '') {
              flushList(`empty-${i}`);
              renderedElements.push(<div key={i} className="h-2" />);
            }
            // 7. Regular Paragraph
            else {
              flushList(`para-${i}`);
              renderedElements.push(
                <p key={i} className="leading-relaxed mb-2 text-foreground">
                  {renderInlineFormatting(line)}
                </p>
              );
            }
          }
          // Flush any final list elements remaining in buffer
          flushList(`final-${index}`);

          return <React.Fragment key={index}>{renderedElements}</React.Fragment>;
        }
      })}
    </div>
  );
};

// Helper function to render bold, italics, inline code, and clickable URL links
function renderInlineFormatting(text: string): React.ReactNode {
  if (!text) return '';

  // 1. Process inline code blocks: `code`
  // 2. Process bold: **text**
  // 3. Process URLs: http:// or https://

  // A combined tokenizer that identifies all three
  const regex = /(\*\*.*?\*\*|`.*?`|https?:\/\/[^\s]+)/g;
  const parts = text.split(regex);

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-secondary border border-border px-1.5 py-0.5 rounded text-xs font-mono text-pink-600 dark:text-pink-400 font-semibold mx-0.5">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline font-medium hover:underline break-all mx-0.5"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}
