import { BookOpen, Search } from "lucide-react";
import { DocumentCard } from "./DocumentCard";

export function DocumentGrid({ documents, folders, loading, searching, layout = "grid", onOpen, onFavorite, onDownload, onDelete, onRead, onUpload, onLogin }) {
  if (loading) {
    return <div className="loading-grid" aria-label="Đang tải thư viện">{Array.from({ length: 8 }, (_, index) => <div className="skeleton-card" key={index} />)}</div>;
  }
  if (!documents.length) {
    return (
      <section className="empty-state">
        <div className="empty-art"><BookOpen size={34} strokeWidth={1.3} /><span>✦</span></div>
        <h3>{searching ? "Chưa tìm thấy tài liệu" : "Góc đọc của bạn đang chờ"}</h3>
        <p>{searching
          ? "Thử từ khóa khác hoặc kiểm tra lại chính tả."
          : "Thêm sách, PDF và tài liệu học tập để tạo nên thư viện riêng của bạn."}</p>
        {!searching && <button className="button button-primary" type="button" onClick={onLogin || onUpload}>{onLogin ? "Đăng nhập để bắt đầu" : "Thêm cuốn đầu tiên"}</button>}
        <span className="supported-formats">PDF · EPUB · AZW3 · DOCX · HÌNH ẢNH</span>
      </section>
    );
  }
  return (
    <div className={`document-grid${layout === "list" ? " list-layout" : ""}`}>
      {documents.map((document) => {
        const folder = folders.find((item) => item.id === document.folderId);
        return (
          <DocumentCard
            key={document.id}
            document={document}
            folderName={folder?.name}
            onOpen={() => onOpen(document)}
            onFavorite={() => onFavorite(document.id)}
            onDownload={() => onDownload(document)}
            onDelete={() => onDelete(document.id)}
            onRead={() => onRead(document.id)}
          />
        );
      })}
    </div>
  );
}
