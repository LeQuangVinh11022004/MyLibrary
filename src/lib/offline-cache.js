const DATABASE_NAME = "trang-sach-offline";
const DATABASE_VERSION = 1;
const STORE_NAME = "documents";

function openDatabase() {
  if (!window.indexedDB) throw new Error("Trình duyệt này không hỗ trợ lưu tài liệu offline.");
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Không thể mở bộ nhớ offline."));
    request.onblocked = () => reject(new Error("Bộ nhớ offline đang bị khóa bởi tab khác."));
  });
}

function cacheKey(userId, documentId) {
  return `${userId}:${documentId}`;
}

async function runTransaction(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;
    try {
      result = operation(store);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      database.close();
      resolve(result?.result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error("Không thể cập nhật bộ nhớ offline."));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error("Thao tác bộ nhớ offline đã bị hủy."));
    };
  });
}

export function cacheDocument(userId, documentId, blob, metadata, annotations = []) {
  return runTransaction("readwrite", (store) => store.put({
    key: cacheKey(userId, documentId),
    blob,
    metadata,
    annotations,
    savedAt: Date.now(),
  }));
}

export async function getCachedDocument(userId, documentId) {
  return runTransaction("readonly", (store) => store.get(cacheKey(userId, documentId)));
}

export function removeCachedDocument(userId, documentId) {
  return runTransaction("readwrite", (store) => store.delete(cacheKey(userId, documentId)));
}
