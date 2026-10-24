import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(url && anonKey);
export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null;

export const supabaseSetupMessage =
  "Chưa cấu hình Supabase. Tạo file .env.local từ .env.example, điền Project URL và anon key rồi khởi động lại ứng dụng.";
