import type { Template } from '../types';

export const META_TEMPLATE_PROMPT = `你是法规解读方法论专家。下面是我收集的若干份我认为优秀的法规解读范文。
请分析它们共同的写作视角、详略与语气，提炼出一段"解读风格说明"，用于指导 AI 解读任意一部新法规。

重要：解读的输出结构与格式由系统固定（速览、出台背景、适用范围与义务主体、核心要点、重点义务、时间节点与行动、新旧变化、罚则、参考案例、合规建议等板块，统一以严格 JSON 输出）。你不需要、也不要自行定义板块清单或规定输出格式。

请只输出一段可直接使用的"解读风格说明"，包含：角色设定、解读视角、详略与侧重（对哪些板块更着重）、语气要求。不要包含任何 JSON、字段定义，或"请按以下结构输出"之类的话。

范文如下：
【在此粘贴你的范文】`;

// 用户可编辑的"解读风格"部分（默认模板）。只描述"怎么解读"，不含输出结构与文档占位符。
export const DEFAULT_REPORT_STYLE = `角色：你是资深中国法律法规解读专家，服务律所与企业合规团队。
解读风格：立足法律实践，既讲清"这部法在说什么"，也点明"对谁有影响、要做什么、有何风险"。语言准确、克制、通俗；重点突出核心义务、关键时间节点与合规风险。`;

const NULL_DISCIPLINE = `【空值纪律】
1. 信息缺失就填 null 或 []，禁止写"未给出""未明确""本段未给出"这类解释性整句。
2. 禁止编造占位值；如果文档本身是草案占位（如 GB/T XXXXX、〔XXXX〕X号、XX机关），对应字段填 null。
3. 不确定的内容宁可留空，不要用常识补齐硬事实。`;

export const METADATA_CONTRACT = `任务：阅读【待解读文档】，只抽取"标题 + 速览"元数据，仅输出严格 JSON（无任何多余文字、无 markdown 围栏）。

【准确性铁律】
1. 发布机关、日期、文号、效力层级、章条规模等硬事实必须来自文档原文。
2. 请优先在文首公告、标题、落款、附则、施行日期条款中查找。
3. 不要输出正文解读、义务、罚则、案例或合规建议。

${NULL_DISCIPLINE}

【输出 JSON 结构】
{
  "标题": "《XX》解读或null",
  "速览": {
    "发布机关": null,
    "发布日期": null,
    "施行日期": null,
    "文号": null,
    "效力层级": null,
    "章条规模": null,
    "上位法依据": [],
    "官方全文链接": null,
    "核心数字": [{"标签": "法定罚款区间", "值": "1-20万元"}]
  }
}`;

// 系统固定的"正文结构契约"：元数据由 METADATA_CONTRACT 单独抽取，本契约只抽正文板块，降低单次输出负担。
export const REPORT_STRUCTURE_CONTRACT = `任务：阅读【待解读文档】，按下方固定结构产出正文解读板块，仅输出严格 JSON（无任何多余文字、无 markdown 围栏）。

【准确性铁律】
1. 条款、义务、罚则、时间节点、义务主体等"硬事实"，必须严格来自文档原文，并标注条款出处（如"第8条"）。
2. 文档中没有、需依据你的知识补充的内容（出台背景、上位法关联、参考案例等）可以填写，但该项"来源"必须标为"AI补充"，提示人工核实。
3. 绝不编造具体判例细节；不确定的参考案例宁可留空（空数组）。
4. 找不到的字段填 null 或空数组，不得杜撰。

${NULL_DISCIPLINE}

【输出 JSON 结构】
{
  "出台背景与意义": {"正文":"", "来源":"文档/AI补充"},
  "适用范围与义务主体": {"适用范围":"", "义务主体":[{"主体":"", "影响等级":"极高/高/中", "定位":"一句话"}]},
  "框架结构": "几章几条、逻辑骨架",
  "核心要点解读": [{"标题":"", "原条款":"第X条", "解读":"大白话", "影响":""}],
  "重点义务清单": [{"主体":"", "义务":"", "条款出处":"第X条"}],
  "关键时间节点与行动清单": [{"事项":"", "依据":"第X条", "截止":"日期或X天内"}],
  "新旧变化": [{"类型":"新增/删除/修改", "说明":"", "条款":"第X条"}],
  "法律责任与罚则": [{"情形":"", "处罚":"", "条款":"第X条"}],
  "参考案例": [{"案例":"", "触犯条款":"", "结果":"", "来源":"AI补充·需核实"}],
  "合规建议": ["..."]
}
无内容的板块用 null 或 [] 表示。不要输出"标题"或"速览"字段。`;

