package ru.mynutritionist.wear

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class AiTransportTest {
    @Test fun successAndClientErrorsDoNotRetry() {
        for (status in listOf(200, 302, 400, 401, 403, 429)) {
            var calls = 0
            val reply = AiTransport.request { url, header ->
                calls++
                assertEquals(AiTransport.endpoints[0], url)
                assertEquals("X-X20-Authorization", header)
                AiTransport.Reply(status, "body")
            }
            assertEquals(status, reply.status)
            assertEquals(1, calls)
        }
    }
    @Test fun serverAndNetworkErrorsRetryOnlyOnce() {
        for (network in listOf(true, false)) {
            var calls = 0
            val reply = AiTransport.request { url, header ->
                calls++
                if (calls == 1) {
                    if (network) throw IOException("test only")
                    AiTransport.Reply(503, "unavailable")
                } else {
                    assertEquals(AiTransport.endpoints[1], url)
                    assertEquals("Authorization", header)
                    AiTransport.Reply(200, "reserve")
                }
            }
            assertEquals("reserve", reply.body)
            assertEquals(2, calls)
        }
    }
    @Test fun doubleOutageAndCancellationNeverLoop() {
        var calls = 0
        try {
            AiTransport.request { _, _ -> calls++; throw IOException("test only") }
            fail("must fail")
        } catch (_: IOException) { assertEquals(2, calls) }
        calls = 0
        try {
            AiTransport.request { _, _ -> calls++; throw java.util.concurrent.CancellationException() }
            fail("must cancel")
        } catch (_: java.util.concurrent.CancellationException) { assertEquals(1, calls) }
    }
}
