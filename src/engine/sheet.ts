import {
  type Fraction,
  ZERO,
  add,
  sub,
  mul,
  div,
  negate,
  isZero,
  frac,
  toDecimal,
} from "./fraction";
import { formatRef, parseRef, allRefs } from "./address";
import type { AstNode } from "./parser";
import { classifyRaw } from "./classify";

export type ErrorKind = "parse" | "divzero" | "cycle";

export interface CellError {
  kind: ErrorKind;
  /** 错误源头格（语法错误格 / 除零格 / 环上格）。 */
  origin: string;
  /** 从源头到当前格的传播链，含两端；源头格自身为 [origin]。 */
  path: string[];
  /** 仅循环引用：实际环路径，首尾相同，如 ["A1","B2","A1"]。 */
  cycle?: string[];
  /** 完整的人类可读描述。 */
  message: string;
}

export type CellStatus =
  | { status: "empty" }
  | { status: "value"; value: Fraction }
  | { status: "error"; error: CellError };

export interface CellRecord {
  /** 写入内容（已 trim），空串表示该格为空。 */
  raw: string;
  /** 直接依赖（公式成功解析后引用到的格，按首次出现、去重）。 */
  deps: string[];
  /** 当前计算结果；任何无法计算的状态都显式表达，绝不保留旧数值。 */
  result: CellStatus;
}

export interface SnapshotCell {
  ref: string;
  raw: string;
  deps: string[];
  dependents: string[];
  status: "value" | "error";
  fraction?: { num: string; den: string };
  decimal?: string;
  error?: CellError;
}

export interface Snapshot {
  version: number;
  /** 键为 A1..T20，仅包含非空格；插入顺序按 A1..T20。 */
  cells: Record<string, SnapshotCell>;
}

/** 导入数据条目的宽松形态：字符串，或 {raw: string}（便于导出再导入）。 */
export type ImportEntry = string | { raw: string };

interface VOk {
  ok: true;
  value: Fraction;
}
interface VErr {
  ok: false;
  error: CellError;
}
type V = VOk | VErr;

function joinPath(path: string[]): string {
  return path.join(" → ");
}

function describeError(err: CellError): string {
  switch (err.kind) {
    case "cycle": {
      const ring = err.cycle ? err.cycle.join(" → ") : "";
      if (err.path.length <= 1) return `循环引用：${ring}`;
      return `上游循环引用（传播链 ${joinPath(err.path)}）；实际环 ${ring}`;
    }
    case "divzero":
      if (err.path.length <= 1) return `除零错误：${err.origin} 中除数为 0`;
      return `上游除零（传播链 ${joinPath(err.path)}）：源头 ${err.origin} 中除数为 0`;
    case "parse":
      if (err.path.length <= 1) return err.message;
      return `上游公式非法（传播链 ${joinPath(err.path)}）：源头 ${err.origin} 处 ${err.message}`;
  }
}

function withMessage(err: CellError): CellError {
  return { ...err, message: describeError({ ...err, message: "" }) };
}

/** 跨引用传播错误：把当前格追加到传播链末尾。 */
function propagate(err: CellError, through: string): VErr {
  const path = err.path.includes(through)
    ? err.path
    : [...err.path, through];
  const next: CellError = {
    kind: err.kind,
    origin: err.origin,
    path,
    ...(err.cycle ? { cycle: err.cycle } : {}),
    message: "",
  };
  return { ok: false, error: withMessage(next) };
}

export class Sheet {
  private cells = new Map<string, CellRecord>();
  /** 反向边：dep -> 直接依赖它的格集合。 */
  private reverse = new Map<string, Set<string>>();
  private versionCounter = 0;

  static blank(): Sheet {
    return new Sheet();
  }

  get version(): number {
    return this.versionCounter;
  }

  get(ref: string): CellRecord | undefined {
    return this.cells.get(ref);
  }

  /** 直接依赖 ref 的格（未排序副本）。 */
  directDependents(ref: string): string[] {
    return [...(this.reverse.get(ref) ?? [])];
  }

  /**
   * 编辑单格。非法内容不抛异常：错误只落在该格，随后传播给下游，
   * 影响范围严格限定为该格及其传递下游。
   */
  setCell(refInput: string, rawInput: string): void {
    const ref = this.normalizeRef(refInput);
    const raw = rawInput.trim();
    this.cells.set(ref, this.buildRecord(ref, raw));
    this.rebuildReverse();
    const affected = this.collectAffected(ref);
    this.recompute(affected);
    this.versionCounter++;
  }

