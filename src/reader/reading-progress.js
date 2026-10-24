const PROGRESS_PREFIX = "trang-sach:reading-progress";
const FORMATS = new Set(["epub", "pdf", "azw3"]);

function progressKey(userId, documentId) {
  return `${PROGRESS_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(documentId)}`;
}

export function loadReadingProgress(userId, documentId) {
  try {
    const stored = window.localStorage.getItem(progressKey(userId, documentId));
    if (!stored) return null;
    const progress = JSON.parse(stored);
    if (!progress || !FORMATS.has(progress.format)) return null;
    return progress;
  } catch (error) {
    console.warn("Không thể đọc tiến độ đọc đã lưu.", error);
    return null;
  }
}

export function saveReadingProgress(userId, documentId, progress) {
  window.localStorage.setItem(
    progressKey(userId, documentId),
    JSON.stringify({ ...progress, updatedAt: Date.now() }),
  );
}
