import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { initKf8File } from "@lingo-reader/mobi-parser";

function sanitizeHtml(html) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("base, embed, form, frame, iframe, link, meta, object, script").forEach((item) => item.remove());
  parsed.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || ["action", "formaction", "ping", "srcdoc", "target"].includes(name)) {
        element.removeAttribute(attribute.name);
      } else if (name === "href" && !attribute.value.startsWith("#")) {
        element.removeAttribute(attribute.name);
      } else if (["src", "poster"].includes(name) && !/^(?:blob:|data:)/i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return parsed.body.innerHTML;
}

function makeChapterDocument(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; img-src blob: data:; media-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:; object-src 'none'; script-src 'none';"><style>html,body{margin:0;background:#fff;color:#292d28}body{box-sizing:border-box;width:min(100%,52rem);margin-inline:auto;padding:clamp(24px,6vw,76px);font-family:Georgia,serif;line-height:1.9;letter-spacing:.01em;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}

function themeColors(theme) {
  return {
    light: ["#fffefa", "#292d28"],
    sepia: ["#f5ead5", "#45392d"],
    dark: ["#202820", "#eee9df"],
  }[theme];
}

function Azw3Chapter({
  book,
  spineEntry,
  chapterIndex,
  isRendered,
  height,
  theme,
  fontSize,
  onMeasure,
  onReady,
  onError,
  onNext,
  onPrevious,
}) {
  const iframeRef = useRef(null);
  const [chapterHtml, setChapterHtml] = useState(null);
  const [chapterError, setChapterError] = useState("");

  useEffect(() => {
    if (!isRendered) {
      setChapterHtml(null);
      setChapterError("");
      return;
    }
    try {
      const contents = book.loadChapter(spineEntry.id);
      if (!contents?.html) throw new Error("Không tìm thấy nội dung của chương này.");
      setChapterHtml(sanitizeHtml(contents.html));
      setChapterError("");
    } catch (cause) {
      console.error(`Không thể giải nén chương ${chapterIndex + 1} của AZW3.`, cause);
      setChapterError(cause.message || "Không thể tải chương này.");
      onError(cause, chapterIndex);
    }
  }, [book, chapterIndex, isRendered, onError, spineEntry.id]);

  const frameHtml = useMemo(
    () => chapterHtml === null ? "" : makeChapterDocument(chapterHtml),
    [chapterHtml],
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || chapterHtml === null) return undefined;
    let activeDocument;
    let resizeObserver;
    let touchStart = null;

    function measureContent() {
      const contentDocument = iframe.contentDocument;
      if (!contentDocument?.body || !contentDocument.documentElement) return;
      const [background, color] = themeColors(theme);
      contentDocument.documentElement.style.backgroundColor = background;
      contentDocument.body.style.backgroundColor = background;
      contentDocument.body.style.color = color;
      contentDocument.body.style.fontSize = `${fontSize}px`;
      const contentHeight = Math.ceil(Math.max(
        contentDocument.body.scrollHeight,
        contentDocument.body.offsetHeight,
        contentDocument.documentElement.scrollHeight,
        contentDocument.documentElement.offsetHeight,
      ) + 2);
      onMeasure(chapterIndex, contentHeight);
    }

    function onDocumentTouchStart(event) {
      if (event.touches.length !== 1) {
        touchStart = null;
        return;
      }
      touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }

    function onDocumentTouchEnd(event) {
      if (!touchStart || !event.changedTouches.length) return;
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - touchStart.x;
      const deltaY = touch.clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(deltaX) < 55 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      if (deltaX < 0) onNext();
      else onPrevious();
    }

    function attachDocumentObservers() {
      const contentDocument = iframe.contentDocument;
      if (!contentDocument?.body || activeDocument === contentDocument) return;
      if (activeDocument) {
        activeDocument.removeEventListener("load", measureContent, true);
        activeDocument.removeEventListener("touchstart", onDocumentTouchStart);
        activeDocument.removeEventListener("touchend", onDocumentTouchEnd);
        resizeObserver?.disconnect();
      }
      activeDocument = contentDocument;
      iframe.dataset.loaded = "true";
      activeDocument.addEventListener("load", measureContent, true);
      activeDocument.addEventListener("touchstart", onDocumentTouchStart, { passive: true });
      activeDocument.addEventListener("touchend", onDocumentTouchEnd, { passive: true });
      resizeObserver = new ResizeObserver(measureContent);
      resizeObserver.observe(contentDocument.documentElement);
      resizeObserver.observe(contentDocument.body);
      measureContent();
      onReady(chapterIndex);
    }

    iframe.addEventListener("load", attachDocumentObservers);
    if (iframe.dataset.loaded === "true") attachDocumentObservers();
    return () => {
      iframe.removeEventListener("load", attachDocumentObservers);
      activeDocument?.removeEventListener("load", measureContent, true);
      activeDocument?.removeEventListener("touchstart", onDocumentTouchStart);
      activeDocument?.removeEventListener("touchend", onDocumentTouchEnd);
      resizeObserver?.disconnect();
    };
  }, [chapterHtml, chapterIndex, fontSize, onMeasure, onNext, onPrevious, onReady, theme]);

  if (!isRendered) {
    return (
      <div className="azw3-chapter-placeholder" style={{ minHeight: `${height}px` }} aria-hidden="true">
        <strong>Chương {chapterIndex + 1}</strong>
        <span>Nội dung sẽ tải khi cuộn tới</span>
      </div>
    );
  }
  if (chapterError) return <div className="azw3-chapter-error" style={{ minHeight: `${height}px` }} role="alert">{chapterError}</div>;
  if (chapterHtml === null) {
    return <div className="azw3-chapter-placeholder" style={{ minHeight: `${height}px` }} role="status">Đang giải nén chương {chapterIndex + 1}…</div>;
  }
  return (
    <iframe
      ref={iframeRef}
      className="azw3-frame"
      title={`AZW3, chương ${chapterIndex + 1}`}
      sandbox="allow-same-origin"
      srcDoc={frameHtml}
      style={{ height: `${height}px` }}
    />
  );
}

