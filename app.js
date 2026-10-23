const BUCKET = "library-files";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const READER_CACHE_NAME = "mylibrary-reader-cache";
const READER_CACHE_STORE = "books";
const READER_CACHE_LIMIT = 200 * 1024 * 1024;
const SAVED_ACCESS_CODE_KEY = "trang-sach-saved-access-code";
const MOBI_PARSER_URL = "https://cdn.jsdelivr.net/npm/@lingo-reader/mobi-parser@0.4.6/+esm";
const READER_THEMES = {
  light: { label: "Nền: sáng", background: "#fffefa", color: "#282d27" },
  sepia: { label: "Nền: sepia", background: "#f2e8d5", color: "#463a2e" },
  dark: { label: "Nền: tối", background: "#20241f", color: "#eee9df" },
};

const state = {
  supabase: null,
  user: null,
  documents: [],
  folders: [],
  view: "all",
  folderId: null,
  search: "",
  sort: "newest",
  layout: "grid",
  toastTimer: null,
  previewUrl: null,
  rendition: null,
  book: null,
  azw3Book: null,
  azw3Spine: [],
  azw3ChapterIndex: 0,
  azw3PageIndex: 0,
  azw3PageCount: 1,
  currentReaderName: "",
  readerFontSize: 18,
  readerTheme: "light",
  readerRequestId: 0,
  authMode: "signin",
  createdAccessCode: null,
};

const byId = (id) => window.document.getElementById(id);
const fileInput = byId("fileInput");
const folderInput = byId("folderInput");
const documentGrid = byId("documentGrid");

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3600);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function fileKind(document) {
  const type = (document.type || "").toLowerCase();
  const extension = document.name.split(".").pop().toLowerCase();
  if (type === "application/pdf" || extension === "pdf") return { badge: "PDF", css: "pdf" };
  if (["epub", "mobi", "azw", "azw3"].includes(extension)) return { badge: extension.toUpperCase(), css: "epub" };
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(extension)) return { badge: "ẢNH", css: "image" };
  if (["doc", "docx", "odt", "rtf"].includes(extension)) return { badge: extension.toUpperCase(), css: "doc" };
  if (["xls", "xlsx", "csv", "ods"].includes(extension)) return { badge: extension.toUpperCase(), css: "sheet" };
  if (["ppt", "pptx", "odp"].includes(extension)) return { badge: extension.toUpperCase(), css: "doc" };
  return { badge: extension && extension.length < 7 ? extension.toUpperCase() : "FILE", css: "other" };
}

function getFolder(folderId) {
  return state.folders.find((folder) => folder.id === folderId);
}

function folderPath(folder) {
  if (!folder) return "";
  const parts = [folder.name];
  let parent = getFolder(folder.parentId);
  while (parent && parts.length <= state.folders.length) {
    parts.unshift(parent.name);
    parent = getFolder(parent.parentId);
  }
  return parts.join(" / ");
}

function updateAuthUI() {
  const signedIn = Boolean(state.user);
  const idHint = state.user?.user_metadata?.library_id_hint;
  byId("authButton").textContent = signedIn ? "Đăng xuất" : "Đăng nhập";
  byId("profileName").textContent = signedIn ? `Thư viện ${idHint ? `#${idHint}` : "cá nhân"}` : "Chưa đăng nhập";
  byId("profileStatus").textContent = signedIn ? "Đã kết nối · riêng tư" : "Kết nối Supabase";
  byId("authButton").setAttribute("aria-label", signedIn ? "Đăng xuất" : "Đăng nhập");
  byId("connectionNotice").hidden = Boolean(state.supabase);
  byId("connectionNotice").textContent = state.supabase
    ? ""
    : "Cần kết nối Supabase trước khi lưu tệp trực tuyến. Điền Project URL và anon key trong supabase-config.js.";
}

function renderSidebar() {
  byId("allCount").textContent = String(state.documents.length);
  byId("statTotal").textContent = String(state.documents.length);
  byId("statFolders").textContent = String(state.folders.length);
  byId("statRead").textContent = String(state.documents.filter((document) => document.status === "read").length);
  const folderList = byId("folderList");
  folderList.replaceChildren();

  for (const folder of state.folders) {
    const count = state.documents.filter((document) => document.folderId === folder.id).length;
    const button = window.document.createElement("button");
    button.type = "button";
    button.className = `folder-link${state.folderId === folder.id ? " active" : ""}`;
    button.dataset.folder = folder.id;
    button.innerHTML = `<span class="folder-glyph" aria-hidden="true">▱</span><span class="folder-label"></span><span class="folder-total">${count}</span>`;
    button.querySelector(".folder-label").textContent = folderPath(folder);
    button.title = folderPath(folder);
    button.addEventListener("click", () => selectFolder(folder.id));
    folderList.append(button);
  }

  for (const button of window.document.querySelectorAll(".nav-link")) {
    button.classList.toggle("active", !state.folderId && button.dataset.view === state.view);
  }
}

function getVisibleDocuments() {
  let result = [...state.documents];
  if (state.folderId) {
    result = result.filter((document) => document.folderId === state.folderId);
  } else if (state.view === "favorites") {
    result = result.filter((document) => document.favorite);
  } else if (state.view === "unread") {
    result = result.filter((document) => document.status !== "read");
  } else if (state.view === "recent") {
    result = result.sort((a, b) => (b.lastOpened || b.addedAt) - (a.lastOpened || a.addedAt)).slice(0, 20);
  }
  if (state.search.trim()) {
    const query = state.search.trim().toLocaleLowerCase("vi");
    result = result.filter((document) => {
      const folder = getFolder(document.folderId);
      return document.name.toLocaleLowerCase("vi").includes(query)
        || (folderPath(folder).toLocaleLowerCase("vi").includes(query))
        || document.relativePath.toLocaleLowerCase("vi").includes(query);
    });
  }
  if (state.sort === "name") result.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  else if (state.sort === "oldest") result.sort((a, b) => a.addedAt - b.addedAt);
  else result.sort((a, b) => b.addedAt - a.addedAt);
  return result;
}

function sectionLabels() {
  if (state.folderId) {
    const folder = getFolder(state.folderId);
    return { title: folderPath(folder) || "Thư mục", description: "Tài liệu trong thư mục này." };
  }
  const labels = {
    all: ["Tài liệu của bạn", "Những điều hay ho bạn đã lưu lại."],
    recent: ["Gần đây", "Những tài liệu bạn mở gần nhất."],
    favorites: ["Yêu thích", "Những tài liệu bạn muốn giữ gần bên."],
    unread: ["Chưa đọc", "Những điều thú vị vẫn đang chờ bạn."],
  };
  return { title: labels[state.view][0], description: labels[state.view][1] };
}

