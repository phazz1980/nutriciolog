// Firebase web config is public. Replace every placeholder only after creating your Firebase project.
const firebaseConfig = {
  apiKey: "AIzaSyCnQHJaiKavTsd3meNykdO5IVywiOAAMkI",
  authDomain: "my-nutritionist-67ce8.firebaseapp.com",
  projectId: "my-nutritionist-67ce8",
  storageBucket: "my-nutritionist-67ce8.firebasestorage.app",
  messagingSenderId: "78706346827",
  appId: "1:78706346827:web:066e5c777fd740c194f6ce",
};

const configured = !Object.values(firebaseConfig).some(value => value.startsWith("YOUR_"));
const googleAuthReady = true;
// Локальная дата, а не toISOString(): в Москве UTC-дата переключается в 03:00.
const localDateKey = () => {
  const now = new Date();
  const pad = value => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
let db, user = null;
let authState = configured ? "loading" : "ready";
let initialization = null, signInAttempt = null, guestMode = false;
let startGoogleSignIn, startEmailSignIn, startEmailRegistration, startPasswordReset, startEmailVerification, startEmailLinking, authSdkCurrentUser;
let sdkAttempt = 0;
let appModuleFailed = false;
let authMessage = "";
const AUTH_WAIT_MS = 15000;
window.getFirebaseAuthStatus = () => ({ state: authState, signedIn: Boolean(user), pending: Boolean(signInAttempt), message: authMessage });
const key = (name, date = "") => `my-nutritionist:${name}:${date}`;
const reportDebug = detail => window.dispatchEvent(new CustomEvent("nutrition-debug", { detail }));
let profileGeneration = 0, profileRefresh = null, profileSaving = false;
const profileCacheKey = uid => key(`account:${uid}:profile:v1`);
const latestProfileCacheKey = key("account:latest-profile:v1");
const pendingWritesKey = uid => key(`account:${uid}:pending-writes:v1`);
let pendingFlush = null;

// Firestore may be temporarily unavailable while the user is travelling or
// switching networks. Keep a small, UID-scoped outbox locally: it contains
// only the document payload already entered in the app, never credentials or
// Firebase tokens. The last action for a document wins.
function pendingWrites(uid = user?.uid) {
  if (!uid) return [];
  try {
    const value = JSON.parse(localStorage.getItem(pendingWritesKey(uid)) || "[]");
    return Array.isArray(value) ? value.filter(item => item && typeof item.collection === "string" && typeof item.id === "string" && ["set", "delete"].includes(item.action)) : [];
  } catch { return []; }
}

function storePendingWrites(uid, writes) {
  try {
    if (writes.length) localStorage.setItem(pendingWritesKey(uid), JSON.stringify(writes));
    else localStorage.removeItem(pendingWritesKey(uid));
    publishSyncStatus(uid, writes.length);
    return true;
  } catch { return false; }
}

function publishSyncStatus(uid = user?.uid, count = pendingWrites(uid).length) {
  window.dispatchEvent(new CustomEvent("nutrition-sync-status", { detail: { uid: uid || "", pending: count } }));
}

function queueWrite(action, collection, id, value, uid = user?.uid) {
  if (!uid) return false;
  const writes = pendingWrites(uid).filter(item => item.collection !== collection || item.id !== id);
  writes.push({ opId: crypto.randomUUID(), action, collection, id, ...(action === "set" ? { value } : {}) });
  return storePendingWrites(uid, writes);
}

function pendingWriteFor(collection, id, uid = user?.uid) {
  const writes = pendingWrites(uid);
  for (let index = writes.length - 1; index >= 0; index--) {
    if (writes[index].collection === collection && writes[index].id === id) return writes[index];
  }
  return null;
}

function overlayPendingDocument(collection, id, value, uid = user?.uid) {
  const pending = pendingWriteFor(collection, id, uid);
  if (!pending) return value;
  return pending.action === "delete" ? null : { ...pending.value, id: pending.value?.id || id };
}

function overlayPendingCollection(collection, values, uid = user?.uid) {
  const byId = new Map((values || []).map(value => [String(value?.id || ""), value]));
  for (const pending of pendingWrites(uid).filter(item => item.collection === collection)) {
    if (pending.action === "delete") byId.delete(pending.id);
    else byId.set(pending.id, { ...pending.value, id: pending.value?.id || pending.id });
  }
  return [...byId.values()];
}

function isTemporaryFirestoreError(error) {
  const code = String(error?.code || "").toLowerCase();
  return navigator.onLine === false || ["unavailable", "deadline-exceeded", "aborted", "cancelled", "internal", "unknown", "network-request-failed"].some(part => code.includes(part));
}

// Persist before calling the SDK: its promise can remain pending while the
// browser still reports an online connection. A late acknowledgement removes
// only its own operation, never a newer edit of the same document.
async function sendDurableWrite(action, collection, id, value, uid) {
  if (!queueWrite(action, collection, id, value, uid)) {
    throw new Error("Не удалось сохранить изменения на устройстве. Освободите место и повторите.");
  }
  const operation = pendingWriteFor(collection, id, uid);
  if (navigator.onLine === false) return "queued";
  const { doc, setDoc, deleteDoc, serverTimestamp } = window.__firestore;
  const reference = doc(db, "users", uid, collection, id);
  let timer;
  const acknowledgement = Promise.resolve().then(() => action === "delete"
    ? deleteDoc(reference)
    : setDoc(reference, { ...value, updatedAt: serverTimestamp() }, { merge: true }))
    .then(() => {
      storePendingWrites(uid, pendingWrites(uid).filter(item => item.opId !== operation.opId));
      updateStatus();
      return "cloud";
    }, error => {
      if (!isTemporaryFirestoreError(error)) {
        storePendingWrites(uid, pendingWrites(uid).map(item => item.opId === operation.opId ? { ...item, blocked: true } : item));
        updateStatus();
      }
      throw error;
    });
  try {
    return await Promise.race([acknowledgement, new Promise(resolve => { timer = setTimeout(() => resolve("queued"), 5000); })]);
  } finally { clearTimeout(timer); }
}

async function flushPendingWrites() {
  if (pendingFlush || !configured || !user || !db || navigator.onLine === false) return pendingFlush;
  const uid = user.uid;
  const writes = pendingWrites(uid);
  if (!writes.length) return;
  pendingFlush = (async () => {
    for (const pending of writes) {
      if (user?.uid !== uid) break;
      if (!pendingWrites(uid).some(item => item.opId === pending.opId)) continue;
      // Stop on a temporary failure and preserve this and later operations.
      try {
        const { doc, setDoc, deleteDoc, serverTimestamp } = window.__firestore;
        const reference = doc(db, "users", uid, pending.collection, pending.id);
        if (pending.action === "delete") await deleteDoc(reference);
        else await setDoc(reference, { ...pending.value, updatedAt: serverTimestamp() }, { merge: true });
        const current = pendingWrites(uid);
        const remaining = current.filter(item => item.opId !== pending.opId);
        storePendingWrites(uid, remaining);
        reportDebug({ type: "sync", mode: "flushed", collection: pending.collection });
      } catch (error) {
        reportDebug({ type: "sync", mode: "deferred", collection: pending.collection, reason: String(error?.code || error?.message || "Unknown").slice(0, 180) });
        if (isTemporaryFirestoreError(error)) break;
        // Preserve rejected payloads for correction; continue with other documents.
        // A rejected write is not a successful sync and must never be discarded.
        const current = pendingWrites(uid).map(item => item.opId === pending.opId
          ? { ...item, blocked: true } : item);
        storePendingWrites(uid, current);
      }
    }
  })().finally(() => { pendingFlush = null; updateStatus(); });
  return pendingFlush;
}

// Cache only display fields, never Firebase users, credentials or tokens.
function profileFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profile = {};
  for (const field of ["name", "goal"]) {
    if (typeof value[field] === "string") profile[field] = value[field].slice(0, 200);
  }
  for (const field of ["age", "height", "weight", "targetWeight", "calories"]) {
    if (typeof value[field] === "number" && Number.isFinite(value[field])) profile[field] = value[field];
  }
  return profile;
}