  /**
   * 整份导入：先完整校验，任何一格非法都拒绝整份网格，
   * 调用方当前表内容保持不变（“上次有效表”）。
   * 通过后整体替换并全量重算。
   */
  loadObject(obj: unknown): void {
    const entries = extractEntries(obj);
    const problems: string[] = [];

    for (const [key, val] of entries) {
      const coord = parseRef(key);
      if (!coord) {
        problems.push(`地址 “${key}” 不是合法的 A1..T20 引用`);
        continue;
      }
      const raw = String(val).trim();
      if (raw === "") continue;
      const classified = classifyRaw(raw);
      if (
        classified.kind === "formula" &&
        !classified.parsed.ok
      ) {
        problems.push(`${formatRef(coord)}：${classified.parsed.message}`);
      }
    }

    if (problems.length > 0) {
      const shown = problems.slice(0, 20).join("；");
      const more =
        problems.length > 20 ? `；等共 ${problems.length} 处错误` : "";
      throw new Error(`导入被拒绝，整份网格未改动：${shown}${more}`);
    }

    const next = new Map<string, CellRecord>();
    for (const [key, val] of entries) {
      const ref = formatRef(parseRef(key)!);
      const raw = String(val).trim();
      if (raw !== "") next.set(ref, this.buildRecord(ref, raw));
    }
    this.cells = next;
    this.rebuildReverse();
    this.recompute(new Set([...next.keys()]));
    this.versionCounter++;
  }

  /** 表格渲染与导出 JSON 共享的同一份当前计算快照。 */
  snapshot(): Snapshot {
    const out: Record<string, SnapshotCell> = {};
    for (const ref of allRefs()) {
      const rec = this.cells.get(ref);
      if (!rec || rec.raw === "") continue;
      const cell: SnapshotCell = {
        ref,
        raw: rec.raw,
        deps: [...rec.deps],
        dependents: [...(this.reverse.get(ref) ?? [])].sort(compareRef),
        status: rec.result.status === "error" ? "error" : "value",
      };
      if (rec.result.status === "value") {
        cell.fraction = {
          num: rec.result.value.num.toString(),
          den: rec.result.value.den.toString(),
        };
        cell.decimal = toDecimal(rec.result.value);
      } else if (rec.result.status === "error") {
        cell.error = rec.result.error;
      }
      out[ref] = cell;
    }
    return {
      version: this.versionCounter,
      cells: out,
    };
  }

  // ---------- 内部实现 ----------

  private normalizeRef(refInput: string): string {
    const coord = parseRef(refInput.trim().toUpperCase());
    if (!coord) throw new Error(`内部错误：非法地址 ${refInput}`);
    return formatRef(coord);
  }

  private buildRecord(ref: string, raw: string): CellRecord {
    if (raw === "") return { raw, deps: [], result: { status: "empty" } };

    const classified = classifyRaw(raw);
    if (classified.kind === "integer") {
      return {
        raw,
        deps: [],
        result: { status: "value", value: frac(classified.value) },
      };
    }
    if (classified.kind === "formula" && classified.parsed.ok) {
      // 临时值，recompute 立即覆盖；任何路径都不会把它当作旧值显示
      return {
        raw,
        deps: [...classified.parsed.refs],
        result: { status: "value", value: ZERO },
      };
    }
    // raw 非空，余下分支必为 formula 且解析失败
    if (classified.kind !== "formula" || classified.parsed.ok) {
      return { raw, deps: [], result: { status: "empty" } };
    }
    return {
      raw,
      deps: [],
      result: {
        status: "error",
        error: {
          kind: "parse" as const,
          origin: ref,
          path: [ref],
          message: classified.parsed.message,
        },
      },
    };
  }

  private rebuildReverse(): void {
    this.reverse = new Map();
    for (const [ref, rec] of this.cells) {
      for (const dep of rec.deps) {
        let set = this.reverse.get(dep);
        if (!set) {
          set = new Set();
          this.reverse.set(dep, set);
        }
        set.add(ref);
      }
    }
  }

