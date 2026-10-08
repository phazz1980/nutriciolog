// Выбор источника фото для формы блюда и вкладки «Совет».
// Обработчики назначаются здесь, а не в разметке, чтобы клик всегда открывал
// собственный выбор «Фото / Галерея» и не перезаписывался другим модулем.
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function nativeCameraPlugin() {
  return window.Capacitor?.Plugins?.Camera?.getPhoto ? window.Capacitor.Plugins.Camera : null;
}

async function takeNativePhoto() {
  const camera = nativeCameraPlugin();
  if (!camera) return null;
  const photo = await camera.getPhoto({
    quality: 85,
    width: 1600,
    height: 1600,
    resultType: "base64",
    source: "CAMERA",
    direction: "REAR",
    correctOrientation: true,
  });
  if (!photo?.base64String) throw new Error("Камера не вернула изображение");
  const bytes = Uint8Array.from(atob(photo.base64String), char => char.charCodeAt(0));
  return new File([bytes], `camera-${Date.now()}.jpeg`, { type: "image/jpeg" });
}

// Keep the whole JSON request below the API Gateway limit, including Base64.
export async function preparePhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Используйте JPEG, PNG или WebP");
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Не удалось прочитать фото"));
      image.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось обработать фото");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.startsWith("data:image/jpeg;base64,") && dataUrl.length <= 1_400_000) {
        return { dataUrl, mimeType: "image/jpeg" };
      }
    }
    throw new Error("Не удалось уменьшить фото. Выберите другое изображение.");
  } finally { URL.revokeObjectURL(url); }
}

export function openPhotoPicker(button, input, { onNativeCameraPhoto } = {}) {
  if (!button || !input) return;
  document.getElementById("photoSourcePicker")?.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "photoSourcePicker";
  backdrop.className = "modal show";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", "Источник фотографии");
  backdrop.innerHTML = '<section class="sheet photo-source-sheet"><p class="photo-source-title">Добавить фото</p><button class="secondary" type="button" data-camera="true"></button><button class="secondary" type="button" data-camera="false"></button><button class="link" type="button" data-close="true">Отмена</button></section>';

  const [camera, gallery, cancel] = backdrop.querySelectorAll("button");
  camera.textContent = "📷 Фото";
  camera.setAttribute("aria-label", "Снять фото камерой");
  gallery.textContent = "🖼️ Галерея";
  gallery.setAttribute("aria-label", "Выбрать фото из галереи или файлов");

  const close = () => {
    backdrop.remove();
    button.focus();
  };
  const pick = async useCamera => {
    document.getElementById("photoSourcePicker")?.remove();
    if (useCamera && nativeCameraPlugin()) {
      try {
        const file = await takeNativePhoto();
        if (file) onNativeCameraPhoto?.(file);
      } catch {
        // Closing or denying the native camera is not an error in the form.
      }
      return;
    }
    if (useCamera) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  };

  camera.onclick = () => { void pick(true); };
  gallery.onclick = () => { void pick(false); };
  cancel.onclick = close;
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  backdrop.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
  });
  document.body.append(backdrop);
  camera.focus();
}
