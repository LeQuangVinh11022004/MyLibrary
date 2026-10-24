import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Download, LoaderCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatFileSize } from "../lib/library-utils";
import { Azw3Reader } from "./Azw3Reader";
import { PdfReader } from "./PdfReader";
import { ReaderToolbar } from "./ReaderToolbar";
import { loadReadingProgress, saveReadingProgress } from "./reading-progress";
import "./reader.css";

const THEMES = ["light", "sepia", "dark"];
const EpubReader = lazy(() => import("./EpubReader").then(({ EpubReader: Reader }) => ({ default: Reader })));

function getExtension(name = "") {
  return name.split(".").pop()?.toLowerCase() || "";
}

function savedPreference(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch (error) {
    console.warn("Không thể đọc tùy chỉnh trình đọc.", error);
    return fallback;
  }
}

export default function ReaderApp() {
  const [item, setItem] = useState(null);
  const [blob, setBlob] = useState(null);
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [readerReady, setReaderReady] = useState(false);
  const [progressReady, setProgressReady] = useState(false);
  const [readingProgress, setReadingProgress] = useState(null);
  const [textContent, setTextContent] = useState("");
  const [location, setLocation] = useState("Đang mở sách…");
  const [theme, setTheme] = useState(() => savedPreference("trang-sach-reader-theme", "light"));
  const [fontSize, setFontSize] = useState(() => {
    const value = Number(savedPreference("trang-sach-reader-font-size", "19"));
    return Number.isFinite(value) ? Math.min(30, Math.max(14, value)) : 19;
  });
  const [chapterIndex, setChapterIndex] = useState(0);
  const [chapterCount, setChapterCount] = useState(1);
  const [toast, setToast] = useState("");
  const epubRef = useRef(null);
  const toastTimer = useRef(null);
  const progressIdentityRef = useRef(null);
  const progressWriteWarningRef = useRef(false);
  const extension = getExtension(item?.name);
  const isPdf = extension === "pdf" || item?.content_type === "application/pdf";
  const isEpub = extension === "epub";
  const isAzw3 = extension === "azw3";
  const isBook = isEpub || isAzw3;
  const isImage = item?.content_type?.startsWith("image/")
    || ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(extension);
  const isText = item?.content_type?.startsWith("text/")
    || ["txt", "md", "csv", "json", "log"].includes(extension);
  const objectUrl = useMemo(() => (blob && isImage ? URL.createObjectURL(blob) : ""), [blob, isImage]);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3600);
  }, []);

  const handleReady = useCallback((cause) => {
    if (cause) {
      console.error("Không thể khởi chạy trình đọc.", cause);
      setError(cause.message || "Không thể mở nội dung sách.");
      setLoading(false);
      return;
    }
    setReaderReady(true);
    setLoading(false);
  }, []);

  const handleLocation = useCallback((nextLocation) => setLocation(nextLocation), []);
  const handleProgress = useCallback((progress) => {
    setReadingProgress(progress);
    const identity = progressIdentityRef.current;
    if (!identity) return;
    try {
      saveReadingProgress(identity.userId, identity.documentId, progress);
    } catch (cause) {
      console.error("Không thể lưu tiến độ đọc trên thiết bị này.", cause);
      if (!progressWriteWarningRef.current) {
        progressWriteWarningRef.current = true;
        notify("Không lưu được tiến độ đọc trên thiết bị này.");
      }
    }
  }, [notify]);
  const handleChapter = useCallback((count, initialIndex) => {
    setChapterCount(count);
    setChapterIndex(Math.min(count - 1, Math.max(0, initialIndex)));
  }, []);

  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  useEffect(() => {
    let active = true;
    setProgressReady(false);
    progressIdentityRef.current = null;
    async function loadDocument() {
      try {
        const url = new URL(window.location.href);
        let id = url.searchParams.get("id");
        if (!id) {
          try {
            id = window.sessionStorage.getItem("trang-sach-current-document-id");
          } catch (storageError) {
            console.warn("Không thể đọc mã tài liệu tạm.", storageError);
          }
        }
        if (!id) throw new Error("Thiếu mã tài liệu. Trở về thư viện và mở sách lại.");
        if (!url.searchParams.has("id")) {
          url.searchParams.set("id", id);
          window.history.replaceState(null, "", url);
        }
        if (!supabase) throw new Error("Chưa cấu hình Supabase. Hãy tạo .env.local từ .env.example rồi chạy lại ứng dụng.");
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session?.user) throw new Error("Phiên đăng nhập chưa có trên thiết bị này. Trở về thư viện và đăng nhập lại.");
        const currentUser = sessionData.session.user;
        const { data: document, error: documentError } = await supabase.from("library_documents")
          .select("*").eq("id", id).single();
        if (documentError) throw documentError;
        const ext = getExtension(document.name);
        const isImageFile = document.content_type?.startsWith("image/")
          || ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext);
        const isTextFile = document.content_type?.startsWith("text/")
          || ["txt", "md", "csv", "json", "log"].includes(ext);
        if (!["pdf", "epub", "azw3"].includes(ext)
            && document.content_type !== "application/pdf"
            && !isImageFile && !isTextFile) {
          throw new Error("Định dạng này chưa xem trực tiếp được. Hãy tải xuống để mở bằng ứng dụng phù hợp.");
        }
        const { data: fileBlob, error: downloadError } = await supabase.storage.from("library-files").download(document.storage_path);
        if (downloadError) throw downloadError;
        if (!active) return;
        const savedProgress = loadReadingProgress(currentUser.id, document.id);
        progressIdentityRef.current = { userId: currentUser.id, documentId: document.id };
        progressWriteWarningRef.current = false;
        setReadingProgress(savedProgress);
        setProgressReady(true);
        setUser(currentUser);
        setItem(document);
        setBlob(fileBlob);
        setLoading(false);
        const { error: updateError } = await supabase.from("library_documents")
          .update({ last_opened: new Date().toISOString() }).eq("id", document.id);
        if (updateError) {
          console.error("Không thể cập nhật lần mở gần nhất.", updateError);
          notify(`Đã mở sách nhưng không cập nhật được lịch sử: ${updateError.message}`);
        }
      } catch (cause) {
        if (!active) return;
        console.error("Không thể mở tài liệu.", cause);
        setError(cause.message || "Không thể tải tài liệu từ Supabase.");
        setLoading(false);
      }
    }
    loadDocument();
    return () => { active = false; };
  }, [notify]);

  useEffect(() => {
    let active = true;
    if (blob && isText) {
      blob.text().then((content) => {
        if (active) setTextContent(content.slice(0, 50000));
      }).catch((cause) => {
        if (active) setError(`Không thể đọc văn bản: ${cause.message}`);
      });
    }
    return () => { active = false; };
  }, [blob, isText]);

  useEffect(() => {
    try {
      window.localStorage.setItem("trang-sach-reader-theme", theme);
      window.localStorage.setItem("trang-sach-reader-font-size", String(fontSize));
    } catch (cause) {
      console.warn("Không thể lưu tùy chỉnh trình đọc.", cause);
    }
  }, [theme, fontSize]);

  useEffect(() => {
    if (!isBook) return undefined;
    function onKeyDown(event) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") previousPage();
      if (event.key === "ArrowRight" || event.key === "PageDown") nextPage();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chapterIndex, chapterCount, isBook]);

  const previousPage = useCallback(() => {
    if (isAzw3) setChapterIndex((index) => Math.max(0, index - 1));
    else epubRef.current?.previous()?.catch((cause) => notify(cause.message));
  }, [isAzw3, notify]);

  const nextPage = useCallback(() => {
    if (isAzw3) setChapterIndex((index) => Math.min(chapterCount - 1, index + 1));
    else epubRef.current?.next()?.catch((cause) => notify(cause.message));
  }, [chapterCount, isAzw3, notify]);

  function changeTheme() {
    setTheme((current) => THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
  }

  async function toggleRead() {
    if (!item || !user) return;
    const status = item.status === "read" ? "unread" : "read";
    const { error: updateError } = await supabase.from("library_documents")
      .update({ status }).eq("id", item.id);
    if (updateError) {
      notify(`Không thể cập nhật trạng thái: ${updateError.message}`);
      return;
    }
    setItem((current) => ({ ...current, status }));
    notify(status === "read" ? "Đã đánh dấu đã đọc." : "Đã chuyển về chưa đọc.");
  }

  function downloadBook() {
    if (!blob || !item) return;
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = item.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const backLink = import.meta.env.BASE_URL;
  return (
    <main className={`reader-app reader-theme-${theme}`}>
      <header className="reader-header">
        <a className="reader-back" href={backLink}><span><ArrowLeft size={19} /></span> Thư viện</a>
        <div className="reader-book-heading">
          <strong>{item?.name || (error ? "Không thể mở sách" : "Đang tải sách…")}</strong>
          <span>{item ? `${extension.toUpperCase()} · ${formatFileSize(Number(item.size_bytes))}` : "Không gian đọc riêng tư"}</span>
        </div>
        <div className="reader-header-actions">
          <button className="reader-header-button" type="button" onClick={downloadBook} disabled={!blob} aria-label="Tải sách xuống" title="Tải sách xuống"><Download size={18} /></button>
          <button className={`reader-header-button${item?.status === "read" ? " is-read" : ""}`} type="button" onClick={toggleRead} disabled={!item} aria-label={item?.status === "read" ? "Đánh dấu chưa đọc" : "Đánh dấu đã đọc"} title={item?.status === "read" ? "Đánh dấu chưa đọc" : "Đánh dấu đã đọc"}><Check size={18} /></button>
        </div>
      </header>
      {isBook && item && (
        <ReaderToolbar
          location={isAzw3 ? `Chương ${chapterIndex + 1} / ${chapterCount}` : location}
          theme={theme}
          fontSize={fontSize}
          onPrevious={previousPage}
          onNext={nextPage}
          onFont={(delta) => setFontSize((size) => Math.min(30, Math.max(14, size + delta)))}
          onTheme={changeTheme}
        />
      )}
      <section className={`reader-viewport${isPdf ? " pdf-viewport" : ""}`}>
        {(loading || (blob && progressReady && (isPdf || isBook) && !readerReady && !error)) && <div className="reader-loading"><LoaderCircle size={26} className="spin" /><span>Đang mở tài liệu từ thư viện…</span></div>}
        {error && <div className="reader-error"><span className="reader-error-icon">!</span><h2>Chưa mở được tài liệu</h2><p>{error}</p><a className="reader-return-link" href={backLink}>Quay về thư viện</a></div>}
        {blob && progressReady && isPdf && <PdfReader blob={blob} initialProgress={readingProgress} onProgress={handleProgress} onReady={handleReady} />}
        {blob && isImage && <div className="image-reader"><img src={objectUrl} alt={item.name} /></div>}
        {blob && isText && <pre className="text-reader">{textContent}</pre>}
        {blob && progressReady && isEpub && (
          <Suspense fallback={null}>
            <EpubReader ref={epubRef} blob={blob} initialProgress={readingProgress} theme={theme} fontSize={fontSize} onLocation={handleLocation} onProgress={handleProgress} onReady={handleReady} />
          </Suspense>
        )}
        {blob && progressReady && isAzw3 && <Azw3Reader key={item.id} blob={blob} initialProgress={readingProgress} theme={theme} fontSize={fontSize} chapterIndex={chapterIndex} onChapter={handleChapter} onNext={nextPage} onPrevious={previousPage} onProgress={handleProgress} onReady={handleReady} />}
      </section>
      {toast && <div className="reader-toast" role="status">{toast}</div>}
    </main>
  );
}
