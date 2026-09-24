import type { SnapshotCell } from "../engine/sheet";

/** 网格中一格显示的文本；错误格绝不显示旧数值，只显示错误标记。 */
export function cellDisplay(cell: SnapshotCell | undefined): string {
  if (!cell) return "";
  if (cell.status === "error") {
    const e = cell.error;
    // 环上成员 vs. 环的下游：同为 cycle 类型，但下游提示“上游”
    if (e?.kind === "cycle") {
      return e.origin === cell.ref ? "↻ 循环" : "↻ 上游循环";
    }
    if (e?.kind === "divzero") {
      return e.origin === cell.ref ? "⚠ 除零" : "⚠ 上游除零";
    }
    if (e?.kind === "parse") {
      return e.origin === cell.ref ? "⚠ 非法" : "⚠ 上游非法";
    }
    return "⚠ 错误";
  }
  return cell.decimal ?? "";
}

export function cellTitle(cell: SnapshotCell | undefined): string {
  if (!cell) return "空格：参与运算时按 0 计";
  if (cell.status === "error") return cell.error?.message ?? "错误";
  if (cell.fraction) {
    const fracText = `${cell.fraction.num}/${cell.fraction.den}`;
    return `精确值 ${fracText}；十进制近似 ${cell.decimal}`;
  }
  return cell.raw;
}
