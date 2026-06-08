import type ExcelJS from 'exceljs';
import type { AlignRow, Article } from '../types';
import type { DiffPart } from './diff';

const BLACK = 'FF000000';
const BLUE = 'FF00B0F0';
const RED = 'FFFF0000';

export type RowDiffs = Map<AlignRow, DiffPart[]>;

export async function exportCompareExcel(
  rows: AlignRow[],
  rowDiffs: RowDiffs,
  options: { leftTitle: string; rightTitle: string; leftFileName: string; rightFileName: string }
) {
  const workbook = await createCompareWorkbook(rows, rowDiffs, options);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${stripExtension(options.leftFileName)}-vs-${stripExtension(options.rightFileName)}-${today()}.xlsx`
  );
}

export async function createCompareWorkbook(
  rows: AlignRow[],
  rowDiffs: RowDiffs,
  options: { leftTitle: string; rightTitle: string }
) {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '律所工作台';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('法规对比');

  worksheet.columns = [
    { key: 'left', width: 60 },
    { key: 'right', width: 60 }
  ];

  worksheet.getCell('A1').value = options.leftTitle;
  worksheet.getCell('B1').value = options.rightTitle;
  worksheet.getRow(1).height = 28;
  for (const cell of [worksheet.getCell('A1'), worksheet.getCell('B1')]) {
    cell.font = { name: 'Microsoft YaHei', bold: true, color: { argb: BLACK } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
    cell.border = border();
  }

  rows.forEach((row, index) => {
    const excelRow = worksheet.getRow(index + 2);
    excelRow.getCell(1).value = { richText: leftRichText(row, rowDiffs.get(row) ?? []) };
    excelRow.getCell(2).value = { richText: rightRichText(row, rowDiffs.get(row) ?? []) };
    excelRow.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.font = { name: 'Microsoft YaHei', color: { argb: BLACK } };
      cell.border = border();
    });
  });

  return workbook;
}

function leftRichText(row: AlignRow, diffs: DiffPart[]): ExcelJS.RichText[] {
  if (row.type === 'inserted') return [];
  if (row.type === 'deleted') return articleRuns(row.left, BLUE);
  return matchedRuns(row.left, diffs, 'left');
}

function rightRichText(row: AlignRow, diffs: DiffPart[]): ExcelJS.RichText[] {
  if (row.type === 'deleted') return [];
  if (row.type === 'inserted') return articleRuns(row.right, RED);
  return matchedRuns(row.right, diffs, 'right');
}

function matchedRuns(article: Article | null, diffs: DiffPart[], side: 'left' | 'right'): ExcelJS.RichText[] {
  const runs = articlePrefix(article);
  for (const part of diffs) {
    if (part.op === 0) runs.push(textRun(part.text, BLACK));
    if (side === 'left' && part.op === -1) runs.push(textRun(part.text, BLUE));
    if (side === 'right' && part.op === 1) runs.push(textRun(part.text, RED));
  }
  return runs.length ? runs : articleRuns(article, BLACK);
}

function articleRuns(article: Article | null, color: string): ExcelJS.RichText[] {
  if (!article) return [];
  return [textRun(articleText(article), color)];
}

function articlePrefix(article: Article | null): ExcelJS.RichText[] {
  if (!article?.number) return [];
  return [textRun(`${article.number}\n`, BLACK)];
}

function articleText(article: Article): string {
  return [article.number, article.text].filter(Boolean).join('\n');
}

function textRun(text: string, color: string): ExcelJS.RichText {
  return { text, font: { name: 'Microsoft YaHei', color: { argb: color } } };
}

function border(): Partial<ExcelJS.Borders> {
  return {
    top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function stripExtension(fileName: string): string {
  return sanitizeFileName(fileName.replace(/\.[^.]+$/, '') || '法规对比');
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

async function loadExcelJs() {
  return import('exceljs');
}
