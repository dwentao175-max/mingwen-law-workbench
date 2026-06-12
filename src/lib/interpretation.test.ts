import { describe, expect, it } from 'vitest';
import {
  buildBodyPrompt,
  buildChunkStructuredPrompt,
  buildMetadataPrompt,
  buildStructuredPrompt,
  defaultTemplate,
  isMetadataMissing,
  isAiSupplement,
  mergeMetadataAndBody,
  mergeReports,
  parseInterpretationJson,
  REPORT_CHUNK_SIZE,
  splitTextForModel
} from './interpretation';

describe('structured interpretation prompt construction', () => {
  it('injects document text into the builtin template', () => {
    const prompt = buildStructuredPrompt(defaultTemplate, '第一条 测试法规正文');

    expect(prompt).not.toContain('{{');
    expect(prompt).toContain('第一条 测试法规正文');
    expect(prompt).toContain('仅输出严格 JSON');
  });

  it('builds chunk prompts for long documents', () => {
    const prompt = buildChunkStructuredPrompt(defaultTemplate, '第二条 分段正文', 1, 3);

    expect(prompt).toContain('第 2 / 3 段');
    expect(prompt).toContain('分段正文');
  });

  it('separates metadata and body extraction contracts', () => {
    const metadataPrompt = buildMetadataPrompt(defaultTemplate, '法规全文');
    const bodyPrompt = buildBodyPrompt(defaultTemplate, '法规全文');

    expect(metadataPrompt).toContain('"标题"');
    expect(metadataPrompt).toContain('"速览"');
    expect(metadataPrompt).not.toContain('"核心要点解读"');
    expect(bodyPrompt).toContain('"核心要点解读"');
    expect(bodyPrompt).not.toContain('"速览":');
  });
});

describe('parseInterpretationJson', () => {
  it('normalizes valid JSON into the report schema', () => {
    const report = parseInterpretationJson('{"标题":"测试解读","速览":{"施行日期":"2026年6月8日"},"核心要点解读":[{"标题":"要点","原条款":"第1条"}]}');

    expect(report.标题).toBe('测试解读');
    expect(report.速览.施行日期).toBe('2026年6月8日');
    expect(report.核心要点解读[0].原条款).toBe('第1条');
    expect(report.重点义务清单).toEqual([]);
  });

  it('recovers JSON wrapped in markdown fences', () => {
    const report = parseInterpretationJson('```json\n{"出台背景与意义":{"正文":"背景","来源":"AI补充"}}\n```');

    expect(report.出台背景与意义?.来源).toBe('AI补充');
  });

  it('repairs common missing commas between object properties', () => {
    const report = parseInterpretationJson('{"标题":"测试解读" "速览":{"施行日期":"2026年6月8日",},"合规建议":["建立台账",]}');

    expect(report.标题).toBe('测试解读');
    expect(report.速览.施行日期).toBe('2026年6月8日');
    expect(report.合规建议).toEqual(['建立台账']);
  });

  it('normalizes placeholder and explanatory filler values to null', () => {
    const report = parseInterpretationJson('{"速览":{"文号":"GB/T XXXXX","发布机关":"本段未给出（占位符--实施）","施行日期":"未明确"}}');

    expect(report.速览.文号).toBeNull();
    expect(report.速览.发布机关).toBeNull();
    expect(report.速览.施行日期).toBeNull();
  });
});

describe('mergeReports', () => {
  it('merges array sections from chunk reports', () => {
    const first = parseInterpretationJson('{"标题":"A","重点义务清单":[{"主体":"甲","义务":"报告","条款出处":"第1条"}]}');
    const second = parseInterpretationJson('{"重点义务清单":[{"主体":"乙","义务":"备案","条款出处":"第2条"}],"合规建议":["建立台账"]}');

    const merged = mergeReports([first, second]);

    expect(merged.标题).toBe('A');
    expect(merged.重点义务清单).toHaveLength(2);
    expect(merged.合规建议).toEqual(['建立台账']);
  });

  it('merges first-pass metadata with second-pass body sections', () => {
    const metadata = parseInterpretationJson('{"标题":"A解读","速览":{"发布机关":"甲机关","施行日期":"2026年6月8日"}}');
    const body = parseInterpretationJson('{"核心要点解读":[{"标题":"要点"}]}');

    const merged = mergeMetadataAndBody(metadata, body);

    expect(merged.标题).toBe('A解读');
    expect(merged.速览.发布机关).toBe('甲机关');
    expect(merged.核心要点解读).toHaveLength(1);
  });
});

describe('splitTextForModel', () => {
  it('keeps medium length documents in one request by default', () => {
    expect(REPORT_CHUNK_SIZE).toBeGreaterThanOrEqual(120_000);
    expect(splitTextForModel('正文'.repeat(6000))).toHaveLength(1);
  });

  it('splits long text into multiple chunks', () => {
    const chunks = splitTextForModel(`第一条 ${'很长'.repeat(80)}\n\n第二条 ${'正文'.repeat(80)}`, 120);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toContain('第二条');
  });
});

describe('isMetadataMissing', () => {
  it('detects missing critical metadata fields', () => {
    expect(isMetadataMissing(parseInterpretationJson('{"速览":{}}'))).toBe(true);
    expect(isMetadataMissing(parseInterpretationJson('{"速览":{"发布机关":"甲机关"}}'))).toBe(false);
  });
});

describe('isAiSupplement', () => {
  it('detects AI supplement markers in an object', () => {
    expect(isAiSupplement({ 来源: 'AI补充·需核实' })).toBe(true);
    expect(isAiSupplement({ 来源: '文档' })).toBe(false);
  });
});