  /** 编辑格 + 沿反向边收集全部传递下游。 */
  private collectAffected(start: string): Set<string> {
    const affected = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const dep1 of this.reverse.get(cur) ?? []) {
        if (!affected.has(dep1)) {
          affected.add(dep1);
          queue.push(dep1);
        }
      }
    }
    return affected;
  }

  /**
   * 重算受影响子图：
   * 1) Kahn 拓扑取无环节点；
   * 2) 残留节点中用 Tarjan SCC 找“实际环”，环上成员标 cycle；
   * 3) 环外残留节点（依赖环的下游）按拓扑求值，错误沿边传播。
   */
  private recompute(affected: Set<string>): void {
    // ---- 1. Kahn，边仅统计受影响子图内部 ----
    const indegree = new Map<string, number>();
    for (const ref of affected) {
      const rec = this.cells.get(ref);
      const innerDeps = rec
        ? rec.deps.filter((d) => affected.has(d)).length
        : 0;
      indegree.set(ref, innerDeps);
    }
    const queue: string[] = [];
    for (const [ref, deg] of indegree) if (deg === 0) queue.push(ref);

    const order: string[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      order.push(cur);
      for (const down of this.reverse.get(cur) ?? []) {
        if (!affected.has(down)) continue;
        const d = (indegree.get(down) ?? 0) - 1;
        indegree.set(down, d);
        if (d === 0) queue.push(down);
      }
    }
    const left = new Set<string>();
    for (const ref of affected) if (!order.includes(ref)) left.add(ref);

    // ---- 2. Tarjan SCC（仅 left 内部边）----
    const sccs = this.tarjan(left);
    const core = new Map<string, string[]>(); // 环上成员 -> 实际环路径
    for (const scc of sccs) {
      if (scc.length === 1) {
        const only = scc[0];
        const rec = this.cells.get(only);
        if (!rec || !rec.deps.includes(only)) continue; // 单点但无自环
      }
      const members = new Set(scc);
      for (const member of scc) {
        const cyclePath = this.findCyclePath(member, members);
        if (cyclePath) core.set(member, cyclePath);
      }
    }

    // ---- 3a. 无环节点按拓扑序求值 ----
    for (const ref of order) {
      const rec = this.cells.get(ref);
      if (rec) rec.result = this.evaluate(ref).toStatus();
    }

    // ---- 3b. 环上成员直接标 cycle ----
    for (const [member, cyclePath] of core) {
      const err = withMessage({
        kind: "cycle",
        origin: member,
        path: [member],
        cycle: cyclePath,
        message: "",
      });
      const rec = this.cells.get(member);
      if (rec) rec.result = { status: "error", error: err };
    }

    // ---- 3c. 环外残留节点：把环成员当作已解决，再做一次 Kahn ----
    const downstream = new Set<string>();
    for (const ref of left) if (!core.has(ref)) downstream.add(ref);

    const indeg2 = new Map<string, number>();
    for (const ref of downstream) {
      const rec = this.cells.get(ref)!;
      indeg2.set(
        ref,
        rec.deps.filter((d) => downstream.has(d)).length,
      );
    }
    const q2: string[] = [];
    for (const [ref, deg] of indeg2) if (deg === 0) q2.push(ref);
    const order2: string[] = [];
    while (q2.length) {
      const cur = q2.shift()!;
      order2.push(cur);
      for (const down of this.reverse.get(cur) ?? []) {
        if (!downstream.has(down)) continue;
        const d = (indeg2.get(down) ?? 0) - 1;
        indeg2.set(down, d);
        if (d === 0) q2.push(down);
      }
    }
    for (const ref of order2) {
      const rec = this.cells.get(ref)!;
      rec.result = this.evaluate(ref).toStatus();
    }
  }

  private tarjan(nodes: Set<string>): string[][] {
    const indices = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const sccs: string[][] = [];
    let counter = 0;

    const strongConnect = (v: string): void => {
      indices.set(v, counter);
      low.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);

      const rec = this.cells.get(v);
      for (const w of rec ? rec.deps : []) {
        if (!nodes.has(w)) continue;
        if (!indices.has(w)) {
          strongConnect(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, indices.get(w)!));
        }
      }

      if (low.get(v) === indices.get(v)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        sccs.push(scc);
      }
    };

    for (const v of nodes) if (!indices.has(v)) strongConnect(v);
    return sccs;
  }

  /** 在 SCC 内部找一条从 start 出发回到 start 的简单环。 */
  private findCyclePath(
    start: string,
    members: Set<string>,
  ): string[] | null {
    const path: string[] = [];
    const visited = new Set<string>([start]);

    const dfs = (v: string): boolean => {
      path.push(v);
      const rec = this.cells.get(v);
      for (const d of rec ? rec.deps : []) {
        if (!members.has(d)) continue;
        if (d === start) {
          path.push(start);
          return true;
        }
        if (!visited.has(d)) {
          visited.add(d);
          if (dfs(d)) return true;
        }
      }
      path.pop();
      return false;
    };

    return dfs(start) ? [...path] : null;
  }

  /** 求一个格当前的值或错误（依赖读取现有结果 / 空视作 0）。 */
  private evaluate(ref: string): V & { toStatus(): CellStatus } {
    const rec = this.cells.get(ref);
    let v: V;
    if (!rec || rec.raw === "") {
      v = { ok: true, value: ZERO };
    } else {
      const classified = classifyRaw(rec.raw);
      if (classified.kind === "integer") {
        v = { ok: true, value: frac(classified.value) };
      } else if (classified.kind === "formula") {
        if (!classified.parsed.ok) {
          v = {
            ok: false,
            error: {
              kind: "parse",
              origin: ref,
              path: [ref],
              message: classified.parsed.message,
            },
          };
        } else {
          v = this.evalAst(ref, classified.parsed.ast);
        }
      } else {
        v = { ok: true, value: ZERO };
      }
    }
    return {
      ...v,
      toStatus() {
        return v.ok
          ? { status: "value" as const, value: v.value }
          : { status: "error" as const, error: v.error };
      },
    };
  }

  private evalAst(owner: string, ast: AstNode): V {
    const calc = (node: AstNode): V => {
      switch (node.kind) {
        case "int":
          return { ok: true, value: frac(node.value) };
        case "neg": {
          const a = calc(node.arg);
          return a.ok
            ? { ok: true, value: negate(a.value) }
            : a;
        }
        case "bin": {
          const l = calc(node.left);
          if (!l.ok) return l;
          const r = calc(node.right);
          if (!r.ok) return r;
          switch (node.op) {
            case "+":
              return { ok: true, value: add(l.value, r.value) };
            case "-":
              return { ok: true, value: sub(l.value, r.value) };
            case "*":
              return { ok: true, value: mul(l.value, r.value) };
            case "/":
              if (isZero(r.value)) {
                return {
                  ok: false,
                  error: withMessage({
                    kind: "divzero",
                    origin: owner,
                    path: [owner],
                    message: "",
                  }),
                };
              }
              return { ok: true, value: div(l.value, r.value) };
          }
          break;
        }
        case "ref": {
          const depRec = this.cells.get(node.ref);
          if (!depRec || depRec.raw === "") {
            return { ok: true, value: ZERO }; // 空格按 0 参与运算
          }
          if (depRec.result.status === "value") {
            return { ok: true, value: depRec.result.value };
          }
          if (depRec.result.status === "error") {
            return propagate(depRec.result.error, owner);
          }
          return { ok: true, value: ZERO };
        }
      }
      // 理论上不可达
      return {
        ok: false,
        error: withMessage({
          kind: "parse",
          origin: owner,
          path: [owner],
          message: "内部求值错误",
        }),
      };
    };
    return calc(ast);
  }
}

function compareRef(a: string, b: string): number {
  const ca = parseRef(a)!;
  const cb = parseRef(b)!;
  return ca.row - cb.row || ca.col - cb.col;
}

/**
 * 从导入对象抽取 [地址, 原始字符串] 列表。
 * 接受 {cells: {A1: "1"}} 或直接 {"A1": "1"}；值为字符串或 {raw}。
 */
function extractEntries(obj: unknown): [string, string][] {
  if (obj === null || typeof obj !== "object") {
    throw new Error("导入被拒绝：根必须是 JSON 对象");
  }
  const root = obj as Record<string, unknown>;
  const cells =
    root.cells && typeof root.cells === "object"
      ? (root.cells as Record<string, unknown>)
      : root;

  const out: [string, string][] = [];
  for (const [key, val] of Object.entries(cells)) {
    if (val === null || val === undefined) continue;
    if (typeof val === "string") {
      out.push([key, val]);
    } else if (
      typeof val === "object" &&
      "raw" in val &&
      typeof (val as { raw: unknown }).raw === "string"
    ) {
      out.push([key, (val as { raw: string }).raw]);
    } else {
      throw new Error(`导入被拒绝：${key} 的值必须是字符串或 { "raw": "..." }`);
    }
  }
  return out;
}
