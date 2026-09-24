import { describe, it, expect } from "vitest";
import { Sheet } from "../src/engine/sheet";
import { formatFraction } from "../src/engine/fraction";
import { valueOf, errorKindOf } from "./helpers";

describe("循环引用：标出实际环", () => {
  it("自环 A1=A1+1", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=A1+1");
    const rec = sheet.get("A1")!;
    expect(rec.result.status).toBe("error");
    if (rec.result.status === "error") {
      expect(rec.result.error.kind).toBe("cycle");
      expect(rec.result.error.cycle).toEqual(["A1", "A1"]);
    }
  });

  it("两环 A1=B1+1 / B1=A1*2，实际环路径首尾相同", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=B1+1");
    sheet.setCell("B1", "=A1*2");
    const a = sheet.get("A1")!;
    const b = sheet.get("B1")!;
    expect(a.result.status).toBe("error");
    expect(b.result.status).toBe("error");
    if (a.result.status === "error" && b.result.status === "error") {
      expect(a.result.error.kind).toBe("cycle");
      expect(b.result.error.kind).toBe("cycle");
      expect(a.result.error.cycle![0]).toBe(
        a.result.error.cycle![a.result.error.cycle!.length - 1],
      );
      const setA = new Set(a.result.error.cycle);
      expect(setA.has("A1")).toBe(true);
      expect(setA.has("B1")).toBe(true);
    }
  });

  it("大环 A1->B2->C3->A1 全部成员被标出", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=B2");
    sheet.setCell("B2", "=C3+1");
    sheet.setCell("C3", "=A1*2");
    for (const ref of ["A1", "B2", "C3"]) {
      expect(errorKindOf(sheet, ref)).toBe("cycle");
    }
  });

  it("独立于环的格照常计算", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=A1+1");
    sheet.setCell("D1", "=2*3+4");
    expect(errorKindOf(sheet, "A1")).toBe("cycle");
    expect(valueOf(sheet, "D1")).toBe("10");
  });
});

describe("下游传播与来源路径", () => {
  it("环外下游标记为 cycle 错误并给出传播链，绝不显示旧数值", () => {
    const sheet = Sheet.blank();
    // 先让下游有一个曾经有效的值
    sheet.setCell("A1", "1");
    sheet.setCell("A2", "=A1+1"); // 2
    sheet.setCell("A3", "=A2*10"); // 20
    expect(valueOf(sheet, "A3")).toBe("20");

    // A1 变成自环：A2、A3 都必须失效
    sheet.setCell("A1", "=A1+1");
    expect(errorKindOf(sheet, "A1")).toBe("cycle");
    expect(errorKindOf(sheet, "A2")).toBe("cycle");
    expect(errorKindOf(sheet, "A3")).toBe("cycle");

    const e3 = sheet.get("A3")!.result;
    if (e3.status === "error") {
      expect(e3.error.origin).toBe("A1");
      expect(e3.error.path).toEqual(["A1", "A2", "A3"]);
      expect(e3.error.cycle).toEqual(["A1", "A1"]);
    }
  });

  it("除零：源头与下游都标 divzero，传播链可追溯", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "0");
    sheet.setCell("B1", "=1/A1");
    sheet.setCell("C1", "=B1+2");
    expect(errorKindOf(sheet, "B1")).toBe("divzero");
    expect(errorKindOf(sheet, "C1")).toBe("divzero");
    const c = sheet.get("C1")!.result;
    if (c.status === "error") {
      expect(c.error.origin).toBe("B1");
      expect(c.error.path).toEqual(["B1", "C1"]);
    }
  });

  it("分母引用结果为 0 也算除零（包括 -0/1 约分后）", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=3-3");
    sheet.setCell("B1", "=7/A1");
    expect(errorKindOf(sheet, "B1")).toBe("divzero");
  });

  it("单格编辑语法错误只影响该格及其下游，其他格不动", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "10");
    sheet.setCell("A2", "=A1*2"); // 20
    sheet.setCell("B1", "=99"); // 独立
    expect(valueOf(sheet, "A2")).toBe("20");

    sheet.setCell("A1", "=1+"); // 语法错误
    expect(errorKindOf(sheet, "A1")).toBe("parse");
    expect(errorKindOf(sheet, "A2")).toBe("parse");
    // B1 完全不受影响
    expect(valueOf(sheet, "B1")).toBe("99");
  });

  it("空格按 0 参与运算", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=T20+5");
    expect(valueOf(sheet, "A1")).toBe("5");
  });
});

