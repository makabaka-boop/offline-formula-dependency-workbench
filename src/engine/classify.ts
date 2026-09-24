import { parseFormula } from "./parser";
import type { ParseResult } from "./parser";

/**
 * 原始单元格内容分类（在“写入”时完成，不抛异常）：
 *  - empty   : 空（含纯空白）
 *  - integer : 十进制整数，允许单个前导负号；不允许 + 号、前导 0、空白
 *  - formula : 以 = 开头，附带解析结果（成功或该格专属的语法错误）
 */
export type Classified =
  | { kind: "empty" }
  | { kind: "integer"; value: bigint }
  | { kind: "formula"; text: string; parsed: ParseResult };

const INTEGER_RE = /^-?(0|[1-9][0-9]*)$/;

export function classifyRaw(raw: string): Classified {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };

  if (INTEGER_RE.test(trimmed)) {
    return { kind: "integer", value: BigInt(trimmed) };
  }
  // 形如 01、+1、1-、1.0：不是整数也不是公式
  if (!trimmed.startsWith("=")) {
    return {
      kind: "formula",
      text: trimmed,
      parsed: {
        ok: false,
        message:
          "不是合法内容：必须留空、输入整数（允许前导负号，无前导零），或以 = 开头的公式",
      },
    };
  }

  const body = trimmed.slice(1);
  return { kind: "formula", text: body, parsed: parseFormula(body) };
}
