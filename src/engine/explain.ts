import { formatFraction, toDecimal, type Fraction } from "./fraction";
import type { CellRecord, CellError } from "./sheet";
import type { Sheet } from "./sheet";
import type { AstNode } from "./parser";
import { classifyRaw } from "./classify";

/**
 * 选中格的“计算解释树”：把公式 AST 的每一步如何得到分数都展开，
 * 让质检员能逐节点解释任何数值的来源。
 */
export type Trace =
  | {
      kind: "empty";
      text: string;
    }
  | {
      kind: "integer";
      value: Fraction;
      text: string;
    }
  | {
      kind: "formula";
      expression: string;
      node: NodeTrace;
    };

export interface NodeTrace {
  label: string;
  /** 叶子节点（整数 / 引用）时给出精确值；引用空格按 0。 */
  value?: Fraction;
  error?: CellError;
  children: NodeTrace[];
}

export function buildTrace(sheet: Sheet, ref: string): Trace {
  const rec: CellRecord | undefined = sheet.get(ref);
  if (!rec || rec.raw === "") {
    return { kind: "empty", text: "空格：参与运算时按 0 计" };
  }
  const classified = classifyRaw(rec.raw);
  if (classified.kind === "integer") {
    return {
      kind: "integer",
      value: fractionOf(rec),
      text: `直接输入的整数 ${rec.raw}`,
    };
  }
  if (classified.kind !== "formula") {
    return { kind: "empty", text: "空格：参与运算时按 0 计" };
  }
  if (!classified.parsed.ok) {
    return {
      kind: "formula",
      expression: rec.raw,
      node: {
        label: `公式 =${rec.raw}`,
        error:
          rec.result.status === "error" ? rec.result.error : undefined,
        children: [],
      },
    };
  }
  const stack = new Set<string>();
  const node = traceAst(sheet, classified.parsed.ast, ref, stack);
  return {
    kind: "formula",
    expression: rec.raw,
    node,
  };
}

function fractionOf(rec: CellRecord): Fraction {
  if (rec.result.status === "value") return rec.result.value;
  return { num: 0n, den: 1n };
}

function traceAst(
  sheet: Sheet,
  ast: AstNode,
  owner: string,
  stack: Set<string>,
): NodeTrace {
  switch (ast.kind) {
    case "int":
      return {
        label: `整数 ${ast.value.toString()}`,
        value: { num: ast.value, den: 1n },
        children: [],
      };
    case "neg": {
      const child = traceAst(sheet, ast.arg, owner, stack);
      const node: NodeTrace = {
        label: "一元负号 -",
        children: [child],
      };
      if (child.error) {
        node.error = child.error;
      } else if (child.value) {
        node.value = { num: -child.value.num, den: child.value.den };
      }
      return node;
    }
    case "bin": {
      const l = traceAst(sheet, ast.left, owner, stack);
      const r = traceAst(sheet, ast.right, owner, stack);
      const node: NodeTrace = {
        label: `二元运算 ${ast.op}`,
        children: [l, r],
      };
      if (l.error) {
        node.error = l.error;
      } else if (r.error) {
        node.error = r.error;
      } else if (l.value && r.value) {
        if (ast.op === "/" && r.value.num === 0n) {
          node.error = {
            kind: "divzero",
            origin: owner,
            path: [owner],
            message: `除零错误：${owner} 中除数为 0`,
          };
        } else {
          node.value = computeBinary(ast.op, l.value, r.value) ?? undefined;
        }
      }
      return node;
    }
    case "ref": {
      const depRec = sheet.get(ast.ref);
      const node: NodeTrace = { label: `引用 ${ast.ref}`, children: [] };
      if (!depRec || depRec.raw === "") {
        node.value = { num: 0n, den: 1n };
        node.label = `引用 ${ast.ref}（空，按 0）`;
        return node;
      }
      if (depRec.result.status === "error") {
        node.error = depRec.result.error;
        return node;
      }
      node.value = fractionOf(depRec);
      // 为防止展开时在环里无限递归，只在非环处继续向内展开
      if (stack.has(ast.ref)) {
        node.label = `引用 ${ast.ref}（循环引用，停止向内展开）`;
        node.value = undefined;
        return node;
      }
      stack.add(ast.ref);
      const depClass = classifyRaw(depRec.raw);
      if (depClass.kind === "formula" && depClass.parsed.ok) {
        node.children = [traceAst(sheet, depClass.parsed.ast, ast.ref, stack)];
        node.label = `引用 ${ast.ref}`;
      } else if (depClass.kind === "integer") {
        node.label = `引用 ${ast.ref}（整数 ${depRec.raw}）`;
      }
      stack.delete(ast.ref);
      return node;
    }
  }
}

function computeBinary(
  op: "+" | "-" | "*" | "/",
  a: Fraction,
  b: Fraction,
): Fraction | null {
  // 内联最小运算，避免 trace 层因除零抛异常
  if (op === "/" && b.num === 0n) return null;
  const num =
    op === "+"
      ? a.num * b.den + b.num * a.den
      : op === "-"
        ? a.num * b.den - b.num * a.den
        : op === "*"
          ? a.num * b.num
          : a.num * b.den;
  const den =
    op === "+" || op === "-" ? a.den * b.den : op === "*" ? a.den * b.den : a.den * b.num;
  let n = num;
  let d = den;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const gcd = (x: bigint, y: bigint): bigint => {
    let xx = x < 0n ? -x : x;
    let yy = y < 0n ? -y : y;
    while (yy !== 0n) [xx, yy] = [yy, xx % yy];
    return xx;
  };
  const g = gcd(n, d);
  return { num: n / g, den: d / g };
}

export function nodeValueText(node: NodeTrace): string | null {
  if (node.error) return null;
  if (!node.value) return null;
  return `${formatFraction(node.value)}（≈ ${toDecimal(node.value)}）`;
}
