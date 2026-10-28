import { BookOpen, Download, FileText, Heart, Trash2 } from "lucide-react";
import { formatDate, formatFileSize, getFileKind } from "../lib/library-utils";

export function DocumentCard({ document, folderName, onOpen, onFavorite, onDownload, onDelete, onRead }) {
  const kind = getFileKind(document);
  const book = ["EPUB", "AZW3"].includes(kind.label);
  return (
    <article className={`document-card tone-${kind.tone}`}>
      <div className="book-art" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}>
        <span className="file-tag">{kind.label}</span>
        <button
          className={`favorite-button${document.favorite ? " selected" : ""}`}
          type="button"
          onClick={(event) => { event.stopPropagation(); onFavorite(); }}
          aria-label={document.favorite ? "Bỏ yêu thích" : "Thêm yêu thích"}
          title={document.favorite ? "Bỏ yêu thích" : "Thêm yêu thích"}
        ><Heart size={17} fill={document.favorite ? "currentColor" : "none"} /></button>
        <span className="book-illustration" aria-hidden="true">
          <span className="book-spine" />
          <span className="book-cover-lines"><i /><i /><i /></span>
          <span className="book-leaf"><BookOpen size={25} strokeWidth={1.35} /></span>
        </span>
        <span className="book-open-label"><BookOpen size={14} /> {book || kind.label === "PDF" ? "Mở tài liệu" : "Xem tệp"}</span>
      </div>
      <div className="document-info">
        <div className="document-title-row">
          <button className="document-title" type="button" onClick={onOpen} title={document.name}>{document.name}</button>
        </div>
        <div className="document-subtitle">
          <span>{folderName || "Chưa phân loại"}</span><span className="meta-dot" />{formatFileSize(document.size)}
        </div>
        <div className="document-footer">
          <span>{formatDate(document.addedAt)}</span>
          <div className="card-actions">
            <button type="button" onClick={onRead} className={`read-status${document.status === "read" ? " read" : ""}`} title={document.status === "read" ? "Đánh dấu chưa đọc" : "Đánh dấu đã đọc"}>
              <span />{document.status === "read" ? "Đã đọc" : "Chưa đọc"}
            </button>
            <button className="card-icon-button" type="button" onClick={onDownload} aria-label="Tải xuống" title="Tải xuống"><Download size={15} /></button>
            <button className="card-icon-button danger-hover" type="button" onClick={onDelete} aria-label="Xóa tài liệu" title="Xóa"><Trash2 size={15} /></button>
          </div>
        </div>
      </div>
    </article>
  );
}
