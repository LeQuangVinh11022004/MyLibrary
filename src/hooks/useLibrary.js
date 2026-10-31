import { useCallback, useEffect, useState } from "react";
import { removeCachedDocument } from "../lib/offline-cache";
import { supabase } from "../lib/supabase";
import {
  getUploadErrorMessage,
  mapDocument,
  mapFolder,
  MAX_FILE_SIZE,
  STORAGE_BUCKET,
} from "../lib/library-utils";

const DOCUMENT_COLUMNS = "id,name,content_type,size_bytes,added_at,last_opened,favorite,status,folder_id,relative_path,storage_path";
const FOLDER_COLUMNS = "id,name,parent_id,created_at";
const HASH_QUERY_BATCH_SIZE = 100;

function fileExtension(name) {
  return name.match(/\.([a-z0-9]{1,10})$/i)?.[0]?.toLowerCase() || "";
}

async function digestFile(file) {
  if (!crypto.subtle) throw new Error("Trình duyệt cần HTTPS để kiểm tra tệp trùng.");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function contentType(file) {
  if (file.type) return file.type;
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  if (/\.epub$/i.test(file.name)) return "application/epub+zip";
  return "application/octet-stream";
}

export function useLibrary(user, notify) {
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const reload = useCallback(async () => {
    if (!supabase || !user) {
      setDocuments([]);
      setFolders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [documentResult, folderResult] = await Promise.all([
        supabase.from("library_documents").select(DOCUMENT_COLUMNS)
          .eq("owner_id", user.id).order("added_at", { ascending: false }),
        supabase.from("library_folders").select(FOLDER_COLUMNS)
          .eq("owner_id", user.id).order("created_at", { ascending: true }),
      ]);
      if (documentResult.error) throw documentResult.error;
      if (folderResult.error) throw folderResult.error;
      setDocuments(documentResult.data.map(mapDocument));
      setFolders(folderResult.data.map(mapFolder));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    reload().catch((error) => {
      console.error("Không thể tải thư viện.", error);
      notify(`Không thể tải thư viện: ${error.message}`);
    });
  }, [reload, notify]);

  const ensureFolder = useCallback(async (name, parentId, cache = []) => {
    const existing = cache.find((item) => item.parentId === parentId
      && item.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"))
      || folders.find((item) => item.parentId === parentId
        && item.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"));
    if (existing) return existing.id;
    const { data, error } = await supabase.from("library_folders")
      .insert({ owner_id: user.id, name, parent_id: parentId })
      .select(FOLDER_COLUMNS).single();
    if (error) throw error;
    const folder = mapFolder(data);
    cache.push(folder);
    setFolders((items) => [...items, folder]);
    return folder.id;
  }, [folders, user]);

  const createFolder = useCallback(async (name, parentId) => {
    if (!supabase || !user) throw new Error("Đăng nhập trước khi tạo thư mục.");
    const folderId = await ensureFolder(name, parentId);
    notify(`Đã tạo thư mục “${name}”.`);
    return folderId;
  }, [ensureFolder, notify, user]);

  const uploadFiles = useCallback(async (fileList, folderId, isFolderUpload = false) => {
    if (!supabase || !user) throw new Error("Đăng nhập trước khi tải tài liệu lên.");
    const allFiles = [...fileList];
    if (!allFiles.length) return;
    const accepted = allFiles.filter((file) => file.size <= MAX_FILE_SIZE);
    const folderCache = [];
    let uploaded = 0;
    let duplicates = 0;
    const tooLarge = allFiles.length - accepted.length;
    const failures = [];
    setUploading(true);
    try {
      const preparedFiles = [];
      for (const file of accepted) {
        let targetFolderId = folderId;
        const relativePath = file.webkitRelativePath || "";
        try {
          if (isFolderUpload && relativePath) {
            const rootFolder = relativePath.split("/")[0];
            targetFolderId = await ensureFolder(rootFolder, folderId, folderCache);
          }
          const contentSha256 = await digestFile(file);
          preparedFiles.push({ file, targetFolderId, relativePath, contentSha256 });
        } catch (error) {
          console.error(`Không thể chuẩn bị ${file.name} để tải lên.`, error);
          failures.push(`${file.name}: ${getUploadErrorMessage(error)}`);
        }
      }

      const existingHashes = new Set();
      const uniqueHashes = [...new Set(preparedFiles.map(({ contentSha256 }) => contentSha256))];
      try {
        for (let offset = 0; offset < uniqueHashes.length; offset += HASH_QUERY_BATCH_SIZE) {
          const hashBatch = uniqueHashes.slice(offset, offset + HASH_QUERY_BATCH_SIZE);
          const { data, error } = await supabase.from("library_documents")
            .select("content_sha256")
            .eq("owner_id", user.id)
            .in("content_sha256", hashBatch);
          if (error) throw error;
          for (const row of data) existingHashes.add(row.content_sha256);
        }
      } catch (error) {
        console.error("Không thể kiểm tra tệp trùng trên Supabase.", error);
        for (const { file } of preparedFiles) {
          failures.push(`${file.name}: ${getUploadErrorMessage(error)}`);
        }
        preparedFiles.length = 0;
      }

      const uploadedHashes = new Set();
      for (const { file, targetFolderId, relativePath, contentSha256 } of preparedFiles) {
        if (existingHashes.has(contentSha256) || uploadedHashes.has(contentSha256)) {
          duplicates += 1;
          continue;
        }
        try {
          const id = crypto.randomUUID();
          const storagePath = `${user.id}/${id}${fileExtension(file.name)}`;
          const type = contentType(file);
          const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET)
            .upload(storagePath, file, { contentType: type, upsert: false });
          if (uploadError) throw uploadError;
          const { error } = await supabase.from("library_documents").insert({
            id,
            owner_id: user.id,
            folder_id: targetFolderId,
            name: file.name,
            storage_path: storagePath,
            content_type: type,
            size_bytes: file.size,
            relative_path: relativePath,
            content_sha256: contentSha256,
          });
          if (error) {
            const { error: cleanupError } = await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
            if (cleanupError) throw new Error(`${error.message}; không thể dọn file tải dở: ${cleanupError.message}`);
            if (error.code === "23505") {
              duplicates += 1;
              uploadedHashes.add(contentSha256);
              continue;
            }
            throw error;
          }
          uploaded += 1;
          uploadedHashes.add(contentSha256);
        } catch (error) {
          console.error(`Không thể tải lên ${file.name}.`, error);
          failures.push(`${file.name}: ${getUploadErrorMessage(error)}`);
        }
      }
      await reload();
      const summary = [
        uploaded && `Đã tải ${uploaded} tệp lên.`,
        duplicates && `Bỏ qua ${duplicates} tệp trùng.`,
        tooLarge && `${tooLarge} tệp vượt giới hạn 50 MB.`,
        ...failures.slice(0, 2),
        failures.length > 2 && `${failures.length - 2} lỗi khác.`,
      ].filter(Boolean).join(" ");
      notify(summary || "Không có tệp phù hợp để tải lên.");
    } finally {
      setUploading(false);
    }
  }, [ensureFolder, notify, reload, user]);

  const toggleFavorite = useCallback(async (id) => {
    const item = documents.find((document) => document.id === id);
    if (!item) return;
    const { error } = await supabase.from("library_documents").update({ favorite: !item.favorite }).eq("id", id);
    if (error) throw error;
    setDocuments((items) => items.map((document) => document.id === id
      ? { ...document, favorite: !document.favorite } : document));
  }, [documents]);

  const toggleRead = useCallback(async (id) => {
    const item = documents.find((document) => document.id === id);
    if (!item) return;
    const status = item.status === "read" ? "unread" : "read";
    const { error } = await supabase.from("library_documents").update({ status }).eq("id", id);
    if (error) throw error;
    setDocuments((items) => items.map((document) => document.id === id ? { ...document, status } : document));
  }, [documents]);

  const downloadDocument = useCallback(async (item) => {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(item.storagePath);
    if (error) throw error;
    const url = URL.createObjectURL(data);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = item.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const deleteDocument = useCallback(async (id) => {
    const item = documents.find((document) => document.id === id);
    if (!item || !window.confirm(`Xóa vĩnh viễn “${item.name}” khỏi thư viện?`)) return;
    const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([item.storagePath]);
    if (storageError) throw storageError;
    const { error } = await supabase.from("library_documents").delete().eq("id", id);
    if (error) throw error;
    setDocuments((items) => items.filter((document) => document.id !== id));
    try {
      await removeCachedDocument(user.id, item.id);
    } catch (cacheError) {
      console.error("Không thể xóa bản offline khỏi thiết bị.", cacheError);
      notify("Đã xóa bản cloud, nhưng cần xóa thủ công bản offline trên thiết bị này.");
      return;
    }
    notify("Đã xóa tài liệu khỏi thư viện.");
  }, [documents, notify, user]);

  return {
    documents,
    folders,
    loading,
    uploading,
    reload,
    createFolder,
    uploadFiles,
    toggleFavorite,
    toggleRead,
    downloadDocument,
    deleteDocument,
  };
}
