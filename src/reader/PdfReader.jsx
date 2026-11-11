import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";

function clampPage(page, totalPages) {
  return Math.min(totalPages, Math.max(1, Number.isInteger(page) ? page : 1));
}

function PdfPage({
  pdf,
  pageNumber,
  containerWidth,
  zoom,
  estimatedRatio,
  isNearViewport,
  onRendered,
  onError,
}) {
  const canvasRef = useRef(null);
  const [pageRatio, setPageRatio] = useState(estimatedRatio);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    setPageRatio(estimatedRatio);
  }, [estimatedRatio]);

  useEffect(() => {
    if (!isNearViewport || !containerWidth || !canvasRef.current) return undefined;
    let active = true;
    let renderTask;

    async function renderPage() {
      setRendering(true);
      try {
        const page = await pdf.getPage(pageNumber);
        if (!active) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (Math.max(200, containerWidth - 32) / baseViewport.width) * zoom;
        const viewport = page.getViewport({ scale });
        setPageRatio(viewport.height / viewport.width);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d", { alpha: false });
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        await renderTask.promise;
        if (!active) return;
        setRendering(false);
        onRendered(pageNumber);
      } catch (cause) {
        if (!active || cause.name === "RenderingCancelledException") return;
        setRendering(false);
        onError(cause);
      }
    }

    renderPage();
    return () => {
      active = false;
      renderTask?.cancel();
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [containerWidth, isNearViewport, onError, onRendered, pageNumber, pdf, zoom]);

  const width = Math.max(200, containerWidth - 32) * zoom;
  return (
    <article
      className={`pdf-page-card${isNearViewport ? " is-active" : ""}`}
      data-page-number={pageNumber}
      style={{ width: `${width}px`, aspectRatio: `1 / ${pageRatio}` }}
      aria-label={`Trang ${pageNumber}`}
    >
      {isNearViewport
        ? <canvas ref={canvasRef} className={`pdf-page-canvas${rendering ? " is-rendering" : ""}`} />
        : <div className="pdf-page-placeholder" aria-hidden="true" />}
      <span className="pdf-page-label">Trang {pageNumber}</span>
      {rendering && <span className="pdf-page-loading">Đang tải trang…</span>}
    </article>
  );
}

export const PdfReader = forwardRef(function PdfReader({ blob, initialProgress, onProgress, onReady }, ref) {
  const stageRef = useRef(null);
  const renderedRef = useRef(false);
  const initialPositionRestoredRef = useRef(false);
  const initialPageNumberRef = useRef(Number.isInteger(initialProgress?.pageNumber) ? initialProgress.pageNumber : 1);
  const pageNumberRef = useRef(initialPageNumberRef.current);
  const touchStartRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(pageNumberRef.current);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(() => (
    Number.isFinite(initialProgress?.zoom) ? Math.min(2, Math.max(0.75, initialProgress.zoom)) : 1
  ));
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [pageRatio, setPageRatio] = useState(11 / 8.5);
  const [renderPages, setRenderPages] = useState(() => new Set());
  const [error, setError] = useState("");

  pageNumberRef.current = pageNumber;

  function scrollToPage(page, behavior = "smooth") {
    if (!totalPages || !stageRef.current) return;
    const targetPage = clampPage(page, totalPages);
    setPageNumber(targetPage);
    const target = stageRef.current.querySelector(`[data-page-number="${targetPage}"]`);
    if (!target) return;
    const stageTop = stageRef.current.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    stageRef.current.scrollTo({
      top: stageRef.current.scrollTop + targetTop - stageTop - 12,
      behavior,
    });
  }

  useImperativeHandle(ref, () => ({
    goTo: (progress) => {
      const restorePage = Number.isInteger(progress?.pageNumber) ? progress.pageNumber : null;
      if (Number.isFinite(progress?.zoom)) {
        setZoom(Math.min(2, Math.max(0.75, progress.zoom)));
        if (restorePage !== null) {
          window.requestAnimationFrame(() => scrollToPage(restorePage));
        }
      } else if (restorePage !== null) {
        scrollToPage(restorePage);
      }
    },
    search: async (query) => {
      if (!pdf || !totalPages) throw new Error("PDF chưa sẵn sàng để tìm kiếm.");
      const cleanQuery = query.toLocaleLowerCase("vi");
      for (let offset = 0; offset < totalPages; offset += 1) {
        const foundPage = ((pageNumberRef.current - 1 + offset) % totalPages) + 1;
        const page = await pdf.getPage(foundPage);
        const content = await page.getTextContent();
        const text = content.items.map((item) => item.str || "").join(" ").toLocaleLowerCase("vi");
        if (text.includes(cleanQuery)) {
          scrollToPage(foundPage);
          return `Tìm thấy ở trang ${foundPage} / ${totalPages}.`;
        }
      }
      return "Không tìm thấy nội dung phù hợp trong PDF.";
    },
  }), [pdf, totalPages]);

  useEffect(() => {
    let active = true;
    let loadingTask;
    initialPositionRestoredRef.current = false;
    renderedRef.current = false;
    setPdf(null);
    setTotalPages(0);
    setRenderPages(new Set());
    setError("");

    async function loadPdf() {
      try {
        initialPageNumberRef.current = Number.isInteger(initialProgress?.pageNumber) ? initialProgress.pageNumber : 1;
        const data = new Uint8Array(await blob.arrayBuffer());
        if (!active) return;
        const [pdfjsLib, workerModule] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;
        if (!active) return;
        loadingTask = pdfjsLib.getDocument({ data });
        const document = await loadingTask.promise;
        if (!active) return;
        const firstPage = await document.getPage(1);
        if (!active) return;
        const firstViewport = firstPage.getViewport({ scale: 1 });
        setPageRatio(firstViewport.height / firstViewport.width);
        setPdf(document);
        setTotalPages(document.numPages);
        setPageNumber(clampPage(initialPageNumberRef.current, document.numPages));
      } catch (cause) {
        if (!active) return;
        console.error("Không thể tải PDF.", cause);
        setError(cause.message || "Không thể đọc tài liệu PDF.");
        onReady(cause);
      }
    }

    loadPdf();
    return () => {
      active = false;
      if (loadingTask) {
        loadingTask.destroy().catch((cause) => {
          console.warn("Không thể dọn bộ đọc PDF.", cause);
        });
      }
    };
  }, [blob, onReady]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(Math.floor(entry.contentRect.width));
      setContainerHeight(Math.floor(entry.contentRect.height));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !pdf || !totalPages) return undefined;
    const pageElements = stage.querySelectorAll(".pdf-page-card");
    if (!window.IntersectionObserver) {
      setRenderPages(new Set(Array.from({ length: totalPages }, (_, index) => index + 1)));
      return undefined;
    }

    const renderMargin = Math.max(600, Math.round(containerHeight * 1.25));
    const activeBand = Math.max(48, Math.round(containerHeight * 0.28));
    const activeTopInset = Math.max(0, Math.round((containerHeight - activeBand) / 2));
    const activeBottomInset = Math.max(0, containerHeight - activeBand - activeTopInset);
    const renderObserver = new IntersectionObserver((entries) => {
      setRenderPages((current) => {
        let next = current;
        for (const entry of entries) {
          const page = Number(entry.target.dataset.pageNumber);
          const shouldRender = entry.isIntersecting;
          if (shouldRender === next.has(page)) continue;
          if (next === current) next = new Set(current);
          if (shouldRender) next.add(page);
          else next.delete(page);
        }
        return next;
      });
    }, { root: stage, rootMargin: `${renderMargin}px 0px ${renderMargin}px 0px`, threshold: 0 });

    const activeObserver = new IntersectionObserver((entries) => {
      const visiblePage = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visiblePage) setPageNumber(Number(visiblePage.target.dataset.pageNumber));
    }, {
      root: stage,
      rootMargin: `-${activeTopInset}px 0px -${activeBottomInset}px 0px`,
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });

    pageElements.forEach((element) => {
      renderObserver.observe(element);
      activeObserver.observe(element);
    });
    return () => {
      renderObserver.disconnect();
      activeObserver.disconnect();
    };
  }, [containerHeight, pdf, totalPages]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !pdf || !totalPages || initialPositionRestoredRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const targetPage = clampPage(initialPageNumberRef.current, totalPages);
      const target = stage.querySelector(`[data-page-number="${targetPage}"]`);
      if (target) {
        const stageTop = stage.getBoundingClientRect().top;
        const targetTop = target.getBoundingClientRect().top;
        stage.scrollTo({ top: stage.scrollTop + targetTop - stageTop - 12, behavior: "auto" });
      }
      initialPositionRestoredRef.current = true;
      setPageNumber(targetPage);
      onProgress({ format: "pdf", pageNumber: targetPage, totalPages, zoom });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [onProgress, pdf, totalPages, zoom]);

  useEffect(() => {
    if (!pdf || !totalPages || !initialPositionRestoredRef.current) return;
    onProgress({ format: "pdf", pageNumber, totalPages, zoom });
  }, [onProgress, pageNumber, pdf, totalPages, zoom]);

  const handlePageRendered = useCallback((renderedPage) => {
    if (renderedRef.current) return;
    renderedRef.current = true;
    onReady();
  }, [onReady]);

  const handlePageError = useCallback((cause) => {
    console.error("Không thể hiển thị trang PDF.", cause);
    setError(cause.message || "Không thể hiển thị trang PDF.");
    if (!renderedRef.current) {
      renderedRef.current = true;
      onReady(cause);
    }
  }, [onReady]);

  function changePage(delta) {
    scrollToPage(pageNumber + delta);
  }

  function startSwipe(event) {
    if (event.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function endSwipe(event) {
    if (!touchStartRef.current || zoom > 1) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    changePage(deltaX < 0 ? 1 : -1);
  }

  if (error) {
    return <div className="pdf-reader-error" role="alert">{error}</div>;
  }

  return (
    <div className="pdf-reader">
      <div className="pdf-reader-controls" aria-label="Điều khiển PDF">
        <button type="button" className="reader-control pdf-control" onClick={() => changePage(-1)} disabled={pageNumber <= 1} aria-label="Trang PDF trước"><ChevronLeft size={18} /></button>
        <span className="pdf-page-count" aria-live="polite">{pageNumber} / {totalPages || "…"}</span>
        <button type="button" className="reader-control pdf-control" onClick={() => changePage(1)} disabled={pageNumber >= totalPages} aria-label="Trang PDF tiếp theo"><ChevronRight size={18} /></button>
        <span className="pdf-control-spacer" />
        <button type="button" className="reader-control pdf-control" onClick={() => setZoom((current) => Math.max(0.75, current - 0.25))} disabled={zoom <= 0.75} aria-label="Thu nhỏ PDF"><Minus size={17} /></button>
        <span className="pdf-zoom-label">{Math.round(zoom * 100)}%</span>
        <button type="button" className="reader-control pdf-control" onClick={() => setZoom((current) => Math.min(2, current + 0.25))} disabled={zoom >= 2} aria-label="Phóng to PDF"><Plus size={17} /></button>
      </div>
      <div
        className={`pdf-page-stage${zoom > 1 ? " is-zoomed" : ""}`}
        ref={stageRef}
        onTouchStart={startSwipe}
        onTouchEnd={endSwipe}
        onTouchCancel={() => { touchStartRef.current = null; }}
      >
        <div className="pdf-page-stack">
          {pdf && Array.from({ length: totalPages }, (_, index) => {
            const page = index + 1;
            return (
              <PdfPage
                key={page}
                pdf={pdf}
                pageNumber={page}
                containerWidth={containerWidth}
                zoom={zoom}
                estimatedRatio={pageRatio}
                isNearViewport={renderPages.has(page)}
                onRendered={handlePageRendered}
                onError={handlePageError}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});