function cardMarkup(document) {
  const kind = fileKind(document);
  const folder = getFolder(document.folderId);
  return `<article class="document-card" data-id="${escapeHtml(document.id)}">
    <div class="document-cover cover-${kind.css}" data-action="open" role="button" tabindex="0" aria-label="Đọc ${escapeHtml(document.name)}">
      <span class="file-badge">${escapeHtml(kind.badge)}</span>
      <button class="favorite-button${document.favorite ? " is-favorite" : ""}" type="button" data-action="favorite" aria-label="${document.favorite ? "Bỏ yêu thích" : "Thêm vào yêu thích"}">${document.favorite ? "♥" : "♡"}</button>
      <div class="cover-art" aria-hidden="true"><span></span><span></span><span></span></div>
    </div>
    <div class="document-info">
      <h3 class="document-title" data-action="open" title="${escapeHtml(document.name)}">${escapeHtml(document.name)}</h3>
      <p class="document-subtitle" title="${escapeHtml(document.relativePath || document.name)}">${escapeHtml(document.relativePath || `${kind.badge} · ${formatFileSize(document.size)}`)}</p>
      <div class="document-meta">
        <span>${document.status === "read" ? "Đã đọc" : formatDate(document.addedAt)}</span>
        ${folder ? `<span class="folder-pill">${escapeHtml(folder.name)}</span>` : ""}
        <span class="card-actions">
          <button class="card-action" type="button" data-action="download" aria-label="Tải xuống" title="Tải xuống">↓</button>
          <button class="card-action" type="button" data-action="delete" aria-label="Xóa tài liệu" title="Xóa">×</button>
        </span>
      </div>
    </div>
  </article>`;
}

function render() {
  renderSidebar();
  const labels = sectionLabels();
  byId("breadcrumbCurrent").textContent = labels.title;
  byId("sectionTitle").innerHTML = `${escapeHtml(labels.title)} <span>(${getVisibleDocuments().length})</span>`;
  byId("sectionDescription").textContent = labels.description;
  const documents = getVisibleDocuments();
  documentGrid.classList.toggle("list-layout", state.layout === "list");
  documentGrid.innerHTML = documents.map(cardMarkup).join("");
  const empty = documents.length === 0;
  documentGrid.hidden = empty;
  byId("emptyState").hidden = !empty;
  byId("emptyTitle").textContent = state.search ? "Không tìm thấy tài liệu" : "Bộ sưu tập của bạn đang chờ";
  byId("emptyDescription").textContent = state.search
    ? "Thử một từ khóa khác hoặc kiểm tra lại chính tả nhé."
    : !state.user ? "Đăng nhập vào thư viện để xem và lưu sách trực tuyến trên thiết bị này."
      : state.view === "favorites" ? "Nhấn biểu tượng trái tim trên tài liệu để lưu vào danh sách yêu thích."
        : state.view === "unread" ? "Tuyệt vời, bạn đã đọc hết tài liệu trong danh sách này."
          : state.folderId ? "Thư mục này chưa có tài liệu. Bạn có thể thêm tài liệu vào thư mục này."
            : "Tải PDF, EPUB hoặc tài liệu học tập lên — chúng sẽ được lưu riêng trong tài khoản Supabase của bạn.";
  byId("emptyUpload").hidden = state.search !== "" || state.view === "favorites" || state.view === "unread";
  byId("emptyUpload").innerHTML = state.user
    ? '<span aria-hidden="true">＋</span> Tải tài liệu đầu tiên'
    : "Đăng nhập để bắt đầu";
}

function selectFolder(folderId) {
  state.folderId = folderId;
  render();
  byId("sidebar").classList.remove("open");
}

function requireConnection() {
  if (!state.supabase) {
    showToast("Hãy điền Project URL và anon key vào supabase-config.js trước.");
    return false;
  }
  if (!state.user) {
    byId("authDialog").showModal();
    return false;
  }
  return true;
}

function chooseFiles() {
  if (requireConnection()) fileInput.click();
}