function cachedProfile(uid) {
  try {
    const entry = JSON.parse(localStorage.getItem(profileCacheKey(uid)));
    if (entry?.version === 1 && Object.hasOwn(entry, "profile")) {
      if (entry.profile === null) return { profile: null };
      const profile = profileFields(entry.profile);
      if (profile) return { profile };
    }
  } catch { /* Corrupt or unavailable storage must not prevent loading the profile. */ }
  return null;
}

function cacheProfile(uid, value) {
  try {
    const profile = profileFields(value);
    localStorage.setItem(profileCacheKey(uid), JSON.stringify({ version: 1, profile }));
    localStorage.setItem(latestProfileCacheKey, JSON.stringify({ version: 1, uid, profile }));
  }
  catch { /* The cloud operation remains successful when device storage is full. */ }
}

function cachedProfilePreview() {
  try {
    const entry = JSON.parse(localStorage.getItem(latestProfileCacheKey));
    if (entry?.version !== 1 || typeof entry.uid !== "string" || !entry.uid || entry.profile === null) return null;
    const profile = profileFields(entry.profile);
    return profile ? { uid: entry.uid, profile } : null;
  } catch { return null; }
}

function removeCachedProfile(uid) {
  try {
    localStorage.removeItem(profileCacheKey(uid));
    if (cachedProfilePreview()?.uid === uid) localStorage.removeItem(latestProfileCacheKey);
  } catch {}
}

function publishProfile(uid, profile) {
  window.dispatchEvent(new CustomEvent("nutrition-profile-updated", { detail: { uid, profile } }));
}

