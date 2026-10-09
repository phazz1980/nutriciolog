package ru.mynutritionist.wear

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import java.time.LocalDate
import java.time.format.DateTimeFormatter

data class DaySummary(
    val calories: Int = 0,
    val waterGlasses: Int = 0,
    val weight: Double? = null,
    val signedIn: Boolean = false,
)

/**
 * Uses the exact Firestore paths and field names of the web client. No API key is
 * embedded here: Firebase's Android client identifiers are local build settings.
 */
class NutritionRepository(context: Context) {
    private val preferences = context.getSharedPreferences("nutrition_wear", Context.MODE_PRIVATE)
    private val configured = listOf(
        BuildConfig.FIREBASE_APP_ID,
        BuildConfig.FIREBASE_API_KEY,
        BuildConfig.FIREBASE_PROJECT_ID,
    ).all { it.isNotBlank() && !it.contains("YOUR_") }

    private val app: FirebaseApp? = if (configured) runCatching {
        FirebaseApp.initializeApp(
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
    val isSignedIn: Boolean get() = auth?.currentUser != null

    suspend fun signIn(email: String, password: String) {
        check(isConfigured) { "Сначала настройте Firebase для Wear OS." }
        auth!!.signInWithEmailAndPassword(email.trim(), password).await()
    }

    suspend fun signInWithDeviceToken(token: String) {
        check(isConfigured) { "Сначала настройте Firebase для Wear OS." }
        auth!!.signInWithCustomToken(token).await()
    }

    fun signOut() = auth?.signOut()

    suspend fun loadToday(): DaySummary {
        val date = today()
        val localWater = preferences.getInt("water:$date", 0)
        val uid = auth?.currentUser?.uid ?: return DaySummary(waterGlasses = localWater)
        val firestore = store ?: return DaySummary(waterGlasses = localWater)
        val user = firestore.collection("users").document(uid)
        val diary = user.collection("foodDiary").whereEqualTo("date", date).get().await()
        val calories = diary.documents.sumOf { (it.getDouble("calories") ?: 0.0).toInt() }
        val water = user.collection("waterLogs").document(date).get().await()
            .getLong("glasses")?.toInt()?.coerceIn(0, 8) ?: localWater
        val weight = user.collection("weightEntries").whereLessThanOrEqualTo("date", date)
            .orderBy("date", Query.Direction.DESCENDING).limit(1).get().await()
            .documents.firstOrNull()?.getDouble("weight")
            ?: preferences.getString("weight:$uid", null)?.toDoubleOrNull()
        preferences.edit().putInt("water:$date", water).apply()
        return DaySummary(calories, water, weight, signedIn = true)
    }

    suspend fun setWater(glasses: Int): Boolean {
        val date = today()
        val safe = glasses.coerceIn(0, 8)
        preferences.edit().putInt("water:$date", safe).apply()
        val uid = auth?.currentUser?.uid ?: return false
        val write = store!!.collection("users").document(uid).collection("waterLogs").document(date).set(
            mapOf("date" to date, "glasses" to safe, "updatedAt" to FieldValue.serverTimestamp()),
        )
        return withTimeoutOrNull(5000) { write.await(); true } ?: false
    }

    suspend fun setWeight(value: Double): Boolean {
        require(value in 20.0..500.0) { "Вес должен быть от 20 до 500 кг." }
        val uid = auth?.currentUser?.uid ?: error("Войдите для синхронизации веса.")
        preferences.edit().putString("weight:$uid", value.toString()).apply()
        val date = today()
        val write = store!!.collection("users").document(uid).collection("weightEntries").document(date).set(
            mapOf("date" to date, "weight" to value, "updatedAt" to FieldValue.serverTimestamp()),
        )
        return withTimeoutOrNull(5000) { write.await(); true } ?: false
    }

    private fun today(): String = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE)
}