function fileExtension(name) {
  const match = name.match(/\.([a-z0-9]{1,10})$/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function contentType(file) {
  if (file.type) return file.type;
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  if (/\.epub$/i.test(file.name)) return "application/epub+zip";
  return "application/octet-stream";
}

async function sha256File(file) {
  if (!window.crypto?.subtle) {
    throw new Error("Trình duyệt cần HTTPS để kiểm tra tệp trùng lặp.");
  }
  const digest = await window.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureFolder(name, parentId) {
  const existing = state.folders.find((folder) => folder.parentId === parentId
    && folder.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"));
  if (existing) return existing.id;
  const { data, error } = await state.supabase.from("library_folders")
    .insert({ owner_id: state.user.id, name, parent_id: parentId })
    .select("*").single();
  if (error) throw error;
  const folder = { id: data.id, name: data.name, parentId: data.parent_id, createdAt: Date.parse(data.created_at) };
  state.folders.push(folder);
  return folder.id;
}

async function uploadOneFile(file, folderId, relativePath) {
  const contentSha256 = await sha256File(file);
  const { data: duplicate, error: duplicateError } = await state.supabase.from("library_documents")
    .select("id")
    .eq("owner_id", state.user.id)
    .eq("content_sha256", contentSha256)
    .maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) return false;

  const id = crypto.randomUUID();
  const storagePath = `${state.user.id}/${id}${fileExtension(file.name)}`;
  const type = contentType(file);
  const { error: uploadError } = await state.supabase.storage.from(BUCKET)
    .upload(storagePath, file, { contentType: type, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await state.supabase.from("library_documents").insert({
    id,
    owner_id: state.user.id,
    folder_id: folderId,
    name: file.name,
    storage_path: storagePath,
    content_type: type,
    size_bytes: file.size,
    relative_path: relativePath,
    content_sha256: contentSha256,
  }).select("*").single();
  if (error) {
    const { error: cleanupError } = await state.supabase.storage.from(BUCKET).remove([storagePath]);
    if (cleanupError) {
      console.error("Không thể dọn tệp tải lên dở dang.", cleanupError);
      throw new Error(`${error.message} Không thể dọn tệp trùng vừa tải lên: ${cleanupError.message}`);
    }
    if (error.code === "23505") return false;
    throw error;
  }
  return true;
}

function uploadErrorMessage(error) {
  const message = error?.message || "Lỗi không xác định.";
  if (/could not find.*content_sha256|column.*content_sha256.*does not exist/i.test(message)) {
    return "Thiếu cột kiểm tra tệp trùng. Chạy lại supabase-schema.sql trong Supabase SQL Editor.";
  }
  if (/bucket not found|nosuchbucket/i.test(message)) {
    return "Bucket library-files chưa được tạo. Chạy supabase-schema.sql trong Supabase SQL Editor.";
  }
  if (/row-level security|permission denied|not authorized|403/i.test(message)) {
    return "Supabase từ chối quyền tải lên. Kiểm tra Storage policies trong supabase-schema.sql.";
  }
  if (/too large|exceed.*size|maximum.*size|413/i.test(message)) {
    return "Tệp vượt quá giới hạn 50 MB của thư viện.";
  }
  return message;
}

async function handleFiles(fileList, isFolderUpload = false) {
  if (!requireConnection()) return;
  const files = [...fileList];
  if (!files.length) return;
  const accepted = files.filter((file) => file.size <= MAX_FILE_SIZE);
  const tooLarge = files.length - accepted.length;
  let uploaded = 0;
  let duplicates = 0;
  const failures = [];
  const folderCache = new Map();

  try {
    for (const file of accepted) {
      let folderId = state.folderId;
      const relativePath = file.webkitRelativePath || "";
      if (isFolderUpload && relativePath) {
        const rootFolder = relativePath.split("/")[0];
        const cacheKey = `${state.folderId || ""}:${rootFolder}`;
        if (!folderCache.has(cacheKey)) {
          folderCache.set(cacheKey, await ensureFolder(rootFolder, state.folderId));
        }
        folderId = folderCache.get(cacheKey);
      }
      try {
        if (await uploadOneFile(file, folderId, relativePath)) uploaded += 1;
        else duplicates += 1;
      } catch (error) {
        console.error(`Không thể tải lên ${file.name}.`, error);
        failures.push({ name: file.name, message: uploadErrorMessage(error) });
      }
    }
    await reloadData();
    const messages = [];
    if (uploaded) messages.push(`Đã tải ${uploaded} tệp lên Supabase.`);
    if (duplicates) messages.push(`Đã bỏ qua ${duplicates} tệp trùng nội dung.`);
    if (tooLarge) messages.push(`${tooLarge} tệp vượt quá giới hạn 50 MB.`);
    if (failures.length) {
      const firstFailure = failures[0];
      messages.push(`Không tải được “${firstFailure.name}”: ${firstFailure.message}`);
      if (failures.length > 1) messages.push(`(${failures.length - 1} tệp khác cũng thất bại.)`);
    }
    showToast(messages.join(" ") || "Không có tệp phù hợp để tải lên.");
  } catch (error) {
    console.error("Không thể tạo thư mục khi tải lên.", error);
    showToast(`Không thể tải lên: ${error.message || "lỗi kết nối Supabase."}`);
    await reloadData();
  } finally {
    fileInput.value = "";
    folderInput.value = "";
  }
}

function mapDocument(row) {
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

async function reloadData() {
  if (!state.supabase || !state.user) {
    state.documents = [];
    state.folders = [];
    render();
    return;
  }
  const [documentResult, folderResult] = await Promise.all([
    state.supabase.from("library_documents").select("*").order("added_at", { ascending: false }),
    state.supabase.from("library_folders").select("*").order("created_at", { ascending: true }),
  ]);
  if (documentResult.error) throw documentResult.error;
  if (folderResult.error) throw folderResult.error;
  state.documents = documentResult.data.map(mapDocument);
  state.folders = folderResult.data.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: Date.parse(row.created_at),
  }));
  render();
}

async function createFolder(name) {
  try {
    state.folderId = await ensureFolder(name, state.folderId);
    state.view = "all";
    await reloadData();
    showToast(`Đã tạo thư mục “${name}” trên Supabase.`);
  } catch (error) {
    console.error("Không thể tạo thư mục.", error);
    showToast(`Không thể tạo thư mục: ${error.message || "lỗi kết nối Supabase."}`);
  }
}

function cleanupPreview() {
  state.readerRequestId += 1;
  if (state.rendition) state.rendition.destroy();
  if (state.book) state.book.destroy();
  if (state.azw3Book) state.azw3Book.destroy();
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.rendition = null;
  state.book = null;
  state.azw3Book = null;
  state.azw3Spine = [];
  state.azw3ChapterIndex = 0;
  state.azw3PageIndex = 0;
  state.azw3PageCount = 1;
  state.currentReaderName = "";
  state.previewUrl = null;
  byId("previewContent").replaceChildren();
  byId("readerControls").hidden = true;
  byId("readerPrevious").disabled = false;
  byId("readerNext").disabled = false;
}

function azw3ReaderStyles() {
  const theme = READER_THEMES[state.readerTheme];
  return `html{height:100%;overflow-x:auto;overflow-y:hidden;scroll-behavior:smooth;scrollbar-width:none;background:${theme.background}!important;color:${theme.color}!important}body{box-sizing:border-box;height:100%;margin:0;padding:clamp(20px,5vw,48px);column-width:calc(100vw - clamp(20px,5vw,48px) - clamp(20px,5vw,48px));column-gap:clamp(40px,10vw,96px);column-fill:auto;font:${state.readerFontSize}px/1.8 Georgia,"Times New Roman",serif;overflow-wrap:anywhere;background:${theme.background}!important;color:${theme.color}!important}img,svg,video{max-width:100%;height:auto;break-inside:avoid}table{max-width:100%;overflow-x:auto;break-inside:avoid}h1,h2,h3,h4,blockquote,figure{break-inside:avoid}p{orphans:3;widows:3}`;
}

function updateAzw3Frame(frame) {
  const style = frame.contentDocument?.getElementById("readerOverrides");
  if (style) style.textContent = azw3ReaderStyles();
}

function updateAzw3Pagination(frame, openLastPage = false) {
  const frameDocument = frame.contentDocument;
  if (!frameDocument) return;
  const root = frameDocument.documentElement;
  const viewportWidth = frame.clientWidth || root.clientWidth;
  if (!viewportWidth) return;
  const columns = frame.contentWindow.getComputedStyle(frameDocument.body);
  const pageStride = Number.parseFloat(columns.columnWidth) + Number.parseFloat(columns.columnGap);
  const contentWidth = Math.max(root.scrollWidth, frameDocument.body?.scrollWidth || 0);
  state.azw3PageCount = Math.max(1, Math.ceil(contentWidth / (Number.isFinite(pageStride) ? pageStride : viewportWidth)));
  state.azw3PageIndex = openLastPage
    ? state.azw3PageCount - 1
    : Math.min(state.azw3PageIndex, state.azw3PageCount - 1);
  root.scrollLeft = state.azw3PageIndex * (Number.isFinite(pageStride) ? pageStride : viewportWidth);
  byId("readerLocation").textContent =
    `Chương ${state.azw3ChapterIndex + 1} / ${state.azw3Spine.length} · Trang ${state.azw3PageIndex + 1} / ${state.azw3PageCount}`;
  byId("readerPrevious").disabled = state.azw3ChapterIndex === 0 && state.azw3PageIndex === 0;
  byId("readerNext").disabled =
    state.azw3ChapterIndex >= state.azw3Spine.length - 1
    && state.azw3PageIndex >= state.azw3PageCount - 1;
}

function sanitizeAzw3ChapterHtml(html) {
  const parsed = new window.DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("base, embed, form, frame, iframe, link, meta, object, script").forEach((element) => element.remove());
  parsed.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || ["action", "formaction", "ping", "srcdoc", "target"].includes(name)) {
        element.removeAttribute(attribute.name);
      } else if (name === "href" && !attribute.value.startsWith("#")) {
        element.removeAttribute(attribute.name);
      } else if (["src", "poster"].includes(name)
          && !/^(?:blob:|data:)/i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return parsed.body.innerHTML;
}

function renderAzw3Chapter(openLastPage = false) {
  const book = state.azw3Book;
  const chapterInfo = state.azw3Spine[state.azw3ChapterIndex];
  if (!book || !chapterInfo) return;

  const chapter = book.loadChapter(chapterInfo.id);
  if (!chapter) throw new Error("Không tìm thấy nội dung chương AZW3 này.");
  const stylesheetLinks = (chapter.css || []).map(({ href }) => {
    const url = new URL(href, window.location.href);
    return url.protocol === "blob:"
      ? `<link rel="stylesheet" href="${escapeHtml(url.href)}">`
      : "";
  }).join("");
  const frame = window.document.createElement("iframe");
  frame.className = "azw3-reader-frame";
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.referrerPolicy = "no-referrer";
  frame.title = `${state.currentReaderName} — chương ${state.azw3ChapterIndex + 1}`;
  const safeChapterHtml = sanitizeAzw3ChapterHtml(chapter.html);
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; img-src blob: data:; media-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:; object-src 'none'; script-src 'none';">${stylesheetLinks}<style id="readerOverrides">${azw3ReaderStyles()}</style></head><body>${safeChapterHtml}</body></html>`;
  frame.addEventListener("load", () => {
    updateAzw3Frame(frame);
    const frameDocument = frame.contentDocument;
    if (!frameDocument) return;
    updateAzw3Pagination(frame, openLastPage);
    frame.contentWindow.addEventListener("resize", () => updateAzw3Pagination(frame));
    let touchStart = null;
    frameDocument.addEventListener("touchstart", (event) => {
      const touch = event.changedTouches[0];
      touchStart = { x: touch.clientX, y: touch.clientY };
    }, { passive: true });
    frameDocument.addEventListener("touchend", (event) => {
      if (!touchStart) return;
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - touchStart.x;
      const deltaY = touch.clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
        moveReader(deltaX < 0 ? 1 : -1);
      }
    }, { passive: true });
    frameDocument.addEventListener("touchcancel", () => { touchStart = null; }, { passive: true });
  }, { once: true });
  byId("previewContent").replaceChildren(frame);
  byId("readerLocation").textContent = `Chương ${state.azw3ChapterIndex + 1} / ${state.azw3Spine.length}`;
}

async function openAzw3Reader(blob, document, dialog, requestId) {
  const parser = await import(MOBI_PARSER_URL);
  if (state.readerRequestId !== requestId || !dialog.open) return;
  if (typeof parser.initKf8File !== "function") {
    throw new Error("Không tải được trình đọc AZW3.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (state.readerRequestId !== requestId || !dialog.open) return;
  const book = await parser.initKf8File(bytes);
  if (state.readerRequestId !== requestId || !dialog.open) {
    book.destroy();
    return;
  }
  state.azw3Book = book;
  state.azw3Spine = book.getSpine();
  state.azw3ChapterIndex = 0;
  state.azw3PageIndex = 0;
  state.currentReaderName = document.name;
  if (!state.azw3Spine.length) throw new Error("Sách AZW3 không có nội dung để đọc.");
  byId("readerControls").hidden = false;
  applyReaderSettings();
  renderAzw3Chapter();
}

function applyReaderSettings() {
  const theme = READER_THEMES[state.readerTheme];
  byId("readerTheme").textContent = theme.label;
  byId("readerFontDown").disabled = state.readerFontSize <= 14;
  byId("readerFontUp").disabled = state.readerFontSize >= 30;
  if (state.rendition) {
    state.rendition.themes.fontSize(`${state.readerFontSize}px`);
    state.rendition.themes.select(`reader-${state.readerTheme}`);
  }
  const frame = byId("previewContent").querySelector(".azw3-reader-frame");
  if (frame) {
    updateAzw3Frame(frame);
    updateAzw3Pagination(frame);
  }
}

function moveReader(direction) {
  if (state.azw3Book) {
    const frame = byId("previewContent").querySelector(".azw3-reader-frame");
    const nextPageIndex = state.azw3PageIndex + direction;
    if (nextPageIndex >= 0 && nextPageIndex < state.azw3PageCount) {
      state.azw3PageIndex = nextPageIndex;
      if (frame) updateAzw3Pagination(frame);
      return;
    }
    const nextChapterIndex = state.azw3ChapterIndex + direction;
    if (nextChapterIndex < 0 || nextChapterIndex >= state.azw3Spine.length) return;
    state.azw3ChapterIndex = nextChapterIndex;
    state.azw3PageIndex = 0;
    try {
      renderAzw3Chapter(direction < 0);
    } catch (error) {
      console.error("Không thể mở chương AZW3.", error);
      showToast(`Không thể mở chương: ${error.message || "lỗi đọc sách."}`);
    }
    return;
  }
  if (!state.rendition) return;
  const movement = direction < 0 ? state.rendition.prev() : state.rendition.next();
  movement?.catch((error) => {
    console.error("Không thể chuyển trang sách.", error);
    showToast(`Không thể chuyển trang: ${error.message || "lỗi đọc sách."}`);
  });
}

function openReaderCache() {
  if (!window.indexedDB) return Promise.reject(new Error("Trình duyệt không hỗ trợ bộ nhớ đệm sách."));
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(READER_CACHE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(READER_CACHE_STORE)) {
        request.result.createObjectStore(READER_CACHE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Không thể mở bộ nhớ đệm sách."));
  });
}

function runReaderCacheTransaction(mode, action) {
  return openReaderCache().then((db) => new Promise((resolve, reject) => {
    let result = null;
    const transaction = db.transaction(READER_CACHE_STORE, mode);
    const store = transaction.objectStore(READER_CACHE_STORE);
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Không thể truy cập bộ nhớ đệm sách."));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Không thể cập nhật bộ nhớ đệm sách."));
    };
    try {
      action(store, (value) => { result = value; });
    } catch (error) {
      transaction.abort();
      db.close();
      reject(error);
    }
  }));
}

function readerCacheKey(document) {
  return `${state.user.id}:${document.id}`;
}

function getCachedReaderBlob(document) {
  const key = readerCacheKey(document);
  return runReaderCacheTransaction("readwrite", (store, setResult) => {
    const request = store.get(key);
    request.onsuccess = () => {
      const entry = request.result;
      if (!entry) return;
      if (entry.storagePath === document.storagePath && entry.size === document.size && entry.blob instanceof Blob) {
        setResult(entry.blob);
        store.put({ ...entry, lastAccessed: Date.now() });
      } else {
        store.delete(key);
      }
    };
  });
}

function cacheReaderBlob(document, blob) {
  if (blob.size > READER_CACHE_LIMIT) return Promise.resolve(false);
  const key = readerCacheKey(document);
  return runReaderCacheTransaction("readwrite", (store, setResult) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = request.result.filter((entry) => entry.key !== key);
      let totalSize = entries.reduce((total, entry) => total + entry.size, 0);
      entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
      for (const entry of entries) {
        if (totalSize + blob.size <= READER_CACHE_LIMIT) break;
        store.delete(entry.key);
        totalSize -= entry.size;
      }
      const canCache = totalSize + blob.size <= READER_CACHE_LIMIT;
      setResult(canCache);
      if (canCache) {
        store.put({
          key,
          storagePath: document.storagePath,
          size: blob.size,
          blob,
          lastAccessed: Date.now(),
        });
      }
    };
  });
}

