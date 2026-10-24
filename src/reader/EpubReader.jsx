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
  onReady,
}, ref) {
  const mountRef = useRef(null);
  const renditionRef = useRef(null);
  const initialProgressRef = useRef(initialProgress);
  useImperativeHandle(ref, () => ({
    previous: () => renditionRef.current?.prev(),
    next: () => renditionRef.current?.next(),
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
            `body { background: ${colors.background} !important; color: ${colors.color} !important; font-family: Literata, Georgia, serif !important; }`,
          );
        });
        rendition.on("relocated", (location) => {
          const position = location.start;
          const percentage = position?.percentage;
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
      if (bookOpened) destroyBook();
    };
  }, [blob, onReady, onLocation, onProgress]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.fontSize(`${fontSize}px`);
    rendition.themes.select(`library-${theme}`);
  }, [fontSize, theme]);

  return (
    <div className={`epub-canvas theme-${theme}`}>
      <div className="epub-page" ref={mountRef} />
    </div>
  );
});
