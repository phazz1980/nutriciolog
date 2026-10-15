// Native sharing is optional; the ordinary browser keeps its file picker.
export async function initShareImage({ onImage, onError, capacitor = window.Capacitor }) {
  const plugin = capacitor?.Plugins?.NutritionShareImage;
  if (!plugin) return;
  const receive = async () => {
    try {
      const image = await plugin.consumeImage();
      if (image.error) { onError(image.error); return; }
      if (!image.base64) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)) {
        throw new Error('Используйте JPEG, PNG или WebP.');
      }
      const bytes = Uint8Array.from(atob(image.base64), char => char.charCodeAt(0));
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.mimeType];
      await onImage(new File([bytes], `shared-image.${extension}`, { type: image.mimeType }));
    } catch (error) {
      onError(error.message || 'Не удалось получить изображение.');
    }
  };
  try {
    await plugin.addListener('imageAvailable', receive);
    await receive();
  } catch {
    onError('Не удалось включить приём изображений. Откройте фото через галерею.');
  }
}
