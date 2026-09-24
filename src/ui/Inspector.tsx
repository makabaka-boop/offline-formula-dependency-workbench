import type { Sheet, SnapshotCell } from "../engine/sheet";
import type { Trace, NodeTrace } from "../engine/explain";
import { buildTrace, nodeValueText } from "../engine/explain";
import { formatFraction } from "../engine/fraction";
import { parseRef, formatRef } from "../engine/address";

interface InspectorProps {
  sheet: Sheet;
  cell: SnapshotCell | undefined;
  selected: string;
  onSelect: (ref: string) => void;
}

function RefChip({ ref, onSelect }: { ref: string; onSelect: (r: string) => void }) {
  return (
    <button
      type="button"
      className="chip"
      onClick={() => onSelect(ref)}
      title={`跳转到 ${ref}`}
    >
      {ref}
    </button>
  );
}

function TraceNodeView({
  node,
  depth,
  onSelect,
}: {
  node: NodeTrace;
  depth: number;
  onSelect: (r: string) => void;
}) {
  const refMatch = /引用 ([A-T]\d{1,2})/.exec(node.label);
  return (
    <div className="trace-row" style={{ marginLeft: depth * 14 }}>
      <span className="trace-label">{node.label}</span>
      {refMatch && <RefChip ref={refMatch[1]} onSelect={onSelect} />}
      {node.error ? (
        <span className={`trace-err err-${node.error.kind}`}>
          {node.error.kind === "cycle" ? "↻" : "⚠"} {node.error.message}
        </span>
      ) : (
        nodeValueText(node) && (
          <span className="trace-value">= {nodeValueText(node)}</span>
        )
      )}
      {node.children.map((child, i) => (
        <TraceNodeView
          key={i}
          node={child}
          depth={depth + 1}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function Inspector({ sheet, cell, selected, onSelect }: InspectorProps) {
  const trace: Trace = buildTrace(sheet, selected);
  const rec = sheet.get(selected);
  const error = cell?.error;

  const move = (dr: number, dc: number) => {
    const coord = parseRef(selected)!;
    const row = Math.min(19, Math.max(0, coord.row + dr));
    const col = Math.min(19, Math.max(0, coord.col + dc));
    onSelect(formatRef({ row, col }));
  };

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <h2>{selected} 格详情</h2>
        <div className="nav-buttons">
          <button type="button" onClick={() => move(-1, 0)}>↑</button>
          <button type="button" onClick={() => move(1, 0)}>↓</button>
          <button type="button" onClick={() => move(0, -1)}>←</button>
          <button type="button" onClick={() => move(0, 1)}>→</button>
        </div>
      </div>

      <section>
        <h3>原始内容 / 公式</h3>
        <code className="raw-code">
          {rec && rec.raw !== "" ? rec.raw : "（空）"}
        </code>
      </section>

      {cell?.status === "value" && cell.fraction && (
        <section>
          <h3>精确分数</h3>
          <p className="fraction-line">
            <strong>{formatFraction({
              num: BigInt(cell.fraction.num),
              den: BigInt(cell.fraction.den),
            })}</strong>
          </p>
          <p className="decimal-line">十进制近似：{cell.decimal}</p>
        </section>
      )}

      {cell?.status === "error" && error && (
        <section className="error-box">
          <h3>
            {error.kind === "cycle"
              ? "↻ 循环引用"
              : error.kind === "divzero"
                ? "⚠ 除零错误"
                : "⚠ 公式非法"}
          </h3>
          <p>{error.message}</p>
          {error.cycle && (
            <p className="path-line">
              <span className="path-label">实际环：</span>
              {error.cycle.map((r, i) => (
                <span key={i}>
                  <RefChip ref={r} onSelect={onSelect} />
                  {i < error.cycle!.length - 1 && <span> → </span>}
                </span>
              ))}
            </p>
          )}
          <p className="path-line">
            <span className="path-label">错误路径：</span>
            {error.path.map((r, i) => (
              <span key={i}>
                <RefChip ref={r} onSelect={onSelect} />
                {i < error.path.length - 1 && <span> → </span>}
              </span>
            ))}
          </p>
          {error.origin !== selected && (
            <p className="origin-line">错误来源：{error.origin}</p>
          )}
        </section>
      )}

      <section>
        <h3>直接依赖（本格直接引用）</h3>
        <div className="chip-row">
          {cell && cell.deps.length > 0 ? (
            cell.deps.map((d) => <RefChip key={d} ref={d} onSelect={onSelect} />)
          ) : (
            <span className="muted">无</span>
          )}
        </div>
      </section>

      <section>
        <h3>直接下游（直接引用本格）</h3>
        <div className="chip-row">
          {cell && cell.dependents.length > 0 ? (
            cell.dependents.map((d) => (
              <RefChip key={d} ref={d} onSelect={onSelect} />
            ))
          ) : (
            <span className="muted">无</span>
          )}
        </div>
      </section>

      <section className="trace-section">
        <h3>数值来源解释（逐步推导）</h3>
        {trace.kind === "empty" && <p className="muted">{trace.text}</p>}
        {trace.kind === "integer" && (
          <p className="muted">{trace.text} = {trace.value.num.toString()}</p>
        )}
        {trace.kind === "formula" && (
          <div className="trace-tree">
            <TraceNodeView node={trace.node} depth={0} onSelect={onSelect} />
          </div>
        )}
      </section>
    </aside>
  );
}
