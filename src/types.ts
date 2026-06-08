export type Article = {
  id: string;
  number: string | null;
  chapter: string | null;
  text: string;
  raw: string;
};

export type AlignRow = {
  left: Article | null;
  right: Article | null;
  type: 'matched' | 'inserted' | 'deleted';
  similarity: number;
  moved?: boolean;
};

export type SplitResult = {
  preface: string;
  articles: Article[];
};

export type ParsedDocument = {
  text: string;
  pageCount?: number;
  warning?: string;
};

export type FieldDef = {
  key: string;
  label: string;
  instruction: string;
  fillBy: 'ai' | 'manual';
};

export type Template = {
  id: string;
  name: string;
  description: string;
  scope: string;
  prompt: string;
  builtin: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateTrashItem = {
  id: string;
  template: Template;
  removedAt: string;
  removedBy: string;
  reason: 'deleted' | 'edited';
};

export type TemplateTrashUsage = {
  bytes: number;
  maxBytes: number;
  percent: number;
  count: number;
};

export type Obligation = {
  id: string;
  articleNumber: string | null;
  articleText: string;
  chapter?: string | null;
  important?: boolean;
  values: Record<string, string>;
};
