import type { InterpretationReport } from './interpretation';

type DocxModule = typeof import('docx');
type ParagraphInstance = InstanceType<DocxModule['Paragraph']>;
type TableInstance = InstanceType<DocxModule['Table']>;

export async function exportInterpretationDocx(report: InterpretationReport, fileName = '法规解读报告.docx') {
  const docx = await import('docx');
  const reportDocument = createInterpretationDocument(docx, report);
  const blob = await docx.Packer.toBlob(reportDocument);
  const url = URL.createObjectURL(blob);
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.docx') ? fileName : `${fileName}.docx`;
  globalThis.document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function createInterpretationDocument(docx: DocxModule, report: InterpretationReport) {
  return new docx.Document({
    sections: [
      {
        properties: {},
        children: [
          heading(docx, report.标题 || '法规解读报告', 1),
          heading(docx, '一、速览', 2),
          keyValueTable(docx, [
            ['发布机关', report.速览.发布机关],
            ['发布日期', report.速览.发布日期],
            ['施行日期', report.速览.施行日期],
            ['文号', report.速览.文号],
            ['效力层级', report.速览.效力层级],
            ['章条规模', report.速览.章条规模],
            ['上位法依据', report.速览.上位法依据.join('；')],
            ['官方全文链接', report.速览.官方全文链接]
          ]),
          ...optionalParagraph(docx, '出台背景与意义', report.出台背景与意义?.正文),
          ...optionalParagraph(docx, '适用范围', report.适用范围与义务主体?.适用范围),
          ...tableSection(docx, '义务主体', ['主体', '影响等级', '定位'], report.适用范围与义务主体?.义务主体 ?? []),
          ...optionalParagraph(docx, '框架结构', report.框架结构),
          ...tableSection(docx, '核心要点解读', ['标题', '原条款', '解读', '影响'], report.核心要点解读),
          ...tableSection(docx, '重点义务清单', ['主体', '义务', '条款出处'], report.重点义务清单),
          ...tableSection(docx, '关键时间节点与行动清单', ['事项', '依据', '截止'], report.关键时间节点与行动清单),
          ...tableSection(docx, '新旧变化', ['类型', '说明', '条款'], report.新旧变化),
          ...tableSection(docx, '法律责任与罚则', ['情形', '处罚', '条款'], report.法律责任与罚则),
          ...tableSection(docx, '参考案例', ['案例', '触犯条款', '结果', '来源'], report.参考案例),
          ...listSection(docx, '合规建议', report.合规建议)
        ]
      }
    ]
  });
}

function heading(docx: DocxModule, text: string, level: 1 | 2 | 3) {
  return new docx.Paragraph({
    text,
    heading: level === 1 ? docx.HeadingLevel.HEADING_1 : level === 2 ? docx.HeadingLevel.HEADING_2 : docx.HeadingLevel.HEADING_3,
    spacing: { before: level === 1 ? 0 : 280, after: 140 }
  });
}

function optionalParagraph(docx: DocxModule, title: string, value: string | null | undefined): ParagraphInstance[] {
  if (!value) return [];
  return [
    heading(docx, title, 2),
    new docx.Paragraph({
      children: [new docx.TextRun(value)],
      spacing: { after: 140 }
    })
  ];
}

function listSection(docx: DocxModule, title: string, items: string[]): ParagraphInstance[] {
  if (!items.length) return [];
  return [
    heading(docx, title, 2),
    ...items.map(
      (item) =>
        new docx.Paragraph({
          text: item,
          bullet: { level: 0 },
          spacing: { after: 80 }
        })
    )
  ];
}

function tableSection<T extends Record<string, unknown>>(
  docx: DocxModule,
  title: string,
  columns: string[],
  rows: T[]
): Array<ParagraphInstance | TableInstance> {
  if (!rows.length) return [];
  return [heading(docx, title, 2), table(docx, columns, rows.map((row) => columns.map((column) => stringify(row[column]))))];
}

function keyValueTable(docx: DocxModule, rows: Array<[string, string | null | undefined]>): TableInstance {
  return table(docx, ['项目', '内容'], rows.filter(([, value]) => value).map(([key, value]) => [key, value ?? '']));
}

function table(docx: DocxModule, columns: string[], rows: string[][]): TableInstance {
  return new docx.Table({
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    rows: [
      new docx.TableRow({ children: columns.map((column) => cell(docx, column, true)) }),
      ...rows.map((row) => new docx.TableRow({ children: row.map((value) => cell(docx, value)) }))
    ]
  });
}

function cell(docx: DocxModule, text: string, bold = false) {
  return new docx.TableCell({
    children: [new docx.Paragraph({ children: [new docx.TextRun({ text, bold })] })]
  });
}

function stringify(value: unknown): string {
  return value == null ? '' : String(value);
}
