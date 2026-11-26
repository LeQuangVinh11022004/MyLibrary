import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeftRight, Check, Copy, Languages, LoaderCircle, Volume2, X } from "lucide-react";
import { detectDirection, prepareTranslationText, translateText } from "../lib/translate";

const LABELS = { en: "Tiếng Anh", vi: "Tiếng Việt" };
const POPOVER_WIDTH = 360;
const GAP = 10;

function speak(text, lang) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === "vi" ? "vi-VN" : "en-US";
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

export function TranslatePopover({ selection, onClose }) {
  const popoverRef = useRef(null);
  const [direction, setDirection] = useState(() => detectDirection(selection.text));
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [placement, setPlacement] = useState({ top: 0, left: 0, above: false });
  const { text, truncated } = prepareTranslationText(selection.text);

  useEffect(() => {
    setDirection(detectDirection(selection.text));
  }, [selection.text]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResult("");
    setCopied(false);
    translateText(text, direction.source, direction.target, controller.signal)
      .then((translation) => setResult(translation))
      .catch((cause) => {
        if (cause.name !== "AbortError") setError(cause.message || "Không dịch được đoạn này.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [direction.source, direction.target, text]);

  useLayoutEffect(() => {
    const { rect } = selection;
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 24);
    const height = popoverRef.current?.offsetHeight || 200;
    const centerX = rect.left + rect.width / 2;
    const left = Math.min(Math.max(12, centerX - width / 2), window.innerWidth - width - 12);
    const fitsBelow = rect.bottom + GAP + height < window.innerHeight - 8;
    const top = fitsBelow ? rect.bottom + GAP : Math.max(8, rect.top - GAP - height);
    setPlacement({ top, left, width, above: !fitsBelow });
  }, [selection, result, loading, error]);

  useEffect(() => {
    function onPointerDown(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) onClose();
    }
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onPointerDown), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [onClose]);

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
    } catch {
      setError("Không sao chép được, hãy bôi đen bản dịch để copy.");
    }
  }

  const englishText = direction.source === "en" ? text : result;

  return (
    <div
      ref={popoverRef}
      className={`translate-popover${placement.above ? " is-above" : ""}`}
      style={{ top: placement.top, left: placement.left, width: placement.width }}
      role="dialog"
      aria-label="Bản dịch đoạn đã chọn"
    >
      <header className="translate-popover-head">
        <span className="translate-popover-title"><Languages size={15} /> {LABELS[direction.source]} → {LABELS[direction.target]}</span>
        <div className="translate-popover-actions">
          <button type="button" onClick={() => setDirection(({ source, target }) => ({ source: target, target: source }))} title="Đổi chiều dịch" aria-label="Đổi chiều dịch"><ArrowLeftRight size={14} /></button>
          <button type="button" onClick={() => speak(englishText, "en")} disabled={!englishText} title="Nghe phát âm tiếng Anh" aria-label="Nghe phát âm tiếng Anh"><Volume2 size={14} /></button>
          <button type="button" onClick={copyResult} disabled={!result} title="Sao chép bản dịch" aria-label="Sao chép bản dịch">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
          <button type="button" onClick={onClose} title="Đóng (Esc)" aria-label="Đóng bản dịch"><X size={15} /></button>
        </div>
      </header>
      <blockquote className="translate-popover-source">{text}{truncated ? "…" : ""}</blockquote>
      <div className="translate-popover-result" aria-live="polite">
        {loading && <span className="translate-popover-loading"><LoaderCircle size={15} className="spin" /> Đang dịch…</span>}
        {!loading && error && <span className="translate-popover-error">{error}</span>}
        {!loading && !error && result}
      </div>
      {truncated && <p className="translate-popover-note">Chỉ dịch 480 ký tự đầu của đoạn đã chọn.</p>}
    </div>
  );
}
