/**
 * 约分后的 BigInt 分数：所有运算都以精确分数进行，绝不使用浮点。
 * 分母恒为正；0 统一表示为 0/1。
 */
export interface Fraction {
  readonly num: bigint;
  readonly den: bigint; // 恒 > 0
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

export function frac(num: bigint, den: bigint = 1n): Fraction {
  if (den === 0n) throw new Error("分母为 0");
  let n = num;
  let d = den;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { num: n / g, den: d / g };
}

export const ZERO: Fraction = { num: 0n, den: 1n };

export function add(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function sub(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function mul(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.num, a.den * b.den);
}

/** 除以 0 由调用方先行判定；此处保留兜底。 */
export function div(a: Fraction, b: Fraction): Fraction {
  if (b.num === 0n) throw new Error("除零");
  return frac(a.num * b.den, a.den * b.num);
}

export function negate(a: Fraction): Fraction {
  return { num: -a.num, den: a.den };
}

export function isZero(a: Fraction): boolean {
  return a.num === 0n;
}

export function formatFraction(a: Fraction): string {
  return a.den === 1n ? `${a.num}` : `${a.num}/${a.den}`;
}

/**
 * 十进制近似值，仅用于给质检员辅助阅读，真正的计算结果永远是分数。
 * 返回精确（可整除）的字符串，或最多 maxDigits 位小数后以 … 截断。
 */
export function toDecimal(a: Fraction, maxDigits = 10): string {
  const sign = a.num < 0n ? "-" : "";
  const n = a.num < 0n ? -a.num : a.num;
  const whole = n / a.den;
  let rem = n % a.den;
  if (rem === 0n) return `${sign}${whole}`;

  let digits = "";
  let recurring = false;
  for (let i = 0; i < maxDigits && rem !== 0n; i++) {
    rem *= 10n;
    digits += (rem / a.den).toString();
    rem %= a.den;
  }
  if (rem !== 0n) recurring = true;
  return `${sign}${whole}.${digits}${recurring ? "…" : ""}`;
}
