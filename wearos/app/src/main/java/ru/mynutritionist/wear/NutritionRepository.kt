package ru.mynutritionist.wear

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.Source
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.time.LocalDate
import java.time.format.DateTimeFormatter

data class DaySummary(
    val calories: Int = 0,
    val waterGlasses: Int = 0,
    val weight: Double? = null,
    val signedIn: Boolean = false,
    val pendingChanges: Int = 0,
    val protein: Double = 0.0,
    val fat: Double = 0.0,
    val carbs: Double = 0.0,
    val calorieGoal: Double? = null,
    val meals: List<DiaryMeal> = emptyList(),
)

data class DiaryMeal(
    val id: String,
    val title: String,
    val mealType: String,
    val portion: Double?,
    val portionUnit: String,
    val calories: Double,
    val pending: Boolean,
)

/** Matches js/core.js nutritionTargets: 30% protein, 30% fat, 40% carbs. */
data class NutritionTargets(val calories: Double, val protein: Int, val fat: Int, val carbs: Int) {
    companion object {
        fun fromCalories(value: Double?): NutritionTargets? {
            if (value == null || !value.isFinite() || value <= 0 || value > 100000) return null
            fun grams(ratio: Double) = kotlin.math.floor(value * ratio + 0.5).toInt()
            return NutritionTargets(value, grams(0.3 / 4), grams(0.3 / 9), grams(0.4 / 4))
        }
    }
}

/**
 * Uses the exact Firestore paths and field names of the web client. No API key is
 * embedded here: Firebase's Android client identifiers are local build settings.
 */
class NutritionRepository(context: Context) {
    companion object {
        private val diskExecutor = Executors.newSingleThreadExecutor()
        private val inFlight = mutableSetOf<String>()
        private val sharedUpdates = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    }
    private val preferences = context.getSharedPreferences("nutrition_wear", Context.MODE_PRIVATE)
    private val local = LocalNutritionStore({ preferences.getString(it, null) }, { key, value ->
        check(preferences.edit().putString(key, value).commit()) { "Недостаточно места на часах." }
    })
    val updates get() = sharedUpdates
    @Volatile var syncRejected = false
        private set
    private val rejected = mutableSetOf<String>()
    private val configured = listOf(
        BuildConfig.FIREBASE_APP_ID,
        BuildConfig.FIREBASE_API_KEY,
        BuildConfig.FIREBASE_PROJECT_ID,
    ).all { it.isNotBlank() && !it.contains("YOUR_") }

    private val app: FirebaseApp? = if (configured) runCatching {
        FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
            ?: FirebaseApp.initializeApp(
            context,
            FirebaseOptions.Builder()
                .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .build(),
        )
    }.getOrNull() else null

    private val auth: FirebaseAuth? get() = app?.let { FirebaseAuth.getInstance(it) }
    private val store: FirebaseFirestore? get() = app?.let { FirebaseFirestore.getInstance(it) }
    val isConfigured: Boolean get() = app != null
    val configurationMessage: String get() = if (!configured)
        "Добавьте firebase.properties при сборке"
    else "Не удалось инициализировать Firebase. Перезапустите приложение."
    val isSignedIn: Boolean get() = auth?.currentUser != null
    val currentUid: String? get() = auth?.currentUser?.uid
    val initialSummary: DaySummary = local.summary(currentUid, today())
    suspend fun cachedToday(): DaySummary = withContext(Dispatchers.IO) { local.summary(currentUid, today()) }
    suspend fun foodForm(): FoodDraft = withContext(Dispatchers.IO) { local.foodForm(currentUid) }
    suspend fun saveFoodForm(owner: String?, draft: FoodDraft) = withContext(Dispatchers.IO) { local.saveFoodForm(owner, draft) }
    suspend fun saveFoodDraft(owner: String?, text: String) = withContext(Dispatchers.IO) { local.saveDraft(owner, text) }

    suspend fun signIn(email: String, password: String) {
        check(isConfigured) { "Сначала настройте Firebase для Wear OS." }
        auth!!.signInWithEmailAndPassword(email.trim(), password).await()
    }

    suspend fun signInWithDeviceToken(token: String) {
        check(isConfigured) { "Сначала настройте Firebase для Wear OS." }
        auth!!.signInWithCustomToken(token).await()
    }

    fun signOut() { auth?.signOut(); syncRejected = false; updates.tryEmit(Unit) }