function deleteCachedReaderBlob(document) {
  return runReaderCacheTransaction("readwrite", (store) => {
    store.delete(readerCacheKey(document));
  });
}

async function loadReaderBlob(document, requestId, dialog) {
  let blob = null;
  try {
    blob = await getCachedReaderBlob(document);
  } catch (error) {
    console.warn("Không thể đọc bộ nhớ đệm sách; sẽ tải từ Supabase.", error);
  }
  if (state.readerRequestId !== requestId || !dialog.open) return null;
  if (blob) return blob;

  const { data, error } = await state.supabase.storage.from(BUCKET).download(document.storagePath);
  if (error) throw error;
  if (state.readerRequestId !== requestId || !dialog.open) return null;
  try {
    const cached = await cacheReaderBlob(document, data);
    if (!cached) showToast("Đã tải sách, nhưng bộ nhớ đệm trên thiết bị đã đầy.");
  } catch (cacheError) {
    console.error("Không thể lưu sách vào bộ nhớ đệm trên thiết bị.", cacheError);
    showToast("Đã tải sách nhưng trình duyệt không thể lưu bộ nhớ đệm.");
  }
  return data;
}

async function openFile(document) {
  if (!state.supabase || !state.user) {
    showToast("Đăng nhập để đọc tài liệu trong thư viện.");
    return;
  }
  cleanupPreview();
  const requestId = state.readerRequestId;
  const dialog = byId("documentDialog");
  const kind = fileKind(document);
  state.currentReaderName = document.name;
  byId("previewName").textContent = document.name;
  byId("previewType").textContent = `${kind.badge} · ${formatFileSize(document.size)}`;
  byId("previewDetails").textContent = `Đã thêm ${formatDate(document.addedAt)}${getFolder(document.folderId) ? ` · ${folderPath(getFolder(document.folderId))}` : ""}`;
  byId("previewIcon").textContent = kind.badge;
  byId("previewIcon").className = `document-preview-icon cover-${kind.css}`;
  byId("previewContent").innerHTML = '<p class="preview-unavailable">Đang tải tài liệu từ thư viện…</p>';
  byId("previewRead").textContent = document.status === "read" ? "Đánh dấu chưa đọc" : "Đánh dấu đã đọc";
  byId("previewDownload").onclick = () => downloadDocument(document);
  byId("previewRead").onclick = () => toggleRead(document.id);
  dialog.showModal();

  try {
    const isBook = /\.(?:epub|azw3)$/i.test(document.name);
    const blob = isBook
      ? await loadReaderBlob(document, requestId, dialog)
      : await state.supabase.storage.from(BUCKET).download(document.storagePath).then(({ data, error }) => {
        if (error) throw error;
        return data;
      });
    if (state.readerRequestId !== requestId || !dialog.open) return;
    if (!blob) return;
    const preview = byId("previewContent");
    preview.replaceChildren();
    if (kind.badge === "PDF") {
      state.previewUrl = URL.createObjectURL(blob);
      const frame = window.document.createElement("iframe");
      frame.src = state.previewUrl;
      frame.title = `Trình đọc ${document.name}`;
      preview.append(frame);
    } else if (/\.epub$/i.test(document.name)) {
      if (!window.ePub) throw new Error("Không tải được thư viện đọc EPUB. Hãy kiểm tra kết nối internet.");
      if (!window.JSZip) throw new Error("Thiếu thư viện giải nén EPUB (JSZip). Tải lại trang khi có kết nối internet.");
      state.book = window.ePub();
      await state.book.open(await blob.arrayBuffer(), "binary");
      if (state.readerRequestId !== requestId || !dialog.open) return;
      byId("readerControls").hidden = false;
      const readerHeight = window.innerWidth <= 600 ? "68dvh" : "76vh";
      state.rendition = state.book.renderTo(preview, { width: "100%", height: readerHeight, flow: "paginated" });
      for (const [name, theme] of Object.entries(READER_THEMES)) {
        state.rendition.themes.register(
          `reader-${name}`,
          `body { background-color: ${theme.background} !important; color: ${theme.color} !important; }`,
        );
      }
      applyReaderSettings();
      state.rendition.on("relocated", (location) => {
        const percentage = location.start?.percentage;
        byId("readerLocation").textContent = Number.isFinite(percentage) ? `${Math.round(percentage * 100)}%` : "Đang đọc";
      });
      await state.rendition.display();
    } else if (/\.azw3$/i.test(document.name)) {
      await openAzw3Reader(blob, document, dialog, requestId);
      if (state.readerRequestId !== requestId || !dialog.open) return;
    } else if (/\.(?:azw|mobi)$/i.test(document.name)) {
      const note = window.document.createElement("p");
      note.className = "preview-unavailable";
      note.textContent = "Trình đọc web hỗ trợ EPUB, PDF và AZW3 không DRM. AZW/MOBI chưa được hỗ trợ trực tiếp; file gốc vẫn có thể tải xuống để mở bằng ứng dụng tương thích.";
      preview.append(note);
    } else if (blob.type.startsWith("image/")) {
      state.previewUrl = URL.createObjectURL(blob);
      const image = window.document.createElement("img");
      image.src = state.previewUrl;
      image.alt = document.name;
      preview.append(image);
    } else if (blob.type.startsWith("text/") || /\.(txt|md|csv|json|log)$/i.test(document.name)) {
      const pre = window.document.createElement("pre");
      pre.textContent = (await blob.text()).slice(0, 50000);
      if (state.readerRequestId !== requestId || !dialog.open) return;
      preview.append(pre);
    } else {
      const note = window.document.createElement("p");
      note.className = "preview-unavailable";
      note.textContent = "Có thể tải tệp xuống để mở bằng ứng dụng phù hợp.";
      preview.append(note);
    }
    if (state.readerRequestId !== requestId || !dialog.open) return;
    document.lastOpened = Date.now();
    const { error: updateError } = await state.supabase.from("library_documents")
      .update({ last_opened: new Date(document.lastOpened).toISOString() }).eq("id", document.id);
    if (updateError) throw updateError;
    render();
  } catch (error) {
    if (state.readerRequestId !== requestId || !dialog.open) return;
    console.error(`Không thể mở ${document.name}.`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const message = /\.azw3$/i.test(document.name)
      ? `Không thể đọc AZW3. Chỉ hỗ trợ file không DRM; hãy kiểm tra kết nối và tính toàn vẹn của sách. Chi tiết: ${errorMessage}`
      : `Không thể tải hoặc mở tài liệu: ${errorMessage}`;
    cleanupPreview();
    if (dialog.open) {
      const notice = window.document.createElement("p");
      notice.className = "preview-unavailable";
      notice.textContent = message;
      byId("previewContent").replaceChildren(notice);
    }
    showToast(message || "Không thể mở tài liệu do lỗi kết nối.");
  }
}

async function downloadDocument(document) {
  try {
    const { data: blob, error } = await state.supabase.storage.from(BUCKET).download(document.storagePath);
    if (error) throw error;
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = document.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error(`Không thể tải xuống ${document.name}.`, error);
    showToast(`Không thể tải xuống: ${error.message || "lỗi kết nối."}`);
  }
}

async function toggleFavorite(id) {
  const document = state.documents.find((item) => item.id === id);
  if (!document) return;
  const favorite = !document.favorite;
  const { error } = await state.supabase.from("library_documents").update({ favorite }).eq("id", id);
  if (error) {
    console.error("Không thể cập nhật yêu thích.", error);
    showToast(`Không thể cập nhật yêu thích: ${error.message}`);
    return;
  }
  document.favorite = favorite;
  render();
}

async function toggleRead(id) {
  const document = state.documents.find((item) => item.id === id);
  if (!document) return;
  const status = document.status === "read" ? "unread" : "read";
  const { error } = await state.supabase.from("library_documents").update({ status }).eq("id", id);
  if (error) {
    console.error("Không thể cập nhật trạng thái đọc.", error);
    showToast(`Không thể cập nhật trạng thái đọc: ${error.message}`);
    return;
  }
  document.status = status;
  byId("documentDialog").close();
  render();
  showToast(status === "read" ? "Đã đánh dấu tài liệu là đã đọc." : "Đã chuyển tài liệu về chưa đọc.");
}

async function deleteDocument(id) {
  const document = state.documents.find((item) => item.id === id);
  if (!document || !window.confirm(`Xóa vĩnh viễn “${document.name}” khỏi thư viện Supabase?`)) return;
  const { error: storageError } = await state.supabase.storage.from(BUCKET).remove([document.storagePath]);
  if (storageError) {
    console.error("Không thể xóa tệp trong Storage.", storageError);
    showToast(`Không thể xóa tệp: ${storageError.message}`);
    return;
  }
  const { error } = await state.supabase.from("library_documents").delete().eq("id", id);
  if (error) {
    console.error("Không thể xóa thông tin tài liệu.", error);
    showToast(`Đã xóa tệp nhưng chưa xóa được thông tin: ${error.message}`);
    return;
  }
  let cacheCleanupFailed = false;
  try {
    await deleteCachedReaderBlob(document);
  } catch (cacheError) {
    cacheCleanupFailed = true;
    console.error("Không thể xóa bản lưu trên thiết bị.", cacheError);
  }
  await reloadData();
  showToast(cacheCleanupFailed
    ? "Đã xóa tài liệu khỏi Supabase nhưng chưa xóa được bản lưu trên thiết bị."
    : "Đã xóa tài liệu khỏi Supabase.");
}

function showAuthDialog() {
  setAuthMode("signin");
  if (!state.supabase) {
    byId("authError").hidden = false;
    byId("authError").textContent = "Trước tiên hãy điền Project URL và anon key vào supabase-config.js.";
  } else {
    byId("authError").hidden = true;
    byId("authError").textContent = "";
  }
  byId("authDialog").showModal();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isSignup = mode === "signup";
  byId("authTitle").textContent = isSignup ? "Tạo tài khoản" : "Đăng nhập";
  byId("authDescription").textContent = isSignup
    ? "Tạo một mã ID ngẫu nhiên để dùng làm chìa khóa đăng nhập của bạn."
    : "Nhập mã ID đã lưu để mở thư viện trên thiết bị này.";
  byId("authSubmit").textContent = isSignup ? "Tạo mã ID" : "Đăng nhập";
  byId("authSwitchPrompt").textContent = isSignup ? "Đã có tài khoản?" : "Chưa có tài khoản?";
  byId("authSwitch").textContent = isSignup ? "Đăng nhập" : "Tạo tài khoản";
  byId("authCodeField").hidden = isSignup;
  byId("authCode").required = !isSignup;
  byId("authCode").value = isSignup ? "" : getSavedAccessCode();
  byId("savedCodeActions").hidden = isSignup || !byId("authCode").value;
  byId("rememberAccessCode").checked = true;
  byId("authSignupHint").hidden = !isSignup;
  byId("authCreatedPanel").hidden = true;
  byId("authSwitchRow").hidden = false;
  byId("authSubmitRow").hidden = false;
  byId("authError").hidden = true;
  byId("copyCreatedId").textContent = "Sao chép mã";
  state.createdAccessCode = null;
}

function syntheticEmail(accessCode) {
  return `${accessCode}@accounts.example.com`;
}

function getSavedAccessCode() {
  try {
    return window.localStorage.getItem(SAVED_ACCESS_CODE_KEY) ?? "";
  } catch (error) {
    console.error("Không thể đọc mã ID đã lưu trên thiết bị.", error);
    showToast("Trình duyệt không cho đọc mã đã lưu. Bạn vẫn có thể dán mã thủ công.");
    return "";
  }
}

function saveAccessCodeOnDevice(accessCode) {
  const shouldRemember = byId("rememberAccessCode").checked;
  try {
    if (shouldRemember) window.localStorage.setItem(SAVED_ACCESS_CODE_KEY, accessCode);
    else window.localStorage.removeItem(SAVED_ACCESS_CODE_KEY);
    return { saved: shouldRemember, failed: false };
  } catch (error) {
    console.error("Không thể ghi nhớ mã ID trên thiết bị.", error);
    return { saved: false, failed: shouldRemember };
  }
}

async function checkIdSignupSettings() {
  const config = window.SUPABASE_CONFIG;
  const response = await fetch(`${config.url.replace(/\/$/, "")}/auth/v1/settings`, {
    headers: { apikey: config.anonKey },
  });
  if (!response.ok) {
    throw new Error("Không đọc được cài đặt Auth của Supabase. Hãy kiểm tra kết nối rồi thử lại.");
  }
  const settings = await response.json();
  if (settings.disable_signup === true) {
    throw new Error("Supabase đang khóa đăng ký mới. Bật Allow new users to sign up trong Authentication → Settings → User Signups, tạo mã ID xong thì có thể tắt lại.");
  }
  if (settings.external?.email !== true) {
    throw new Error("Supabase đang tắt Email provider. Hãy bật Email trong Authentication → Sign In / Providers. Website vẫn chỉ yêu cầu mã ID; email chỉ được dùng nội bộ để Supabase xác thực.");
  }
  if (settings.mailer_autoconfirm !== true) {
    throw new Error("Để dùng ID không cần email, vào Supabase → Authentication → Sign In / Providers → Email và tắt Confirm email, rồi thử lại.");
  }
}

function showCreatedAccessCode(accessCode) {
  state.createdAccessCode = accessCode;
  const saveResult = saveAccessCodeOnDevice(accessCode);
  byId("createdIdCode").textContent = accessCode;
  byId("savedCodeStatus").textContent = saveResult.saved
    ? "Đã ghi nhớ trên trình duyệt này. Khi đăng nhập lại tại đây, mã sẽ được điền sẵn."
    : saveResult.failed
      ? "Không thể ghi nhớ mã trên trình duyệt. Hãy tải mã về máy hoặc sao chép ngay."
      : "Mã chưa được ghi nhớ trên thiết bị. Hãy tải mã về máy hoặc sao chép ngay.";
  byId("authTitle").textContent = "Lưu mã ID của bạn";
  byId("authDescription").textContent = "Tài khoản đã tạo và đang đăng nhập. Sao chép mã này ngay; mã sẽ không hiển thị lại.";
  byId("authCodeField").hidden = true;
  byId("authSignupHint").hidden = true;
  byId("authCreatedPanel").hidden = false;
  byId("authSwitchRow").hidden = true;
  byId("authSubmitRow").hidden = true;
}

function closeAuthDialog() {
  if (state.createdAccessCode
      && !window.confirm("Mã ID chỉ hiển thị một lần. Bạn đã lưu mã chưa?")) return;
  state.createdAccessCode = null;
  byId("authDialog").close();
}

async function submitAuth(event) {
  event.preventDefault();
  if (!state.supabase) {
    showAuthDialog();
    return;
  }
  byId("authSubmit").disabled = true;
  byId("authError").hidden = true;
  try {
    if (state.authMode === "signup") {
      await checkIdSignupSettings();
      const accessCode = crypto.randomUUID().toLowerCase();
      const { data, error } = await state.supabase.auth.signUp({
        email: syntheticEmail(accessCode),
        password: accessCode,
        options: { data: { library_id_hint: accessCode.slice(0, 8).toUpperCase() } },
      });
      if (error) throw error;
      if (!data.session) {
        throw new Error("Supabase chưa tạo phiên đăng nhập. Kiểm tra Confirm email đã tắt trong phần cấu hình Email.");
      }
      showCreatedAccessCode(accessCode);
      showToast("Đã tạo tài khoản. Hãy lưu mã ID trước khi đóng hộp thoại.");
    } else {
      const accessCode = byId("authCode").value.trim().toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(accessCode)) {
        throw new Error("Mã ID không đúng định dạng. Hãy nhập đầy đủ mã UUID đã được cấp.");
      }
      const { error } = await state.supabase.auth.signInWithPassword({
        email: syntheticEmail(accessCode),
        password: accessCode,
      });
      if (error) throw error;
      byId("authDialog").close();
      showToast("Đăng nhập thành công.");
    }
  } catch (error) {
    byId("authError").hidden = false;
    byId("authError").textContent = error.message || "Không thể xác thực mã ID. Hãy kiểm tra mã và thử lại.";
  } finally {
    byId("authSubmit").disabled = false;
  }
}

