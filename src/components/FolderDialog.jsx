import { useState } from "react";
import { FolderPlus, X } from "lucide-react";

export function FolderDialog({ open, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(cleanName);
      setName("");
      onClose();
    } catch (cause) {
      setError(cause.message || "Không thể tạo thư mục.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="auth-dialog folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Đóng"><X size={19} /></button>
        <div className="modal-icon folder-modal-icon"><FolderPlus size={21} /></div>
        <p className="eyebrow">SẮP XẾP THƯ VIỆN</p>
        <h2 id="folder-title">Tạo thư mục mới</h2>
        <p className="modal-description">Gom sách theo môn học, chủ đề hoặc bất cứ cách nào phù hợp với bạn.</p>
        <form onSubmit={submit}>
          <label className="form-label">Tên thư mục
            <input autoFocus className="form-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Ví dụ: Tiếng Anh, Lịch sử..." required />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={onClose}>Hủy</button>
            <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Đang tạo…" : "Tạo thư mục"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
