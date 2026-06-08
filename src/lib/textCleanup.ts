const PUNCTUATION_END = /[。！？；：）】》」』…]$/;
const PUNCTUATION_START = /^[，。！？；：、）】》」』]/;

export function cleanExtractedText(input: string): string {
  const normalized = input
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');

  const lines = normalized.split('\n').map((line) => line.trim());
  const frequencies = new Map<string, number>();
  for (const line of lines) {
    if (line.length >= 4 && line.length <= 40) {
      frequencies.set(line, (frequencies.get(line) ?? 0) + 1);
    }
  }

  const filtered = lines.filter((line) => {
    if (/^\d+$/.test(line)) return false;
    if (/^[-—_ ]*\d+[-—_ ]*$/.test(line)) return false;
    const count = frequencies.get(line) ?? 0;
    return !(count >= 3 && line.length <= 40);
  });

  return mergeBrokenLines(filtered).trim();
}

function mergeBrokenLines(lines: string[]): string {
  const output: string[] = [];
  for (const line of lines) {
    if (!line) {
      if (output[output.length - 1] !== '') output.push('');
      continue;
    }

    const previous = output[output.length - 1];
    const shouldMerge =
      previous &&
      !PUNCTUATION_END.test(previous) &&
      !isStructuralLine(line) &&
      !PUNCTUATION_START.test(line) &&
      line.length < 80;

    if (shouldMerge) {
      output[output.length - 1] = `${previous}${line}`;
    } else {
      output.push(line);
    }
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n');
}

function isStructuralLine(line: string): boolean {
  return (
    /^\s*第[一二三四五六七八九十百千零〇\d]+条/.test(line) ||
    /^\s*第[一二三四五六七八九十百千零〇\d]+章/.test(line) ||
    /^（[一二三四五六七八九十\d]+）/.test(line)
  );
}
