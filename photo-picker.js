(() => {
  const pick = (photoInput, useCamera) => {
    document.getElementById('photoSourcePicker')?.remove();
    if (useCamera) photoInput.setAttribute('capture', 'environment');
    else photoInput.removeAttribute('capture');
    photoInput.click();
  };

  const openPicker = (photoButton, photoInput) => {
    document.getElementById('photoSourcePicker')?.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'photoSourcePicker';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'Источник фотографии');
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:20;background:#18332b55;display:flex;align-items:flex-end;justify-content:center;padding:16px';

    const sheet = document.createElement('div');
    sheet.style.cssText = 'width:min(100%,430px);background:#fff;border-radius:22px;padding:14px;display:grid;gap:10px';
    const title = document.createElement('p');
    title.textContent = 'Добавить фото';
    title.style.cssText = 'margin:2px 4px 4px;font-weight:700';
    sheet.append(title);

    const makeButton = (text, label, useCamera) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = text;
      button.setAttribute('aria-label', label);
      button.style.cssText = 'width:100%;padding:14px';
      button.onclick = () => pick(photoInput, useCamera);
      return button;
    };
    sheet.append(
      makeButton('📷 Фото', 'Снять фото камерой', true),
      makeButton('🖼️ Галерея', 'Выбрать фото из галереи или файлов', false)
    );
    const close = () => { backdrop.remove(); photoButton.focus(); };
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'link'; cancel.textContent = 'Отмена'; cancel.onclick = close;
    sheet.append(cancel);
    backdrop.onclick = event => { if (event.target === backdrop) close(); };
    backdrop.onkeydown = event => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const buttons = [...sheet.querySelectorAll('button')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
      }
    };
    backdrop.append(sheet);
    document.body.append(backdrop);
    sheet.querySelector('button').focus();
  };
  for (const [selector, inputId] of [
    ['[aria-label="Распознать блюдо по фото"]', 'manualMealPhoto'],
    ['#advicePhotoButton', 'mealPhoto'],
  ]) {
    const button = document.querySelector(selector), input = document.getElementById(inputId);
    if (button && input) button.onclick = () => openPicker(button, input);
  }
})();
