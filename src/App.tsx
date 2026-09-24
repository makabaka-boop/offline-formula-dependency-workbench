import { useCallback, useState } from "react";
import { Sheet, type Snapshot } from "./engine/sheet";
import { parseRef, formatRef } from "./engine/address";
import { Grid } from "./ui/Grid";
import { Inspector } from "./ui/Inspector";

export function App() {
  const [sheet] = useState(() => Sheet.blank());
  const [selected, setSelected] = useState("A1");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [, force] = useState(0);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");

  // 表格与导出共享同一份当前计算快照
  const snapshot: Snapshot = sheet.snapshot();

  const rerender = () => force((n) => n + 1);

  const beginEdit = useCallback(
    (ref: string) => {
      setEditing(ref);
      setDraft(sheet.get(ref)?.raw ?? "");
    },
    [sheet],
  );

  const commit = useCallback(() => {
    if (!editing) return;
    try {
      sheet.setCell(editing, draft);
      setNotice({ kind: "ok", text: `已写入 ${editing}` });
    } catch (e) {
      setNotice({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
    setEditing(null);
    rerender();
  }, [draft, editing, sheet]);

  const cancel = () => {
    setEditing(null);
    setDraft("");
  };

  const selectCell = (ref: string) => {
    if (editing) commit();
    setSelected(ref);
  };

  const move = (dr: number, dc: number) => {
    const coord = parseRef(selected)!;
    const row = Math.min(19, Math.max(0, coord.row + dr));
    const col = Math.min(19, Math.max(0, coord.col + dc));
    setSelected(formatRef({ row, col }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        move(-1, 0);
        break;
      case "ArrowDown":
        e.preventDefault();
        move(1, 0);
        break;
      case "ArrowLeft":
        e.preventDefault();
        move(0, -1);
        break;
      case "ArrowRight":
        e.preventDefault();
        move(0, 1);
        break;
      case "Enter":
      case "F2":
        e.preventDefault();
        beginEdit(selected);
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        sheet.setCell(selected, "");
        rerender();
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          beginEdit(selected);
          setDraft(e.key);
        }
    }
  };

  const doExport = () => {
    const payload = {
      type: "offline-spreadsheet/export",
      generatedAt: new Date().toISOString(),
      snapshot: sheet.snapshot(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spreadsheet-snapshot-v${sheet.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch (e) {
      setNotice({
        kind: "err",
        text: `JSON 无法解析，整份网格未改动：${
          e instanceof Error ? e.message : String(e)
        }`,
      });
      return;
    }
    try {
      sheet.loadObject(parsed);
      setShowImport(false);
      setImportText("");
      setNotice({ kind: "ok", text: "导入成功，已全量重算" });
      setSelected("A1");
      rerender();
    } catch (e) {
      setNotice({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const selectedCell = snapshot.cells[selected];

  return (
    <div className="app" tabIndex={0} onKeyDown={onKeyDown}>
      <header className="toolbar">
        <h1>离线试算表工作台</h1>
        <div className="toolbar-controls">
          <span className="snapshot-tag">快照 v{sheet.version}</span>
          <button type="button" onClick={() => beginEdit(selected)}>
            编辑选中格
          </button>
          <button type="button" onClick={doExport}>
            导出当前快照 JSON
          </button>
          <button type="button" onClick={() => setShowImport(true)}>
            导入网格 JSON
          </button>
        </div>
      </header>

      <div className="formula-bar">
        <span className="fb-ref">{editing ?? selected}</span>
        <span className="fb-eq">fx</span>
        <input
          value={editing ? draft : sheet.get(selected)?.raw ?? ""}
          onChange={(e) => {
            if (!editing) beginEdit(selected);
            setDraft(e.target.value);
          }}
          onFocus={() => {
            if (!editing) beginEdit(selected);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
            } else if (e.key === "Escape") {
              cancel();
            }
          }}
          placeholder="输入整数，或 = 开头的公式（如 =A1*2+1/3），Enter 提交"
        />
        <span className="fb-hint">Enter 提交 · Esc 取消 · Delete 清空</span>
      </div>

      {notice && (
        <div className={`notice ${notice.kind}`}>
          {notice.text}
          <button type="button" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      <div className="workspace">
        <Grid
          snapshot={snapshot}
          selected={selected}
          editing={editing}
          draft={draft}
          onSelect={selectCell}
          onStartEdit={beginEdit}
          onDraftChange={setDraft}
          onCommit={commit}
          onCancel={cancel}
          onMove={move}
        />
        <Inspector
          sheet={sheet}
          cell={selectedCell}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      <footer className="legend">
        <span>
          <i className="sw sw-cycle" /> 循环引用（环上成员）
        </span>
        <span>
          <i className="sw sw-prop" /> 环/除零/非法的下游（不显示旧值）
        </span>
        <span className="muted">
          空引用按 0 参与运算；所有结果为 BigInt 约分分数，十进制仅为辅助近似。
        </span>
      </footer>

      {showImport && (
        <div className="modal-backdrop" onClick={() => setShowImport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>导入网格 JSON</h2>
            <p className="muted">
              形态：{"{\"cells\":{\"A1\":\"2\",\"A2\":\"=A1*3\"}}"}。
              任何一格非法都会拒绝整份网格并保留当前表。
            </p>
            <textarea
              rows={12}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{"cells":{"A1":"=1/3","A2":"=A1+2"}}'
            />
            <div className="modal-actions">
              <button type="button" className="primary" onClick={doImport}>
                校验并导入
              </button>
              <button type="button" onClick={() => setShowImport(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
