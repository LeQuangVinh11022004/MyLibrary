import { useEffect, useRef } from "react";
import { LogIn, LogOut, Menu, Search, Upload } from "lucide-react";

export function TopBar({ user, search, onSearch, onMenu, onUpload, onAuth, onSignOut, uploading = false }) {
  const searchRef = useRef(null);
  useEffect(() => {
    function handleShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" type="button" onClick={onMenu} aria-label="Mở menu"><Menu size={20} /></button>
      <div className="breadcrumb"><span>Thư viện</span><span className="breadcrumb-slash">/</span><strong>Không gian của bạn</strong></div>
      <div className="topbar-actions">
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <input ref={searchRef} type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Tìm sách, tài liệu..." aria-label="Tìm tài liệu" />
          <kbd>⌘ K</kbd>
        </label>
        <button className="button button-quiet auth-top-button" type="button" onClick={user ? onSignOut : onAuth} aria-label={user ? "Đăng xuất" : "Đăng nhập"}>
          {user ? <LogOut size={17} /> : <LogIn size={17} />}
          <span>{user ? "Đăng xuất" : "Đăng nhập"}</span>
        </button>
        <button className="button button-primary top-upload" type="button" onClick={onUpload} disabled={uploading} aria-label={uploading ? "Đang tải lên" : "Tải lên"}><Upload size={17} /><span>{uploading ? "Đang tải…" : "Tải lên"}</span></button>
      </div>
    </header>
  );
}
