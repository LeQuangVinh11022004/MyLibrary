import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, BookMarked, BookOpen, Check, Grid2X2, List, Plus, Sparkles } from "lucide-react";
import { AuthModal } from "./components/AuthModal";
import { DocumentGrid } from "./components/DocumentGrid";
import { FolderDialog } from "./components/FolderDialog";
import { Sidebar } from "./components/Sidebar";
import { Toast } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { useAuth } from "./hooks/useAuth";
import { useLibrary } from "./hooks/useLibrary";
import { isSupabaseConfigured, supabaseSetupMessage } from "./lib/supabase";
import { getFolderPath } from "./lib/library-utils";
import "./styles.css";

const VIEW_LABELS = {
  all: ["Tất cả sách", "Mọi cuốn sách và tài liệu, được sắp xếp gọn gàng."],
  recent: ["Đọc gần đây", "Tiếp tục với những tài liệu bạn vừa mở."],
  favorites: ["Yêu thích", "Những cuốn bạn muốn giữ gần bên."],
  unread: ["Chưa đọc", "Một vài điều thú vị vẫn đang chờ bạn."],
};

export default function App() {
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const [folderId, setFolderId] = useState(null);
  const [sort, setSort] = useState("newest");
  const [layout, setLayout] = useState("grid");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const toastTimer = useRef(null);
  const auth = useAuth();
  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 4200);
  }, []);
  const library = useLibrary(auth.user, notify);

  const visibleDocuments = useMemo(() => {
    let items = [...library.documents];
    if (folderId) items = items.filter((item) => item.folderId === folderId);
    else if (view === "favorites") items = items.filter((item) => item.favorite);
    else if (view === "unread") items = items.filter((item) => item.status !== "read");
    else if (view === "recent") {
      items = items.sort((a, b) => (b.lastOpened || b.addedAt) - (a.lastOpened || a.addedAt)).slice(0, 20);
    }
    const query = search.trim().toLocaleLowerCase("vi");
    if (query) {
      items = items.filter((item) => {
        const folder = library.folders.find((candidate) => candidate.id === item.folderId);
        return item.name.toLocaleLowerCase("vi").includes(query)
          || item.relativePath.toLocaleLowerCase("vi").includes(query)
          || getFolderPath(folder, library.folders).toLocaleLowerCase("vi").includes(query);
      });
    }
    if (view !== "recent") {
      if (sort === "name") items.sort((a, b) => a.name.localeCompare(b.name, "vi"));
      else if (sort === "oldest") items.sort((a, b) => a.addedAt - b.addedAt);
      else items.sort((a, b) => b.addedAt - a.addedAt);
    }
    return items;
  }, [folderId, library.documents, library.folders, search, sort, view]);

  const currentView = folderId
    ? [getFolderPath(library.folders.find((item) => item.id === folderId), library.folders) || "Thư mục", "Tài liệu trong thư mục này."]
    : VIEW_LABELS[view];

  function requireUser() {
    if (!isSupabaseConfigured) {
      notify(supabaseSetupMessage);
      return false;
    }
    if (!auth.user) {
      auth.openAuth();
      return false;
    }
    return true;
  }

  function chooseUpload(folder = false) {
    if (!requireUser()) return;
    (folder ? folderInput : fileInput).current?.click();
  }

  async function uploadSelection(event, isFolderUpload = false) {
    const input = event.currentTarget;
    if (!input.files?.length) return;
    try {
      await library.uploadFiles(input.files, folderId, isFolderUpload);
    } catch (error) {
      console.error("Không thể tải tài liệu lên.", error);
      notify(`Không thể tải lên: ${error.message}`);
    } finally {
      input.value = "";
    }
  }

  async function createFolder(name) {
    if (!requireUser()) throw new Error("Đăng nhập để tạo thư mục.");
    const duplicate = library.folders.some((folder) => folder.parentId === folderId
      && folder.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"));
    if (duplicate) throw new Error("Thư mục này đã tồn tại tại vị trí hiện tại.");
    const createdFolderId = await library.createFolder(name, folderId);
    setFolderId(createdFolderId);
    setView("all");
  }

  function openDocument(document) {
    if (!requireUser()) return;
    if (!document?.id) {
      notify("Không tìm thấy mã tài liệu. Hãy tải lại thư viện rồi thử lại.");
      return;
    }
    try {
      window.sessionStorage.setItem("trang-sach-current-document-id", document.id);
    } catch (error) {
      console.warn("Không thể lưu tạm mã tài liệu.", error);
    }
    const url = new URL(`${import.meta.env.BASE_URL}reader.html`, window.location.origin);
    url.searchParams.set("id", document.id);
    window.location.assign(url.href);
  }

  async function runAction(action, successMessage) {
    try {
      await action();
      if (successMessage) notify(successMessage);
    } catch (error) {
      console.error("Không thể hoàn tất thao tác thư viện.", error);
      notify(`Thao tác thất bại: ${error.message}`);
    }
  }

  async function signOut() {
    try {
      await auth.signOut();
      setFolderId(null);
      setView("all");
      notify("Đã đăng xuất.");
    } catch (error) {
      console.error("Không thể đăng xuất.", error);
      notify(`Không thể đăng xuất: ${error.message}`);
    }
  }

  function selectView(nextView) {
    setView(nextView);
    setFolderId(null);
    setSidebarOpen(false);
  }

  function selectFolder(nextFolder) {
    setFolderId(nextFolder);
    setView("all");
    setSidebarOpen(false);
  }

  const readCount = library.documents.filter((item) => item.status === "read").length;

  return (
    <div className="app-shell">
      <Sidebar
        user={auth.user}
        view={view}
        folderId={folderId}
        folders={library.folders}
        documents={library.documents}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onViewChange={selectView}
        onFolderSelect={selectFolder}
        onUpload={() => chooseUpload(false)}
        onUploadFolder={() => chooseUpload(true)}
        onCreateFolder={() => requireUser() && setFolderDialogOpen(true)}
        onAuth={auth.openAuth}
        onSignOut={signOut}
      />
      <main className="main-content">
        <TopBar
          user={auth.user}
          search={search}
          onSearch={setSearch}
          onMenu={() => setSidebarOpen(true)}
          onUpload={() => chooseUpload(false)}
          onAuth={auth.openAuth}
          onSignOut={signOut}
          uploading={library.uploading}
        />
        <div className="page-content">
          {!isSupabaseConfigured && (
            <div className="connection-banner" role="status">
              <Sparkles size={18} />
              <span>{supabaseSetupMessage}</span>
            </div>
          )}
          {library.uploading && <div className="upload-banner" role="status">Đang tải tệp lên thư viện. Không đóng trang cho đến khi hoàn tất.</div>}
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow"><Sparkles size={14} /> MỘT GÓC NHỎ DÀNH CHO NHỮNG ĐIỀU HAY</span>
              <h1>Mở một trang sách,<br /><em>mở một chân trời.</em></h1>
              <p>Sách, tài liệu và những ý tưởng bạn muốn giữ lại — tất cả trong thư viện riêng.</p>
            </div>
            <div className="hero-art" aria-hidden="true">
              <span className="hero-orbit orbit-one" /><span className="hero-orbit orbit-two" />
              <span className="hero-sun" />
              <span className="hero-book hero-book-back"><i /><i /><i /></span>
              <span className="hero-book hero-book-front"><i /><i /><i /></span>
              <span className="hero-star star-one">✦</span><span className="hero-star star-two">✧</span>
            </div>
            <button className="button button-primary hero-upload" type="button" onClick={() => chooseUpload(false)}><Plus size={18} /> Thêm tài liệu</button>
          </section>

          <section className="stats-row" aria-label="Tổng quan thư viện">
            <article className="stat-card stat-books"><span className="stat-icon"><BookOpen size={19} /></span><div><span>TÀI LIỆU</span><strong>{library.documents.length}</strong></div><small>đang lưu giữ</small></article>
            <article className="stat-card stat-folders"><span className="stat-icon"><BookMarked size={19} /></span><div><span>THƯ MỤC</span><strong>{library.folders.length}</strong></div><small>được sắp xếp</small></article>
            <article className="stat-card stat-read"><span className="stat-icon"><Check size={19} /></span><div><span>ĐÃ ĐỌC</span><strong>{readCount}</strong></div><small>mỗi trang là một bước</small></article>
          </section>

          <section className="library-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow section-eyebrow">BỘ SƯU TẬP CỦA BẠN</span>
                <h2>{currentView[0]} <span>{visibleDocuments.length}</span></h2>
                <p>{currentView[1]}</p>
              </div>
              <div className="library-tools">
                <label className="sort-control"><ArrowDownAZ size={17} /><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sắp xếp tài liệu"><option value="newest">Mới thêm</option><option value="name">Tên A–Z</option><option value="oldest">Cũ nhất</option></select></label>
                <div className="layout-switch" role="group" aria-label="Kiểu hiển thị">
                  <button className={layout === "grid" ? "selected" : ""} type="button" onClick={() => setLayout("grid")} aria-label="Hiển thị dạng lưới"><Grid2X2 size={17} /></button>
                  <button className={layout === "list" ? "selected" : ""} type="button" onClick={() => setLayout("list")} aria-label="Hiển thị dạng danh sách"><List size={18} /></button>
                </div>
              </div>
            </div>
            {library.loading && !library.documents.length ? (
              <DocumentGrid documents={[]} folders={[]} loading />
            ) : (
              <DocumentGrid
                documents={visibleDocuments}
                folders={library.folders}
                layout={layout}
                loading={false}
                searching={Boolean(search)}
                onOpen={openDocument}
                onFavorite={(id) => runAction(() => library.toggleFavorite(id))}
                onDownload={(item) => runAction(() => library.downloadDocument(item))}
                onDelete={(id) => runAction(() => library.deleteDocument(id))}
                onRead={(id) => runAction(() => library.toggleRead(id))}
                onUpload={() => chooseUpload(false)}
                onLogin={!auth.user ? auth.openAuth : null}
              />
            )}
          </section>
          <footer className="page-footer"><span>Đọc chậm thôi, điều hay sẽ ở lại.</span><span><i /> Thư viện cá nhân · lưu trữ riêng tư</span></footer>
        </div>
      </main>

      <input ref={fileInput} className="visually-hidden" type="file" multiple onChange={uploadSelection} />
      <input ref={folderInput} className="visually-hidden" type="file" webkitdirectory="" multiple onChange={(event) => uploadSelection(event, true)} />
      <AuthModal
        open={auth.authOpen}
        initialCode={auth.initialCode}
        createdCode={auth.createdCode}
        onClose={auth.closeAuth}
        onAuthenticate={auth.authenticate}
      />
      <FolderDialog
        open={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        onCreate={createFolder}
      />
      <Toast message={toast} onClose={() => setToast("")} />
    </div>
  );
}
