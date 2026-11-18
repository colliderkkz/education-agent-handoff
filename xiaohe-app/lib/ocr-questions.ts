/** Numbering suggestions retain raw text; all boundaries need human review. */
export function splitOcrQuestions(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^\s*\d{1,3}\s*(?:[、．]|\.(?!\d))\s*\S/u.test(line) && current.some(item => item.trim())) {
      blocks.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.some(item => item.trim())) blocks.push(current.join('\n').trim());
  return blocks;
}

export function ocrImportQuestions(text: string): string[] {
  const blocks = splitOcrQuestions(text);
  const numbered = blocks.filter(block => /^\s*\d{1,3}\s*(?:[、．]|\.(?!\d))\s*\S/u.test(block));
  return numbered.length ? numbered : blocks;
}
