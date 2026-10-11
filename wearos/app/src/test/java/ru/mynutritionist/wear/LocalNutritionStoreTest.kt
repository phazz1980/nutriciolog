package ru.mynutritionist.wear

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class LocalNutritionStoreTest {
    private val disk = mutableMapOf<String, String>()
    private fun store() = LocalNutritionStore({ disk[it] }, { key, value -> disk[key] = value })
    private val date = "2026-10-10"
    private fun water(value: Int) = JSONObject().put("date", date).put("glasses", value)
    private fun meal(id: String) = MealEstimate("Яблоко", 150.0, 78.0, 0.4, 0.3, 20.0).json()
        .put("date", date).put("id", id).put("mealType", "Перекус").put("source", "wear-voice-ai").put("portionUnit", "г")

    @Test fun restartRetainsWaterWeightFoodAndPending() {
        val local = store()
        local.record("alice", "waterLogs", date, water(3))
        local.record("alice", "weightEntries", date, JSONObject().put("date", date).put("weight", 72.5))
        local.record("alice", "foodDiary", "fixed-id", meal("fixed-id"))
        val restarted = store()
        assertEquals(DaySummary(78, 3, 72.5, true, 3, 0.4, 0.3, 20.0,
            meals = listOf(DiaryMeal("fixed-id", "Яблоко", "Перекус", 150.0, "г", 78.0, true))),
            restarted.summary("alice", date))
        assertEquals("fixed-id", restarted.changes("alice").single { it.collection == "foodDiary" }.id)
    }
    @Test fun accountAndGuestAreIsolated() {
        val local = store()
        local.record(null, "waterLogs", date, water(8))
        local.record("alice", "waterLogs", date, water(2))
        local.saveDraft("alice", "каша 200 граммов")
        assertEquals(0, local.summary("bob", date).waterGlasses)
        assertEquals("", local.draft("bob"))
        assertTrue(local.changes("bob").isEmpty())
        assertEquals(8, local.summary(null, date).waterGlasses)
        assertEquals(0, local.summary(null, date).pendingChanges)
    }
    @Test fun mealListMergesCloudAndPendingIsScopedAndOrdered() {
        val local = store()
        local.record("alice", "foodDiary", "pending", meal("pending"))
        local.cacheMeals("alice", date, mapOf(
            "breakfast" to meal("breakfast").put("title", "Каша").put("mealType", "Завтрак"),
            "pending" to meal("pending")), local.revision("alice"))
        val meals = store().summary("alice", date).meals
        assertEquals(listOf("breakfast", "pending"), meals.map { it.id })
        assertEquals("Каша", meals.first().title)
        assertFalse(meals.first().pending)
        assertTrue(meals.last().pending)
        assertTrue(local.summary("bob", date).meals.isEmpty())
        assertTrue(local.summary(null, date).meals.isEmpty())
        assertTrue(local.summary("alice", "2026-10-11").meals.isEmpty())
        local.acknowledge("alice", local.changes("alice").single())
        assertEquals(2, store().summary("alice", date).meals.size)
        assertFalse(store().summary("alice", date).meals.any { it.pending })
    }
    @Test fun mealListSupportsLegacyRecordsAndGuestRestart() {
        val local = store()
        local.record(null, "foodDiary", "guest", meal("guest"))
        assertEquals("Яблоко", store().summary(null, date).meals.single().title)
        assertFalse(store().summary(null, date).meals.single().pending)
        local.cacheMeals("alice", date, mapOf("legacy" to JSONObject().put("date", date).put("calories", 100)), 0)
        val legacy = store().summary("alice", date).meals.single()
        assertEquals("Блюдо", legacy.title)
        assertNull(legacy.portion)
        assertEquals(100.0, legacy.calories, 0.0)
    }
    @Test fun olderAckCannotEraseNewerWater() {
        val local = store()
        local.record("alice", "waterLogs", date, water(1))
        val older = local.changes("alice").single()
        local.record("alice", "waterLogs", date, water(4))
        local.acknowledge("alice", older)
        assertEquals(1, local.changes("alice").size)
        assertEquals(4, local.summary("alice", date).waterGlasses)
        local.acknowledge("alice", local.changes("alice").single())
        assertTrue(local.changes("alice").isEmpty())
    }
    @Test fun remoteOverlayNeverDuplicatesConfirmedFood() {
        val local = store()
        local.record("alice", "foodDiary", "same-id", meal("same-id"))
        local.cacheMeals("alice", date, mapOf("same-id" to meal("same-id")), local.revision("alice"))
        assertEquals(78, local.summary("alice", date).calories)
        local.acknowledge("alice", local.changes("alice").single())
        assertEquals(78, store().summary("alice", date).calories)
        assertEquals(0.4, store().summary("alice", date).protein, 0.0001)
        assertEquals(0.3, store().summary("alice", date).fat, 0.0001)
        assertEquals(20.0, store().summary("alice", date).carbs, 0.0001)
    }
    @Test fun dailyMacrosIncludeCloudAndPendingFoodWithoutDuplicateAndSurviveRestart() {
        val local = store()
        local.record("alice", "foodDiary", "pending", meal("pending"))
        val remote = meal("remote").put("protein", 10.2).put("fat", 4.5).put("carbs", 7.7)
        local.cacheMeals("alice", date, mapOf("remote" to remote, "pending" to meal("pending")), local.revision("alice"))
        val summary = store().summary("alice", date)
        assertEquals(10.6, summary.protein, 0.0001)
        assertEquals(4.8, summary.fat, 0.0001)
        assertEquals(27.7, summary.carbs, 0.0001)
        assertEquals(0.0, local.summary("alice", "2026-10-11").protein, 0.0)
        assertEquals(0.0, local.summary("bob", date).carbs, 0.0)
        assertEquals(0.0, local.summary(null, date).fat, 0.0)
    }
    @Test fun legacyMealsWithoutMacrosAndInvalidFieldsDoNotBreakTotals() {
        val legacy = JSONObject().put("date", date).put("calories", 100)
        val invalid = meal("invalid").put("protein", "NaN").put("fat", -5).put("carbs", "bad")
        store().cacheMeals("alice", date, mapOf("legacy" to legacy, "invalid" to invalid), 0)
        val summary = store().summary("alice", date)
        assertEquals(0.0, summary.protein, 0.0)
        assertEquals(0.0, summary.fat, 0.0)
        assertEquals(0.0, summary.carbs, 0.0)
        assertEquals(178, summary.calories)
    }
    @Test fun profileGoalSurvivesRestartIsUidScopedAndCanBeRemoved() {
        store().cacheCalorieGoal("alice", 1800.0)
        assertEquals(1800.0, store().summary("alice", date).calorieGoal!!, 0.0)
        assertNull(store().summary("bob", date).calorieGoal)
        assertNull(store().summary(null, date).calorieGoal)
        assertTrue(store().changes("alice").isEmpty())
        store().cacheCalorieGoal("alice", null)
        assertNull(store().summary("alice", date).calorieGoal)
    }
    @Test fun targetsMatchPhoneRulesAndRejectMissingOrInvalidGoal() {
        assertEquals(NutritionTargets(1800.0, 135, 60, 180), NutritionTargets.fromCalories(1800.0))
        assertEquals(14, NutritionTargets.fromCalories(180.0)!!.protein)
        listOf(null, 0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY, 100001.0).forEach {
            assertNull(NutritionTargets.fromCalories(it))
        }
    }
    @Test fun staleReadAndRemoteWaterCannotErasePendingEdits() {
        val local = store()
        val revision = local.revision("alice")
        local.record("alice", "waterLogs", date, water(5))
        local.record("alice", "foodDiary", "new", meal("new"))
        local.cacheMeals("alice", date, emptyMap(), revision)
        local.cacheWater("alice", date, 0, local.revision("alice"))
        assertEquals(78, local.summary("alice", date).calories)
        assertEquals(5, local.summary("alice", date).waterGlasses)
    }
    @Test fun draftDoesNotBecomeFoodAndSurvivesRestart() {
        store().saveDraft("alice", "яблоко 150 граммов")
        assertEquals("яблоко 150 граммов", store().draft("alice"))
        assertEquals(0, store().summary("alice", date).calories)
        assertTrue(store().changes("alice").isEmpty())
    }
    @Test fun midnightResetsWaterAndCaloriesButKeepsLatestWeight() {
        val local = store()
        local.record("alice", "waterLogs", date, water(3))
        local.record("alice", "foodDiary", "food", meal("food"))
        local.record("alice", "weightEntries", date, JSONObject().put("date", date).put("weight", 80.0))
        assertEquals(DaySummary(0, 0, 80.0, true, 3), local.summary("alice", "2026-10-11"))
    }
    @Test fun validEstimateAndStrictRejection() {
        assertTrue(MealEstimate.parse(meal("food")).valid())
        listOf("portion", "protein", "fat", "carbs", "calories").forEach { field ->
            val missing = meal("food").also { it.remove(field) }
            assertThrows(Exception::class.java) { MealEstimate.parse(missing) }
        }
        assertFalse(MealEstimate("Яблоко", 0.0, 10.0, 0.0, 0.0, 0.0).valid())
        assertFalse(MealEstimate("Яблоко", 100.0, Double.NaN, 0.0, 0.0, 0.0).valid())
        assertFalse(MealEstimate("Яблоко", 100.0, 10.0, -1.0, 0.0, 0.0).valid())
    }
    @Test fun aiParserRejectsMultipleProductsAndClarification() {
        val product = meal("food")
        assertEquals(78.0, FoodAi.parse(JSONObject().put("proposedProducts", org.json.JSONArray().put(product))).calories, 0.0)
        assertThrows(IllegalStateException::class.java) {
            FoodAi.parse(JSONObject().put("proposedProducts", org.json.JSONArray().put(product).put(product)))
        }
        val clarification = assertThrows(FoodClarification::class.java) {
            FoodAi.parse(JSONObject().put("advice", "Сколько граммов?").put("proposedProducts", org.json.JSONArray()))
        }
        assertEquals("Сколько граммов?", clarification.message)
    }
    @Test fun clarificationAnswerPreservesOriginalFoodAndQuestion() {
        val context = FoodAi.appendAnswer("", "На воде или молоке?", "На молоке")
        val request = FoodAi.requestMessage("Овсянка 200 граммов", context)
        assertTrue(request.contains("Овсянка 200 граммов"))
        assertTrue(request.contains("На воде или молоке?"))
        assertTrue(request.contains("На молоке"))
        assertTrue(store().changes("alice").isEmpty())
    }
    @Test fun repeatedClarificationsFitGatewayLimit() {
        var context = ""
        repeat(8) { context = FoodAi.appendAnswer(context, "в".repeat(200), "о".repeat(200)) }
        assertTrue(context.length <= 450)
        assertTrue(FoodAi.requestMessage("я".repeat(300), context).length <= 1000)
        assertTrue(context.endsWith("о".repeat(200)))
        assertThrows(IllegalArgumentException::class.java) { FoodAi.appendAnswer(context, "вопрос", " ") }
    }
    @Test fun clarificationDraftSurvivesRestartAndIsUidScoped() {
        val draft = FoodDraft("каша 200 г", "На чём сварена?", "На молоке", "Предыдущее уточнение")
        store().saveFoodForm("alice", draft)
        assertEquals(draft, store().foodForm("alice"))
        assertEquals(FoodDraft(), store().foodForm("bob"))
        assertEquals(FoodDraft(), store().foodForm(null))
        assertTrue(store().changes("alice").isEmpty())
        store().record("alice", "foodDiary", "food", meal("food"))
        assertEquals(FoodDraft(), store().foodForm("alice"))
    }
}
