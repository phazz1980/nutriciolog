exports.handler = async (event, context) => (await import('./yandex-runtime.mjs')).handler(event, context);