describe("编辑后恢复", () => {
  it("解除自环后下游逐级恢复，且分数精确", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=A1+1");
    sheet.setCell("A2", "=A1+1");
    sheet.setCell("A3", "=A2/3");
    expect(errorKindOf(sheet, "A3")).toBe("cycle");

    sheet.setCell("A1", "2");
    expect(valueOf(sheet, "A1")).toBe("2");
    expect(valueOf(sheet, "A2")).toBe("3");
    expect(valueOf(sheet, "A3")).toBe("1");
  });

  it("除零修复后下游恢复为精确分数", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "0");
    sheet.setCell("B1", "=1/A1");
    sheet.setCell("C1", "=B1/4");
    expect(errorKindOf(sheet, "C1")).toBe("divzero");

    sheet.setCell("A1", "8");
    expect(valueOf(sheet, "B1")).toBe("1/8");
    expect(valueOf(sheet, "C1")).toBe("1/32");
    const rec = sheet.get("C1")!;
    if (rec.result.status === "value") {
      expect(rec.result.value.num).toBe(1n);
      expect(rec.result.value.den).toBe(32n);
    }
  });

  it("改公式移除依赖边后，旧下游不再被牵连", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=1/0");
    sheet.setCell("B1", "=A1");
    expect(errorKindOf(sheet, "B1")).toBe("divzero");

    sheet.setCell("B1", "=40+2");
    expect(valueOf(sheet, "B1")).toBe("42");
  });

  it("环中某成员改为常量后，剩余格恢复或继续报错都符合依赖", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=B1+1");
    sheet.setCell("B1", "=A1+1");
    expect(errorKindOf(sheet, "A1")).toBe("cycle");

    sheet.setCell("B1", "1");
    expect(valueOf(sheet, "A1")).toBe("2");
  });

  it("清空源头格后下游按 0 恢复", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "5");
    sheet.setCell("A2", "=A1+1");
    expect(valueOf(sheet, "A2")).toBe("6");
    sheet.setCell("A1", "");
    expect(valueOf(sheet, "A2")).toBe("1");
    // 空源头不再有非空记录
    expect(sheet.get("A1")?.raw).toBe("");
  });

  it("错误格快照中永远没有旧分数，即便它曾经有值", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "3");
    sheet.setCell("B1", "=1/A1"); // 曾经为 1/3
    sheet.setCell("A1", "0");
    const cell = sheet.snapshot().cells.B1;
    expect(cell.status).toBe("error");
    expect(cell.fraction).toBeUndefined();
    expect(cell.decimal).toBeUndefined();
    // 重新有效后快照立即恢复分数
    sheet.setCell("A1", "6");
    const repaired = sheet.snapshot().cells.B1;
    expect(repaired.status).toBe("value");
    expect(repaired.fraction).toEqual({ num: "1", den: "6" });
  });

  it("快照版本随每次成功编辑递增", () => {
    const sheet = Sheet.blank();
    const v0 = sheet.version;
    sheet.setCell("A1", "1");
    expect(sheet.version).toBe(v0 + 1);
    sheet.setCell("A1", "2");
    expect(sheet.version).toBe(v0 + 2);
  });
});

describe("整份导入：拒绝即保留上次有效表", () => {
  it("任何一格非法都整体拒绝，且旧网格保持不变", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=2+2");
    expect(valueOf(sheet, "A1")).toBe("4");

    expect(() =>
      sheet.loadObject({
        cells: {
          A1: "=SUM(B:B)",
          A2: "5",
        },
      }),
    ).toThrow(/导入被拒绝/);

    // 上次有效表完好
    expect(valueOf(sheet, "A1")).toBe("4");
    expect(sheet.get("A2")).toBeUndefined();
  });

  it("地址非法或值类型非法也整体拒绝", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "1");
    expect(() =>
      sheet.loadObject({ cells: { X1: "1", A1: "2" } }),
    ).toThrow(/X1/);
    expect(valueOf(sheet, "A1")).toBe("1");

    expect(() => sheet.loadObject({ cells: { A1: 42 } })).toThrow(
      /必须是字符串/,
    );
  });

  it("合法导入整体替换并重算", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "100");
    sheet.loadObject({
      cells: {
        A1: "2",
        A2: "=A1*3",
        B2: "=1/3",
      },
    });
    expect(valueOf(sheet, "A1")).toBe("2");
    expect(valueOf(sheet, "A2")).toBe("6");
    const rec = sheet.get("B2")!;
    if (rec.result.status === "value") {
      expect(rec.result.value).toEqual({ num: 1n, den: 3n });
    }
  });

  it("支持导出形态 {raw: \"...\"} 的条目往返导入并整体重算", () => {
    const sheet = Sheet.blank();
    sheet.loadObject({
      cells: {
        A2: { raw: "6" },
        C3: { raw: "=A2+1" },
      },
    });
    expect(valueOf(sheet, "C3")).toBe("7");
  });
});

describe("快照：表格与导出共享", () => {
  it("snapshot 中同时含精确分数、十进制辅助、依赖与错误", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "1");
    sheet.setCell("A2", "=A1/3");
    const snap = sheet.snapshot();
    const a2 = snap.cells.A2;
    expect(a2.fraction).toEqual({ num: "1", den: "3" });
    expect(a2.decimal).toMatch(/^0\.3+/);
    expect(a2.deps).toEqual(["A1"]);
    expect(snap.cells.A1.dependents).toEqual(["A2"]);
    expect(snap.version).toBeGreaterThan(0);
  });

  it("错误格进入快照且不携带 fraction", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=1/0");
    const cell = sheet.snapshot().cells.A1;
    expect(cell.status).toBe("error");
    expect(cell.error?.kind).toBe("divzero");
    expect(cell.fraction).toBeUndefined();
  });

  it("快照按 A1..T20 行优先顺序插入", () => {
    const sheet = Sheet.blank();
    sheet.setCell("B2", "1");
    sheet.setCell("A1", "2");
    expect(Object.keys(sheet.snapshot().cells)).toEqual(["A1", "B2"]);
  });

  it("快照值就是当前值（导出不再产生第二份计算结果）", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=7/13");
    const cell = sheet.snapshot().cells.A1;
    const live = sheet.get("A1")!.result;
    if (live.status === "value") {
      expect(cell.fraction?.num).toBe(live.value.num.toString());
      expect(cell.fraction?.den).toBe(live.value.den.toString());
      expect(formatFraction(live.value)).toBe("7/13");
    }
  });
});
