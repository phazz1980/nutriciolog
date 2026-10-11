package ru.mynutritionist.wear

import org.json.JSONObject
import java.util.UUID

data class MealEstimate(val title: String, val portion: Double, val calories: Double,
    val protein: Double, val fat: Double, val carbs: Double) {
    fun valid() = title.isNotBlank() && title.length <= 200 && portion.isFinite() && portion > 0 && portion <= 10000 &&
        calories.isFinite() && calories in 0.0..50000.0 &&
        listOf(protein, fat, carbs).all { it.isFinite() && it in 0.0..5000.0 }
    fun json() = JSONObject().put("title", title).put("portion", portion).put("calories", calories)
        .put("protein", protein).put("fat", fat).put("carbs", carbs)
    companion object {
        fun parse(data: JSONObject) = MealEstimate(data.getString("title"), data.getDouble("portion"),
            data.getDouble("calories"), data.getDouble("protein"), data.getDouble("fat"), data.getDouble("carbs"))
            .also { require(it.valid()) { "ИИ вернул неполный расчёт. Уточните продукт и порцию." } }
    }
}

data class PendingChange(val key: String, val version: String, val collection: String, val id: String, val data: JSONObject)
data class FoodDraft(val text: String = "", val question: String = "", val answer: String = "", val context: String = "")

