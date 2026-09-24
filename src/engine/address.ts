/** A1..T20 寻址：列 A..T 对应 0..19，行 1..20 对应 0..19。 */

export const MAX_COL = 20;
export const MAX_ROW = 20;

export interface Coord {
  readonly col: number; // 0 基
  readonly row: number; // 0 基
}

const REF_RE = /^([A-Ta-t])(\d{1,2})$/;

/**
 * 解析引用，只接受 A1..T20。
 * 列字母大小写不敏感；行号不允许前导 0（0、01、21、U、AA 均拒绝）。
 */
export function parseRef(ref: string): Coord | null {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  const letter = m[1];
  const col = letter.charCodeAt(0) - (letter >= "A" && letter <= "T" ? 65 : 97);
  const rowDigits = m[2];
  if (rowDigits.length === 2 && rowDigits[0] === "0") return null; // 01..09
  const row = Number(rowDigits) - 1;
  if (row < 0 || row >= MAX_ROW) return null;
  return { col, row };
}

export function formatRef({ col, row }: Coord): string {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

/** 按先行后列遍历 20x20 的全部地址（A1, B1, …, T1, A2, …）。 */
export function* allRefs(): Generator<string> {
  for (let row = 0; row < MAX_ROW; row++) {
    for (let col = 0; col < MAX_COL; col++) {
      yield formatRef({ col, row });
    }
  }
}
