import { useEffect } from "react";
import { CheckCircle2, X } from "lucide-react";

export function Toast({ message, onClose }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <CheckCircle2 size={18} aria-hidden="true" />
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Đóng thông báo"><X size={16} /></button>
    </div>
  );
}
