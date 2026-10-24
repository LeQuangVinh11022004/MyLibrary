import { ChevronLeft, ChevronRight, Minus, Moon, Plus, Sun } from "lucide-react";

export function ReaderToolbar({ location, theme, fontSize, onPrevious, onNext, onFont, onTheme }) {
  return (
    <div className="reader-toolbar">
      <div className="reader-page-nav">
        <button className="reader-control" type="button" onClick={() => onPrevious()} aria-label="Trang trước"><ChevronLeft size={17} /><span>Trước</span></button>
        <span className="reader-location" aria-live="polite">{location}</span>
        <button className="reader-control" type="button" onClick={() => onNext()} aria-label="Trang tiếp theo"><span>Tiếp</span><ChevronRight size={17} /></button>
      </div>
      <div className="reader-settings" aria-label="Tùy chỉnh trình đọc">
        <button className="reader-control font-control" type="button" onClick={() => onFont(-2)} aria-label="Giảm cỡ chữ" title="Giảm cỡ chữ"><Minus size={14} /><span>A</span></button>
        <span className="font-size-indicator">{fontSize}px</span>
        <button className="reader-control font-control" type="button" onClick={() => onFont(2)} aria-label="Tăng cỡ chữ" title="Tăng cỡ chữ"><Plus size={14} /><span>A</span></button>
        <button className="reader-control theme-control" type="button" onClick={onTheme} aria-label="Đổi màu nền">
          {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
          <span>{theme === "light" ? "Sáng" : theme === "sepia" ? "Sepia" : "Tối"}</span>
        </button>
      </div>
    </div>
  );
}
