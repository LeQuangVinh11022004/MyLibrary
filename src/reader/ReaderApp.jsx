import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CloudDownload, Download, Fingerprint, LoaderCircle, NotebookPen, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatFileSize } from "../lib/library-utils";
import { anchorOrVerifyFileHash, isHashRegistryConfigured } from "../lib/blockchain";
import { Azw3Reader } from "./Azw3Reader";
import { PdfReader } from "./PdfReader";
import { ReaderAnnotations } from "./ReaderAnnotations";
import { ReaderSearch } from "./ReaderSearch";
import { ReaderToolbar } from "./ReaderToolbar";
import { cacheDocument, getCachedDocument, removeCachedDocument } from "../lib/offline-cache";
import { loadReadingProgress, saveReadingProgress } from "./reading-progress";
import "./reader.css";

const THEMES = ["light", "sepia", "dark"];
const EpubReader = lazy(() => import("./EpubReader").then(({ EpubReader: Reader }) => ({ default: Reader })));

function getExtension(name = "") {
  return name.split(".").pop()?.toLowerCase() || "";
}

function isNetworkFailure(error) {
  return !window.navigator.onLine || /failed to fetch|network|timeout|connection|offline/i.test(error?.message || "");
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
  const [annotations, setAnnotations] = useState([]);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [offlineCopyActive, setOfflineCopyActive] = useState(false);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [blockchainBusy, setBlockchainBusy] = useState(false);
  const [blockchainTx, setBlockchainTx] = useState("");
  const [isOnline, setIsOnline] = useState(() => window.navigator.onLine);
  const epubRef = useRef(null);
  const pdfRef = useRef(null);
  const azw3Ref = useRef(null);
  const textReaderRef = useRef(null);
  const toastTimer = useRef(null);
  const progressIdentityRef = useRef(null);
  const progressWriteWarningRef = useRef(false);
  const progressSyncWarningRef = useRef(false);
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
    setBlockchainTx("");
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3600);
  }, []);

  useEffect(() => {
    function updateNetworkState() {
      setIsOnline(window.navigator.onLine);
    }
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
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

  useEffect(() => {
    if (!progressReady || !item || !user || !readingProgress) return undefined;
    if (!isOnline) {
      if (!progressSyncWarningRef.current) {
        progressSyncWarningRef.current = true;
        notify("Đang offline; tiến độ sẽ đồng bộ khi có mạng trở lại.");
      }
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      try {
        const { error: syncError } = await supabase.from("library_documents")
          .update({ reading_progress: readingProgress }).eq("id", item.id);
        if (syncError) throw syncError;
        progressSyncWarningRef.current = false;
      } catch (syncError) {
        console.error("Không thể đồng bộ tiến độ đọc.", syncError);
        if (!progressSyncWarningRef.current) {
          progressSyncWarningRef.current = true;
          notify("Tiến độ đã lưu trên thiết bị nhưng chưa đồng bộ được.");
        }
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [isOnline, item, notify, progressReady, readingProgress, user]);
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
        let cachedDocument = null;
        try {
          cachedDocument = await getCachedDocument(currentUser.id, id);
        } catch (cacheError) {
          console.warn("Không thể kiểm tra bản offline.", cacheError);
        }
        const { data: onlineDocument, error: documentError } = await supabase.from("library_documents")
          .select("*").eq("id", id).single();
        if (documentError && (!cachedDocument?.metadata || !isNetworkFailure(documentError))) throw documentError;
        const document = documentError ? cachedDocument.metadata : onlineDocument;
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
        const { data: onlineAnnotations, error: annotationError } = await supabase.from("reader_annotations")
          .select("*").eq("document_id", document.id).order("created_at", { ascending: false });
        if (annotationError && (!cachedDocument?.annotations || !isNetworkFailure(annotationError))) throw annotationError;
        const annotationRows = annotationError ? cachedDocument.annotations : onlineAnnotations;
        const { data: downloadedBlob, error: downloadError } = await supabase.storage.from("library-files").download(document.storage_path);
        if (downloadError && (!cachedDocument?.blob || !isNetworkFailure(downloadError))) throw downloadError;
        const fileBlob = downloadError ? cachedDocument.blob : downloadedBlob;
        if (!active) return;
        const validProgress = (progress) => progress && ["epub", "pdf", "azw3"].includes(progress.format);
        const localProgress = loadReadingProgress(currentUser.id, document.id);
        const storedProgress = validProgress(document.reading_progress) ? document.reading_progress : null;
        const savedProgress = validProgress(localProgress)
          && (!storedProgress || (localProgress.updatedAt || 0) > (storedProgress.updatedAt || 0))
          ? localProgress
          : storedProgress;
        progressIdentityRef.current = { userId: currentUser.id, documentId: document.id };
        progressWriteWarningRef.current = false;
        progressSyncWarningRef.current = false;
        setReadingProgress(savedProgress);
        setProgressReady(true);
        setUser(currentUser);
        setItem(document);
        setBlob(fileBlob);
        setAnnotations(annotationRows.map((row) => ({
          id: row.id,
          kind: row.kind,
          body: row.body,
          location: row.location,
          createdAt: row.created_at,
        })));
        setOfflineAvailable(Boolean(cachedDocument?.blob));
        setOfflineCopyActive(Boolean(downloadError));
        setLoading(false);
        if (!downloadError) {
          const { error: updateError } = await supabase.from("library_documents")
            .update({ last_opened: new Date().toISOString() }).eq("id", document.id);
          if (updateError) {
            console.error("Không thể cập nhật lần mở gần nhất.", updateError);
            notify(`Đã mở sách nhưng không cập nhật được lịch sử: ${updateError.message}`);
          }
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

  function currentLocation() {
    if (readingProgress) return readingProgress;
    if (isPdf) return { format: "pdf", pageNumber: 1, totalPages: 1, zoom: 1 };
    if (isEpub) return { format: "epub", cfi: "", percentage: 0 };
    if (isAzw3) return { format: "azw3", chapterIndex, totalChapters: chapterCount };
    return { format: "text", offset: 0 };
  }

  async function createAnnotation(kind, body = "") {
    if (!item || !user) throw new Error("Cần đăng nhập để lưu dấu trang và ghi chú.");
    const { data, error: insertError } = await supabase.from("reader_annotations")
      .insert({
        owner_id: user.id,
        document_id: item.id,
        kind,
        body,
        location: currentLocation(),
      })
      .select("*").single();
    if (insertError) throw insertError;
    setAnnotations((current) => [{
      id: data.id,
      kind: data.kind,
      body: data.body,
      location: data.location,
      createdAt: data.created_at,
    }, ...current]);
    notify(kind === "bookmark" ? "Đã thêm dấu trang." : "Đã lưu ghi chú.");
  }

  async function deleteAnnotation(id) {
    const { error: deleteError } = await supabase.from("reader_annotations").delete().eq("id", id);
    if (deleteError) {
      console.error("Không thể xóa dấu trang hoặc ghi chú.", deleteError);
      notify(`Không thể xóa: ${deleteError.message}`);
      return;
    }
    setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
  }

  function jumpTo(locationToRestore) {
    if (!locationToRestore) return;
    handleProgress(locationToRestore);
    if (locationToRestore.format === "pdf") {
      pdfRef.current?.goTo(locationToRestore);
    } else if (locationToRestore.format === "epub") {
      epubRef.current?.goTo(locationToRestore)?.catch((cause) => notify(`Không thể mở vị trí EPUB: ${cause.message}`));
    } else if (locationToRestore.format === "azw3") {
      setChapterIndex(Math.min(chapterCount - 1, Math.max(0, locationToRestore.chapterIndex || 0)));
    }
  }

  async function searchDocument(query) {
    if (isPdf) return pdfRef.current?.search(query);
    if (isEpub) return epubRef.current?.search(query);
    if (isAzw3) return azw3Ref.current?.search(query);
    if (!isText) throw new Error("Định dạng này chưa hỗ trợ tìm trong nội dung.");
    const index = textContent.toLocaleLowerCase("vi").indexOf(query.toLocaleLowerCase("vi"));
    if (index < 0) return "Không tìm thấy nội dung phù hợp.";
    const textNode = textReaderRef.current?.firstChild;
    if (textNode) {
      const range = window.document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + query.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    return "Đã tìm thấy và chọn nội dung khớp.";
  }

  async function toggleOfflineCopy() {
    if (!item || !user || !blob) return;
    setOfflineBusy(true);
    try {
      if (offlineAvailable) {
        await removeCachedDocument(user.id, item.id);
        setOfflineAvailable(false);
        if (offlineCopyActive) setOfflineCopyActive(false);
        notify("Đã xóa bản lưu offline trên thiết bị này.");
      } else {
        await cacheDocument(user.id, item.id, blob, item, annotations);
        setOfflineAvailable(true);
        notify("Đã lưu tài liệu để đọc offline trên thiết bị này.");
      }
    } catch (cause) {
      console.error("Không thể cập nhật bản lưu offline.", cause);
      notify(`Không thể lưu offline: ${cause.message}`);
    } finally {
      setOfflineBusy(false);
    }
  }

  async function anchorCurrentFileHash() {
    if (!blob) return;
    setBlockchainBusy(true);
    try {
      const proof = await anchorOrVerifyFileHash(blob);
      if (proof.status === "anchored") {
        notify("Đã neo hash file lên Sepolia.");
        setBlockchainTx(proof.transactionHash);
      } else {
        const anchoredAt = new Date(proof.timestamp * 1000).toLocaleString("vi-VN");
        notify(`Hash khớp với bản đã neo trên Sepolia (${anchoredAt}).`);
      }
    } catch (cause) {
      console.error("Không thể neo hash file lên blockchain.", cause);
      notify(`Không thể neo hash: ${cause.message}`);
    } finally {
      setBlockchainBusy(false);
    }
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
          {(isPdf || isBook) && <button className="reader-header-button" type="button" onClick={() => createAnnotation("bookmark").catch((cause) => notify(cause.message))} disabled={!readerReady} aria-label="Thêm dấu trang" title="Thêm dấu trang"><BookmarkPlus size={18} /></button>}
          <button className={`reader-header-button${annotationsOpen ? " is-read" : ""}`} type="button" onClick={() => { setAnnotationsOpen((open) => !open); setSearchOpen(false); }} disabled={!item} aria-label="Mở dấu trang và ghi chú" title="Dấu trang và ghi chú"><NotebookPen size={18} /></button>
          <button className={`reader-header-button${offlineAvailable ? " is-read" : ""}`} type="button" onClick={toggleOfflineCopy} disabled={!blob || offlineBusy} aria-label={offlineAvailable ? "Xóa bản offline" : "Lưu để đọc offline"} title={offlineAvailable ? "Xóa bản offline" : "Lưu để đọc offline"}><CloudDownload size={18} /></button>
          <button className="reader-header-button" type="button" onClick={anchorCurrentFileHash} disabled={!blob || blockchainBusy || !isHashRegistryConfigured} aria-label={isHashRegistryConfigured ? "Neo hash file lên Sepolia" : "Neo hash (chưa cấu hình smart contract)"} title={isHashRegistryConfigured ? "Neo hash file lên Sepolia (công khai)" : "Cần triển khai FileHashRegistry và cấu hình địa chỉ"}><Fingerprint size={18} /></button>
          {(isPdf || isBook || isText) && <button className={`reader-header-button${searchOpen ? " is-read" : ""}`} type="button" onClick={() => { setSearchOpen((open) => !open); setAnnotationsOpen(false); }} disabled={!readerReady && !isText} aria-label="Tìm trong tài liệu" title="Tìm trong tài liệu"><Search size={18} /></button>}
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
        {blob && progressReady && isPdf && <PdfReader ref={pdfRef} blob={blob} initialProgress={readingProgress} onProgress={handleProgress} onReady={handleReady} />}
        {blob && isImage && <div className="image-reader"><img src={objectUrl} alt={item.name} /></div>}
        {blob && isText && <pre ref={textReaderRef} className="text-reader">{textContent}</pre>}
        {blob && progressReady && isEpub && (
          <Suspense fallback={null}>
            <EpubReader ref={epubRef} blob={blob} initialProgress={readingProgress} theme={theme} fontSize={fontSize} onLocation={handleLocation} onProgress={handleProgress} onReady={handleReady} />
          </Suspense>
        )}
        {blob && progressReady && isAzw3 && <Azw3Reader ref={azw3Ref} key={item.id} blob={blob} initialProgress={readingProgress} theme={theme} fontSize={fontSize} chapterIndex={chapterIndex} onChapter={handleChapter} onNext={nextPage} onPrevious={previousPage} onProgress={handleProgress} onReady={handleReady} />}
      </section>
      <ReaderAnnotations
        open={annotationsOpen}
        annotations={annotations}
        onClose={() => setAnnotationsOpen(false)}
        onBookmark={() => createAnnotation("bookmark").catch((cause) => notify(cause.message))}
        onCreate={(body) => createAnnotation("note", body)}
        onDelete={deleteAnnotation}
        onJump={jumpTo}
      />
      <ReaderSearch open={searchOpen} onClose={() => setSearchOpen(false)} onSearch={searchDocument} />
      {offlineCopyActive && <div className="reader-offline-indicator" role="status">Đang đọc bản đã lưu trên thiết bị</div>}
      {toast && <div className="reader-toast" role="status">{toast}{blockchainTx && <a href={`https://sepolia.etherscan.io/tx/${blockchainTx}`} target="_blank" rel="noreferrer">Xem giao dịch</a>}</div>}
    </main>
  );
}
