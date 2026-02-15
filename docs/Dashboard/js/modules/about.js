// ============================================
// ABOUT PAGE EDITOR MODULE
// ============================================
import {
  ctx,
  setHidden,
  showAuthLockout,
  extractDriveFileId,
  toEmbedUrl,
} from "./utils.js";

export function initAbout() {
  const aEl = {
    section: document.getElementById("aboutSection"),
    form: document.getElementById("aboutForm"),
    photoUrl: document.getElementById("aboutPhotoUrl"),
    urlStatus: document.getElementById("aboutUrlStatus"),
    photoPreview: document.getElementById("aboutPhotoPreview"),
    bioText: document.getElementById("aboutBioText"),
    saveBtn: document.getElementById("aboutSaveBtn"),
    message: document.getElementById("aboutMessage"),
    previewPhoto: document.getElementById("aboutPreviewPhoto"),
    previewText: document.getElementById("aboutPreviewText"),
  };

  let aboutLoaded = false;
  let aboutConvertedUrl = null;

  function showAboutMsg(text, isError) {
    aEl.message.textContent = text;
    aEl.message.className = "gallery-msg " + (isError ? "error" : "success");
    setHidden(aEl.message, false);
    setTimeout(() => setHidden(aEl.message, true), 5000);
  }

  function handleAboutUrlInput() {
    const raw = aEl.photoUrl.value.trim();
    if (!raw) {
      setHidden(aEl.urlStatus, true);
      setHidden(aEl.photoPreview, true);
      aboutConvertedUrl = null;
      return;
    }
    const fileId = extractDriveFileId(raw);
    if (fileId) {
      aboutConvertedUrl = toEmbedUrl(fileId);
      aEl.urlStatus.textContent = "✅ Valid Google Drive URL detected";
      aEl.urlStatus.className = "gallery-url-status valid";
      setHidden(aEl.urlStatus, false);
      aEl.photoPreview.textContent = "";
      const img = document.createElement("img");
      img.alt = "Photo preview";
      img.src = aboutConvertedUrl;
      img.addEventListener(
        "error",
        () => {
          aEl.photoPreview.textContent = "";
          const msg = document.createElement("span");
          msg.className = "text-muted-2";
          msg.style.fontSize = "0.7rem";
          msg.style.padding = "0.5rem";
          msg.textContent = "Could not load preview";
          aEl.photoPreview.appendChild(msg);
        },
        { once: true },
      );
      aEl.photoPreview.appendChild(img);
      setHidden(aEl.photoPreview, false);

      aEl.previewPhoto.textContent = "";
      const previewImg = document.createElement("img");
      previewImg.alt = "About photo";
      previewImg.src = aboutConvertedUrl;
      previewImg.style.cssText = "width:100%;height:100%;object-fit:cover;";
      aEl.previewPhoto.appendChild(previewImg);
    } else {
      aboutConvertedUrl = null;
      aEl.urlStatus.textContent =
        "⚠️ Could not detect a Google Drive file ID";
      aEl.urlStatus.className = "gallery-url-status invalid";
      setHidden(aEl.urlStatus, false);
      setHidden(aEl.photoPreview, true);
    }
  }

  aEl.photoUrl.addEventListener("input", handleAboutUrlInput);
  aEl.photoUrl.addEventListener("paste", () =>
    setTimeout(handleAboutUrlInput, 50),
  );

  // ----- Live bio preview -----
  aEl.bioText.addEventListener("input", () => {
    const val = aEl.bioText.value;
    if (val.trim()) {
      aEl.previewText.innerHTML = val;
    }
  });

  // ----- Load existing content -----
  async function loadAboutContent() {
    if (!ctx.db || !ctx.adminCode) return;
    try {
      const { data, error } = await ctx.db.rpc("admin_get_about_content", {
        p_admin_code: ctx.adminCode,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        if (data?.error === "Unauthorized") {
          ctx.adminCode = null;
          showAuthLockout("Invalid admin code.");
          return;
        }
        throw new Error(data?.error || "Failed to load about content");
      }

      if (data.photo_url) {
        aEl.photoUrl.value = data.photo_url;
        aboutConvertedUrl = data.photo_url;

        aEl.previewPhoto.textContent = "";
        const img = document.createElement("img");
        img.alt = "About photo";
        img.src = data.photo_url;
        img.style.cssText = "width:100%;height:100%;object-fit:cover;";
        img.addEventListener(
          "error",
          () => {
            img.style.display = "none";
          },
          { once: true },
        );
        aEl.previewPhoto.appendChild(img);
      }

      if (data.bio_text) {
        aEl.bioText.value = data.bio_text;
        aEl.previewText.innerHTML = data.bio_text;
      }

      aboutLoaded = true;
    } catch (err) {
      aEl.previewText.textContent = "";
      const p = document.createElement("p");
      p.className = "text-danger";
      p.style.fontSize = "0.85rem";
      p.textContent = "Error: " + String(err?.message || err);
      aEl.previewText.appendChild(p);
    }
  }

  // ----- Save -----
  aEl.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ctx.db || !ctx.adminCode) return;

    const photoUrl = aboutConvertedUrl || aEl.photoUrl.value.trim();
    const bioText = aEl.bioText.value;

    if (!photoUrl && !bioText) {
      showAboutMsg("Nothing to save — enter a photo URL or bio text.", true);
      return;
    }

    aEl.saveBtn.disabled = true;
    aEl.saveBtn.textContent = "Saving...";

    try {
      const { data, error } = await ctx.db.rpc("admin_set_about_content", {
        p_admin_code: ctx.adminCode,
        p_photo_url: photoUrl || "",
        p_bio_text: bioText,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        if (data?.error === "Unauthorized") {
          ctx.adminCode = null;
          showAuthLockout("Invalid admin code.");
          return;
        }
        showAboutMsg(data?.error || "Save failed", true);
        return;
      }
      showAboutMsg(
        "About page updated! Visitors will see changes on refresh.",
        false,
      );
    } catch (err) {
      showAboutMsg("Error: " + err.message, true);
    } finally {
      aEl.saveBtn.disabled = false;
      aEl.saveBtn.textContent = "Save Changes";
    }
  });

  // ----- Load on section open -----
  aEl.section.addEventListener("toggle", () => {
    if (aEl.section.open && !aboutLoaded && ctx.db && ctx.adminCode) {
      loadAboutContent();
    }
  });
}
