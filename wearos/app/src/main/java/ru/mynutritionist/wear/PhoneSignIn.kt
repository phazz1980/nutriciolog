package ru.mynutritionist.wear

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class WatchPairing(val code: String, val secret: String, val expiresAt: Long, val verificationUrl: String)
class PairingException(val code: String) : Exception(code)

object PhoneSignIn {
    val configured: Boolean get() = BuildConfig.WEAR_AUTH_ENDPOINT.startsWith("https://")

    private suspend fun request(action: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        check(configured) { "Вход с телефона ещё не подключён." }
        val connection = URL(BuildConfig.WEAR_AUTH_ENDPOINT.trimEnd('/') + "/" + action).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val success = connection.responseCode in 200..299
            val stream = if (success) connection.inputStream else connection.errorStream
            val result = stream?.bufferedReader(Charsets.UTF_8)?.use { JSONObject(it.readText()) } ?: JSONObject()
            if (!success) throw PairingException(result.optString("error", "service_unavailable"))
            result
        } finally { connection.disconnect() }
    }

    suspend fun start(): WatchPairing {
        val result = request("start", JSONObject())
        return WatchPairing(result.getString("code"), result.getString("deviceSecret"), result.getLong("expiresAt"), result.getString("verificationUrl"))
    }

    suspend fun poll(pairing: WatchPairing): String? {
        val result = request("poll", credentials(pairing))
        return if (result.getString("status") == "approved") result.getString("customToken") else null
    }

    suspend fun cancel(pairing: WatchPairing) { request("cancel", credentials(pairing)) }
    private fun credentials(pairing: WatchPairing) = JSONObject().put("code", pairing.code).put("deviceSecret", pairing.secret)
}
