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
const key = (name, date = "") => `my-nutritionist:${name}:${date}`;

async function loadProfile() {
  const localProfile = localStorage.getItem(key("profile:main"));
  if (!configured || !user || !db) return localProfile ? JSON.parse(localProfile) : null;
  const { doc, getDoc } = window.__firestore;
  const snapshot = await getDoc(doc(db, "users", user.uid, "profile", "main"));
  return snapshot.exists() ? snapshot.data() : (localProfile ? JSON.parse(localProfile) : null);
}

async function initFirebase() {
  if (!configured) return;
  const [{ initializeApp }, authSdk, firestoreSdk] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  db = firestoreSdk.getFirestore(app);
  authSdk.onAuthStateChanged(authSdk.getAuth(app), current => { user = current; updateStatus(); window.dispatchEvent(new Event("nutrition-auth-changed")); });
  window.firebaseSignInWithGoogle = async () => authSdk.signInWithPopup(authSdk.getAuth(app), new authSdk.GoogleAuthProvider());
  window.firebaseSignOut = () => authSdk.signOut(authSdk.getAuth(app));
  window.getFirebaseIdToken = async () => user ? user.getIdToken() : null;
  window.firebaseSignInWithEmail = (email, password) => authSdk.signInWithEmailAndPassword(authSdk.getAuth(app), email, password);
  window.firebaseRegisterWithEmail = (email, password) => authSdk.createUserWithEmailAndPassword(authSdk.getAuth(app), email, password);
  window.__firestore = firestoreSdk;
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
  if (element) element.textContent = configured ? (user ? `Синхронизация: ${user.email || "аккаунт подключён"}` : "Войдите, чтобы синхронизировать данные") : "Локальный режим: Firebase пока не подключён";
  updateAuthUI();
}

function updateAuthUI() {
  let panel = document.getElementById("authPanel");
  const screen = document.getElementById("profile");
  if (!screen) return;
  if (!panel) { panel = document.createElement("section"); panel.id = "authPanel"; panel.className = "card"; screen.append(panel); }
  if (!configured) { panel.innerHTML = '<b>Гостевой режим</b><p class="hello">Данные остаются на этом устройстве. После настройки Firebase здесь появится вход и синхронизация.</p><button class="secondary" type="button" disabled>Войти после настройки Firebase</button>'; return; }
  if (!googleAuthReady) { panel.innerHTML = '<b>Гостевой режим</b><p class="hello">Firebase подключён, но Google-вход ещё не активирован. Пока данные остаются на этом устройстве.</p><button class="secondary" type="button" disabled>Google-вход ожидает настройки</button>'; return; }
  if (user) { panel.innerHTML = `<b>${user.email || 'Аккаунт подключён'}</b><p class="hello">Ваши данные синхронизируются с личным аккаунтом.</p><button class="secondary" type="button" id="signOutButton">Выйти</button>`; document.getElementById("signOutButton").onclick = () => window.firebaseSignOut(); return; }
  panel.innerHTML = '<b>Синхронизация данных</b><p class="hello">Войдите через Google, чтобы сохранять данные в личном аккаунте. До входа приложение работает как гость.</p><button class="primary" type="button" id="googleSignIn">Войти через Google</button>';
  document.getElementById("googleSignIn").onclick = () => window.firebaseSignInWithGoogle().catch(() => alert("Не удалось войти через Google."));
}

async function save(collection, id, value) {
  if (!configured || !user || !db) { localStorage.setItem(key(`${collection}:${id}`), JSON.stringify(value)); return { mode: "local" }; }
  const { doc, setDoc, serverTimestamp } = window.__firestore;
  await setDoc(doc(db, "users", user.uid, collection, id), { ...value, updatedAt: serverTimestamp() }, { merge: true });
  return { mode: "cloud" };
}

window.nutritionStore = {
  saveProfile: profile => save("profile", "main", profile),
  loadProfile,
  getAccountProfileDefaults: () => ({ name: user?.displayName || "", photoUrl: user?.photoURL || "" }),
  saveDayPlan: plan => save("dayPlans", plan.date, plan),
  saveWaterLog: log => save("waterLogs", log.date, log),
  saveWeightEntry: entry => save("weightEntries", entry.date, entry),
  saveDiaryEntry: entry => save("foodDiary", `${entry.date}-${crypto.randomUUID()}`, entry),
};

window.dispatchEvent(new Event("nutritionstore-ready"));

window.addProposedMeal = async meal => {
  if (!meal || !meal.title || !Number.isFinite(Number(meal.calories))) throw new Error("Некорректное предложение блюда");
  return window.nutritionStore.saveDiaryEntry({ date: new Date().toISOString().slice(0, 10), mealType: meal.mealType || "Перекус", title: meal.title, calories: Number(meal.calories), source: "ai-confirmed" });
};

initFirebase().catch(() => { updateStatus(); });
updateStatus();