/** A small durable, UID-scoped backup. No credentials or audio belong here. */
class LocalNutritionStore(private val read: (String) -> String?, private val write: (String, String) -> Unit) {
    companion object { private val lock = Any() }
    private fun key(uid: String?) = if (uid == null) "guest-v2" else "account-v2:$uid"
    private fun state(uid: String?) = read(key(uid))?.let { JSONObject(it) } ?: JSONObject()
    private fun pending(state: JSONObject) = state.optJSONObject("pending") ?: JSONObject()
    private fun day(state: JSONObject, date: String): JSONObject {
        val days = state.optJSONObject("days") ?: JSONObject().also { state.put("days", it) }
        return days.optJSONObject(date) ?: JSONObject().also { days.put(date, it) }
    }
    fun summary(uid: String?, date: String): DaySummary = synchronized(lock) {
        val state = state(uid)
        val day = day(state, date)
        val meals = day.optJSONObject("meals") ?: JSONObject()
        val changes = pending(state)
        val diary = meals.keys().asSequence().map { id ->
            val meal = meals.getJSONObject(id)
            DiaryMeal(id, meal.optString("title").ifBlank { "Блюдо" }, meal.optString("mealType"),
                meal.optDouble("portion", Double.NaN).takeIf { it.isFinite() && it > 0 },
                meal.optString("portionUnit", "г").ifBlank { "г" },
                meal.optDouble("calories", 0.0).takeIf { it.isFinite() && it >= 0 } ?: 0.0,
                changes.has("foodDiary/$id"))
        }.sortedWith(compareBy<DiaryMeal> {
            listOf("Завтрак", "Обед", "Ужин", "Перекус").indexOf(it.mealType).let { order -> if (order < 0) 4 else order }
        }.thenBy { it.id }).toList()
        fun total(field: String) = meals.keys().asSequence().sumOf {
            meals.getJSONObject(it).optDouble(field, 0.0).takeIf { value -> value.isFinite() && value >= 0 } ?: 0.0
        }
        DaySummary(meals.keys().asSequence().sumOf { meals.getJSONObject(it).optDouble("calories", 0.0) }.toInt(),
            day.optInt("water", 0), state.optDouble("weight", Double.NaN).takeIf { it.isFinite() && state.optString("weightDate") <= date },
            uid != null, pending(state).length(), protein = total("protein"), fat = total("fat"), carbs = total("carbs"),
            calorieGoal = NutritionTargets.fromCalories(state.optDouble("calorieGoal", Double.NaN))?.calories,
            meals = diary)
    }
    fun cacheCalorieGoal(uid: String, calories: Double?) = synchronized(lock) {
        val state = state(uid)
        val goal = NutritionTargets.fromCalories(calories)
        if (goal == null) state.remove("calorieGoal") else state.put("calorieGoal", goal.calories)
        write(key(uid), state.toString())
    }
    fun draft(uid: String?): String = synchronized(lock) { state(uid).optString("draft", "") }
    fun foodForm(uid: String?): FoodDraft = synchronized(lock) {
        val state = state(uid)
        FoodDraft(state.optString("draft", ""), state.optString("foodQuestion", ""),
            state.optString("foodAnswer", ""), state.optString("foodContext", ""))
    }
    fun saveFoodForm(uid: String?, draft: FoodDraft) = synchronized(lock) {
        val state = state(uid).put("draft", draft.text.take(300)).put("foodQuestion", draft.question.take(200))
            .put("foodAnswer", draft.answer.take(200)).put("foodContext", draft.context.takeLast(450))
        write(key(uid), state.toString())
    }
    fun saveDraft(uid: String?, text: String) = synchronized(lock) {
        val state = state(uid).put("draft", text.take(300))
        write(key(uid), state.toString())
    }
    fun revision(uid: String?): Long = synchronized(lock) { state(uid).optLong("revision", 0) }
    fun changes(uid: String): List<PendingChange> = synchronized(lock) {
        val changes = pending(state(uid))
        changes.keys().asSequence().map { key ->
            val op = changes.getJSONObject(key)
            PendingChange(key, op.getString("version"), op.getString("collection"), op.getString("id"), op.getJSONObject("data"))
        }.toList()
    }
    fun acknowledge(uid: String, change: PendingChange) = synchronized(lock) {
        val state = state(uid)
        val changes = pending(state)
        // A late acknowledgement must never erase a newer edit to the same day.
        if (changes.optJSONObject(change.key)?.optString("version") == change.version) {
            changes.remove(change.key)
            state.put("pending", changes).put("revision", state.optLong("revision") + 1)
            write(key(uid), state.toString())
        }
    }
    fun record(uid: String?, collection: String, id: String, data: JSONObject) = synchronized(lock) {
        val state = state(uid)
        val date = data.getString("date")
        when (collection) {
            "waterLogs" -> day(state, date).put("water", data.getInt("glasses"))
            "weightEntries" -> state.put("weight", data.getDouble("weight")).put("weightDate", date)
            "foodDiary" -> {
                val day = day(state, date)
                val meals = day.optJSONObject("meals") ?: JSONObject()
                day.put("meals", meals.put(id, data))
                state.put("draft", "")
                state.remove("foodQuestion"); state.remove("foodAnswer"); state.remove("foodContext")
            }
            else -> error("Unsupported collection")
        }
        if (uid != null) {
            val changes = pending(state)
            changes.put("$collection/$id", JSONObject().put("version", UUID.randomUUID().toString())
                .put("collection", collection).put("id", id).put("data", data))
            state.put("pending", changes)
        }
        state.put("revision", state.optLong("revision") + 1)
        write(key(uid), state.toString())
    }
    fun cacheMeals(uid: String, date: String, values: Map<String, JSONObject>, revision: Long) = synchronized(lock) {
        val state = state(uid)
        // Do not replace a local edit with a read begun before that edit/ack.
        if (state.optLong("revision") != revision) return@synchronized
        val meals = JSONObject(values)
        val changes = pending(state)
        changes.keys().forEach { key ->
            val op = changes.getJSONObject(key)
            val data = op.getJSONObject("data")
            if (op.getString("collection") == "foodDiary" && data.getString("date") == date)
                meals.put(op.getString("id"), data)
        }
        day(state, date).put("meals", meals)
        write(key(uid), state.toString())
    }
    fun cacheWater(uid: String, date: String, value: Int, revision: Long) = synchronized(lock) {
        val state = state(uid)
        if (state.optLong("revision") != revision || pending(state).has("waterLogs/$date")) return@synchronized
        day(state, date).put("water", value.coerceIn(0, 8))
        write(key(uid), state.toString())
    }
    fun cacheWeight(uid: String, date: String, value: Double?, revision: Long) = synchronized(lock) {
        val state = state(uid)
        if (state.optLong("revision") != revision || pending(state).keys().asSequence().any { it.startsWith("weightEntries/") }) return@synchronized
        if (value == null) { state.remove("weight"); state.remove("weightDate") }
        else { state.put("weight", value); state.put("weightDate", date) }
        write(key(uid), state.toString())
    }
}
