import { describe, expect, it } from 'vitest';
import type ExcelJS from 'exceljs';
import type { AlignRow, Article } from '../types';
import { diffTexts } from './diff';
import { createCompareWorkbook, type RowDiffs } from './excelExport';

const article = (number: string, text: string): Article => ({
  id: number,
  number,
  chapter: null,
  text,
  raw: `${number} ${text}`
});

describe('createCompareWorkbook', () => {
  it('exports two-column rich text with blue left changes and red right changes', async () => {
    const matched: AlignRow = {
      left: article('第一条', '网络运营者应当及时报告。'),
      right: article('第一条', '网络运营者应当立即报告。'),
      type: 'matched',
      similarity: 0.8
    };
    const inserted: AlignRow = {
      left: null,
      right: article('第二条', '新增条文。'),
      type: 'inserted',
      similarity: 0
    };
    const deleted: AlignRow = {
      left: article('第三条', '删除条文。'),
      right: null,
      type: 'deleted',
      similarity: 0
    };
    const diffs: RowDiffs = new Map([[matched, diffTexts(matched.left!.text, matched.right!.text)]]);

    const workbook = await createCompareWorkbook([matched, inserted, deleted], diffs, {
      leftTitle: '征求稿标题',
      rightTitle: '正式稿标题'
    });
    const sheet = workbook.getWorksheet('法规对比');

    expect(sheet?.getCell('A1').value).toBe('征求稿标题');
    expect(sheet?.getCell('B1').value).toBe('正式稿标题');
    expect(richText(sheet?.getCell('A2')).some((run) => run.text === '及时' && run.font?.color?.argb === 'FF00B0F0')).toBe(true);
    expect(richText(sheet?.getCell('B2')).some((run) => run.text === '立即' && run.font?.color?.argb === 'FFFF0000')).toBe(true);
    expect(richText(sheet?.getCell('A3'))).toEqual([]);
    expect(richText(sheet?.getCell('B3')).every((run) => run.font?.color?.argb === 'FFFF0000')).toBe(true);
    expect(richText(sheet?.getCell('A4')).every((run) => run.font?.color?.argb === 'FF00B0F0')).toBe(true);
    expect(richText(sheet?.getCell('B4'))).toEqual([]);
  });
});

function richText(cell: ExcelJS.Cell | undefined): ExcelJS.RichText[] {
  const value = cell?.value;
  if (value && typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) return value.richText;
  return [];
}
