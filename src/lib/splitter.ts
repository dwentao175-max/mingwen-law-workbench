import type { Article, SplitResult } from '../types';

const ARTICLE_RE = /^\s*(第[一二三四五六七八九十百千零〇\d]+条)\s*(.*)$/;
const CHAPTER_RE = /^\s*(第[一二三四五六七八九十百千零〇\d]+章.*)$/;

export function splitArticles(text: string): SplitResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const preface: string[] = [];
  const articles: Article[] = [];
  let currentChapter: string | null = null;
  let current: DraftArticle | null = null;
  let seenFirstArticle = false;

  const flush = () => {
    if (!current) return;
    const textBody = current.lines.join('\n').trim();
    articles.push({
      id: cryptoSafeId(),
      number: current.number,
      chapter: current.chapter,
      text: textBody,
      raw: `${current.number ?? ''} ${textBody}`.trim()
    });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const chapterMatch = line.match(CHAPTER_RE);
    if (chapterMatch) {
      flush();
      currentChapter = chapterMatch[1].trim();
      if (!seenFirstArticle) preface.push(rawLine);
      continue;
    }

    const articleMatch = line.match(ARTICLE_RE);
    if (articleMatch) {
      flush();
      seenFirstArticle = true;
      current = {
        number: articleMatch[1],
        chapter: currentChapter,
        lines: articleMatch[2] ? [articleMatch[2].trim()] : []
      };
      continue;
    }

    if (!seenFirstArticle) {
      if (line) preface.push(rawLine);
    } else if (current) {
      current.lines.push(rawLine.trimEnd());
    }
  }

  flush();
  return { preface: preface.join('\n').trim(), articles };
}

type DraftArticle = {
  number: string | null;
  chapter: string | null;
  lines: string[];
};

export function makeArticle(number: string | null, text: string, chapter: string | null = null): Article {
  return {
    id: cryptoSafeId(),
    number,
    chapter,
    text: text.trim(),
    raw: `${number ?? ''} ${text}`.trim()
  };
}

function cryptoSafeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `article-${Math.random().toString(36).slice(2)}`;
}
