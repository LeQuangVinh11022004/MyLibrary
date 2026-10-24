import { BookOpen, Clock3, Folder, FolderPlus, Heart, LibraryBig, Plus, Upload, X } from "lucide-react";
import { getFolderPath } from "../lib/library-utils";

const NAV_ITEMS = [
  { id: "all", label: "Tất cả sách", icon: LibraryBig },
  { id: "recent", label: "Đọc gần đây", icon: Clock3 },
  { id: "favorites", label: "Yêu thích", icon: Heart },
  { id: "unread", label: "Chưa đọc", icon: BookOpen },
];

export function Sidebar({
  user, view, folderId, folders, documents, open, onClose, onViewChange, onFolderSelect,
  onUpload, onUploadFolder, onCreateFolder, onAuth, onSignOut,
}) {
  return (
    <>
      <button className={`sidebar-scrim${open ? " visible" : ""}`} type="button" aria-label="Đóng menu" onClick={onClose} />
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="sidebar-top">
          <a className="brand" href={import.meta.env.BASE_URL} aria-label="Trang Sách - thư viện">
            <span className="brand-icon"><BookOpen size={21} strokeWidth={1.8} /></span>
            <span><strong>trang sách</strong><small>THƯ VIỆN CỦA BẠN</small></span>
          </a>
          <button className="icon-button sidebar-close" type="button" onClick={onClose} aria-label="Đóng menu"><X /></button>
          <button className="button button-primary sidebar-add" type="button" onClick={onUpload}>
            <Plus size={18} /> Thêm tài liệu
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="Thư viện">
          <p className="nav-label">KHÔNG GIAN CỦA BẠN</p>
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item${view === id && !folderId ? " active" : ""}`}
              key={id}
              type="button"
              onClick={() => onViewChange(id)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "all" && <span className="nav-count">{documents.length}</span>}
            </button>
          ))}
          <div className="folder-section-head">
            <p className="nav-label">THƯ MỤC</p>
            <div>
              <button className="icon-button small-icon" type="button" onClick={onUploadFolder} title="Tải lên thư mục" aria-label="Tải lên thư mục"><Upload size={15} /></button>
              <button className="icon-button small-icon" type="button" onClick={onCreateFolder} title="Tạo thư mục" aria-label="Tạo thư mục"><FolderPlus size={15} /></button>
            </div>
          </div>
          <div className="folder-nav">
            {folders.map((folder) => (
              <button
                className={`nav-item folder-item${folderId === folder.id ? " active" : ""}`}
                key={folder.id}
                type="button"
                title={getFolderPath(folder, folders)}
                onClick={() => onFolderSelect(folder.id)}
              >
                <Folder size={17} strokeWidth={1.8} />
                <span>{getFolderPath(folder, folders)}</span>
                <span className="nav-count">{documents.filter((document) => document.folderId === folder.id).length}</span>
              </button>
            ))}
            {!folders.length && <p className="folder-empty">Thư mục mới sẽ hiện ở đây.</p>}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <span className="privacy-icon"><BookOpen size={17} /></span>
            <strong>Riêng tư theo mặc định</strong>
            <p>Sách và tài liệu của bạn được lưu trong Supabase riêng tư.</p>
          </div>
          <div className="profile">
            <div className="avatar">{user ? "M" : "?"}</div>
            <div className="profile-info">
              <strong>{user ? `Thư viện #${user.user_metadata?.library_id_hint || "cá nhân"}` : "Chưa đăng nhập"}</strong>
              <span><i className={user ? "online-dot" : ""} />{user ? "Đã kết nối riêng tư" : "Kết nối Supabase"}</span>
            </div>
            <button className="profile-action" type="button" onClick={user ? onSignOut : onAuth}>
              {user ? "Thoát" : "Đăng nhập"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