    suspend fun loadToday(): DaySummary {
        val date = today()
        val uid = currentUid ?: return cachedToday()
        val firestore = store ?: return cachedToday()
        flushPending(retryRejected = true)
        val user = firestore.collection("users").document(uid)
        val revision = withContext(Dispatchers.IO) { local.revision(uid) }
        // All reads run concurrently and are bounded. A failed read never zeroes a saved value.
        coroutineScope {
            val meals = async { withTimeoutOrNull(4000) { runCatching {
                user.collection("foodDiary").whereEqualTo("date", date).get(Source.SERVER).await()
            }.getOrNull() } }
            val water = async { withTimeoutOrNull(4000) { runCatching {
                user.collection("waterLogs").document(date).get(Source.SERVER).await()
            }.getOrNull() } }
            val weight = async { withTimeoutOrNull(4000) { runCatching {
                user.collection("weightEntries").whereLessThanOrEqualTo("date", date)
                    .orderBy("date", Query.Direction.DESCENDING).limit(1).get(Source.SERVER).await()
            }.getOrNull() } }
            val profile = async { withTimeoutOrNull(4000) { runCatching {
                user.collection("profile").document("main").get(Source.SERVER).await()
            }.getOrNull() } }
            val diaryResult = meals.await(); val waterResult = water.await(); val weightResult = weight.await()
            val profileResult = profile.await()
            withContext(Dispatchers.IO) {
                profileResult?.let { local.cacheCalorieGoal(uid, (it.get("calories") as? Number)?.toDouble()) }
                diaryResult?.let { local.cacheMeals(uid, date, it.documents.associate { doc ->
                    doc.id to JSONObject(doc.data.orEmpty().filterKeys { it != "updatedAt" })
                }, revision) }
                waterResult?.let { local.cacheWater(uid, date, (it.get("glasses") as? Number)?.toInt() ?: 0, revision) }
                weightResult?.let { result ->
                    val doc = result.documents.firstOrNull()
                    local.cacheWeight(uid, doc?.getString("date") ?: date, (doc?.get("weight") as? Number)?.toDouble(), revision)
                }
            }
        }
        return cachedToday()
    }

    suspend fun setWater(glasses: Int): Boolean {
        val date = today()
        val safe = glasses.coerceIn(0, 8)
        val uid = currentUid
        withContext(Dispatchers.IO) { local.record(uid, "waterLogs", date, JSONObject().put("date", date).put("glasses", safe)) }
        updates.tryEmit(Unit)
        flushPending()
        return uid != null && withContext(Dispatchers.IO) { local.changes(uid).isEmpty() }
    }

    suspend fun setWeight(value: Double): Boolean {
        require(value in 20.0..500.0) { "Вес должен быть от 20 до 500 кг." }
        val uid = currentUid
        val date = today()
        withContext(Dispatchers.IO) { local.record(uid, "weightEntries", date, JSONObject().put("date", date).put("weight", value)) }
        updates.tryEmit(Unit)
        flushPending()
        return uid != null && withContext(Dispatchers.IO) { local.changes(uid).isEmpty() }
    }

    suspend fun estimateFood(text: String, context: String = ""): MealEstimate {
        val user = auth?.currentUser ?: error("Войдите для расчёта с ИИ.")
        val token = withTimeoutOrNull(10000) { user.getIdToken(false).await().token }
            ?: error("Не удалось подтвердить вход. Проверьте сеть.")
        val estimate = FoodAi.estimate(text, token, context)
        check(currentUid == user.uid) { "Аккаунт изменился. Повторите расчёт." }
        return estimate
    }

    /** Invoked only by the explicit Add button, never by recognition or AI completion. */
    suspend fun addFood(owner: String?, meal: MealEstimate, mealType: String) {
        check(currentUid == owner) { "Аккаунт изменился. Откройте форму заново." }
        require(meal.valid() && mealType in listOf("Завтрак", "Обед", "Ужин", "Перекус"))
        val date = today()
        val id = "$date-wear-${UUID.randomUUID()}"
        val data = meal.json().put("id", id).put("date", date).put("mealType", mealType)
            .put("portionUnit", "г").put("source", "wear-voice-ai")
        withContext(Dispatchers.IO) { local.record(owner, "foodDiary", id, data) }
        updates.tryEmit(Unit)
        flushPending()
    }

    suspend fun flushPending(retryRejected: Boolean = false) = withContext(Dispatchers.IO) {
        val uid = currentUid ?: return@withContext
        val firestore = store ?: return@withContext
        if (retryRejected) synchronized(rejected) { rejected.clear(); syncRejected = false }
        local.changes(uid).forEach { change ->
            if (currentUid != uid) return@forEach
            val flight = "$uid/${change.key}/${change.version}"
            if (synchronized(rejected) { flight in rejected }) return@forEach
            if (!synchronized(inFlight) { inFlight.add(flight) }) return@forEach
            val data = change.data.keys().asSequence().associateWith { change.data.get(it) }.toMutableMap()
            data["updatedAt"] = FieldValue.serverTimestamp()
            firestore.collection("users").document(uid).collection(change.collection).document(change.id).set(data)
                .addOnSuccessListener(diskExecutor) {
                    try { local.acknowledge(uid, change) }
                    finally { synchronized(inFlight) { inFlight.remove(flight) }; updates.tryEmit(Unit) }
                }.addOnFailureListener(diskExecutor) {
                    synchronized(inFlight) { inFlight.remove(flight) }
                    synchronized(rejected) { rejected.add(flight) }
                    if (currentUid == uid) syncRejected = true
                    updates.tryEmit(Unit)
                }
        }
    }

    private fun today(): String = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE)
}
