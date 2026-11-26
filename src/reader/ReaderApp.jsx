import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookmarkPlus, Check, ChevronLeft, ChevronRight, CloudDownload, Download, Eye, EyeOff, Fingerprint, Keyboard, Languages, ListTree, LoaderCircle, Minus, MoreHorizontal, NotebookPen, Plus, Search, Type, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatFileSize } from "../lib/library-utils";
import { anchorOrVerifyFileHash, isHashRegistryConfigured } from "../lib/blockchain";
import { Azw3Reader } from "./Azw3Reader";
import { PdfReader } from "./PdfReader";
import { ReaderAnnotations } from "./ReaderAnnotations";
import { ReaderSearch } from "./ReaderSearch";
import { ReaderTocSidebar } from "./ReaderTocSidebar";
import { TranslatePopover } from "./TranslatePopover";
import { cacheDocument, getCachedDocument, removeCachedDocument } from "../lib/offline-cache";
import {
  fetchRedisReaderPreferences,
  fetchRedisReadingProgress,
  invalidateCachedLibrarySnapshot,
  saveRedisReaderPreferences,
  saveRedisReadingProgress,
} from "../lib/redis-api";
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
  const [annotationsAvailable, setAnnotationsAvailable] = useState(true);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [readerWarning, setReaderWarning] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(() => (
    window.innerWidth >= 900
    && savedPreference("trang-sach-reader-toc-open", window.innerWidth >= 1100 ? "1" : "0") === "1"
  ));
  const [pdfToc, setPdfToc] = useState([]);
  const [currentHref, setCurrentHref] = useState("");
  const [translateMode, setTranslateMode] = useState(false);
  const [selection, setSelection] = useState(null);
  const translateModeRef = useRef(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [tocItems, setTocItems] = useState([]);
  const [zenMode, setZenMode] = useState(false);
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
  const textProgressFrameRef = useRef(0);
  const textProgressTargetRef = useRef(null);
  const textProgressPercentRef = useRef(0);
  const textRestoredDocumentRef = useRef(null);
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
  const progressDetails = (() => {
    if (isPdf) {
      const page = readingProgress?.format === "pdf" ? readingProgress.pageNumber : 0;
      const total = readingProgress?.format === "pdf" ? readingProgress.totalPages : 0;
      if (!Number.isFinite(total) || total < 1) return { percent: null, detail: "Đang tính tiến độ PDF…" };
      const percent = Math.min(100, Math.max(0, Math.round((page / total) * 100)));
      return { percent, detail: `Trang ${page} / ${total}` };
    }
    if (isEpub) {
      if (readingProgress?.format !== "epub" || !Number.isFinite(readingProgress.percentage)) {
        return { percent: null, detail: "Đang xác định vị trí trong sách…" };
      }
      const percent = Math.min(100, Math.max(0, Math.round(readingProgress.percentage * 100)));
      return {
        percent,
        detail: readingProgress.pageNumber ? `Vị trí trong sách · trang ${readingProgress.pageNumber}` : "Vị trí trong sách",
      };
    }
    if (isAzw3) {
      const total = readingProgress?.format === "azw3" ? readingProgress.totalChapters : chapterCount;
      const current = readingProgress?.format === "azw3" ? readingProgress.chapterIndex + 1 : chapterIndex + 1;
      if (!Number.isFinite(total) || total < 1) return { percent: null, detail: "Đang tính số chương…" };
      const percent = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
      return { percent, detail: `Chương ${current} / ${total}` };
    }
    if (isText) {
      if (readingProgress?.format !== "text" || !Number.isFinite(readingProgress.percentage)) {
        return { percent: 0, detail: "Văn bản · bắt đầu" };
      }
      const percent = Math.min(100, Math.max(0, Math.round(readingProgress.percentage * 100)));
      return { percent, detail: "Vị trí trong văn bản" };
    }
    return null;
  })();

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
      saveRedisReadingProgress(user.id, item.id, readingProgress);
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

  const computedToc = useMemo(() => {
    if (isEpub) return tocItems;
    if (isPdf) return pdfToc;
    if (isAzw3 && chapterCount > 1) {
      return Array.from({ length: chapterCount }, (_, index) => ({
        id: `chapter-${index}`,
        label: `Chương ${index + 1}`,
        chapterIndex: index,
        depth: 0,
      }));
    }
    return [];
  }, [chapterCount, isAzw3, isEpub, isPdf, pdfToc, tocItems]);

  const currentPdfPage = readingProgress?.format === "pdf" ? readingProgress.pageNumber : 1;
  const activeTocId = useMemo(() => {
    if (!computedToc.length) return null;
    if (isAzw3) return `chapter-${chapterIndex}`;
    if (isPdf) {
      let active = null;
      for (const entry of computedToc) {
        if (entry.pageNumber <= currentPdfPage && (!active || entry.pageNumber >= active.pageNumber)) active = entry;
      }
      return active?.id ?? null;
    }
    if (isEpub && currentHref) {
      const base = currentHref.split("#")[0];
      const match = computedToc.find((entry) => {
        const entryBase = (entry.href || "").split("#")[0];
        return entryBase && (entryBase === base || base.endsWith(entryBase) || entryBase.endsWith(base));
      });
      return match?.id ?? null;
    }
    return null;
  }, [chapterIndex, computedToc, currentHref, currentPdfPage, isAzw3, isEpub, isPdf]);

  useEffect(() => {
    try {
      window.localStorage.setItem("trang-sach-reader-toc-open", tocOpen ? "1" : "0");
    } catch {
      // Ignore storage failures; the sidebar still works for this session.
    }
  }, [tocOpen]);

  const toggleToc = useCallback(() => setTocOpen((open) => !open), []);

  function selectTocEntry(entry) {
    if (isEpub) epubRef.current?.goTo({ href: entry.href })?.catch?.((cause) => notify(`Không mở được mục: ${cause.message}`));
    else if (isAzw3) azw3Ref.current?.goTo({ chapterIndex: entry.chapterIndex });
    else if (isPdf) pdfRef.current?.goTo({ pageNumber: entry.pageNumber });
    if (window.innerWidth < 900) setTocOpen(false);
  }

  useEffect(() => {
    translateModeRef.current = translateMode;
    if (!translateMode) setSelection(null);
  }, [translateMode]);

  const toggleTranslate = useCallback(() => {
    setTranslateMode((current) => {
      const next = !current;
      if (next) window.getSelection()?.removeAllRanges();
      return next;
    });
  }, []);

  const handleSelectedText = useCallback((rawText, rect) => {
    if (!translateModeRef.current || !rect) return;
    const text = String(rawText || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 2000 || !/\p{L}/u.test(text)) return;
    setSelection({
      text,
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
    });
  }, []);

  useEffect(() => {
    if (!translateMode) return undefined;
    function onPointerUp(event) {
      if (event.target?.closest?.(".translate-popover")) return;
      window.setTimeout(() => {
        const current = window.getSelection();
        if (!current || current.isCollapsed || !current.rangeCount) return;
        const range = current.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const host = container.nodeType === 1 ? container : container.parentElement;
        if (!host?.closest?.(".text-reader, .pdf-page-card")) return;
        handleSelectedText(current.toString(), range.getBoundingClientRect());
      }, 10);
    }
    document.addEventListener("mouseup", onPointerUp);
    document.addEventListener("touchend", onPointerUp);
    return () => {
      document.removeEventListener("mouseup", onPointerUp);
      document.removeEventListener("touchend", onPointerUp);
    };
  }, [handleSelectedText, translateMode]);

  useEffect(() => {
    if (translateMode) notify(isImage ? "Ảnh không có chữ để dịch." : "Đã bật dịch: bôi đen đoạn văn để xem bản dịch Anh ⇄ Việt.");
  }, [isImage, notify, translateMode]);

  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  useEffect(() => {
    let active = true;
    setProgressReady(false);
    textRestoredDocumentRef.current = null;
    setAnnotationsAvailable(true);
    setReaderWarning("");
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
          .select("id,name,content_type,size_bytes,storage_path,status,reading_progress")
          .eq("id", id).eq("owner_id", currentUser.id).single();
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
        const cachedBlobMatches = Boolean(cachedDocument?.blob
          && cachedDocument.metadata?.storage_path === document.storage_path
          && Number(cachedDocument.metadata?.size_bytes) === Number(document.size_bytes));
        const [annotationResult, downloadResult] = await Promise.all([
          supabase.from("reader_annotations")
            .select("id,kind,body,location,created_at")
            .eq("owner_id", currentUser.id).eq("document_id", document.id)
            .order("created_at", { ascending: false }),
          cachedBlobMatches
            ? Promise.resolve({ data: null, error: null })
            : supabase.storage.from("library-files").download(document.storage_path),
        ]);
        const { data: onlineAnnotations, error: annotationError } = annotationResult;
        const missingAnnotationsTable = annotationError?.code === "PGRST205"
          || /could not find the table ['"]?public\.reader_annotations|relation ['"]?public\.reader_annotations.*does not exist/i.test(annotationError?.message || "");
        if (annotationError && !missingAnnotationsTable
            && (!cachedDocument?.annotations || !isNetworkFailure(annotationError))) throw annotationError;
        const annotationRows = missingAnnotationsTable
          ? []
          : annotationError ? cachedDocument.annotations : onlineAnnotations;
        const { data: downloadedBlob, error: downloadError } = downloadResult;
        if (downloadError && (!cachedBlobMatches || !isNetworkFailure(downloadError))) throw downloadError;
        const fileBlob = cachedBlobMatches ? cachedDocument.blob : downloadError ? cachedDocument.blob : downloadedBlob;
        if (!active) return;
        const validProgress = (progress) => progress && ["epub", "pdf", "azw3", "text"].includes(progress.format);
        const [redisProgress, redisPrefs] = await Promise.all([
          fetchRedisReadingProgress(currentUser.id, document.id),
          fetchRedisReaderPreferences(currentUser.id),
        ]);
        if (active && redisPrefs) {
          if (["light", "sepia", "dark"].includes(redisPrefs.theme)) setTheme(redisPrefs.theme);
          if (Number.isFinite(redisPrefs.fontSize)) {
            setFontSize(Math.min(30, Math.max(14, redisPrefs.fontSize)));
          }
        }
        const localProgress = loadReadingProgress(currentUser.id, document.id);
        const storedProgress = validProgress(document.reading_progress) ? document.reading_progress : null;
        const candidates = [localProgress, redisProgress, storedProgress].filter(validProgress);
        candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const savedProgress = candidates[0] || null;
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
        if (missingAnnotationsTable) {
          setAnnotationsAvailable(false);
          setReaderWarning("Thiếu bảng reader_annotations trên Supabase. Sách vẫn mở được, nhưng dấu trang và ghi chú chưa dùng được. Chạy migration supabase/migrations/20261027000000_reader_features.sql trong Supabase SQL Editor.");
          console.error("Thiếu bảng public.reader_annotations. Hãy chạy migration Supabase cho tính năng reader.");
        }
        setOfflineAvailable(cachedBlobMatches);
        setOfflineCopyActive(cachedBlobMatches || Boolean(downloadError));
        setLoading(false);
        if (!documentError) {
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
    if (!isText || !progressReady || !item?.id || !textContent
        || textRestoredDocumentRef.current === item.id || !textReaderRef.current) return;
    const reader = textReaderRef.current;
    const percentage = readingProgress?.format === "text"
      ? Math.min(1, Math.max(0, readingProgress.percentage || 0))
      : 0;
    reader.scrollTop = percentage * Math.max(0, reader.scrollHeight - reader.clientHeight);
    textProgressPercentRef.current = percentage;
    textRestoredDocumentRef.current = item.id;
  }, [isText, item?.id, progressReady, readingProgress, textContent]);

  const handleTextScroll = useCallback((event) => {
    textProgressTargetRef.current = event.currentTarget;
    if (textProgressFrameRef.current) return;
    textProgressFrameRef.current = window.requestAnimationFrame(() => {
      textProgressFrameRef.current = 0;
      const reader = textProgressTargetRef.current;
      if (!reader) return;
      const maxScroll = reader.scrollHeight - reader.clientHeight;
      const percentage = maxScroll > 0 ? reader.scrollTop / maxScroll : 0;
      if (Math.abs(percentage - textProgressPercentRef.current) < 0.01) return;
      textProgressPercentRef.current = percentage;
      handleProgress({ format: "text", percentage });
    });
  }, [handleProgress]);

  useEffect(() => () => {
    if (textProgressFrameRef.current) {
      window.cancelAnimationFrame(textProgressFrameRef.current);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("trang-sach-reader-theme", theme);
      window.localStorage.setItem("trang-sach-reader-font-size", String(fontSize));
    } catch (cause) {
      console.warn("Không thể lưu tùy chỉnh trình đọc.", cause);
    }
    if (user?.id) {
      saveRedisReaderPreferences(user.id, { theme, fontSize });
    }
  }, [theme, fontSize, user?.id]);

  const previousPage = useCallback(() => {
    if (isPdf) pdfRef.current?.previous();
    else if (isAzw3) azw3Ref.current?.previous();
    else if (isEpub) epubRef.current?.previous()?.catch((cause) => notify(cause.message));
  }, [isAzw3, isEpub, isPdf, notify]);

  const nextPage = useCallback(() => {
    if (isPdf) pdfRef.current?.next();
    else if (isAzw3) azw3Ref.current?.next();
    else if (isEpub) epubRef.current?.next()?.catch((cause) => notify(cause.message));
  }, [isAzw3, isEpub, isPdf, notify]);

  useEffect(() => {
    function onKeyDown(event) {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) {
        if (event.key === "Escape") {
          setAnnotationsOpen(false);
          setSearchOpen(false);
          setTocOpen(false);
          setShortcutsOpen(false);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f") {
        if (isPdf || isBook || isText) {
          event.preventDefault();
          setSearchOpen(true);
          setAnnotationsOpen(false);
          setTocOpen(false);
          setShortcutsOpen(false);
        }
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      switch (event.key) {
        case "Escape":
          if (selection) {
            setSelection(null);
          } else if (annotationsOpen || searchOpen || shortcutsOpen || appearanceOpen || moreOpen) {
            setAnnotationsOpen(false);
            setSearchOpen(false);
            setShortcutsOpen(false);
            setAppearanceOpen(false);
            setMoreOpen(false);
          } else if (zenMode) {
            setZenMode(false);
          }
          return;
        case "?":
          event.preventDefault();
          setShortcutsOpen((open) => !open);
          setAnnotationsOpen(false);
          setSearchOpen(false);
          setTocOpen(false);
          return;
        case "z":
        case "Z":
          if (item) setZenMode((current) => !current);
          return;
        case "f":
        case "F":
          event.preventDefault();
          if (!window.document.fullscreenElement) {
            window.document.documentElement.requestFullscreen?.().catch(() => {});
          } else {
            window.document.exitFullscreen?.().catch(() => {});
          }
          return;
        case "d":
        case "D":
          if (item && !isImage) toggleTranslate();
          return;
        case "t":
        case "T":
          if (isBook || isText) changeTheme();
          return;
        case "m":
        case "M":
          if (computedToc.length > 0) {
            setTocOpen((open) => !open);
            setAnnotationsOpen(false);
            setSearchOpen(false);
            setShortcutsOpen(false);
          }
          return;
        case "n":
        case "N":
          if (item) {
            setAnnotationsOpen((open) => !open);
            setSearchOpen(false);
            setTocOpen(false);
            setShortcutsOpen(false);
          }
          return;
        case "b":
        case "B":
          if ((isPdf || isBook) && readerReady) {
            createAnnotation("bookmark").catch((cause) => notify(cause.message));
          }
          return;
        case "/":
          if (isPdf || isBook || isText) {
            event.preventDefault();
            setSearchOpen((open) => !open);
            setAnnotationsOpen(false);
            setTocOpen(false);
            setShortcutsOpen(false);
          }
          return;
        case "+":
        case "=":
          if (isPdf) pdfRef.current?.zoomIn();
          else if (isBook || isText) setFontSize((size) => Math.min(30, Math.max(14, size + 2)));
          return;
        case "-":
        case "_":
          if (isPdf) pdfRef.current?.zoomOut();
          else if (isBook || isText) setFontSize((size) => Math.min(30, Math.max(14, size - 2)));
          return;
        case "0":
          if (isPdf) pdfRef.current?.resetZoom();
          else if (isBook || isText) setFontSize(19);
          return;
        case "ArrowLeft":
        case "PageUp":
        case "k":
        case "K":
          if (isPdf || isBook) {
            event.preventDefault();
            previousPage();
          }
          return;
        case "ArrowRight":
        case "PageDown":
        case "j":
        case "J":
          if (isPdf || isBook) {
            event.preventDefault();
            nextPage();
          }
          return;
        case " ":
          if (isPdf || isBook) {
            event.preventDefault();
            if (event.shiftKey) previousPage();
            else nextPage();
          }
          return;
        case "Home":
          if (isPdf) { event.preventDefault(); pdfRef.current?.first(); }
          else if (isAzw3) { event.preventDefault(); azw3Ref.current?.first(); }
          return;
        case "End":
          if (isPdf) { event.preventDefault(); pdfRef.current?.last(); }
          else if (isAzw3) { event.preventDefault(); azw3Ref.current?.last(); }
          return;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    annotationsOpen,
    chapterCount,
    chapterIndex,
    computedToc.length,
    isAzw3,
    isBook,
    isPdf,
    isText,
    item,
    nextPage,
    notify,
    previousPage,
    readerReady,
    searchOpen,
    shortcutsOpen,
    tocOpen,
    toggleTranslate,
    isImage,
    selection,
    appearanceOpen,
    moreOpen,
    zenMode,
  ]);

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
    invalidateCachedLibrarySnapshot(user.id);
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
    if (!annotationsAvailable) {
      throw new Error("Cần chạy migration supabase/migrations/20261027000000_reader_features.sql trong Supabase SQL Editor trước khi dùng dấu trang và ghi chú.");
    }
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
    if (!annotationsAvailable) {
      notify("Cần chạy migration Supabase để quản lý dấu trang và ghi chú.");
      return;
    }
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
      azw3Ref.current?.goTo(locationToRestore);
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

  const closePopovers = useCallback(() => {
    setAnnotationsOpen(false);
    setSearchOpen(false);
    setShortcutsOpen(false);
    setAppearanceOpen(false);
    setMoreOpen(false);
  }, []);

  const headerSubtitle = useMemo(() => {
    if (!item) return "Không gian đọc riêng tư";
    const parts = [extension.toUpperCase()];
    if (progressDetails?.percent !== null && progressDetails?.percent !== undefined) {
      parts.push(`${progressDetails.percent}%`);
    } else if (item.size_bytes) {
      parts.push(formatFileSize(Number(item.size_bytes)));
    }
    if (offlineCopyActive) parts.push("Offline");
    return parts.join(" · ");
  }, [extension, item, offlineCopyActive, progressDetails]);

  const backLink = import.meta.env.BASE_URL;
  return (
    <main className={`reader-app reader-theme-${theme}${zenMode ? " is-zen" : ""}`}>
      <header className="reader-header">
        <div className="reader-header-left">
          <a className="reader-pill-btn" href={backLink} aria-label="Quay về thư viện" title="Quay về thư viện">
            <ArrowLeft size={17} />
            <span className="hide-sm">Thư viện</span>
          </a>
          {computedToc.length > 0 && (
            <button
              className={`reader-pill-btn${tocOpen ? " is-active" : ""}`}
              type="button"
              onClick={toggleToc}
              aria-pressed={tocOpen}
              aria-label="Mục lục"
              title="Mục lục (phím M)"
            >
              <ListTree size={17} />
              <span className="hide-md">Mục lục</span>
            </button>
          )}
        </div>

        <div className="reader-book-heading">
          <strong title={item?.name}>{item?.name || (error ? "Không thể mở sách" : "Đang tải sách…")}</strong>
          <span>{headerSubtitle}</span>
        </div>

        <div className="reader-header-actions">
          {item && !isImage && (
            <button
              className={`reader-pill-btn${translateMode ? " is-active" : ""}`}
              type="button"
              onClick={toggleTranslate}
              aria-pressed={translateMode}
              aria-label="Chế độ dịch Anh ⇄ Việt"
              title="Bật dịch rồi bôi đen chữ để dịch (phím D)"
            >
              <Languages size={16} />
              <span className="hide-sm">Dịch</span>
            </button>
          )}
          {(isPdf || isBook || isText) && (
            <button
              className={`reader-icon-btn${searchOpen ? " is-active" : ""}`}
              type="button"
              onClick={() => { const next = !searchOpen; closePopovers(); setSearchOpen(next); }}
              disabled={!readerReady && !isText}
              aria-label="Tìm trong tài liệu"
              title="Tìm trong tài liệu (Ctrl+F)"
            >
              <Search size={17} />
            </button>
          )}
          <button
            className={`reader-icon-btn${annotationsOpen ? " is-active" : ""}`}
            type="button"
            onClick={() => { const next = !annotationsOpen; closePopovers(); setAnnotationsOpen(next); }}
            disabled={!item}
            aria-label="Dấu trang và ghi chú"
            title="Dấu trang & ghi chú (phím N)"
          >
            <NotebookPen size={17} />
            {annotations.length > 0 && <em className="reader-badge">{annotations.length}</em>}
          </button>
          {(isBook || isText) && item && (
            <button
              className={`reader-icon-btn${appearanceOpen ? " is-active" : ""}`}
              type="button"
              onClick={() => { const next = !appearanceOpen; closePopovers(); setAppearanceOpen(next); }}
              aria-label="Cỡ chữ và màu nền"
              title="Cỡ chữ & màu nền (phím T)"
            >
              <Type size={17} />
            </button>
          )}
          <button
            className={`reader-icon-btn${moreOpen ? " is-active" : ""}`}
            type="button"
            onClick={() => { const next = !moreOpen; closePopovers(); setMoreOpen(next); }}
            aria-label="Thêm tùy chọn"
            title="Thêm tùy chọn"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

        {item && progressDetails && (
          <div
            className={`reader-progress-line${progressDetails.percent === null ? " is-indeterminate" : ""}`}
            role="progressbar"
            aria-label="Tiến độ đọc"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(progressDetails.percent === null ? {} : { "aria-valuenow": progressDetails.percent })}
            aria-valuetext={progressDetails.percent === null
              ? progressDetails.detail
              : `${progressDetails.detail}, ${progressDetails.percent}%`}
          >
            <span style={{ width: `${progressDetails.percent ?? 0}%` }} />
          </div>
        )}
      </header>

      {zenMode && (
        <button
          type="button"
          className="reader-zen-exit"
          onClick={() => setZenMode(false)}
          aria-label="Thoát chế độ tập trung"
          title="Hiện lại thanh công cụ (Z hoặc Esc)"
        >
          <EyeOff size={15} />
          <span>Hiện thanh công cụ</span>
        </button>
      )}
      {readerWarning && <div className="reader-feature-warning" role="status">{readerWarning}</div>}

      <div className="reader-body">
        <ReaderTocSidebar
          open={tocOpen}
          items={computedToc}
          activeId={activeTocId}
          onSelect={selectTocEntry}
          onClose={() => setTocOpen(false)}
        />
        <section className={`reader-viewport${isPdf ? " pdf-viewport" : ""}${translateMode ? " is-translating" : ""}`}>
          {(loading || (blob && progressReady && (isPdf || isBook) && !readerReady && !error)) && (
            <div className="reader-loading">
              <LoaderCircle size={24} className="spin" />
              <span>Đang mở tài liệu…</span>
            </div>
          )}
          {error && (
            <div className="reader-error">
              <span className="reader-error-icon">!</span>
              <h2>Chưa mở được tài liệu</h2>
              <p>{error}</p>
              <a className="reader-return-link" href={backLink}>Quay về thư viện</a>
            </div>
          )}
          {blob && progressReady && isPdf && <PdfReader ref={pdfRef} blob={blob} initialProgress={readingProgress} onProgress={handleProgress} onToc={setPdfToc} onReady={handleReady} />}
          {blob && isImage && <div className="image-reader"><img src={objectUrl} alt={item.name} /></div>}
          {blob && isText && <pre ref={textReaderRef} className="text-reader" style={{ fontSize: `${fontSize}px` }} onScroll={handleTextScroll}>{textContent}</pre>}
          {blob && progressReady && isEpub && (
            <Suspense fallback={null}>
              <EpubReader ref={epubRef} blob={blob} initialProgress={readingProgress} theme={theme} fontSize={fontSize} onLocation={handleLocation} onProgress={handleProgress} onToc={setTocItems} onSection={setCurrentHref} onSelectText={handleSelectedText} onReady={handleReady} />
            </Suspense>
          )}
          {blob && progressReady && isAzw3 && <Azw3Reader ref={azw3Ref} key={item.id} blob={blob} initialProgress={readingProgress} theme={theme} fontSize={fontSize} chapterIndex={chapterIndex} onChapter={handleChapter} onNext={nextPage} onPrevious={previousPage} onProgress={handleProgress} onSelectText={handleSelectedText} onReady={handleReady} />}

          {isBook && item && !zenMode && (
            <nav className="reader-bottom-dock" aria-label="Điều hướng trang">
              <button type="button" className="reader-dock-btn" onClick={previousPage} aria-label="Trang trước" title="Trang trước (←)">
                <ChevronLeft size={18} />
                <span>Trước</span>
              </button>
              <span className="reader-dock-status" aria-live="polite">
                {isAzw3 ? `Chương ${chapterIndex + 1} / ${chapterCount}` : location}
              </span>
              <button type="button" className="reader-dock-btn" onClick={nextPage} aria-label="Trang tiếp theo" title="Trang tiếp theo (→)">
                <span>Tiếp</span>
                <ChevronRight size={18} />
              </button>
            </nav>
          )}
        </section>
      </div>

      {appearanceOpen && (isBook || isText) && (
        <aside className="reader-popover reader-appearance-popover" aria-label="Cỡ chữ và màu nền">
          <div className="reader-popover-section">
            <span className="reader-popover-label">Màu giấy đọc</span>
            <div className="reader-theme-grid">
              {[
                { id: "light", label: "Sáng", bg: "#fffefa", ink: "#292d28" },
                { id: "sepia", label: "Giấy ấm", bg: "#f4e9d3", ink: "#45392d" },
                { id: "dark", label: "Ban đêm", bg: "#1f2520", ink: "#ece8df" },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`reader-theme-option${theme === option.id ? " is-selected" : ""}`}
                  onClick={() => setTheme(option.id)}
                >
                  <span className="reader-theme-swatch" style={{ background: option.bg, color: option.ink }}>Aa</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="reader-popover-section">
            <div className="reader-popover-row">
              <span className="reader-popover-label">Cỡ chữ</span>
              <span className="reader-font-value">{fontSize}px</span>
            </div>
            <div className="reader-font-stepper">
              <button type="button" onClick={() => setFontSize((size) => Math.max(14, size - 2))} disabled={fontSize <= 14} aria-label="Giảm cỡ chữ"><Minus size={15} /> Nhỏ hơn</button>
              <button type="button" onClick={() => setFontSize(19)} disabled={fontSize === 19} aria-label="Cỡ chữ mặc định">Mặc định</button>
              <button type="button" onClick={() => setFontSize((size) => Math.min(30, size + 2))} disabled={fontSize >= 30} aria-label="Tăng cỡ chữ"><Plus size={15} /> Lớn hơn</button>
            </div>
          </div>
        </aside>
      )}

      {moreOpen && (
        <aside className="reader-popover reader-more-menu" aria-label="Thêm tùy chọn">
          {(isPdf || isBook) && (
            <button type="button" className="reader-menu-item" disabled={!readerReady} onClick={() => { setMoreOpen(false); createAnnotation("bookmark").catch((cause) => notify(cause.message)); }}>
              <BookmarkPlus size={16} />
              <span>Đánh dấu trang này</span>
              <kbd>B</kbd>
            </button>
          )}
          <button type="button" className="reader-menu-item" disabled={!item} onClick={() => { setMoreOpen(false); toggleRead(); }}>
            <Check size={16} />
            <span>{item?.status === "read" ? "Đánh dấu chưa đọc" : "Đánh dấu đã đọc"}</span>
          </button>
          <button type="button" className="reader-menu-item" disabled={!item} onClick={() => { setMoreOpen(false); setZenMode((current) => !current); }}>
            <Eye size={16} />
            <span>Chế độ tập trung</span>
            <kbd>Z</kbd>
          </button>
          <div className="reader-menu-divider" />
          <button type="button" className="reader-menu-item" disabled={!blob || offlineBusy} onClick={() => { setMoreOpen(false); toggleOfflineCopy(); }}>
            <CloudDownload size={16} />
            <span>{offlineAvailable ? "Xóa bản lưu offline" : "Lưu để đọc offline"}</span>
          </button>
          <button type="button" className="reader-menu-item" disabled={!blob} onClick={() => { setMoreOpen(false); downloadBook(); }}>
            <Download size={16} />
            <span>Tải tệp xuống</span>
          </button>
          {isHashRegistryConfigured && (
            <button type="button" className="reader-menu-item" disabled={!blob || blockchainBusy} onClick={() => { setMoreOpen(false); anchorCurrentFileHash(); }}>
              <Fingerprint size={16} />
              <span>Neo hash file (Sepolia)</span>
            </button>
          )}
          <div className="reader-menu-divider" />
          <button type="button" className="reader-menu-item" onClick={() => { setMoreOpen(false); setShortcutsOpen(true); }}>
            <Keyboard size={16} />
            <span>Phím tắt bàn phím</span>
            <kbd>?</kbd>
          </button>
        </aside>
      )}

      {translateMode && !zenMode && (
        <div className="reader-translate-hint" role="status">
          <Languages size={14} />
          <span>{isPdf ? "Bôi đen chữ trên trang PDF để dịch" : "Bôi đen đoạn văn để dịch"} · Anh ⇄ Việt</span>
          <button type="button" onClick={() => setTranslateMode(false)}>Tắt</button>
        </div>
      )}
      {selection && <TranslatePopover key={selection.text} selection={selection} onClose={() => setSelection(null)} />}
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
      {shortcutsOpen && (
        <aside className="reader-shortcuts-panel" aria-label="Phím tắt bàn phím">
          <header className="reader-annotations-header">
            <div><strong>Phím tắt bàn phím</strong><span>Thao tác nhanh khi đọc</span></div>
            <button className="reader-annotation-icon" type="button" onClick={() => setShortcutsOpen(false)} aria-label="Đóng bảng phím tắt"><X size={18} /></button>
          </header>
          <dl className="reader-shortcuts-list">
            <div><dt><kbd>←</kbd> <kbd>→</kbd> / <kbd>J</kbd> <kbd>K</kbd></dt><dd>Trang hoặc chương trước / tiếp</dd></div>
            <div><dt><kbd>Space</kbd> / <kbd>Shift</kbd>+<kbd>Space</kbd></dt><dd>Tiến / lùi trang</dd></div>
            <div><dt><kbd>Home</kbd> / <kbd>End</kbd></dt><dd>Đầu / cuối tài liệu (PDF, AZW3)</dd></div>
            <div><dt><kbd>+</kbd> / <kbd>-</kbd> / <kbd>0</kbd></dt><dd>Tăng / giảm / mặc định cỡ chữ hoặc thu phóng</dd></div>
            <div><dt><kbd>T</kbd></dt><dd>Đổi giao diện Sáng · Sepia · Tối</dd></div>
            <div><dt><kbd>M</kbd></dt><dd>Hiện / ẩn Mục lục bên trái</dd></div>
            <div><dt><kbd>B</kbd></dt><dd>Thêm dấu trang tại vị trí hiện tại</dd></div>
            <div><dt><kbd>N</kbd></dt><dd>Mở / đóng Dấu trang & ghi chú</dd></div>
            <div><dt><kbd>/</kbd> hoặc <kbd>Ctrl</kbd>+<kbd>F</kbd></dt><dd>Tìm trong tài liệu</dd></div>
            <div><dt><kbd>D</kbd></dt><dd>Bật / tắt dịch (bôi đen để dịch Anh ⇄ Việt)</dd></div>
            <div><dt><kbd>Z</kbd></dt><dd>Chế độ tập trung (ẩn thanh công cụ)</dd></div>
            <div><dt><kbd>F</kbd></dt><dd>Bật / tắt toàn màn hình</dd></div>
            <div><dt><kbd>?</kbd> / <kbd>Esc</kbd></dt><dd>Mở trợ giúp phím tắt / Đóng bảng</dd></div>
          </dl>
        </aside>
      )}
      {offlineCopyActive && <div className="reader-offline-indicator" role="status">Đang đọc bản đã lưu trên thiết bị</div>}
      {toast && <div className="reader-toast" role="status">{toast}{blockchainTx && <a href={`https://sepolia.etherscan.io/tx/${blockchainTx}`} target="_blank" rel="noreferrer">Xem giao dịch</a>}</div>}
    </main>
  );
}
