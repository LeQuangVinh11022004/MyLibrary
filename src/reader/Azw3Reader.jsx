import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

const PARSER_URL = "https://cdn.jsdelivr.net/npm/@lingo-reader/mobi-parser@0.4.6/+esm";

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
  const [chapter, setChapter] = useState(null);
  const iframeRef = useRef(null);
  const initialProgressRef = useRef(initialProgress);

  useImperativeHandle(ref, () => ({
    search: async (query) => {
      if (!chapter) throw new Error("AZW3 chưa sẵn sàng để tìm kiếm.");
      const cleanQuery = query.toLocaleLowerCase("vi");
      for (let index = 0; index < chapter.spine.length; index += 1) {
        const contents = chapter.book.loadChapter(chapter.spine[index].id);
        const searchableText = new DOMParser().parseFromString(sanitizeHtml(contents?.html || ""), "text/html")
          .body.textContent.toLocaleLowerCase("vi");
        if (searchableText.includes(cleanQuery)) {
          onChapter(chapter.spine.length, index);
          return `Tìm thấy trong chương ${index + 1} / ${chapter.spine.length}.`;
        }
      }
      return "Không tìm thấy nội dung phù hợp trong AZW3.";
    },
  }), [chapter, onChapter]);

  useEffect(() => {
    let active = true;
    let book;
    async function openBook() {
      const parser = await import(/* @vite-ignore */ PARSER_URL);
      if (typeof parser.initKf8File !== "function") throw new Error("Không tải được trình đọc AZW3.");
      book = await parser.initKf8File(new Uint8Array(await blob.arrayBuffer()));
      const spine = book.getSpine();
      if (!spine.length) throw new Error("Sách AZW3 không có nội dung để đọc.");
      if (!active) {
        book.destroy();
        return;
      }
      const initialIndex = Math.min(
        spine.length - 1,
        Math.max(0, Number.isInteger(initialProgressRef.current?.chapterIndex)
          ? initialProgressRef.current.chapterIndex
          : 0),
      );
      onChapter(spine.length, initialIndex);
      setChapter({ book, spine });
      onReady();
    }
    openBook().catch((error) => { if (active) onReady(error); });
    return () => {
      active = false;
      book?.destroy();
    };
  }, [blob, onChapter, onReady]);

  useEffect(() => {
    if (!chapter) return;
    onProgress({ format: "azw3", chapterIndex, totalChapters: chapterCount(chapter) });
  }, [chapter, chapterIndex, onProgress]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;
    let activeDocument;
    let touchStart = null;
    function attachTouchHandlers() {
      const contentDocument = iframe.contentDocument;
      if (!contentDocument) return;
      if (activeDocument) {
        activeDocument.removeEventListener("touchstart", onTouchStart);
        activeDocument.removeEventListener("touchend", onTouchEnd);
      }
      activeDocument = contentDocument;
      activeDocument.addEventListener("touchstart", onTouchStart, { passive: true });
      activeDocument.addEventListener("touchend", onTouchEnd, { passive: true });
    }
    function onTouchStart(event) {
      if (event.touches.length !== 1) {
        touchStart = null;
        return;
      }
      touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    function onTouchEnd(event) {
      if (!touchStart || !event.changedTouches.length) return;
      const deltaX = event.changedTouches[0].clientX - touchStart.x;
      const deltaY = event.changedTouches[0].clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(deltaX) < 55 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      if (deltaX < 0) onNext();
      else onPrevious();
    }
    iframe.addEventListener("load", attachTouchHandlers);
    attachTouchHandlers();
    return () => {
      iframe.removeEventListener("load", attachTouchHandlers);
      activeDocument?.removeEventListener("touchstart", onTouchStart);
      activeDocument?.removeEventListener("touchend", onTouchEnd);
    };
  }, [chapterIndex, onNext, onPrevious, theme, fontSize]);

  if (!chapter) return <div className="reader-loading">Đang giải nén sách…</div>;
  const spineEntry = chapter.spine[chapterIndex];
  const contents = chapter.book.loadChapter(spineEntry.id);
  if (!contents?.html) {
    return <div className="reader-error" role="alert">Không tìm thấy nội dung của chương này.</div>;
  }
  const colors = {
    light: ["#fffefa", "#292d28"],
    sepia: ["#f2e8d5", "#463a2e"],
    dark: ["#20241f", "#eee9df"],
  }[theme];
  const safeHtml = sanitizeHtml(contents.html);
  const frameHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; img-src blob: data:; media-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:; object-src 'none'; script-src 'none';"><style>html,body{margin:0;min-height:100%;background:${colors[0]};color:${colors[1]}}body{padding:clamp(24px,6vw,76px);font:${fontSize}px/1.8 Georgia,serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${safeHtml}</body></html>`;
  return <iframe ref={iframeRef} className="azw3-frame" title={`AZW3, chương ${chapterIndex + 1}`} sandbox="allow-same-origin" srcDoc={frameHtml} />;
});

function chapterCount(chapter) {
  return chapter.spine.length;
}
