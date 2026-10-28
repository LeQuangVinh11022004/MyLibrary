import { Search, X } from "lucide-react";
import { useState } from "react";

export function ReaderSearch({ open, onClose, onSearch }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      setResult(await onSearch(cleanQuery));
    } catch (cause) {
      setError(cause.message || "Không thể tìm trong tài liệu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="reader-search-panel" aria-label="Tìm trong tài liệu">
      <header className="reader-annotations-header">
        <div><strong>Tìm trong tài liệu</strong><span>PDF · EPUB · AZW3 · văn bản</span></div>
        <button className="reader-annotation-icon" type="button" onClick={onClose} aria-label="Đóng tìm kiếm"><X size={18} /></button>
      </header>
      <form className="reader-find-form" onSubmit={submit}>
        <label className="reader-find-input">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder="Nhập từ hoặc cụm từ…" aria-label="Từ khóa tìm kiếm" autoFocus />
        </label>
        <button className="reader-control" type="submit" disabled={busy || !query.trim()}>{busy ? "Đang tìm…" : "Tìm"}</button>
      </form>
      {error && <p className="reader-annotation-error reader-find-message" role="alert">{error}</p>}
      {result && <p className="reader-find-message" role="status">{result}</p>}
    </aside>
  );
}
