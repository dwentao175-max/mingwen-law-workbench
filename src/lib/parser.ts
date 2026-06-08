import type { ParsedDocument } from '../types';
import { cleanExtractedText } from './textCleanup';

export async function parseFile(file: File): Promise<ParsedDocument> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const buffer = await file.arrayBuffer();

  if (extension === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return { text: cleanExtractedText(result.value) };
  }

  if (extension === 'pdf') {
    return parsePdf(buffer);
  }

  throw new Error('仅支持 .docx 或 .pdf 文件');
}

export async function renderPdfPagesAsImages(
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  const pdfjsLib = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持 Canvas OCR 预处理。');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;
    pages.push(canvas.toDataURL('image/jpeg', 0.88));
    onProgress?.(pageNumber, pdf.numPages);
  }

  return pages;
}

async function parsePdf(buffer: ArrayBuffer): Promise<ParsedDocument> {
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join('\n');
    pages.push(pageText);
  }

  const rawText = pages.join('\n\n');
  const visibleChars = rawText.replace(/\s/g, '').length;
  if (visibleChars / Math.max(pdf.numPages, 1) < 20) {
    return {
      text: '',
      pageCount: pdf.numPages,
      warning: '检测到扫描件或无文字层 PDF，OCR 识别将在后续版本支持，请先用 Word 或电子版 PDF。'
    };
  }

  return { text: cleanExtractedText(rawText), pageCount: pdf.numPages };
}

async function loadPdfJs() {
  const [pdfjsLib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjsLib;
}
