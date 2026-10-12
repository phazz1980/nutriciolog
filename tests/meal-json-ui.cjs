const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'js/core.js'), 'utf8').replace(/export /g, '');
const photo = fs.readFileSync(path.join(root, 'js/photo.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const slice = (code, start, end) => code.slice(code.indexOf(start), code.indexOf(end)).replace(/export /g, '');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, ''));
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.addScriptTag({ content: core + '\n' + slice(photo, 'export function fillMealForm', 'export function toastPhotoTransfer') + '\n' + slice(ui, 'export function openDialog', '// Раскрываемый') + '\n' + slice(app, 'function openMeal()', 'function closeMeal()') + '\n' + slice(app, 'function clearMealEstimateError', 'function validateMealEstimate') + `
      const element = id => document.getElementById(id);
      let lastSelectedMealType = '', mealCalculationBusy = false, savedMealEstimate = null, describedPortion = null, lastCalculatedUnitWeight = null, lastNutritionClarification = null, recognizedManualMealEstimate = null;
      const toast = message => window.lastToast = message;
      const openModal = id => element(id).classList.add('show');
      const setPortionUnit = unit => element('portionUnit').value = unit;
      element('mealNameActions').insertAdjacentHTML('afterend', '<div id="mealNameSuggestions"></div>');
      ` + slice(app, '  for (const id of ["mealJsonHelpButton"', '  for (const nav of') });
    await page.addScriptTag({ content: slice(app, 'function fillSavedMealNutrition()', '/* -------------------------------------------------------------- AI: meal */') + '\n' + slice(app, '  for (const id of ["calories", "protein", "fat", "carbs"])', '  for (const id of ["mealName", "portion"])') + `
      const portionUnit = () => element('portionUnit').value;
      const setAutomaticPortionUnit = () => { if (element('nutritionBasis100').checked) setPortionUnit('г'); };
      element('portion').addEventListener('input', fillMealNutritionFromPortion);
    ` });
    const meal = { title: 'Салат', portion: 250.5, protein: 20, fat: 10, carbs: 30 };
    const paste = (id, text) => page.evaluate(({ id, text }) => {
      const data = new DataTransfer(); data.setData('text', text);
      document.getElementById(id).dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, { id, text });
    await paste('question', '```json\n' + JSON.stringify(meal) + '\n```');
    assert.equal(await page.locator('#mealName').inputValue(), 'Салат');
    assert.equal(await page.locator('#portion').inputValue(), '250.5');
    assert.equal(await page.locator('#calories').inputValue(), '290');
    assert.equal(await page.locator('#modal.show').count(), 1);
    assert.equal(await page.locator('#mealList').textContent(), 'Записей пока нет. Добавьте первый продукт или блюдо.');
    await paste('mealName', '{broken');
    assert.equal(await page.locator('#mealName').inputValue(), 'Салат');
    await paste('mealName', JSON.stringify({ ...meal, title: '<img src=x onerror=alert(1)>' }));
    assert.equal(await page.locator('#mealName').inputValue(), '<img src=x onerror=alert(1)>');
    await page.evaluate(() => { window.copied = ''; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => window.copied = text } }); });
    await page.locator('#mealJsonHelpButton').click();
    assert.equal(await page.locator('#mealJsonHelp pre').count(), 0);
    assert.ok((await page.locator('#mealJsonHelp').textContent()).includes('Полученный ответ вставьте'));
    await page.locator('#copyMealJsonPrompt').click();
    assert.ok((await page.evaluate(() => window.copied)).includes('"protein"'));
    assert.equal(await page.locator('#mealJsonCopyStatus').textContent(), 'Промпт скопирован');
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.locator('#mealJsonHelp .sheet').evaluate(el => el.scrollWidth <= el.clientWidth));
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#mealJsonHelp').count(), 0);
    assert.equal(await page.locator('#mealJsonHelpButton').textContent(), 'Спросить у другого ИИ');
    assert.ok(await page.locator('#mealJsonHelpButton').evaluate(button => button.getBoundingClientRect().top >= document.getElementById('mealName').getBoundingClientRect().bottom));
    assert.equal(await page.locator('#adviceJsonHelpButton').evaluate(button => button.previousElementSibling.id), 'askForm');
    await page.locator('label:has(#nutritionBasis100)').click();
    await page.locator('#portion').fill('250');
    await page.locator('#calories').fill('160');
    await page.locator('#protein').fill('');
    await page.locator('#fat').fill('4');
    await page.locator('#carbs').fill('');
    assert.deepEqual(await page.evaluate(() => readFormNutrition()), { calories: 400, protein: 0, fat: 10, carbs: 0 });
    await page.locator('#portion').fill('300');
    assert.equal(await page.locator('#calories').inputValue(), '160');
    assert.equal(await page.evaluate(() => readFormNutrition().calories), 480);
    await paste('mealName', JSON.stringify(meal));
    assert.equal(await page.locator('#nutritionBasisPortion').isChecked(), true);
    assert.equal(await page.evaluate(() => readFormNutrition().calories), 290);
    await page.locator('#calories').fill('450');
    await page.locator('#portion').fill('300');
    assert.equal(await page.locator('#calories').inputValue(), '450', 'manual correction survives portion change');
    await page.locator('label:has(#nutritionBasis100)').click();
    await page.locator('#modal form').evaluate(form => form.reset());
    assert.equal(await page.locator('#nutritionBasisPortion').isChecked(), true);
    await paste('mealName', JSON.stringify(meal));
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.locator('#modal .sheet').evaluate(el => el.scrollWidth <= el.clientWidth), `form overflow at ${width}`);
      assert.ok(await page.locator('.meal-data-row').evaluate(row => {
        const input = row.querySelector('#portion').getBoundingClientRect();
        const toggle = row.querySelector('.meal-basis-options').getBoundingClientRect();
        return toggle.left >= input.right && Math.abs(toggle.bottom - input.bottom) < 4;
      }), `portion and toggle must share a row at ${width}`);
      assert.ok(await page.locator('.meal-macros-row').evaluate(row => {
        const boxes = [...row.querySelectorAll('input')].map(el => el.getBoundingClientRect());
        return boxes.length === 4 && boxes.every(box => Math.abs(box.top - boxes[0].top) < 1);
      }), `calories and macros must share a row at ${width}`);
    }
    await page.screenshot({ path: process.env.MEAL_SCREENSHOT || require('os').tmpdir() + '/manual-nutrition.png' });
    console.log('JSON paste in both fields, draft safety, prompt copy, dialog close and widths: passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
