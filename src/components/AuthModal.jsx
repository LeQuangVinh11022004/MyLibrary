import { useEffect, useState } from "react";
import { Check, Copy, Download, KeyRound, ShieldCheck, X } from "lucide-react";

export function AuthModal({ open, initialCode, createdCode, onClose, onAuthenticate }) {
  const [mode, setMode] = useState("signin");
  const [code, setCode] = useState(initialCode);
  const [honeypot, setHoneypot] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [copied, setCopied] = useState(false);
  const [hasSavedCode, setHasSavedCode] = useState(Boolean(initialCode));

  useEffect(() => {
    if (open) {
      setMode("signin");
      setCode(initialCode);
      setHoneypot("");
      setHasSavedCode(Boolean(initialCode));
      setError("");
      setRemember(true);
    }
  }, [open, initialCode]);

  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    const now = Date.now();
    if (now < cooldownUntil) {
      const waitSeconds = Math.ceil((cooldownUntil - now) / 1000);
      setError(`Vui lòng đợi ${waitSeconds} giây trước khi thử lại.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onAuthenticate({ mode, code, remember, honeypot });
    } catch (cause) {
      setCooldownUntil(Date.now() + 2500);
      setError(cause.message || "Không thể xác thực mã ID. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(createdCode);
      setCopied(true);
    } catch {
      setError("Không thể sao chép tự động. Hãy chọn và sao chép mã bên trên.");
    }
  }

  function clearSavedCode() {
    try {
      window.localStorage.removeItem("trang-sach-saved-access-code");
      setCode("");
      setHasSavedCode(false);
      setError("");
    } catch (cause) {
      setError(`Không thể xóa mã đã lưu: ${cause.message}`);
    }
  }

  function downloadCode() {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`Trang sách - mã ID đăng nhập\n\n${createdCode}\n`], { type: "text/plain;charset=utf-8" }));
    link.download = "trang-sach-ma-id.txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !createdCode) onClose(); }}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        {!createdCode && <button className="modal-close" type="button" onClick={onClose} aria-label="Đóng"><X size={19} /></button>}
        <div className="modal-icon"><KeyRound size={21} /></div>
        {createdCode ? (
          <>
            <p className="eyebrow">MÃ ĐĂNG NHẬP CỦA BẠN</p>
            <h2 id="auth-title">Lưu lại mã ID</h2>
            <p className="modal-description">Mã này là chìa khóa duy nhất vào thư viện. Hãy lưu lại trước khi đóng cửa sổ.</p>
            <code className="created-code">{createdCode}</code>
            <div className="code-actions">
              <button className="button button-secondary" type="button" onClick={copyCode}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Đã sao chép" : "Sao chép mã"}</button>
              <button className="button button-secondary" type="button" onClick={downloadCode}><Download size={17} />Tải mã về máy</button>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <p className="security-note">Mất mã thì không thể khôi phục tài khoản. Đừng chia sẻ mã này.</p>
            <button className="button button-primary full-width" type="button" onClick={onClose}>Mình đã lưu mã</button>
          </>
        ) : (
          <>
            <p className="eyebrow">THƯ VIỆN CỦA RIÊNG BẠN</p>
            <h2 id="auth-title">{mode === "signin" ? "Chào bạn trở lại" : "Tạo thư viện cá nhân"}</h2>
            <p className="modal-description">{mode === "signin"
              ? "Nhập mã ID để mở những cuốn sách của bạn."
              : "Tạo một mã ID ngẫu nhiên để dùng làm chìa khóa đăng nhập."}</p>
            <form onSubmit={submit}>
              <div className="visually-hidden" aria-hidden="true">
                <label>Website
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(event) => setHoneypot(event.target.value)}
                  />
                </label>
              </div>
              {mode === "signin" ? (
                <>
                  <label className="form-label">Mã ID
                    <input autoFocus className="form-input code-input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" spellCheck="false" required />
                  </label>
                  {hasSavedCode && <button className="clear-saved-code" type="button" onClick={clearSavedCode}>Xóa mã đã ghi nhớ trên thiết bị này</button>}
                </>
              ) : (
                <div className="signup-note">
                  <span>🔐</span>
                  <p>Mã sẽ chỉ hiển thị một lần. Hãy sao chép hoặc tải về trước khi tiếp tục.</p>
                  <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Ghi nhớ mã trên thiết bị này</label>
                </div>
              )}
              <div className="auth-shield-badge" role="note">
                <ShieldCheck size={15} />
                <span>Bảo vệ bằng SHA-256 Proof-of-Work & giới hạn tối đa 3 phiên Redis</span>
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="button button-primary full-width auth-submit" type="submit" disabled={busy}>{busy ? "Đang xác thực…" : mode === "signin" ? "Đăng nhập" : "Tạo mã ID"}</button>
            </form>
            <p className="auth-switch">{mode === "signin" ? "Chưa có tài khoản?" : "Đã có mã ID?"}{" "}
              <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}> {mode === "signin" ? "Tạo tài khoản" : "Đăng nhập"}</button>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
