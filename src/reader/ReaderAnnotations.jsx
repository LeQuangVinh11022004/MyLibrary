import { Bookmark, Trash2, X } from "lucide-react";
import { useState } from "react";

function locationLabel(location) {
  if (!location) return "Vị trí chưa xác định";
  if (location.format === "pdf") return `PDF · trang ${location.pageNumber}`;
  if (location.format === "epub") return `EPUB · ${Math.round((location.percentage || 0) * 100)}%`;
  if (location.format === "azw3") return `AZW3 · chương ${(location.chapterIndex || 0) + 1}`;
  return "Văn bản";
}

export function ReaderAnnotations({ open, annotations, onClose, onBookmark, onCreate, onDelete, onJump }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    const body = note.trim();
    if (!body) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(body);
      setNote("");
    } catch (cause) {
      setError(cause.message || "Không thể lưu ghi chú.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="reader-annotations" aria-label="Dấu trang và ghi chú">
      <header className="reader-annotations-header">
        <div><strong>Dấu trang & ghi chú</strong><span>{annotations.length} mục</span></div>
        <button className="reader-annotation-icon" type="button" onClick={onClose} aria-label="Đóng ghi chú"><X size={18} /></button>
      </header>
      <form className="reader-note-form" onSubmit={submit}>
        <button className="reader-control" type="button" onClick={onBookmark}>Đánh dấu vị trí hiện tại</button>
        <label htmlFor="reader-note">Ghi chú tại vị trí đang đọc</label>
        <textarea id="reader-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={5000} placeholder="Viết điều bạn muốn nhớ…" rows={3} />
        {error && <p className="reader-annotation-error" role="alert">{error}</p>}
        <button className="reader-control" type="submit" disabled={busy || !note.trim()}>{busy ? "Đang lưu…" : "Lưu ghi chú"}</button>
      </form>
      <div className="reader-annotation-list">
        {!annotations.length && <p className="reader-annotation-empty">Chưa có dấu trang hay ghi chú.</p>}
        {annotations.map((annotation) => (
          <article className="reader-annotation-item" key={annotation.id}>
            <button className="reader-annotation-jump" type="button" onClick={() => onJump(annotation.location)}>
              <span><Bookmark size={14} />{locationLabel(annotation.location)}</span>
              <strong>{annotation.kind === "bookmark" ? "Dấu trang" : "Ghi chú"}</strong>
              {annotation.kind === "note" && <p>{annotation.body}</p>}
            </button>
            <button className="reader-annotation-icon danger" type="button" onClick={() => onDelete(annotation.id)} aria-label="Xóa dấu trang hoặc ghi chú"><Trash2 size={15} /></button>
          </article>
        ))}
      </div>
    </aside>
  );
}
