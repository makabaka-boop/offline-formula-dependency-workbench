/**
 * 手写递归下降解析器（无任何第三方解析库）。
 *
 * 文法（E 必须消费完整串，多余 token 即报错）：
 *   E  := T (('+' | '-') T)*
 *   T  := F (('*' | '/') F)*
 *   F  := '-' F | Atom
 *   Atom := 整数 | 引用 | '(' E ')'
 *
 * 字符白名单：数字、A..T/a..t 引用字母、+ - * / ( )。
 * 不允许空白、函数、范围、$ 绝对引用、小数点。
 */

export type AstNode =
  | { kind: "int"; value: bigint; pos: number }
  | { kind: "ref"; ref: string; pos: number }
  | { kind: "neg"; arg: AstNode; pos: number }
  | {
      kind: "bin";
      op: "+" | "-" | "*" | "/";
      left: AstNode;
      right: AstNode;
      pos: number;
    };

export interface ParseOk {
  ok: true;
  ast: AstNode;
  /** 该公式引用到的全部单元，按首次出现去重。 */
  refs: string[];
}

export interface ParseErr {
  ok: false;
  message: string;
}

export type ParseResult = ParseOk | ParseErr;

function errorAt(pos: number, text: string): ParseErr {
  return { ok: false, message: `公式语法错误（位置 ${pos}）：${text}` };
}

function scanAtomError(ch: string, pos: number): ParseErr {
  return errorAt(pos, `非法字符 “${ch}”，只允许整数、A1..T20 引用与 ( ) + - * /`);
}

export function parseFormula(input: string): ParseResult {
  const s = input;
  let i = 0;
  const refs: string[] = [];

  function addRef(ref: string): void {
    if (!refs.includes(ref)) refs.push(ref);
  }

  function parseExpr(): { node: AstNode } | ParseErr {
    const left = parseTerm();
    if ("ok" in left && left.ok === false) return left;
    let node = (left as { node: AstNode }).node;

    while (i < s.length && (s[i] === "+" || s[i] === "-")) {
      const op = s[i] as "+" | "-";
      const pos = i++;
      const right = parseTerm();
      if ("ok" in right && right.ok === false) return right;
      node = { kind: "bin", op, left: node, right: (right as { node: AstNode }).node, pos };
    }
    return { node };
  }

  function parseTerm(): { node: AstNode } | ParseErr {
    const left = parseFactor();
    if ("ok" in left && left.ok === false) return left;
    let node = (left as { node: AstNode }).node;

    while (i < s.length && (s[i] === "*" || s[i] === "/")) {
      const op = s[i] as "*" | "/";
      const pos = i++;
      const right = parseFactor();
      if ("ok" in right && right.ok === false) return right;
      node = { kind: "bin", op, left: node, right: (right as { node: AstNode }).node, pos };
    }
    return { node };
  }

  function parseFactor(): { node: AstNode } | ParseErr {
    if (i >= s.length) return errorAt(i, "表达式意外结束");
    if (s[i] === "-") {
      const pos = i++;
      const arg = parseFactor();
      if ("ok" in arg && arg.ok === false) return arg;
      return { node: { kind: "neg", arg: (arg as { node: AstNode }).node, pos } };
    }
    return parseAtom();
  }

  function parseAtom(): { node: AstNode } | ParseErr {
    if (i >= s.length) return errorAt(i, "此处应有操作数");
    const ch = s[i];
    const pos = i;

    if (ch === "(") {
      i++;
      const inner = parseExpr();
      if ("ok" in inner && inner.ok === false) return inner;
      if (i >= s.length || s[i] !== ")") return errorAt(i, "缺少右括号 )");
      i++;
      return { node: (inner as { node: AstNode }).node };
    }

    if (ch >= "0" && ch <= "9") {
      let digits = "";
      while (i < s.length && s[i] >= "0" && s[i] <= "9") {
        digits += s[i++];
      }
      // 数字后面紧跟字母：例如 1A，绝不能被当作两个 token
      if (i < s.length && ((s[i] >= "A" && s[i] <= "Z") || (s[i] >= "a" && s[i] <= "z"))) {
        return errorAt(i, `非法字符 “${s[i]}”，整数后不能直接连接字母`);
      }
      let value: bigint;
      try {
        value = BigInt(digits);
      } catch {
        return errorAt(pos, "整数无法解析");
      }
      return { node: { kind: "int", value, pos } };
    }

    if ((ch >= "A" && ch <= "T") || (ch >= "a" && ch <= "t")) {
      const letter = s[i++];
      let rowDigits = "";
      while (i < s.length && s[i] >= "0" && s[i] <= "9") {
        rowDigits += s[i++];
      }
      if (rowDigits === "") return errorAt(i, `列字母 ${letter.toUpperCase()} 后缺少行号`);
      // 字母后紧跟字母，例如 AB1
      if (i < s.length && ((s[i] >= "A" && s[i] <= "Z") || (s[i] >= "a" && s[i] <= "z"))) {
        return scanAtomError(s[i], i);
      }
      const normalized = letter.toUpperCase();
      const row = Number(rowDigits);
      if (row < 1 || row > 20) {
        return errorAt(pos, `引用 ${normalized}${rowDigits} 越界，只允许 A1..T20`);
      }
      const ref = `${normalized}${row}`;
      addRef(ref);
      return { node: { kind: "ref", ref, pos } };
    }

    // U..Z 等越界列字母或其他符号（包括 +、*、/、)、空白）
    if ((ch >= "U" && ch <= "Z") || (ch >= "u" && ch <= "z")) {
      return errorAt(pos, `列 ${ch.toUpperCase()} 超出范围，只允许 A..T 列`);
    }
    return scanAtomError(ch, pos);
  }

  if (s.length === 0) return errorAt(0, "等号后为空");
  const result = parseExpr();
  if ("ok" in result && result.ok === false) return result;
  if (i !== s.length) {
    // 形如 (1)2 或运算符后缺少操作数等多余字符
    return errorAt(i, `运算符后缺少操作数或存在多余字符 “${s[i]}”`);
  }
  return { ok: true, ast: (result as { node: AstNode }).node, refs };
}
