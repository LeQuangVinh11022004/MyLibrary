import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase, supabaseSetupMessage } from "../lib/supabase";

const SAVED_ACCESS_CODE_KEY = "trang-sach-saved-access-code";

function savedCode() {
  try {
    return window.localStorage.getItem(SAVED_ACCESS_CODE_KEY) || "";
  } catch (error) {
    console.warn("Không thể đọc mã ID đã lưu.", error);
    return "";
  }
}

async function checkSignupSettings() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key } });
  if (!response.ok) throw new Error("Không đọc được cài đặt Auth của Supabase. Kiểm tra kết nối rồi thử lại.");
  const settings = await response.json();
  if (settings.disable_signup) throw new Error("Supabase đang khóa đăng ký mới. Bật Allow new users to sign up để tạo tài khoản.");
  if (settings.external?.email !== true) throw new Error("Hãy bật Email provider trong Supabase; email chỉ dùng nội bộ để xác thực mã ID.");
  if (settings.mailer_autoconfirm !== true) throw new Error("Hãy tắt Confirm email trong cài đặt Email của Supabase.");
}

export function useAuth() {
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [initialCode, setInitialCode] = useState("");
  const [createdCode, setCreatedCode] = useState("");

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (active) setUser(data.session?.user || null);
    }).catch((error) => console.error("Không thể khôi phục phiên đăng nhập.", error));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const openAuth = useCallback(() => {
    setInitialCode(savedCode());
    setCreatedCode("");
    setAuthOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    setAuthOpen(false);
    setCreatedCode("");
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const authenticate = useCallback(async ({ mode, code, remember }) => {
    if (!isSupabaseConfigured || !supabase) throw new Error(supabaseSetupMessage);
    if (mode === "signup") {
      await checkSignupSettings();
      const accessCode = crypto.randomUUID().toLowerCase();
      const { data, error } = await supabase.auth.signUp({
        email: `${accessCode}@accounts.example.com`,
        password: accessCode,
        options: { data: { library_id_hint: accessCode.slice(0, 8).toUpperCase() } },
      });
      if (error) throw error;
      if (!data.session) throw new Error("Supabase chưa tạo phiên. Hãy kiểm tra Confirm email đã tắt.");
      try {
        if (remember) window.localStorage.setItem(SAVED_ACCESS_CODE_KEY, accessCode);
        else window.localStorage.removeItem(SAVED_ACCESS_CODE_KEY);
      } catch (error) {
        console.warn("Không thể lưu mã ID trên trình duyệt.", error);
      }
      setCreatedCode(accessCode);
      return;
    }
    const accessCode = code.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(accessCode)) {
      throw new Error("Mã ID không đúng định dạng. Hãy nhập đầy đủ mã UUID.");
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: `${accessCode}@accounts.example.com`,
      password: accessCode,
    });
    if (error) throw error;
    closeAuth();
  }, [closeAuth]);

  return {
    user,
    authOpen,
    initialCode,
    createdCode,
    openAuth,
    closeAuth,
    signOut,
    authenticate,
  };
}
