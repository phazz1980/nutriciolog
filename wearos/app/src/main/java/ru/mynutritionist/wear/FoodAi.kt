package ru.mynutritionist.wear

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class FoodClarification(val question: String) : IllegalStateException(question)

/** Text-only call to the existing authenticated gateway. Never stores audio/tokens. */
object FoodAi {
    fun appendAnswer(context: String, question: String, answer: String): String {
        require(answer.isNotBlank() && answer.length <= 200)
        return (context + "\nВопрос: ${question.take(200)}\nОтвет: ${answer.trim()}").takeLast(450)
    }
    fun requestMessage(text: String, context: String): String {
        require(text.isNotBlank() && text.length <= 300 && context.length <= 450)
        return "Оцени блюдо «${text.trim()}» с учётом уточнений ниже. Верни один продукт для всей порции: " +
            "title, portion (г), calories, protein, fat, carbs. Если данных мало — пустой список и вопрос в advice. " +
            "Без количества оцени типичную порцию.\n$context"
    }
    suspend fun estimate(text: String, token: String, context: String = ""): MealEstimate = withContext(Dispatchers.IO) {
        val message = requestMessage(text, context)
        val bodyToSend = JSONObject().put("message", message).toString().toByteArray(Charsets.UTF_8)
        val reply = AiTransport.request { endpoint, authHeader ->
        coroutineContext.ensureActive()
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 10000
            connection.readTimeout = 50000
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty(authHeader, "Bearer $token")
            connection.outputStream.use { it.write(bodyToSend) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            AiTransport.Reply(status, body)
        } finally { connection.disconnect() }
        }
            if (reply.status !in 200..299) error(when (reply.status) {
                401, 403 -> "Не удалось подтвердить вход для ИИ."
                429 -> "Лимит ИИ исчерпан. Попробуйте позже."
                else -> "ИИ временно недоступен. Черновик сохранён."
            })
            val data = runCatching { JSONObject(reply.body) }.getOrElse { error("Сервис вернул неполный ответ. Повторите позже.") }
            parse(data)
    }
    fun parse(data: JSONObject): MealEstimate {
        val products = data.optJSONArray("proposedProducts")
        if (products != null && products.length() > 1) error("Назовите один продукт или одно блюдо за раз.")
        val meal = if (products?.length() == 1) products.getJSONObject(0) else data.optJSONObject("proposedMeal")
        if (meal == null) {
            val question = data.optString("advice", "").trim()
            if (question.isNotBlank()) throw FoodClarification(question.take(200))
            error("ИИ не вернул расчёт. Уточните продукт и количество.")
        }
        return MealEstimate.parse(meal)
    }
}