documentGrid.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const card = action.closest(".document-card");
  const document = state.documents.find((item) => item.id === card?.dataset.id);
  if (!document) return;
  switch (action.dataset.action) {
    case "open": openFile(document); break;
    case "favorite": toggleFavorite(document.id); break;
    case "download": downloadDocument(document); break;
    case "delete": deleteDocument(document.id); break;
  }
});
byId("downloadCreatedId").addEventListener("click", () => {
  if (!state.createdAccessCode) return;
  const blob = new Blob([`Trang sách - mã ID đăng nhập\n\n${state.createdAccessCode}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = "trang-sach-ma-id.txt";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});
byId("clearSavedCode").addEventListener("click", () => {
  try {
    window.localStorage.removeItem(SAVED_ACCESS_CODE_KEY);
    byId("authCode").value = "";
    byId("savedCodeActions").hidden = true;
    showToast("Đã xóa mã ID đã ghi nhớ trên thiết bị này.");
  } catch (error) {
    console.error("Không thể xóa mã ID đã lưu.", error);
    showToast("Không thể xóa mã đã lưu. Hãy kiểm tra cài đặt trình duyệt.");
  }
});

documentGrid.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches('[data-action="open"][role="button"]')) {
    event.preventDefault();
    const card = event.target.closest(".document-card");
    const document = state.documents.find((item) => item.id === card?.dataset.id);
    if (document) openFile(document);
  }
});

byId("sidebarUpload").addEventListener("click", chooseFiles);
byId("uploadFolder").addEventListener("click", () => { if (requireConnection()) folderInput.click(); });
byId("topUpload").addEventListener("click", chooseFiles);
byId("heroUpload").addEventListener("click", chooseFiles);
byId("emptyUpload").addEventListener("click", () => {
  if (!state.supabase) byId("infoDialog").showModal();
  else if (state.user) chooseFiles();
  else showAuthDialog();
});
fileInput.addEventListener("change", () => handleFiles(fileInput.files));
folderInput.addEventListener("change", () => handleFiles(folderInput.files, true));
byId("addFolder").addEventListener("click", () => {
  if (!requireConnection()) return;
  byId("folderName").value = "";
  byId("folderDialog").showModal();
  byId("folderName").focus();
});
byId("folderForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = byId("folderName").value.trim();
  if (!name) return;
  if (state.folders.some((folder) => folder.parentId === state.folderId
      && folder.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"))) {
    showToast("Thư mục này đã có trong thư mục hiện tại.");
    return;
  }
  byId("folderDialog").close();
  await createFolder(name);
});
byId("storageInfo").addEventListener("click", () => byId("infoDialog").showModal());
byId("authButton").addEventListener("click", async () => {
  if (!state.user) {
    setAuthMode("signin");
    showAuthDialog();
    return;
  }
  const { error } = await state.supabase.auth.signOut();
  if (error) {
    console.error("Không thể đăng xuất.", error);
    showToast(`Không thể đăng xuất: ${error.message}`);
  }
});
byId("authForm").addEventListener("submit", submitAuth);
byId("authSwitch").addEventListener("click", () => setAuthMode(state.authMode === "signin" ? "signup" : "signin"));
byId("copyCreatedId").addEventListener("click", async () => {
  if (!state.createdAccessCode) return;
  try {
    await navigator.clipboard.writeText(state.createdAccessCode);
    byId("copyCreatedId").textContent = "Đã sao chép";
    showToast("Đã sao chép mã ID. Hãy cất giữ ở nơi an toàn.");
  } catch (error) {
    console.error("Không thể sao chép mã ID.", error);
    showToast("Không thể tự sao chép. Hãy chọn mã trên màn hình rồi sao chép thủ công.");
  }
});
byId("finishSignup").addEventListener("click", () => {
  state.createdAccessCode = null;
  byId("authDialog").close();
});
byId("authDialog").addEventListener("cancel", (event) => {
  if (!state.createdAccessCode) return;
  event.preventDefault();
  closeAuthDialog();
});
byId("documentDialog").addEventListener("close", cleanupPreview);
byId("readerPrevious").addEventListener("click", () => moveReader(-1));
byId("readerNext").addEventListener("click", () => moveReader(1));
byId("readerFontDown").addEventListener("click", () => {
  state.readerFontSize = Math.max(14, state.readerFontSize - 2);
  applyReaderSettings();
});
byId("readerFontUp").addEventListener("click", () => {
  state.readerFontSize = Math.min(30, state.readerFontSize + 2);
  applyReaderSettings();
});
byId("readerTheme").addEventListener("click", () => {
  const themes = Object.keys(READER_THEMES);
  const currentIndex = themes.indexOf(state.readerTheme);
  state.readerTheme = themes[(currentIndex + 1) % themes.length];
  applyReaderSettings();
});
window.document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => {
  const dialog = button.closest("dialog");
  if (dialog.id === "authDialog") closeAuthDialog();
  else dialog.close();
}));
window.document.querySelectorAll(".modal").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    if (dialog.id === "authDialog") closeAuthDialog();
    else dialog.close();
  });
});
window.document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    state.folderId = null;
    render();
    byId("sidebar").classList.remove("open");
  });
});
byId("searchInput").addEventListener("input", (event) => {
  state.search = event.target.value;
  render();
});
byId("sortSelect").addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});
window.document.querySelectorAll(".view-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.layout = button.dataset.layout;
    window.document.querySelectorAll(".view-button").forEach((item) => item.classList.toggle("selected", item === button));
    render();
  });
});
byId("menuToggle").addEventListener("click", () => byId("sidebar").classList.toggle("open"));
window.document.addEventListener("click", (event) => {
  if (window.innerWidth <= 850 && byId("sidebar").classList.contains("open")
      && !event.target.closest("#sidebar") && !event.target.closest("#menuToggle")) {
    byId("sidebar").classList.remove("open");
  }
});
window.document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    byId("searchInput").focus();
    byId("searchInput").closest(".search-box").classList.add("search-open");
  }
  if (event.key === "Escape") byId("searchInput").closest(".search-box").classList.remove("search-open");
});
byId("searchInput").addEventListener("focus", () => {
  if (window.innerWidth <= 600) byId("searchInput").closest(".search-box").classList.add("search-open");
});

async function start() {
  const config = window.SUPABASE_CONFIG;
  const configured = config?.url?.startsWith("https://")
    && !config.url.includes("YOUR_PROJECT")
    && config.anonKey
    && !config.anonKey.includes("YOUR_SUPABASE");
  if (configured && window.supabase?.createClient) {
    state.supabase = window.supabase.createClient(config.url, config.anonKey);
    state.supabase.auth.onAuthStateChange((_event, session) => {
      state.user = session?.user ?? null;
      updateAuthUI();
      window.setTimeout(() => {
        reloadData().catch((error) => {
          console.error("Không thể tải thư viện từ Supabase.", error);
          showToast(`Không thể tải thư viện: ${error.message || "hãy kiểm tra cấu hình và chính sách RLS."}`);
        });
      }, 0);
    });
    const { data, error } = await state.supabase.auth.getSession();
    if (error) throw error;
    state.user = data.session?.user ?? null;
  }
  updateAuthUI();
  await reloadData();
  if (!state.supabase) {
    byId("emptyTitle").textContent = "Kết nối Supabase để bắt đầu";
    byId("emptyUpload").textContent = "Cách cấu hình";
  }
}

start().catch((error) => {
  console.error("Không thể khởi tạo thư viện.", error);
  showToast(`Không thể khởi tạo ứng dụng: ${error.message || "lỗi không xác định."}`);
});
