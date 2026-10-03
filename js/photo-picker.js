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

export function openPhotoPicker(button, input) {
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
  const pick = useCamera => {
    document.getElementById("photoSourcePicker")?.remove();
    if (useCamera) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  };

  camera.onclick = () => pick(true);
  gallery.onclick = () => pick(false);
  cancel.onclick = close;
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  backdrop.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
  });
  document.body.append(backdrop);
  camera.focus();
}