function refreshAccountProfile(uid) {
  if (profileSaving) return Promise.resolve(cachedProfile(uid)?.profile ?? null);
  const generation = profileGeneration;
  if (profileRefresh?.uid === uid && profileRefresh.generation === generation) return profileRefresh.promise;
  const refresh = { uid, generation };
  refresh.promise = (async () => {
    const { doc, getDoc } = window.__firestore;
    const snapshot = await getDoc(doc(db, "users", uid, "profile", "main"));
    if (user?.uid !== uid || generation !== profileGeneration) return cachedProfile(uid)?.profile ?? null;
    const profile = profileFields(overlayPendingDocument("profile", "main", snapshot.exists() ? snapshot.data() : null));
    cacheProfile(uid, profile);
    publishProfile(uid, profile);
    return profile;
  })().finally(() => { if (profileRefresh === refresh) profileRefresh = null; });
  profileRefresh = refresh;
  return refresh.promise;
}

function authError(code) { return Object.assign(new Error(code), { code }); }

window.getAuthErrorMessage = error => ({
  "auth/network-request-failed": "Не удалось связаться с сервисом входа. Проверьте интернет и повторите действие.",
  "auth/timeout": "Ответ сервиса задерживается. Проверьте интернет и попробуйте ещё раз.",
  "auth/loading": "Аккаунт ещё загружается. Подождите немного и повторите действие.",
  "auth/unavailable": "Сервис входа не загрузился. Повторите подключение в профиле.",
  "auth/popup-blocked": "Браузер заблокировал окно входа. Разрешите всплывающие окна или откройте сайт в Safari/Chrome.",
  "auth/popup-closed-by-user": "Вход не завершён. Если окно было пустым, проверьте сеть или откройте сайт в Safari/Chrome и повторите вход.",
  "auth/cancelled-popup-request": "Уже открыто другое окно входа. Завершите вход в нём.",
  "auth/unauthorized-domain": "Для этого адреса сайта не настроен вход. Обратитесь к администратору.",
  "auth/operation-not-allowed": "Этот способ входа пока не включён в Firebase.",
  "auth/invalid-email": "Проверьте адрес электронной почты.",
  "auth/invalid-credential": "Неверный email или пароль.",
  "auth/user-not-found": "Аккаунт с таким email не найден.",
  "auth/wrong-password": "Неверный пароль.",
  "auth/email-already-in-use": "Этот email уже зарегистрирован. Войдите или восстановите пароль.",
  "auth/weak-password": "Пароль должен содержать не менее 6 символов.",
  "auth/credential-already-in-use": "Этот email уже связан с другим аккаунтом. Войдите в него по email отдельно.",
  "auth/provider-already-linked": "Вход по email уже настроен для этого аккаунта.",
  "auth/requires-recent-login": "Для создания пароля войдите через Google ещё раз и повторите действие.",
  "auth/too-many-requests": "Слишком много попыток. Подождите немного и попробуйте снова.",
}[error?.code] || "Не удалось выполнить вход. Попробуйте ещё раз.");

function withAuthTimeout(promise, code = "auth/timeout") {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(authError(code)), AUTH_WAIT_MS);
  })]).finally(() => clearTimeout(timer));
}

async function waitForAccount() {
  if (!configured || guestMode) return;
  if (authState === "loading") await withAuthTimeout(initialization, "auth/loading");
  if (authState !== "ready") throw authError("auth/unavailable");
  if (signInAttempt && !user) await withAuthTimeout(signInAttempt, "auth/loading");
}

// Defined before the SDK loads: a pending session must never look signed out.
window.getFirebaseIdToken = async () => {
  await waitForAccount();
  return user ? withAuthTimeout(user.getIdToken()) : null;
};
window.firebaseSignInWithGoogle = () => {
  if (signInAttempt) return signInAttempt;
  if (authState !== "ready" || !startGoogleSignIn) return Promise.reject(authError(authState === "loading" ? "auth/loading" : "auth/unavailable"));
  if (navigator.onLine === false) return Promise.reject(authError("auth/network-request-failed"));
  authMessage = "";
  // Invoke synchronously from the click; awaiting initialization here loses the mobile user gesture.
  const attempt = startGoogleSignIn();
  const slowTimer = setTimeout(() => {
    authMessage = "Вход занимает больше времени. Дождитесь окна Google. Если оно пустое, закройте его и повторите вход при устойчивой сети или в Safari/Chrome.";
    updateStatus();
  }, AUTH_WAIT_MS);
  signInAttempt = Promise.resolve(attempt).catch(error => {
    authMessage = window.getAuthErrorMessage(error);
    throw error;
  }).finally(() => {
    clearTimeout(slowTimer);
    signInAttempt = null;
    updateStatus();
  });
  updateStatus();
  return signInAttempt;
};

function startEmailAttempt(action) {
  if (signInAttempt) return signInAttempt;
  if (authState !== "ready") return Promise.reject(authError(authState === "loading" ? "auth/loading" : "auth/unavailable"));
  if (navigator.onLine === false) return Promise.reject(authError("auth/network-request-failed"));
  authMessage = "";
  signInAttempt = Promise.resolve(action()).catch(error => {
    authMessage = window.getAuthErrorMessage(error);
    throw error;
  }).finally(() => {
    signInAttempt = null;
    updateStatus();
  });
  updateStatus();
  return signInAttempt;
}

