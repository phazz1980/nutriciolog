import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePhoto } from '../js/photo-picker.js';
test('photo compression: bounds dimensions, retries quality and releases object URL', async () => {
  const original = { Image: globalThis.Image, document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let revoked = false;
  const qualities = [];
  const canvas = { getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL(type, quality) {
    assert.equal(type, 'image/jpeg'); qualities.push(quality);
    return 'data:image/jpeg;base64,' + 'a'.repeat(quality > 0.7 ? 1_500_000 : 100);
  }};
  globalThis.Image = class { naturalWidth = 4000; naturalHeight = 3000; set src(value) { this.onload(); }};
  globalThis.document = { createElement: () => canvas };
  URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => { revoked = true; };
  try {
    const result = await preparePhoto({ type: 'image/png' });
    assert.equal(result.mimeType, 'image/jpeg');
    assert.equal(canvas.width, 1600); assert.equal(canvas.height, 1200);
    assert.deepEqual(qualities, [0.85, 0.7]); assert.equal(revoked, true);
    await assert.rejects(preparePhoto({ type: 'text/plain' }), /JPEG/);
  } finally {
    globalThis.Image = original.Image; globalThis.document = original.document;
    URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
  }
});
