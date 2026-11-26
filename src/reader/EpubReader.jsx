import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import ePub from "epubjs";
import JSZip from "jszip";

window.JSZip ||= JSZip;

const THEMES = {
  light: { background: "#fffefa", color: "#292d28" },
  sepia: { background: "#f2e8d5", color: "#463a2e" },
  dark: { background: "#20241f", color: "#eee9df" },
};

export const EpubReader = forwardRef(function EpubReader({
  blob,
  initialProgress,
  theme,
  fontSize,
  onLocation,
  onProgress,
  onToc,
  onSection,
  onSelectText,
  onReady,
}, ref) {
  const mountRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const initialProgressRef = useRef(initialProgress);
  const onSectionRef = useRef(onSection);
  const onSelectTextRef = useRef(onSelectText);
  onSectionRef.current = onSection;
  onSelectTextRef.current = onSelectText;
  useImperativeHandle(ref, () => ({
    previous: () => renditionRef.current?.prev(),
    next: () => renditionRef.current?.next(),
    goTo: (progress) => renditionRef.current?.display(progress?.href || progress?.cfi || progress?.percentage || undefined),
    search: async (query) => {
      const book = bookRef.current;
      const rendition = renditionRef.current;
      if (!book || !rendition) throw new Error("EPUB chưa sẵn sàng để tìm kiếm.");
      const cleanQuery = query.toLocaleLowerCase("vi");
      const currentSectionIndex = rendition.currentLocation()?.start?.index;
      for (const section of book.spine.spineItems) {
        let found = false;
        try {
          await section.load(book.load.bind(book));
          const [match] = section.find(cleanQuery);
          if (match) {
            await rendition.display(match.cfi);
            found = true;
            return `Tìm thấy trong sách: “${match.excerpt}”`;
          }
        } finally {
          if (!found && section.index !== currentSectionIndex) section.unload();
        }
      }
      return "Không tìm thấy nội dung phù hợp trong EPUB.";
    },
  }), []);

  useEffect(() => {
    let disposed = false;
    let bookOpened = false;
    let bookDestroyed = false;
    let book;
    let swipeStart = null;
    function destroyBook() {
      if (!book || bookDestroyed) return;
      book.destroy();
      bookDestroyed = true;
    }

    async function openBook() {
      try {
        const content = await blob.arrayBuffer();
        if (disposed || !mountRef.current) return;
        book = ePub();
        await book.open(content, "binary");
        bookOpened = true;
        bookRef.current = book;
        if (onToc) {
          book.loaded.navigation.then((nav) => {
            if (disposed) return;
            const flatten = (items = [], depth = 0) => items.flatMap((entry) => [
              { id: entry.id || entry.href, label: (entry.label || "").trim(), href: entry.href, depth },
              ...flatten(entry.subitems || [], depth + 1),
            ]);
            onToc(flatten(nav?.toc || []).filter((entry) => entry.label && entry.href));
          }).catch(() => {});
        }
        if (disposed || !mountRef.current) {
          destroyBook();
          return;
        }
        const rendition = book.renderTo(mountRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "none",
        });
        renditionRef.current = rendition;
        Object.entries(THEMES).forEach(([name, colors]) => {
          rendition.themes.register(
            `library-${name}`,
            `body { background: ${colors.background} !important; color: ${colors.color} !important; font-family: Literata, Georgia, serif !important; line-height: 1.75 !important; }
            p, li, blockquote { line-height: 1.75 !important; }
            p { margin: 0 0 .85em !important; text-align: left !important; }
            h1, h2, h3, h4 { line-height: 1.35 !important; color: ${colors.color} !important; }
            a { color: inherit !important; text-decoration-color: rgba(127, 127, 127, .5) !important; }
            img, svg, video { max-width: 100% !important; height: auto !important; }`,
          );
        });
        rendition.on("relocated", (location) => {
          const position = location.start;
          const percentage = position?.percentage;
          if (position?.href) onSectionRef.current?.(position.href);
          onLocation(Number.isFinite(percentage) ? `${Math.round(percentage * 100)}%` : "Đang đọc");
          if (position?.cfi) {
            onProgress({
              format: "epub",
              cfi: position.cfi,
              percentage: Number.isFinite(percentage) ? percentage : 0,
              pageNumber: position.displayed?.page || 1,
            });
          }
        });
        rendition.on("touchstart", (event) => {
          if (event.touches?.length !== 1) {
            swipeStart = null;
            return;
          }
          swipeStart = {
            x: event.touches[0].clientX,
            y: event.touches[0].clientY,
          };
        });
        rendition.on("touchend", (event) => {
          if (!swipeStart || !event.changedTouches?.length) return;
          const touch = event.changedTouches[0];
          const deltaX = touch.clientX - swipeStart.x;
          const deltaY = touch.clientY - swipeStart.y;
          swipeStart = null;
          if (Math.abs(deltaX) < 55 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
          const pageTurn = deltaX < 0 ? rendition.next() : rendition.prev();
          pageTurn.catch((cause) => console.warn("Không thể chuyển trang EPUB.", cause));
        });
        rendition.on("selected", (_cfiRange, contents) => {
          const frameWindow = contents?.window;
          const selected = frameWindow?.getSelection();
          if (!selected || selected.isCollapsed || !selected.rangeCount) return;
          const rect = selected.getRangeAt(0).getBoundingClientRect();
          const frameRect = frameWindow.frameElement?.getBoundingClientRect() || { top: 0, left: 0 };
          onSelectTextRef.current?.(selected.toString(), {
            top: rect.top + frameRect.top,
            bottom: rect.bottom + frameRect.top,
            left: rect.left + frameRect.left,
            right: rect.right + frameRect.left,
            width: rect.width,
            height: rect.height,
          });
        });
        rendition.on("keyup", (event) => {
          window.dispatchEvent(new KeyboardEvent("keydown", {
            key: event.key,
            code: event.code,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
          }));
        });
        const savedProgress = initialProgressRef.current;
        const savedCfi = savedProgress?.format === "epub" ? savedProgress.cfi : null;
        const savedPercentage = savedProgress?.format === "epub"
          && Number.isFinite(savedProgress.percentage)
          ? savedProgress.percentage
          : null;
        try {
          await rendition.display(savedCfi || savedPercentage || undefined);
        } catch (cause) {
          if (!savedCfi || savedPercentage === null) throw cause;
          console.warn("Không thể khôi phục vị trí EPUB bằng CFI; thử theo phần trăm.", cause);
          await rendition.display(savedPercentage);
        }
        rendition.themes.fontSize(`${fontSize}px`);
        rendition.themes.select(`library-${theme}`);
        onReady();
      } catch (error) {
        destroyBook();
        if (!disposed) onReady(error);
      }
    }
    openBook();
    return () => {
      disposed = true;
      renditionRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
      if (bookOpened) destroyBook();
    };
  }, [blob, onReady, onLocation, onProgress, onToc]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.fontSize(`${fontSize}px`);
    rendition.themes.select(`library-${theme}`);
  }, [fontSize, theme]);

  return (
    <div className={`epub-canvas theme-${theme}`}>
      <button
        type="button"
        className="epub-edge-zone is-prev"
        onClick={() => renditionRef.current?.prev()}
        aria-label="Trang trước"
        title="Trang trước (←)"
      />
      <div className="epub-page" ref={mountRef} />
      <button
        type="button"
        className="epub-edge-zone is-next"
        onClick={() => renditionRef.current?.next()}
        aria-label="Trang tiếp theo"
        title="Trang tiếp theo (→)"
      />
    </div>
  );
});
