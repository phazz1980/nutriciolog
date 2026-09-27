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
  try { localStorage.setItem(profileCacheKey(uid), JSON.stringify({ version: 1, profile: profileFields(value) })); }
  catch { /* The cloud operation remains successful when device storage is full. */ }
}

function removeCachedProfile(uid) {
  try { localStorage.removeItem(profileCacheKey(uid)); } catch {}
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
    const profile = snapshot.exists() ? profileFields(snapshot.data()) : null;
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
  if (element) element.textContent = !configured ? "Локальный режим: Firebase пока не подключён" : user ? `Синхронизация: ${user.email || "аккаунт подключён"}` : guestMode ? "Гостевой режим: данные сохраняются на этом устройстве" : authState === "loading" ? "Подключаемся и восстанавливаем вход…" : authState === "error" ? "Сервис входа недоступен" : "Войдите, чтобы синхронизировать данные";
  updateAuthUI();
  window.dispatchEvent(new Event("nutrition-auth-status"));
}

function updateAuthUI() {
  let panel = document.getElementById("authPanel");
  const screen = document.getElementById("profile");
  if (!screen) return;
  if (!panel) { panel = document.createElement("section"); panel.id = "authPanel"; panel.className = "card"; screen.append(panel); }
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
    const providers = user.providerData.map(provider => provider.providerId);
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
    const { doc, setDoc, serverTimestamp } = window.__firestore;
    await setDoc(doc(db, "users", uid, collection, id), { ...value, updatedAt: serverTimestamp() }, { merge: true });
    if (isProfile && user?.uid === uid && generation === profileGeneration) {
      cacheProfile(uid, value);
      publishProfile(uid, profileFields(value));
    }
    reportDebug({ type: "save", mode: "cloud", collection });
    return { mode: "cloud" };
  } catch (error) {
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
  const { doc, getDoc } = window.__firestore;
  const snapshot = await getDoc(doc(db, "users", user.uid, "products", normalizedName));
  return snapshot.exists() ? snapshot.data() : null;
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

async function loadWaterLog(date) {
  await waitForAccount();
  const safeDate = String(date || "");
  if (!safeDate) return null;
  if (!configured || !user || !db) {
    const saved = localStorage.getItem(key(`waterLogs:${safeDate}`));
    try { return saved ? JSON.parse(saved) : null; } catch { return null; }
  }
  const { doc, getDoc } = window.__firestore;
  const snapshot = await getDoc(doc(db, "users", user.uid, "waterLogs", safeDate));
  return snapshot.exists() ? snapshot.data() : null;
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
  const { collection, getDocs, query, where } = window.__firestore;
  const snapshot = await getDocs(query(collection(db, "users", user.uid, "foodDiary"), where("date", "==", date)));
  return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
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
  const { collection, getDocs } = window.__firestore;
  const snapshot = await getDocs(collection(db, "users", user.uid, "weightEntries"));
  return snapshot.docs.map(document => document.data()).filter(entry => entry?.date && Number.isFinite(Number(entry.weight)));
}

window.nutritionStore = {
  saveProfile: profile => save("profile", "main", profile),
  loadProfile,
  getAccountProfileDefaults: () => ({ uid: user?.uid || "", name: user?.displayName || "", email: user?.email || "", photoUrl: user?.photoURL || "" }),
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
    const { deleteDoc, doc } = window.__firestore;
    await deleteDoc(doc(db, "users", user.uid, "foodDiary", id));
    return { mode: "cloud" };
  },
  loadDiaryEntries,
  loadWeightEntries,
  loadProduct,
  saveProduct,
};

initFirebase();
window.dispatchEvent(new Event("nutritionstore-ready"));

window.addProposedMeal = async meal => {
  if (!meal || !meal.title || !Number.isFinite(Number(meal.calories))) throw new Error("Некорректное предложение блюда");
  meal.id ||= crypto.randomUUID();
  return window.nutritionStore.saveDiaryEntry({ date: meal.date || new Date().toISOString().slice(0, 10), id: meal.id, mealType: meal.mealType || "Перекус", title: meal.title, calories: Number(meal.calories), source: "ai-confirmed" });
};

window.addProposedProduct = async product => {
  if (!product || !product.title || !Number.isFinite(Number(product.calories))) throw new Error("Некорректное предложение продукта");
  product.id ||= crypto.randomUUID();
  const entry = {
    id: product.id,
    date: product.date || new Date().toISOString().slice(0, 10),
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
});
updateStatus();
