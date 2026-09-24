import { Sheet } from "../src/engine/sheet";
import { formatFraction } from "../src/engine/fraction";
import type { ErrorKind } from "../src/engine/sheet";

export function valueOf(sheet: Sheet, ref: string): string {
  const rec = sheet.get(ref);
  if (!rec || rec.result.status !== "value") {
    throw new Error(`${ref} 不是值`);
  }
  return formatFraction(rec.result.value);
}

export function errorKindOf(sheet: Sheet, ref: string): ErrorKind {
  const rec = sheet.get(ref);
  if (!rec || rec.result.status !== "error") {
    throw new Error(`${ref} 不是错误格`);
  }
  return rec.result.error.kind;
}
