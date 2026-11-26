import { useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Search, X } from "lucide-react";

export function ReaderTocSidebar({ open, items, activeId, onSelect, onClose }) {
  const listRef = useRef(null);
  const [filter, setFilter] = useState("");

  const visibleItems = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase("vi");
    if (!query) return items.map((entry, index) => ({ entry, index }));
    return items
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.label.toLocaleLowerCase("vi").includes(query));
  }, [filter, items]);

  useEffect(() => {
    if (!open || !activeId) return;
    const activeElement = listRef.current?.querySelector(".reader-toc-item.is-active");
    activeElement?.scrollIntoView({ block: "nearest" });
  }, [activeId, open]);

  if (!open || !items.length) return null;

  return (
    <>
      <button className="reader-toc-scrim" type="button" aria-label="Đóng mục lục" onClick={onClose} />
      <aside className="reader-toc-sidebar" aria-label="Mục lục">
        <header className="reader-toc-sidebar-head">
          <span><ListTree size={16} /> <strong>Mục lục</strong> <em>{items.length}</em></span>
          <button className="reader-annotation-icon" type="button" onClick={onClose} aria-label="Ẩn mục lục" title="Ẩn mục lục (M)"><X size={17} /></button>
        </header>
        {items.length > 8 && (
          <label className="reader-toc-filter">
            <Search size={14} aria-hidden="true" />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Lọc chương, mục…" aria-label="Lọc mục lục" />
          </label>
        )}
        <nav className="reader-toc-sidebar-list" ref={listRef}>
          {visibleItems.map(({ entry, index }) => (
            <button
              key={`${entry.id}-${index}`}
              type="button"
              className={`reader-toc-item${entry.id === activeId ? " is-active" : ""}`}
              style={{ paddingLeft: `${12 + Math.min(entry.depth || 0, 4) * 14}px` }}
              onClick={() => onSelect(entry)}
              title={entry.label}
              aria-current={entry.id === activeId ? "true" : undefined}
            >
              <span>{entry.label}</span>
              {entry.pageNumber ? <small>{entry.pageNumber}</small> : null}
            </button>
          ))}
          {!visibleItems.length && <p className="reader-toc-empty">Không có mục nào khớp.</p>}
        </nav>
      </aside>
    </>
  );
}
