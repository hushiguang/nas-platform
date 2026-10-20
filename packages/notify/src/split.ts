/**
 * 按字节拆分长文本。
 *
 * 企微对单条消息的长度限制是**字节**不是字符：
 * 群机器人 markdown.content 上限 4096 字节，应用消息 text.content 上限 2048 字节。
 * 中文一个字 UTF-8 占 3 字节，所以「3800 个字」的中文消息有 1.1 万字节，
 * 照样被拒（errcode 40058 markdown.content exceed max length 4096）。
 *
 * 之前按字符数截断，等于没截 —— 消息直接发不出去。这里统一按字节切，
 * 优先在换行处断开（markdown 的行是独立的，切断后仍然可读）。
 */

/** 字节长度。中文按 3 字节算，所以不能用 length */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * 把 text 切成若干段，每段字节数不超过 maxBytes。
 *
 * 切分点优先取换行；单行本身就超限时（超长的一行）按字符硬切，
 * 保证每段都不超限 —— 不切的话这段消息必被企微拒掉。
 */
export function splitByBytes(text: string, maxBytes: number): string[] {
  if (maxBytes <= 0) throw new Error("maxBytes 必须大于 0");
  if (byteLength(text) <= maxBytes) return [text];

  const parts: string[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer) {
      parts.push(buffer);
      buffer = "";
    }
  };

  for (const line of text.split("\n")) {
    const candidate = buffer ? `${buffer}\n${line}` : line;
    if (byteLength(candidate) <= maxBytes) {
      buffer = candidate;
      continue;
    }
    // 这一行放不下了，先把缓冲里的收尾，再单独处理这行
    flush();
    if (byteLength(line) <= maxBytes) {
      buffer = line;
      continue;
    }
    // 单行超长：按字符切，每段都卡在字节上限内
    let piece = "";
    for (const char of line) {
      if (byteLength(piece + char) > maxBytes) {
        parts.push(piece);
        piece = char;
      } else {
        piece += char;
      }
    }
    buffer = piece;
  }
  flush();
  return parts.length > 0 ? parts : [""];
}
