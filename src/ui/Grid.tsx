import { useEffect, useRef } from "react";
import type { Snapshot, SnapshotCell } from "../engine/sheet";
import { MAX_COL, MAX_ROW, formatRef } from "../engine/address";
import { cellDisplay, cellTitle } from "./display";

interface GridProps {
  snapshot: Snapshot;
  selected: string;
  editing: string | null;
  draft: string;
  onSelect: (ref: string) => void;
  onStartEdit: (ref: string) => void;
  onDraftChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onMove: (dr: number, dc: number) => void;
}

function classFor(
  cell: SnapshotCell | undefined,
  ref: string,
  selected: string,
): string {
  const classes = ["cell"];
  if (ref === selected) classes.push("selected");
  if (cell?.status === "error") {
    const e = cell.error;
    const isSource = e?.origin === ref;
    if (e?.kind === "cycle" && isSource) classes.push("err-cycle");
    else if (e?.kind === "parse" && isSource) classes.push("err-parse");
    else classes.push("err-prop");
    if (isSource) classes.push("err-source");
  }
  return classes.join(" ");
}

export function Grid(props: GridProps) {
  const {
    snapshot,
    selected,
    editing,
    draft,
    onSelect,
    onStartEdit,
    onDraftChange,
    onCommit,
    onCancel,
    onMove,
  } = props;

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const letters = Array.from({ length: MAX_COL }, (_, c) =>
    String.fromCharCode(65 + c),
  );

  return (
    <div className="grid-scroll">
      <table className="grid">
        <thead>
          <tr>
            <th className="corner" />
            {letters.map((l) => (
              <th key={l} className="col-head">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: MAX_ROW }, (_, r) => (
            <tr key={r}>
              <th className="row-head">{r + 1}</th>
              {Array.from({ length: MAX_COL }, (_, c) => {
                const ref = formatRef({ col: c, row: r });
                const cell = snapshot.cells[ref];
                const isEditing = editing === ref;
                return (
                  <td
                    key={ref}
                    className={classFor(cell, ref, selected)}
                    onClick={() => onSelect(ref)}
                    onDoubleClick={() => onStartEdit(ref)}
                    title={cellTitle(cell)}
                  >
                    {isEditing ? (
                      <input
                        ref={inputRef}
                        className="cell-input"
                        value={draft}
                        onChange={(e) => onDraftChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            onCommit();
                            onMove(1, 0);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            onCancel();
                          } else if (e.key === "Tab") {
                            e.preventDefault();
                            onCommit();
                            onMove(0, e.shiftKey ? -1 : 1);
                          }
                        }}
                        onBlur={onCommit}
                      />
                    ) : (
                      <span
                        className={
                          cell?.status === "value" &&
                          cell.fraction &&
                          cell.fraction.den !== "1"
                            ? "cell-text fraction"
                            : "cell-text"
                        }
                      >
                        {cellDisplay(cell)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