export const Azw3Reader = forwardRef(function Azw3Reader({
  blob,
  initialProgress,
  theme,
  fontSize,
  chapterIndex,
  onChapter,
  onNext,
  onPrevious,
  onProgress,
  onReady,
}, ref) {
  const stageRef = useRef(null);
  const initialChapterRef = useRef(Number.isInteger(initialProgress?.chapterIndex) ? initialProgress.chapterIndex : 0);
  const initialScrollDoneRef = useRef(false);
  const activeChapterRef = useRef(initialChapterRef.current);
  const readyRef = useRef(false);
  const [chapter, setChapter] = useState(null);
  const [chapterHeights, setChapterHeights] = useState({});
  const [renderedChapters, setRenderedChapters] = useState(() => new Set());
  const [containerHeight, setContainerHeight] = useState(0);

  function scrollToChapter(chapterToOpen, behavior = "smooth") {
    if (!chapter || !stageRef.current) return;
    const targetChapter = Math.min(chapter.spine.length - 1, Math.max(0, chapterToOpen));
    activeChapterRef.current = targetChapter;
    onChapter(chapter.spine.length, targetChapter);
    const target = stageRef.current.querySelector(`[data-chapter-index="${targetChapter}"]`);
    if (!target) return;
    const stageTop = stageRef.current.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    stageRef.current.scrollTo({
      top: stageRef.current.scrollTop + targetTop - stageTop - 8,
      behavior,
    });
  }

  const handleMeasure = useCallback((index, nextHeight) => {
    setChapterHeights((current) => current[index] === nextHeight
      ? current
      : { ...current, [index]: nextHeight });
  }, []);

  const handleChapterReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    onReady();
  }, [onReady]);

  const handleChapterError = useCallback((cause, index) => {
    if (!readyRef.current && index === initialChapterRef.current) onReady(cause);
  }, [onReady]);

  useImperativeHandle(ref, () => ({
    goTo: (progress) => {
      if (Number.isInteger(progress?.chapterIndex)) scrollToChapter(progress.chapterIndex);
    },
    next: () => scrollToChapter(activeChapterRef.current + 1),
    previous: () => scrollToChapter(activeChapterRef.current - 1),
    search: async (query) => {
      if (!chapter) throw new Error("AZW3 chưa sẵn sàng để tìm kiếm.");
      const cleanQuery = query.toLocaleLowerCase("vi");
      for (let index = 0; index < chapter.spine.length; index += 1) {
        const contents = chapter.book.loadChapter(chapter.spine[index].id);
        const searchableText = new DOMParser().parseFromString(sanitizeHtml(contents?.html || ""), "text/html")
          .body.textContent.toLocaleLowerCase("vi");
        if (searchableText.includes(cleanQuery)) {
          scrollToChapter(index);
          return `Tìm thấy trong chương ${index + 1} / ${chapter.spine.length}.`;
        }
      }
      return "Không tìm thấy nội dung phù hợp trong AZW3.";
    },
  }), [chapter, onChapter]);

  useEffect(() => {
    let active = true;
    let book;
    initialScrollDoneRef.current = false;
    readyRef.current = false;
    setChapter(null);
    setChapterHeights({});
    setRenderedChapters(new Set());

    async function openBook() {
      book = await initKf8File(new Uint8Array(await blob.arrayBuffer()));
      const spine = book.getSpine();
      if (!spine.length) throw new Error("Sách AZW3 không có nội dung để đọc.");
      if (!active) {
        book.destroy();
        return;
      }
      const initialIndex = Math.min(
        spine.length - 1,
        Math.max(0, Number.isInteger(initialProgress?.chapterIndex) ? initialProgress.chapterIndex : 0),
      );
      initialChapterRef.current = initialIndex;
      activeChapterRef.current = initialIndex;
      onChapter(spine.length, initialIndex);
      setChapter({ book, spine });
    }
    openBook().catch((cause) => { if (active) onReady(cause); });
    return () => {
      active = false;
      book?.destroy();
    };
  }, [blob, onChapter, onReady]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setContainerHeight(Math.floor(entry.contentRect.height));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !chapter) return undefined;
    const chapterElements = stage.querySelectorAll(".azw3-chapter-card");
    if (!window.IntersectionObserver) {
      setRenderedChapters(new Set(chapter.spine.map((_, index) => index)));
      return undefined;
    }
    const renderMargin = Math.max(600, Math.round(containerHeight * 1.25));
    const activeBand = Math.max(48, Math.round(containerHeight * 0.28));
    const activeTopInset = Math.max(0, Math.round((containerHeight - activeBand) / 2));
    const activeBottomInset = Math.max(0, containerHeight - activeBand - activeTopInset);
    const renderObserver = new IntersectionObserver((entries) => {
      setRenderedChapters((current) => {
        let next = current;
        for (const entry of entries) {
          const index = Number(entry.target.dataset.chapterIndex);
          if (entry.isIntersecting === next.has(index)) continue;
          if (next === current) next = new Set(current);
          if (entry.isIntersecting) next.add(index);
          else next.delete(index);
        }
        return next;
      });
    }, { root: stage, rootMargin: `${renderMargin}px 0px ${renderMargin}px 0px`, threshold: 0 });
    const activeObserver = new IntersectionObserver((entries) => {
      const visibleChapter = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visibleChapter) return;
      const index = Number(visibleChapter.target.dataset.chapterIndex);
      activeChapterRef.current = index;
      onChapter(chapter.spine.length, index);
    }, {
      root: stage,
      rootMargin: `-${activeTopInset}px 0px -${activeBottomInset}px 0px`,
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });
    chapterElements.forEach((element) => {
      renderObserver.observe(element);
      activeObserver.observe(element);
    });
    return () => {
      renderObserver.disconnect();
      activeObserver.disconnect();
    };
  }, [chapter, containerHeight, onChapter]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !chapter || initialScrollDoneRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const targetChapter = Math.min(
        chapter.spine.length - 1,
        Math.max(0, initialChapterRef.current),
      );
      const target = stage.querySelector(`[data-chapter-index="${targetChapter}"]`);
      if (target) {
        const stageTop = stage.getBoundingClientRect().top;
        const targetTop = target.getBoundingClientRect().top;
        stage.scrollTo({ top: stage.scrollTop + targetTop - stageTop - 8, behavior: "auto" });
      }
      initialScrollDoneRef.current = true;
      activeChapterRef.current = targetChapter;
      onChapter(chapter.spine.length, targetChapter);
      onProgress({ format: "azw3", chapterIndex: targetChapter, totalChapters: chapter.spine.length });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chapter, onChapter, onProgress]);

  useEffect(() => {
    if (!chapter || !initialScrollDoneRef.current) return;
    onProgress({ format: "azw3", chapterIndex, totalChapters: chapter.spine.length });
  }, [chapter, chapterIndex, onProgress]);

  if (!chapter) return <div className="reader-loading">Đang giải nén sách…</div>;
  const estimatedHeight = Math.max(420, containerHeight || Math.round(window.innerHeight * 0.8));
  return (
    <div className="azw3-chapter-stage" ref={stageRef}>
      <div className="azw3-chapter-stack">
        {chapter.spine.map((spineEntry, index) => (
          <section
            className="azw3-chapter-card"
            key={spineEntry.id}
            data-chapter-index={index}
            style={{ minHeight: `${chapterHeights[index] || estimatedHeight}px` }}
            aria-label={`Chương ${index + 1}`}
          >
            <Azw3Chapter
              book={chapter.book}
              spineEntry={spineEntry}
              chapterIndex={index}
              isRendered={renderedChapters.has(index)}
              height={chapterHeights[index] || estimatedHeight}
              theme={theme}
              fontSize={fontSize}
              onMeasure={handleMeasure}
              onReady={handleChapterReady}
              onError={handleChapterError}
              onNext={onNext}
              onPrevious={onPrevious}
            />
          </section>
        ))}
      </div>
    </div>
  );
});
