import { describe, it, expect } from "vitest";
import {
  frac,
  add,
  sub,
  mul,
  div,
  negate,
  formatFraction,
  toDecimal,
} from "../src/engine/fraction";
import { parseRef, formatRef } from "../src/engine/address";
import { parseFormula } from "../src/engine/parser";
import { classifyRaw } from "../src/engine/classify";
import { Sheet } from "../src/engine/sheet";
import { valueOf } from "./helpers";

describe("BigInt 约分分数", () => {
  it("构造时自动约分并保证分母为正", () => {
    expect(frac(6n, 4n)).toEqual({ num: 3n, den: 2n });
    expect(frac(3n, -2n)).toEqual({ num: -3n, den: 2n });
    expect(frac(-3n, -2n)).toEqual({ num: 3n, den: 2n });
    expect(frac(0n, -7n)).toEqual({ num: 0n, den: 1n });
  });

  it("四则运算保持精确且约分", () => {
    expect(add(frac(1n, 2n), frac(1n, 3n))).toEqual({ num: 5n, den: 6n });
    expect(sub(frac(1n), frac(2n, 3n))).toEqual({ num: 1n, den: 3n });
    expect(mul(frac(4n, 7n), frac(3n, 8n))).toEqual({ num: 3n, den: 14n });
    expect(div(frac(1n, 3n), frac(2n, 3n))).toEqual({ num: 1n, den: 2n });
    expect(negate(frac(3n, 2n))).toEqual({ num: -3n, den: 2n });
  });

  it("格式化与十进制辅助显示", () => {
    expect(formatFraction(frac(5n))).toBe("5");
    expect(formatFraction(frac(5n, 2n))).toBe("5/2");
    expect(toDecimal(frac(1n, 3n), 4)).toBe("0.3333…");
    expect(toDecimal(frac(1n, 4n))).toBe("0.25");
    // 余数在 2 位时仍未除尽 -> 截断标记
    expect(toDecimal(frac(1n, 8n), 2)).toBe("0.12…");
    expect(toDecimal(frac(1n, 8n))).toBe("0.125");
  });
});

describe("A1 寻址", () => {
  it("合法边界", () => {
    expect(parseRef("A1")).toEqual({ col: 0, row: 0 });
    expect(parseRef("t20")).toEqual({ col: 19, row: 19 });
    expect(formatRef({ col: 0, row: 0 })).toBe("A1");
  });

  it("越界与非法形式", () => {
    expect(parseRef("U1")).toBeNull();
    expect(parseRef("A0")).toBeNull();
    expect(parseRef("A21")).toBeNull();
    expect(parseRef("A01")).toBeNull();
    expect(parseRef("AA1")).toBeNull();
  });
});

describe("公式解析器：优先级与一元负号", () => {
  function refsOf(input: string): string[] {
    const r = parseFormula(input);
    if (!r.ok) throw new Error(r.message);
    return r.refs;
  }

  it("* / 优先于 + -，同级左结合，括号改变结合性", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=2+3*4");
    expect(valueOf(sheet, "A1")).toBe("14");

    sheet.setCell("A2", "=(2+3)*4");
    expect(valueOf(sheet, "A2")).toBe("20");

    // 8/4/2 = 1（左结合），8/(4/2)=4
    sheet.setCell("A3", "=8/4/2");
    expect(valueOf(sheet, "A3")).toBe("1");
    sheet.setCell("A4", "=8/(4/2)");
    expect(valueOf(sheet, "A4")).toBe("4");

    // 2-3-4 = -5（左结合），2-(3-4)=3
    sheet.setCell("A5", "=2-3-4");
    expect(valueOf(sheet, "A5")).toBe("-5");
    sheet.setCell("A6", "=2-(3-4)");
    expect(valueOf(sheet, "A6")).toBe("3");

    expect(refsOf("2+A1*B2")).toEqual(["A1", "B2"]);
  });

  it("一元负号：--、-(...)、负号与乘除结合", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=-5");
    expect(valueOf(sheet, "A1")).toBe("-5");
    sheet.setCell("A2", "=--5");
    expect(valueOf(sheet, "A2")).toBe("5");
    sheet.setCell("A3", "=-(2+3)");
    expect(valueOf(sheet, "A3")).toBe("-5");
    sheet.setCell("A4", "=-2*3");
    expect(valueOf(sheet, "A4")).toBe("-6");
    sheet.setCell("A5", "=2*-3");
    expect(valueOf(sheet, "A5")).toBe("-6");
    sheet.setCell("A6", "=6/-2");
    expect(valueOf(sheet, "A6")).toBe("-3");
  });

  it("分数结果精确：1/3+1/3*2 = 1，而非 0.9999", () => {
    const sheet = Sheet.blank();
    sheet.setCell("A1", "=1/3+1/3*2");
    expect(valueOf(sheet, "A1")).toBe("1");
  });

  it("引用大小写不敏感并规范化", () => {
    expect(refsOf("a1+b2")).toEqual(["A1", "B2"]);
  });

  it("拒绝空白、函数、范围与乱码", () => {
    const bad = [
      "1 + 2",
      "SUM(A1:A3)",
      "A1:A3",
      "1.5+2",
      "1++",
      "(1+2",
      "1+2)",
      "U1+1",
      "A21",
      "1A",
      "$A$1",
      "",
    ];
    for (const f of bad) {
      expect(parseFormula(f).ok, `应当拒绝: ${f}`).toBe(false);
    }
  });

  it("原始整数分类", () => {
    expect(classifyRaw(" 12 ").kind).toBe("integer");
    expect(classifyRaw("-7").kind).toBe("integer");
    expect(classifyRaw("01").kind).not.toBe("integer");
    expect(classifyRaw("+1").kind).not.toBe("integer");
    expect(classifyRaw("  ").kind).toBe("empty");
  });
});