window.firebaseSignInWithEmail = (email, password) => startEmailAttempt(() => startEmailSignIn(email, password));
window.firebaseRegisterWithEmail = (email, password) => startEmailAttempt(() => startEmailRegistration(email, password)).then(async credential => {
  await startEmailVerification(credential.user);
  return credential;
});
window.firebaseSendPasswordReset = email => {
  if (authState !== "ready" || !startPasswordReset) return Promise.reject(authError(authState === "loading" ? "auth/loading" : "auth/unavailable"));
  if (navigator.onLine === false) return Promise.reject(authError("auth/network-request-failed"));
  return startPasswordReset(email);
};
window.firebaseSendEmailVerification = () => {
  if (!user || authState !== "ready" || !startEmailVerification) return Promise.reject(authError("auth/unavailable"));
  if (navigator.onLine === false) return Promise.reject(authError("auth/network-request-failed"));
  return startEmailVerification(user);
};
window.firebaseRefreshEmailVerification = async () => {
  if (!user || authState !== "ready") throw authError("auth/unavailable");
  await user.reload();
  user = authSdkCurrentUser();
  updateStatus();
  window.dispatchEvent(new Event("nutrition-auth-changed"));
  return Boolean(user?.emailVerified);
};
window.firebaseLinkEmailPassword = password => startEmailAttempt(() => startEmailLinking(user.email, password)).then(async credential => {
  await credential.user.reload();
  user = authSdkCurrentUser();
  updateStatus();
  window.dispatchEvent(new Event("nutrition-auth-changed"));
  return user;
});

async function loadProfile() {
  await waitForAccount();
  if (!configured || !user || !db) {
    const localProfile = localStorage.getItem(key("profile:main"));
    return localProfile ? JSON.parse(localProfile) : null;
  }
  const queued = overlayPendingDocument("profile", "main", null, user.uid);
  if (queued) return profileFields(queued);
  const cached = cachedProfile(user.uid);
  const refresh = refreshAccountProfile(user.uid);
  if (cached) {
    refresh.catch(() => {}); // Keep the last known profile on a temporary network error.
    return cached.profile;
  }
  return refresh;
}

