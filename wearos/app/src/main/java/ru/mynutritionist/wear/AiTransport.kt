package ru.mynutritionist.wear

import java.io.IOException

/** One retry; no tokens, payloads or server selection are persisted or displayed. */
object AiTransport {
    val endpoints = listOf(
        "https://functions.yandexcloud.net/d4evergfv4q48plpsdbu",
        "https://my-nutritionist-advice.340052.workers.dev",
    )
    data class Reply(val status: Int, val body: String)
    fun request(send: (String, String) -> Reply): Reply {
        for ((index, endpoint) in endpoints.withIndex()) {
            try {
                val reply = send(endpoint, if (index == 0) "X-X20-Authorization" else "Authorization")
                if (index == 1 || reply.status !in 500..599) return reply
            } catch (error: IOException) {
                if (index == 1) throw error
            }
        }
        error("ИИ временно недоступен.")
    }
}
