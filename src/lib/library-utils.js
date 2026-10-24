export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const STORAGE_BUCKET = "library-files";

export function mapDocument(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.content_type || "",
    size: Number(row.size_bytes),
    addedAt: Date.parse(row.added_at),
    lastOpened: row.last_opened ? Date.parse(row.last_opened) : 0,
    favorite: row.favorite,
    status: row.status,
    folderId: row.folder_id,
    relativePath: row.relative_path || "",
    storagePath: row.storage_path,
  };
}

export function mapFolder(row) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: Date.parse(row.created_at),
  };
}

export function getFileKind(file) {
  const type = (file.type || "").toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (type === "application/pdf" || extension === "pdf") return { label: "PDF", tone: "rose" };
  if (["epub", "azw3", "mobi", "azw"].includes(extension)) return { label: extension.toUpperCase(), tone: "green" };
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp"].includes(extension)) return { label: "ẢNH", tone: "violet" };
  if (["doc", "docx", "odt", "rtf", "ppt", "pptx"].includes(extension)) return { label: extension.toUpperCase(), tone: "blue" };
  if (["xls", "xlsx", "csv", "ods"].includes(extension)) return { label: extension.toUpperCase(), tone: "teal" };
  return { label: extension.length < 7 ? extension.toUpperCase() : "FILE", tone: "amber" };
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export function getFolderPath(folder, folders) {
  if (!folder) return "";
  const parts = [folder.name];
  let parent = folders.find((item) => item.id === folder.parentId);
  while (parent && parts.length <= folders.length) {
    parts.unshift(parent.name);
    parent = folders.find((item) => item.id === parent.parentId);
  }
  return parts.join(" / ");
}

export function getUploadErrorMessage(error) {
  const message = error?.message || "Lỗi không xác định.";
  if (/content_sha256.*does not exist|could not find.*content_sha256/i.test(message)) {
    return "Thiếu cột kiểm tra tệp trùng. Chạy lại schema SQL của Supabase.";
  }
  if (/bucket not found|nosuchbucket/i.test(message)) {
    return "Bucket library-files chưa được tạo. Chạy schema SQL của Supabase.";
  }
  if (/row-level security|permission denied|not authorized|403/i.test(message)) {
    return "Supabase từ chối quyền tải lên. Kiểm tra Storage policies.";
  }
  if (/too large|exceed.*size|maximum.*size|413/i.test(message)) {
    return "Tệp vượt quá giới hạn 50 MB.";
  }
  return message;
}