async function connectFirebase() {
  // Keep firebase-app at its canonical URL: Auth/Firestore import that same
  // module and must share its component registry. A failed app import needs reload.
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js").catch(error => {
    appModuleFailed = true;
    throw error;
  });
  // Browsers cache failed module loads. Retry Auth/Firestore entrypoints under a fresh URL.
  const retry = sdkAttempt++ ? `?retry=${sdkAttempt}` : "";
  const [authSdk, firestoreSdk] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js${retry}`),
    import(`https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js${retry}`),
  ]);
  const app = initializeApp(firebaseConfig);
  db = firestoreSdk.getFirestore(app);
  window.__firestore = firestoreSdk;
  const auth = authSdk.getAuth(app);
  authSdkCurrentUser = () => auth.currentUser;
  auth.languageCode = "ru";
  // Be explicit: Firebase keeps its own session state in browser storage.
  // No user object, credential or ID token is copied into this application.
  // If a browser disallows persistent storage, keep Firebase's normal fallback
  // rather than making the whole app unavailable.
  await authSdk.setPersistence(auth, authSdk.browserLocalPersistence).catch(() => {});
  startGoogleSignIn = () => authSdk.signInWithPopup(auth, new authSdk.GoogleAuthProvider());
  window.firebaseSignOut = () => authSdk.signOut(auth);
  startEmailSignIn = (email, password) => authSdk.signInWithEmailAndPassword(auth, email, password);
  startEmailRegistration = (email, password) => authSdk.createUserWithEmailAndPassword(auth, email, password);
  startPasswordReset = email => authSdk.sendPasswordResetEmail(auth, email);
  startEmailVerification = account => authSdk.sendEmailVerification(account);
  startEmailLinking = (email, password) => authSdk.linkWithCredential(auth.currentUser, authSdk.EmailAuthProvider.credential(email, password));
  await new Promise((resolve, reject) => authSdk.onAuthStateChanged(auth, current => {
    if (user?.uid && user.uid !== current?.uid) removeCachedProfile(user.uid);
    profileGeneration++;
    profileRefresh = null;
    profileSaving = false;
    user = current;
    authState = "ready";
    guestMode = false;
    authMessage = "";
    updateStatus();
    reportDebug({ type: "auth", configured, signedIn: Boolean(current) });
    window.dispatchEvent(new Event("nutrition-auth-changed"));
    flushPendingWrites().catch(() => {});
    resolve();
  }, reject));
}

function initFirebase() {
  if (!configured || initialization) return initialization;
  authState = "loading";
  authMessage = "";
  const slowTimer = setTimeout(() => {
    authMessage = "Медленное соединение: ждём сервис входа. Можно пока работать как гость.";
    updateStatus();
  }, AUTH_WAIT_MS);
  initialization = connectFirebase().catch(() => {
    authState = "error";
    authMessage = window.getAuthErrorMessage(authError("auth/unavailable"));
    initialization = null;
  }).finally(() => { clearTimeout(slowTimer); updateStatus(); });
  updateStatus();
  return initialization;
}

function updateStatus() {
  let element = document.getElementById("firebaseStatus");
  if (!element) {
    element = document.createElement("p");
    element.id = "firebaseStatus";
    element.className = "hello";
    const screen = document.getElementById("profile");
    if (screen) screen.prepend(element);
  }
  const pending = user ? pendingWrites(user.uid).length : 0;
  const blocked = user ? pendingWrites(user.uid).filter(item => item.blocked).length : 0;
  if (element) element.textContent = !configured ? "Локальный режим: Firebase пока не подключён" : user ? (pending ? `Синхронизация: ожидают отправки ${pending} изм.` : `Синхронизация: ${user.email || "аккаунт подключён"}`) : guestMode ? "Гостевой режим: данные сохраняются на этом устройстве" : authState === "loading" ? "Подключаемся и восстанавливаем вход…" : authState === "error" ? "Сервис входа недоступен" : "Войдите, чтобы синхронизировать данные";
  if (element && blocked) element.textContent += ` Не приняты сервером: ${blocked}. Изменения сохранены на устройстве; проверьте данные и права доступа.`;
  updateAuthUI();
  window.dispatchEvent(new Event("nutrition-auth-status"));
}

function updateAuthUI() {
  let panel = document.getElementById("authPanel");
  const screen = document.getElementById("profile");
  if (!screen) return;
  if (!panel) { panel = document.createElement("section"); panel.id = "authPanel"; panel.className = "card"; screen.insertBefore(panel, document.getElementById("profileDocuments")); }
  if (!configured) { panel.innerHTML = '<b>Гостевой режим</b><p class="hello">Данные остаются на этом устройстве. После настройки Firebase здесь появится вход и синхронизация.</p><button class="secondary" type="button" disabled>Войти после настройки Firebase</button>'; return; }
  if (authState !== "ready") {
    panel.innerHTML = '<b>Подключение аккаунта</b><p class="hello" role="status"></p><button class="primary" type="button" id="retryAuth"></button><button class="secondary" type="button" id="guestAuth">Продолжить как гость</button>';
    panel.querySelector('p').textContent = authMessage || "Восстанавливаем сохранённый вход. При медленном интернете это может занять время.";
    const retry = document.getElementById("retryAuth");
    retry.textContent = authState === "loading" ? "Подключаемся…" : appModuleFailed ? "Перезагрузить страницу" : "Повторить подключение";
    retry.disabled = authState === "loading";
    retry.onclick = () => appModuleFailed ? window.location.reload() : initFirebase();
    if (authState === "error" && sdkAttempt > 1 && !appModuleFailed) {
      const reload = document.createElement("button");
      reload.type = "button"; reload.className = "secondary";
      reload.textContent = "Перезагрузить страницу";
      reload.onclick = () => window.location.reload();
      panel.append(reload);
    }
    document.getElementById("guestAuth").onclick = () => { guestMode = true; updateStatus(); window.dispatchEvent(new Event("nutrition-auth-changed")); };
    return;
  }
  if (user) {
    const verification = user.email && !user.emailVerified ? '<p class="hello" id="emailVerificationMessage">Подтвердите email по ссылке из письма, чтобы завершить регистрацию.</p><button class="secondary" type="button" id="resendEmailVerification">Отправить письмо повторно</button><button class="link" type="button" id="checkEmailVerification">Я подтвердил email</button>' : '<p class="hello">Ваши данные синхронизируются с личным аккаунтом.</p>';
    const providers = (user.providerData || []).map(provider => provider.providerId);
    const canAddPassword = user.email && providers.includes("google.com") && !providers.includes("password");
    const passwordLinking = canAddPassword ? '<form id="linkEmailPasswordForm"><p class="hello">Чтобы входить без Google, создайте пароль для этого же email. Данные и аккаунт сохранятся.</p><label class="field">Новый пароль<input id="linkEmailPassword" type="password" autocomplete="new-password" minlength="6" required></label><button class="secondary" type="submit">Создать пароль для входа</button><p class="hello" id="linkEmailPasswordMessage"></p></form>' : '';
    panel.innerHTML = `<b>${user.email || 'Аккаунт подключён'}</b>${verification}${passwordLinking}<button class="secondary" type="button" id="signOutButton">Выйти</button>`;
    document.getElementById("signOutButton").onclick = () => window.firebaseSignOut();
    if (canAddPassword) {
      const form = document.getElementById("linkEmailPasswordForm");
      const password = document.getElementById("linkEmailPassword");
      const message = document.getElementById("linkEmailPasswordMessage");
      form.onsubmit = event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        message.textContent = "Создаём пароль…";
        window.firebaseLinkEmailPassword(password.value).then(() => { message.textContent = "Пароль создан. Теперь можно войти по email без Google."; }).catch(error => { message.textContent = window.getAuthErrorMessage(error); });
      };
    }
    if (!user.email || user.emailVerified) return;
    const message = document.getElementById("emailVerificationMessage");
    document.getElementById("resendEmailVerification").onclick = () => {
      message.textContent = "Отправляем письмо…";
      window.firebaseSendEmailVerification().then(() => { message.textContent = "Письмо отправлено. Проверьте входящие и папку «Спам»."; }).catch(error => { message.textContent = window.getAuthErrorMessage(error); });
    };
    document.getElementById("checkEmailVerification").onclick = () => {
      message.textContent = "Проверяем подтверждение…";
      window.firebaseRefreshEmailVerification().then(verified => { if (!verified) message.textContent = "Email пока не подтверждён. Откройте ссылку из письма и попробуйте снова."; }).catch(error => { message.textContent = window.getAuthErrorMessage(error); });
    };
    return;
  }
  panel.innerHTML = '<b>Синхронизация данных</b><p class="hello" id="authMessage">Войдите через email и пароль или Google, чтобы сохранять данные в личном аккаунте. До входа приложение работает как гость.</p><form id="emailAuthForm"><label class="field">Email<input id="emailAuthEmail" type="email" autocomplete="email" inputmode="email" required></label><label class="field">Пароль<input id="emailAuthPassword" type="password" autocomplete="current-password" minlength="6" required></label><button class="primary" type="submit" id="emailSignIn">Войти по email</button><button class="secondary" type="button" id="emailRegister">Создать аккаунт</button><button class="link" type="button" id="passwordReset">Восстановить пароль</button></form>' + (googleAuthReady ? '<button class="secondary" type="button" id="googleSignIn">Войти через Google</button>' : '');
  const message = document.getElementById("authMessage");
  const form = document.getElementById("emailAuthForm");
  const email = document.getElementById("emailAuthEmail");
  const password = document.getElementById("emailAuthPassword");
  const setMessage = text => { message.textContent = text; };
  const getEmail = () => {
    if (!email.checkValidity()) { email.reportValidity(); return null; }
    return email.value.trim();
  };
  form.onsubmit = event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    setMessage("Выполняем вход…");
    window.firebaseSignInWithEmail(email.value.trim(), password.value).catch(error => setMessage(window.getAuthErrorMessage(error)));
  };
  document.getElementById("emailRegister").onclick = () => {
    if (!form.reportValidity()) return;
    setMessage("Создаём аккаунт…");
    window.firebaseRegisterWithEmail(email.value.trim(), password.value).catch(error => setMessage(window.getAuthErrorMessage(error)));
  };
  document.getElementById("passwordReset").onclick = () => {
    const address = getEmail(); if (!address) return;
    setMessage("Отправляем письмо для восстановления…");
    window.firebaseSendPasswordReset(address).then(() => setMessage("Письмо для восстановления пароля отправлено. Проверьте почту.")).catch(error => setMessage(window.getAuthErrorMessage(error)));
  };
  if (!googleAuthReady) return;
  const button = document.getElementById("googleSignIn");
  button.disabled = Boolean(signInAttempt);
  button.textContent = signInAttempt ? "Ожидаем вход через Google…" : "Войти через Google";
  if (authMessage) message.textContent = authMessage;
  button.onclick = () => window.firebaseSignInWithGoogle().catch(error => { authMessage = window.getAuthErrorMessage(error); updateStatus(); });
}

async function save(collection, id, value) {
  await waitForAccount();
  if (!configured || !user || !db) {
    localStorage.setItem(key(`${collection}:${id}`), JSON.stringify(value));
    reportDebug({ type: "save", mode: "local", collection, reason: "Нет авторизованного Firebase-пользователя" });
    return { mode: "local" };
  }
  const uid = user.uid;
  const isProfile = collection === "profile" && id === "main";
  const generation = isProfile ? ++profileGeneration : profileGeneration;
  if (isProfile) profileSaving = true;
  try {
    const mode = await sendDurableWrite("set", collection, id, value, uid);
    if (isProfile && user?.uid === uid && generation === profileGeneration) {
      cacheProfile(uid, value);
      publishProfile(uid, profileFields(value));
    }
    reportDebug({ type: "save", mode, collection });
    updateStatus();
    return { mode };
  } catch (error) {
    if (isTemporaryFirestoreError(error) && queueWrite("set", collection, id, value, uid)) {
      if (isProfile && user?.uid === uid && generation === profileGeneration) {
        cacheProfile(uid, value);
        publishProfile(uid, profileFields(value));
      }
      reportDebug({ type: "save", mode: "queued", collection });
      updateStatus();
      return { mode: "queued" };
    }
    reportDebug({ type: "save", mode: "error", collection, reason: String(error?.code || error?.message || "Неизвестная ошибка").slice(0, 180) });
    throw error;
  } finally {
    if (isProfile && generation === profileGeneration) profileSaving = false;
  }
}

function normalizeProductName(name) {
  return String(name || "").normalize("NFKD").toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

async function loadProduct(name) {
  await waitForAccount();
  const normalizedName = normalizeProductName(name);
  if (!normalizedName) return null;
  const localProduct = localStorage.getItem(key("products", normalizedName));
  if (!configured || !user || !db) return localProduct ? JSON.parse(localProduct) : null;
  try {
    const { doc, getDoc } = window.__firestore;
    const snapshot = await getDoc(doc(db, "users", user.uid, "products", normalizedName));
    return overlayPendingDocument("products", normalizedName, snapshot.exists() ? snapshot.data() : null);
  } catch (error) {
    if (isTemporaryFirestoreError(error)) return overlayPendingDocument("products", normalizedName, null);
    throw error;
  }
}

async function listProducts() {
  await waitForAccount();
  if (!configured || !user || !db) {
    const prefix = key("products:");
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).flatMap(storageKey => {
      if (!storageKey?.startsWith(prefix)) return [];
      try {
        const product = JSON.parse(localStorage.getItem(storageKey));
        return typeof product?.title === "string" && product.title.trim() ? [product] : [];
      } catch { return []; }
    });
  }
  try {
    const { collection, getDocs } = window.__firestore;
    const snapshot = await getDocs(collection(db, "users", user.uid, "products"));
    return overlayPendingCollection("products", snapshot.docs.map(document => ({ ...document.data(), id: document.id })))
      .filter(product => typeof product?.title === "string" && product.title.trim());
  } catch (error) {
    if (isTemporaryFirestoreError(error)) return overlayPendingCollection("products", [])
      .filter(product => typeof product?.title === "string" && product.title.trim());
    throw error;
  }
}

async function saveProduct(product) {
  const title = String(product?.title || "").trim();
  const normalizedName = normalizeProductName(title);
  if (!normalizedName || !Number.isFinite(Number(product?.calories))) throw new Error("Некорректный продукт");
  const unitWeight = Number(product.unitWeight);
  const clarification = product?.aiClarification;
  const clarificationQuestion = String(clarification?.question || "").trim().slice(0, 500);
  const additionalIngredients = String(clarification?.additionalIngredients || "").trim().slice(0, 500);
  return save("products", normalizedName, {
    title,
    normalizedName,
    portion: Number(product.portion) || null,
    ...(Number.isFinite(unitWeight) && unitWeight > 0 ? { unitWeight } : {}),
    calories: Number(product.calories),
    protein: Number(product.protein) || 0,
    fat: Number(product.fat) || 0,
    carbs: Number(product.carbs) || 0,
    ...(clarificationQuestion && additionalIngredients ? { aiClarification: { question: clarificationQuestion, additionalIngredients } } : {}),
  });
}

async function deleteProduct(name) {
  await waitForAccount();
  const normalizedName = normalizeProductName(name);
  if (!normalizedName) throw new Error("Не указан продукт для удаления");
  if (!configured || !user || !db) {
    localStorage.removeItem(key("products", normalizedName));
    reportDebug({ type: "delete", mode: "local", collection: "products" });
    return { mode: "local" };
  }
  const uid = user.uid;
  try {
    const mode = await sendDurableWrite("delete", "products", normalizedName, null, uid);
    reportDebug({ type: "delete", mode, collection: "products" });
    updateStatus();
    return { mode };
  } catch (error) {
    if (isTemporaryFirestoreError(error) && queueWrite("delete", "products", normalizedName, null, uid)) {
      reportDebug({ type: "delete", mode: "queued", collection: "products" });
      updateStatus();
      return { mode: "queued" };
    }
    throw error;
  }
}

async function loadWaterLog(date) {
  await waitForAccount();
  const safeDate = String(date || "");
  if (!safeDate) return null;
  if (!configured || !user || !db) {
    const saved = localStorage.getItem(key(`waterLogs:${safeDate}`));
    try { return saved ? JSON.parse(saved) : null; } catch { return null; }
  }
  try {
    const { doc, getDoc } = window.__firestore;
    const snapshot = await getDoc(doc(db, "users", user.uid, "waterLogs", safeDate));
    return overlayPendingDocument("waterLogs", safeDate, snapshot.exists() ? snapshot.data() : null);
  } catch (error) {
    if (isTemporaryFirestoreError(error)) return overlayPendingDocument("waterLogs", safeDate, null);
    throw error;
  }
}

async function loadDiaryEntries(date) {
  await waitForAccount();
  if (!configured || !user || !db) {
    const prefix = key("foodDiary");
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(storageKey => storageKey?.startsWith(prefix)).flatMap(storageKey => {
      try {
        const entry = JSON.parse(localStorage.getItem(storageKey));
        return entry?.date === date ? [{ ...entry, id: entry.id || storageKey.slice(prefix.length, -1) }] : [];
      } catch { return []; }
    });
  }
  try {
    const { collection, getDocs, query, where } = window.__firestore;
    const snapshot = await getDocs(query(collection(db, "users", user.uid, "foodDiary"), where("date", "==", date)));
    return overlayPendingCollection("foodDiary", snapshot.docs.map(document => ({ ...document.data(), id: document.id })))
      .filter(entry => entry?.date === date);
  } catch (error) {
    if (isTemporaryFirestoreError(error)) return overlayPendingCollection("foodDiary", []).filter(entry => entry?.date === date);
    throw error;
  }
}

async function loadWeightEntries() {
  await waitForAccount();
  if (!configured || !user || !db) {
    const prefix = key("weightEntries");
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(storageKey => storageKey?.startsWith(prefix)).flatMap(storageKey => {
      try {
        const entry = JSON.parse(localStorage.getItem(storageKey));
        return entry?.date && Number.isFinite(Number(entry.weight)) ? [entry] : [];
      } catch { return []; }
    });
  }
  try {
    const { collection, getDocs } = window.__firestore;
    const snapshot = await getDocs(collection(db, "users", user.uid, "weightEntries"));
    return overlayPendingCollection("weightEntries", snapshot.docs.map(document => ({ ...document.data(), id: document.id })))
      .filter(entry => entry?.date && Number.isFinite(Number(entry.weight)));
  } catch (error) {
    if (isTemporaryFirestoreError(error)) return overlayPendingCollection("weightEntries", [])
      .filter(entry => entry?.date && Number.isFinite(Number(entry.weight)));
    throw error;
  }
}

window.nutritionStore = {
  saveProfile: profile => save("profile", "main", profile),
  loadProfile,
  getAccountProfileDefaults: () => ({ uid: user?.uid || "", name: user?.displayName || "", email: user?.email || "", photoUrl: "" }),
  getCachedProfilePreview: cachedProfilePreview,
  saveDayPlan: plan => save("dayPlans", plan.date, plan),
  saveWaterLog: log => save("waterLogs", log.date, log),
  loadWaterLog,
  saveWeightEntry: entry => save("weightEntries", entry.date, entry),
  saveDiaryEntry: entry => {
    const id = entry.id || crypto.randomUUID();
    return save("foodDiary", id, { ...entry, id });
  },
  deleteDiaryEntry: async id => {
    await waitForAccount();
    if (!id) throw new Error("Не указана запись дневника");
    if (!configured || !user || !db) {
      localStorage.removeItem(key(`foodDiary:${id}`));
      return { mode: "local" };
    }
    const uid = user.uid;
    try {
      const mode = await sendDurableWrite("delete", "foodDiary", String(id), null, uid);
      updateStatus();
      return { mode };
    } catch (error) {
      if (isTemporaryFirestoreError(error) && queueWrite("delete", "foodDiary", String(id), null, uid)) {
        updateStatus();
        return { mode: "queued" };
      }
      throw error;
    }
  },
  loadDiaryEntries,
  loadWeightEntries,
  loadProduct,
  listProducts,
  saveProduct,
  deleteProduct,
};

initFirebase();
window.dispatchEvent(new Event("nutritionstore-ready"));

window.addProposedMeal = async meal => {
  if (!meal || !meal.title || !Number.isFinite(Number(meal.calories))) throw new Error("Некорректное предложение блюда");
  meal.id ||= crypto.randomUUID();
  return window.nutritionStore.saveDiaryEntry({
    date: meal.date || localDateKey(),
    id: meal.id,
    mealType: meal.mealType || "Перекус",
    title: String(meal.title).trim(),
    portion: Number(meal.portion) || null,
    portionUnit: meal.portionUnit || "г",
    calories: Number(meal.calories),
    protein: Number(meal.protein) || 0,
    fat: Number(meal.fat) || 0,
    carbs: Number(meal.carbs) || 0,
    source: "ai-confirmed",
  });
};

window.addProposedProduct = async product => {
  if (!product || !product.title || !Number.isFinite(Number(product.calories))) throw new Error("Некорректное предложение продукта");
  product.id ||= crypto.randomUUID();
  const entry = {
    id: product.id,
    date: product.date || localDateKey(),
    mealType: product.mealType || "Перекус",
    title: String(product.title).trim(),
    portion: Number(product.portion) || null,
    calories: Number(product.calories),
    protein: Number(product.protein) || 0,
    fat: Number(product.fat) || 0,
    carbs: Number(product.carbs) || 0,
    source: "ai-product-confirmed",
  };
  await window.nutritionStore.saveDiaryEntry(entry);
  await window.nutritionStore.saveProduct(entry);
};

window.addEventListener("online", () => {
  if (authState === "error" && !appModuleFailed) initFirebase();
  if (user && db) refreshAccountProfile(user.uid).catch(() => {});
  flushPendingWrites().catch(() => {});
});
updateStatus();