export const defaultTemplate: Template = {
  id: 'builtin-general-report',
  name: '法规通用解读',
  description: '输出结构化 JSON，经人工核查后渲染为固定 HTML 页面和 Word 报告。',
  scope: '法律法规、部门规章、规范性文件、行业标准',
  prompt: DEFAULT_REPORT_STYLE,
  builtin: true,
  author: '明文',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

export const builtInTemplates: Template[] = [defaultTemplate];

export type SourceTagged = {
  来源?: string | null;
};

export type InterpretationReport = {
  标题: string | null;
  速览: {
    发布机关: string | null;
    发布日期: string | null;
    施行日期: string | null;
    文号: string | null;
    效力层级: string | null;
    章条规模: string | null;
    上位法依据: string[];
    官方全文链接: string | null;
    核心数字: Array<{ 标签: string | null; 值: string | null }>;
  };
  出台背景与意义: ({ 正文: string | null } & SourceTagged) | null;
  适用范围与义务主体: {
    适用范围: string | null;
    义务主体: Array<{ 主体: string | null; 影响等级: string | null; 定位: string | null }>;
  } | null;
  框架结构: string | null;
  核心要点解读: Array<{ 标题: string | null; 原条款: string | null; 解读: string | null; 影响: string | null }>;
  重点义务清单: Array<{ 主体: string | null; 义务: string | null; 条款出处: string | null }>;
  关键时间节点与行动清单: Array<{ 事项: string | null; 依据: string | null; 截止: string | null }>;
  新旧变化: Array<{ 类型: string | null; 说明: string | null; 条款: string | null }>;
  法律责任与罚则: Array<{ 情形: string | null; 处罚: string | null; 条款: string | null }>;
  参考案例: Array<{ 案例: string | null; 触犯条款: string | null; 结果: string | null; 来源: string | null }>;
  合规建议: string[];
};

export type ReportProgress = {
  stage: 'idle' | 'extracting' | 'merging' | 'review' | 'done' | 'error';
  message: string;
  done: number;
  total: number;
};

export const REPORT_CHUNK_SIZE = 120_000;

export function buildStructuredPrompt(template: Template, documentText: string): string {
  return buildBodyPrompt(template, documentText);
}

export function buildMetadataPrompt(template: Template, documentText: string): string {
  // 模板只贡献"解读风格"；结构契约由系统强制拼接，保证任何模板都输出同一套 JSON 结构。
  const style = template.prompt.split('{{文档全文}}').join('').trim();
  return [style, '', METADATA_CONTRACT, '', '【待解读文档】：', documentText.trim()].join('\n');
}

export function buildBodyPrompt(template: Template, documentText: string): string {
  const style = template.prompt.split('{{文档全文}}').join('').trim();
  return [style, '', REPORT_STRUCTURE_CONTRACT, '', '【待解读文档】：', documentText.trim()].join('\n');
}

// 渲染兜底：判断 AI 返回的报告是否基本为空/跑偏（用于触发重试或提示，避免静默白板）。
export function isReportEmpty(report: InterpretationReport): boolean {
  const o = report.速览;
  const hasOverview = Boolean(
    report.标题 || o.发布机关 || o.施行日期 || o.文号 || o.章条规模 || o.上位法依据.length || o.核心数字.length
  );
  const hasBody =
    Boolean(report.出台背景与意义?.正文) ||
    Boolean(report.适用范围与义务主体?.适用范围) ||
    (report.适用范围与义务主体?.义务主体.length ?? 0) > 0 ||
    Boolean(report.框架结构) ||
    report.核心要点解读.length > 0 ||
    report.重点义务清单.length > 0 ||
    report.关键时间节点与行动清单.length > 0 ||
    report.新旧变化.length > 0 ||
    report.法律责任与罚则.length > 0 ||
    report.参考案例.length > 0 ||
    report.合规建议.length > 0;
  return !hasOverview && !hasBody;
}

export function buildChunkStructuredPrompt(template: Template, chunk: string, index: number, total: number): string {
  return buildBodyChunkPrompt(template, chunk, index, total);
}

export function buildBodyChunkPrompt(template: Template, chunk: string, index: number, total: number): string {
  return [
    buildBodyPrompt(template, chunk),
    '',
    `注意：这是长文档的第 ${index + 1} / ${total} 段。只抽取本段能够支持的 JSON 内容；不要补全其他段信息。`
  ].join('\n');
}

export function splitTextForModel(text: string, chunkSize = REPORT_CHUNK_SIZE): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    if (end < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf('\n\n', end);
      const lineBreak = normalized.lastIndexOf('\n', end);
      const boundary = paragraphBreak > start + chunkSize * 0.6 ? paragraphBreak : lineBreak > start + chunkSize * 0.6 ? lineBreak : end;
      end = boundary;
    }
    chunks.push(normalized.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}

export function parseInterpretationJson(text: string): InterpretationReport {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI 未返回 JSON 对象');
  const jsonText = cleaned.slice(start, end + 1);
  const candidates = [jsonText, repairLooseJson(jsonText)];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return normalizeReport(parsed);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 返回的 JSON 无法解析');
}

function repairLooseJson(text: string): string {
  return text
    .replace(/，/g, ',')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/("[^"\\]*(?:\\.[^"\\]*)*")\s*(?="[^"]+"\s*:)/g, '$1,')
    .replace(/([}\]])\s*(?="[^"]+"\s*:)/g, '$1,');
}

export function normalizeReport(value: unknown): InterpretationReport {
  const source = objectValue(value);
  const overview = objectValue(source.速览);
  const background = source.出台背景与意义 == null ? null : objectValue(source.出台背景与意义);
  const scope = source.适用范围与义务主体 == null ? null : objectValue(source.适用范围与义务主体);
  return {
    标题: nullableString(source.标题),
    速览: {
      发布机关: nullableString(overview.发布机关),
      发布日期: nullableString(overview.发布日期),
      施行日期: nullableString(overview.施行日期),
      文号: nullableString(overview.文号),
      效力层级: nullableString(overview.效力层级),
      章条规模: nullableString(overview.章条规模),
      上位法依据: stringArray(overview.上位法依据),
      官方全文链接: nullableString(overview.官方全文链接),
      核心数字: objectArray(overview.核心数字).map((item) => ({ 标签: nullableString(item.标签), 值: nullableString(item.值) }))
    },
    出台背景与意义: background
      ? { 正文: nullableString(background.正文), 来源: nullableString(background.来源) }
      : null,
    适用范围与义务主体: scope
      ? {
          适用范围: nullableString(scope.适用范围),
          义务主体: objectArray(scope.义务主体).map((item) => ({
            主体: nullableString(item.主体),
            影响等级: nullableString(item.影响等级),
            定位: nullableString(item.定位)
          }))
        }
      : null,
    框架结构: nullableString(source.框架结构),
    核心要点解读: objectArray(source.核心要点解读).map((item) => ({
      标题: nullableString(item.标题),
      原条款: nullableString(item.原条款),
      解读: nullableString(item.解读),
      影响: nullableString(item.影响)
    })),
    重点义务清单: objectArray(source.重点义务清单).map((item) => ({
      主体: nullableString(item.主体),
      义务: nullableString(item.义务),
      条款出处: nullableString(item.条款出处)
    })),
    关键时间节点与行动清单: objectArray(source.关键时间节点与行动清单).map((item) => ({
      事项: nullableString(item.事项),
      依据: nullableString(item.依据),
      截止: nullableString(item.截止)
    })),
    新旧变化: objectArray(source.新旧变化).map((item) => ({
      类型: nullableString(item.类型),
      说明: nullableString(item.说明),
      条款: nullableString(item.条款)
    })),
    法律责任与罚则: objectArray(source.法律责任与罚则).map((item) => ({
      情形: nullableString(item.情形),
      处罚: nullableString(item.处罚),
      条款: nullableString(item.条款)
    })),
    参考案例: objectArray(source.参考案例).map((item) => ({
      案例: nullableString(item.案例),
      触犯条款: nullableString(item.触犯条款),
      结果: nullableString(item.结果),
      来源: nullableString(item.来源)
    })),
    合规建议: stringArray(source.合规建议)
  };
}

export function mergeReports(reports: InterpretationReport[]): InterpretationReport {
  const normalized = reports.map(normalizeReport);
  const first = normalized[0] ?? emptyReport();
  return normalizeReport({
    标题: firstFilled(normalized.map((item) => item.标题)),
    速览: {
      发布机关: firstFilled(normalized.map((item) => item.速览.发布机关)),
      发布日期: firstFilled(normalized.map((item) => item.速览.发布日期)),
      施行日期: firstFilled(normalized.map((item) => item.速览.施行日期)),
      文号: firstFilled(normalized.map((item) => item.速览.文号)),
      效力层级: firstFilled(normalized.map((item) => item.速览.效力层级)),
      章条规模: firstFilled(normalized.map((item) => item.速览.章条规模)),
      上位法依据: unique(normalized.flatMap((item) => item.速览.上位法依据)),
      官方全文链接: firstFilled(normalized.map((item) => item.速览.官方全文链接)),
      核心数字: normalized.flatMap((item) => item.速览.核心数字)
    },
    出台背景与意义: first.出台背景与意义,
    适用范围与义务主体: {
      适用范围: firstFilled(normalized.map((item) => item.适用范围与义务主体?.适用范围)),
      义务主体: normalized.flatMap((item) => item.适用范围与义务主体?.义务主体 ?? [])
    },
    框架结构: firstFilled(normalized.map((item) => item.框架结构)),
    核心要点解读: normalized.flatMap((item) => item.核心要点解读),
    重点义务清单: normalized.flatMap((item) => item.重点义务清单),
    关键时间节点与行动清单: normalized.flatMap((item) => item.关键时间节点与行动清单),
    新旧变化: normalized.flatMap((item) => item.新旧变化),
    法律责任与罚则: normalized.flatMap((item) => item.法律责任与罚则),
    参考案例: normalized.flatMap((item) => item.参考案例),
    合规建议: unique(normalized.flatMap((item) => item.合规建议))
  });
}

export function mergeMetadataAndBody(metadata: InterpretationReport, body: InterpretationReport): InterpretationReport {
  return normalizeReport({
    ...body,
    标题: metadata.标题,
    速览: metadata.速览
  });
}

export function isMetadataMissing(report: InterpretationReport): boolean {
  return !report.标题 && !report.速览.发布机关 && !report.速览.施行日期;
}

export function emptyReport(): InterpretationReport {
  return {
    标题: null,
    速览: {
      发布机关: null,
      发布日期: null,
      施行日期: null,
      文号: null,
      效力层级: null,
      章条规模: null,
      上位法依据: [],
      官方全文链接: null,
      核心数字: []
    },
    出台背景与意义: null,
    适用范围与义务主体: null,
    框架结构: null,
    核心要点解读: [],
    重点义务清单: [],
    关键时间节点与行动清单: [],
    新旧变化: [],
    法律责任与罚则: [],
    参考案例: [],
    合规建议: []
  };
}

export function isAiSupplement(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some((item) => typeof item === 'string' && item.includes('AI补充'));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(objectValue) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(nullableString).filter((item): item is string => Boolean(item)) : [];
}

function nullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || /^null$/i.test(text) || /^undefined$/i.test(text)) return null;
  if (/^(无|暂无|不适用|未给出|未明确|待定|N\/A)$/i.test(text)) return null;
  if (/本段未给出|占位符|未给出（|未明确（/.test(text)) return null;
  if (/^GB\/T\s*[XxＸ×]{3,}$/i.test(text)) return null;
  if (/^〔?[XxＸ×]{3,}〕?[XxＸ×]*号?$/.test(text)) return null;
  if (/^[XxＸ×]{2,}(?:机关|部门|单位|文件)?$/.test(text)) return null;
  return text;
}

function firstFilled(values: Array<string | null | undefined>): string | null {
  return values.find((item) => item && item.trim()) ?? null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}
