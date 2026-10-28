import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut, Menu, Search, Upload, X } from "lucide-react";

export function TopBar({ user, search, onSearch, onMenu, onUpload, onAuth, onSignOut, uploading = false }) {
  const searchRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  function closeSearch() {
    setSearchOpen(false);
    onSearch("");
  }

  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" type="button" onClick={onMenu} aria-label="Mở menu"><Menu size={20} /></button>
      <div className="breadcrumb"><span>Thư viện</span><span className="breadcrumb-slash">/</span><strong>Không gian của bạn</strong></div>
      <div className="topbar-actions">
        <div className={`search-field${searchOpen ? " search-expanded" : ""}`}>
          <Search className="search-icon" size={18} aria-hidden="true" />
          <button className="mobile-search-trigger" type="button" onClick={() => setSearchOpen(true)} aria-label="Mở tìm kiếm"><Search size={19} /></button>
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && searchOpen) {
                event.preventDefault();
                if (search) onSearch("");
                else closeSearch();
              }
            }}
            placeholder="Tìm sách, tài liệu..."
            aria-label="Tìm tài liệu"
          />
          <kbd>⌘ K</kbd>
          {searchOpen && <button className="mobile-search-close" type="button" onClick={closeSearch} aria-label="Đóng tìm kiếm"><X size={18} /></button>}
        </div>
        <button className="button button-quiet auth-top-button" type="button" onClick={user ? onSignOut : onAuth} aria-label={user ? "Đăng xuất" : "Đăng nhập"}>
          {user ? <LogOut size={17} /> : <LogIn size={17} />}
          <span>{user ? "Đăng xuất" : "Đăng nhập"}</span>
        </button>
        <button className="button button-primary top-upload" type="button" onClick={onUpload} disabled={uploading} aria-label={uploading ? "Đang tải lên" : "Tải lên"}><Upload size={17} /><span>{uploading ? "Đang tải…" : "Tải lên"}</span></button>
      </div>
    </header>
  );
}
