const BUCKET = "library-files";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const SAVED_ACCESS_CODE_KEY = "trang-sach-saved-access-code";

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
  }).select("*").single();
  if (error) {
    const { error: cleanupError } = await state.supabase.storage.from(BUCKET).remove([storagePath]);
    if (cleanupError) console.error("Không thể dọn tệp tải lên dở dang.", cleanupError);
    throw error;
  }
  return mapDocument(data);
}

function uploadErrorMessage(error) {
  const message = error?.message || "Lỗi không xác định.";
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
        await uploadOneFile(file, folderId, relativePath);
        uploaded += 1;
      } catch (error) {
        console.error(`Không thể tải lên ${file.name}.`, error);
        failures.push({ name: file.name, message: uploadErrorMessage(error) });
      }
    }
    await reloadData();
    const messages = [];
    if (uploaded) messages.push(`Đã tải ${uploaded} tệp lên Supabase.`);
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
  if (state.rendition) state.rendition.destroy();
  if (state.book) state.book.destroy();
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.rendition = null;
  state.book = null;
  state.previewUrl = null;
  byId("previewContent").replaceChildren();
  byId("epubControls").hidden = true;
}

async function openFile(document) {
  if (!state.supabase || !state.user) {
    showToast("Đăng nhập để đọc tài liệu trong thư viện.");
    return;
  }
  cleanupPreview();
  const dialog = byId("documentDialog");
  const kind = fileKind(document);
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
    const { data: blob, error } = await state.supabase.storage.from(BUCKET).download(document.storagePath);
    if (error) throw error;
    if (!dialog.open) return;
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
      byId("epubControls").hidden = false;
      state.book = window.ePub();
      await state.book.open(blob, "binary");
      const readerHeight = window.innerWidth <= 600 ? "68vh" : "76vh";
      state.rendition = state.book.renderTo(preview, { width: "100%", height: readerHeight, flow: "paginated" });
      state.rendition.on("relocated", (location) => {
        const percentage = location.start?.percentage;
        byId("epubLocation").textContent = Number.isFinite(percentage) ? `${Math.round(percentage * 100)}%` : "Đang đọc";
      });
      await state.rendition.display();
    } else if (blob.type.startsWith("image/")) {
      state.previewUrl = URL.createObjectURL(blob);
      const image = window.document.createElement("img");
      image.src = state.previewUrl;
      image.alt = document.name;
      preview.append(image);
    } else if (blob.type.startsWith("text/") || /\.(txt|md|csv|json|log)$/i.test(document.name)) {
      const pre = window.document.createElement("pre");
      pre.textContent = (await blob.text()).slice(0, 50000);
      preview.append(pre);
    } else {
      const note = window.document.createElement("p");
      note.className = "preview-unavailable";
      note.textContent = "Có thể tải tệp xuống để mở bằng ứng dụng phù hợp.";
      preview.append(note);
    }
    document.lastOpened = Date.now();
    const { error: updateError } = await state.supabase.from("library_documents")
      .update({ last_opened: new Date(document.lastOpened).toISOString() }).eq("id", document.id);
    if (updateError) throw updateError;
    render();
  } catch (error) {
    console.error(`Không thể mở ${document.name}.`, error);
    if (dialog.open) {
      byId("previewContent").innerHTML = '<p class="preview-unavailable">Không thể tải hoặc mở tài liệu. Hãy thử lại khi kết nối mạng ổn định.</p>';
    }
    showToast(`Không thể mở tài liệu: ${error.message || "lỗi kết nối."}`);
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
  await reloadData();
  showToast("Đã xóa tài liệu khỏi Supabase.");
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
byId("epubPrevious").addEventListener("click", () => state.rendition?.prev());
byId("epubNext").addEventListener("click", () => state.rendition?.next());
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
