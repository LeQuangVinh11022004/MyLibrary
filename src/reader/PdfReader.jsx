import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";

function clampPage(page, totalPages) {
  return Math.min(totalPages, Math.max(1, Number.isInteger(page) ? page : 1));
}

export function PdfReader({ blob, initialProgress, onProgress, onReady }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const renderedRef = useRef(false);
  const touchStartRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(() => (
    Number.isInteger(initialProgress?.pageNumber) ? initialProgress.pageNumber : 1
  ));
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(() => (
    Number.isFinite(initialProgress?.zoom) ? Math.min(2, Math.max(0.75, initialProgress.zoom)) : 1
  ));
  const [containerWidth, setContainerWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let loadingTask;

    async function loadPdf() {
      try {
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
        setPdf(document);
        setTotalPages(document.numPages);
        setPageNumber((current) => clampPage(current, document.numPages));
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
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !containerWidth || !canvasRef.current) return undefined;
    let active = true;
    let renderTask;

    async function renderPage() {
      setRendering(true);
      setError("");
      try {
        const page = await pdf.getPage(pageNumber);
        if (!active) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (Math.max(200, containerWidth - 32) / baseViewport.width) * zoom;
        const viewport = page.getViewport({ scale });
        const pixelRatio = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;
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
        if (!renderedRef.current) {
          renderedRef.current = true;
          onReady();
        }
        onProgress({ format: "pdf", pageNumber, totalPages, zoom });
      } catch (cause) {
        if (!active || cause.name === "RenderingCancelledException") return;
        console.error("Không thể hiển thị trang PDF.", cause);
        setError(cause.message || "Không thể hiển thị trang PDF.");
        if (!renderedRef.current) onReady(cause);
      }
    }

    renderPage();
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [containerWidth, onProgress, onReady, pageNumber, pdf, totalPages, zoom]);

  function changePage(delta) {
    setPageNumber((current) => clampPage(current + delta, totalPages));
    if (stageRef.current) {
      stageRef.current.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    }
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
        {rendering && <div className="pdf-page-loading">Đang tải trang {pageNumber}…</div>}
        <canvas ref={canvasRef} className="pdf-page-canvas" aria-label={`Trang ${pageNumber} trên ${totalPages}`} />
      </div>
    </div>
  );
}
