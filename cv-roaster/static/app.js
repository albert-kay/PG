const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const fileInfo = document.getElementById("file-info");
const fileName = document.getElementById("file-name");
const removeFile = document.getElementById("remove-file");
const uploadBtn = document.getElementById("upload-btn");
const uploadSection = document.getElementById("upload-section");
const actionsSection = document.getElementById("actions-section");
const resultSection = document.getElementById("result-section");
const resultTitle = document.getElementById("result-title");
const resultContent = document.getElementById("result-content");
const copyBtn = document.getElementById("copy-btn");
const backBtn = document.getElementById("back-btn");
const newCvBtn = document.getElementById("new-cv-btn");
const loading = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const toast = document.getElementById("toast");

let selectedFile = null;
let sessionId = null;

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];

const ACTION_META = {
  roast: { title: "CV Roast", loadingMsg: "Roasting your CV..." },
  improve: { title: "Improvement Plan", loadingMsg: "Finding improvements..." },
  generate: { title: "Rewritten CV", loadingMsg: "Rewriting your CV..." },
  stealth: { title: "ATS-Optimized CV", loadingMsg: "Optimizing for AI screeners..." },
};

// Toast notifications
let toastTimer = null;
function showToast(msg, duration) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), duration || 5000);
}

// File validation
function validateFile(file) {
  const ext = "." + file.name.split(".").pop().toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    showToast("Invalid file type. Use PDF, DOCX, or TXT.");
    return false;
  }
  if (file.size > MAX_FILE_SIZE) {
    showToast("File too large. Maximum size is 5MB.");
    return false;
  }
  return true;
}

// File selection
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) selectFile(fileInput.files[0]);
});

function selectFile(file) {
  if (!validateFile(file)) return;
  selectedFile = file;
  fileName.textContent = file.name;
  fileInfo.classList.remove("hidden");
  uploadBtn.classList.remove("hidden");
}

removeFile.addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  fileInfo.classList.add("hidden");
  uploadBtn.classList.add("hidden");
});

// Upload
uploadBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  const form = new FormData();
  form.append("cv", selectedFile);

  uploadBtn.disabled = true;
  uploadBtn.textContent = "Uploading...";
  showLoading("Uploading your CV...");
  try {
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    sessionId = data.session_id;
    uploadSection.classList.add("hidden");
    actionsSection.classList.remove("hidden");
  } catch (err) {
    showToast(err.message || "Upload failed. Check your connection and try again.");
  } finally {
    hideLoading();
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Upload CV";
  }
});

// Actions
document.querySelectorAll(".action-card").forEach((card) => {
  card.addEventListener("click", async () => {
    const action = card.dataset.action;
    const meta = ACTION_META[action];
    showLoading(meta.loadingMsg);
    actionsSection.classList.add("hidden");

    try {
      const res = await fetch(`/api/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404) {
          // Session expired - go back to upload
          sessionId = null;
          actionsSection.classList.add("hidden");
          uploadSection.classList.remove("hidden");
          showToast("Your session expired. Please upload your CV again.");
          return;
        }
        throw new Error(data.error);
      }

      if (!data.result) {
        showToast("No results were generated. Please try again.");
        actionsSection.classList.remove("hidden");
        return;
      }

      resultTitle.textContent = meta.title;
      resultContent.innerHTML = markdownToHtml(data.result);
      resultSection.classList.remove("hidden");
    } catch (err) {
      showToast(err.message || "Something went wrong. Check your connection and try again.");
      actionsSection.classList.remove("hidden");
    } finally {
      hideLoading();
    }
  });
});

// Back to actions
backBtn.addEventListener("click", () => {
  resultSection.classList.add("hidden");
  actionsSection.classList.remove("hidden");
});

// Upload new CV
newCvBtn.addEventListener("click", () => {
  sessionId = null;
  selectedFile = null;
  fileInput.value = "";
  fileInfo.classList.add("hidden");
  uploadBtn.classList.add("hidden");
  actionsSection.classList.add("hidden");
  uploadSection.classList.remove("hidden");
});

// Copy
copyBtn.addEventListener("click", () => {
  const text = resultContent.innerText;
  navigator.clipboard.writeText(text).then(
    () => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy"), 2000);
    },
    () => {
      showToast("Copy failed. Please select the text and copy manually.");
    }
  );
});

function showLoading(msg) {
  loadingText.textContent = msg;
  loading.classList.remove("hidden");
}

function hideLoading() {
  loading.classList.add("hidden");
}

// Minimal markdown to HTML
function markdownToHtml(md) {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, '<li class="ul">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ol">$2</li>')
    .replace(/((<li class="ul">.*<\/li>\n?)+)/g, (m) => `<ul>${m}</ul>`)
    .replace(/((<li class="ol">.*<\/li>\n?)+)/g, (m) => `<ol>${m}</ol>`)
    .replace(/ class="[uo]l"/g, "")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");
}
