package ru.mynutritionist.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.border
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.wear.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Scaffold
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repository = NutritionRepository(applicationContext)
        setContent { WearApp(repository) }
    }
}

private enum class Screen { HOME, WATER, WEIGHT, ACCOUNT, PHONE_SIGN_IN }

@Composable
private fun WearApp(repository: NutritionRepository) {
    var screen by remember { mutableStateOf(Screen.HOME) }
    var summary by remember { mutableStateOf(DaySummary(signedIn = repository.isSignedIn)) }
    var status by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    var savingWater by remember { mutableStateOf(false) }
    var savingWeight by remember { mutableStateOf(false) }
    var weightError by remember { mutableStateOf("") }

    fun refresh() = scope.launch {
        status = "Обновляем…"
        runCatching { repository.loadToday() }
            .onSuccess { summary = it; status = "" }
            .onFailure { status = "Не удалось синхронизировать" }
    }
    fun changeWater(delta: Int) {
        if (savingWater) return
        val water = (summary.waterGlasses + delta).coerceIn(0, 8)
        summary = summary.copy(waterGlasses = water)
        savingWater = true
        scope.launch {
            try {
                val synced = repository.setWater(water)
                status = if (synced) "Синхронизировано" else if (repository.isSignedIn) "Сохранено на часах, ожидает сети" else "Сохранено на часах"
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) { status = "Вода сохранена только на часах" }
            finally { savingWater = false }
        }
    }

    LaunchedEffect(Unit) { refresh() }

    BackHandler(enabled = screen != Screen.HOME) { screen = Screen.HOME }

    Scaffold(timeText = { TimeText() }) {
        MaterialTheme {
            when (screen) {
                Screen.HOME -> Home(summary, status, repository.isConfigured, ::refresh, { screen = Screen.WATER }, { screen = Screen.WEIGHT }, { screen = Screen.ACCOUNT })
                Screen.WATER -> WaterScreen(summary.waterGlasses, savingWater, { screen = Screen.HOME }) { desired ->
                    changeWater(desired - summary.waterGlasses)
                    screen = Screen.HOME
                }
                Screen.WEIGHT -> WeightScreen(summary.weight, summary.signedIn, savingWeight, weightError, { screen = Screen.HOME }) { value ->
                    savingWeight = true
                    weightError = ""
                    scope.launch {
                        try {
                            val synced = repository.setWeight(value)
                            summary = summary.copy(weight = value)
                            status = if (synced) "Вес синхронизирован" else "Вес сохранён на часах, ожидает сети"
                            screen = Screen.HOME
                        } catch (error: CancellationException) { throw error }
                        catch (_: Exception) { weightError = "Не удалось сохранить вес" }
                        finally { savingWeight = false }
                    }
                }
                Screen.ACCOUNT -> AccountScreen(repository, { refresh(); screen = Screen.HOME }, { screen = Screen.PHONE_SIGN_IN }) {
                    refresh(); screen = Screen.HOME
                }
                Screen.PHONE_SIGN_IN -> PhoneSignInScreen(repository, { current ->
                    if (current != null) scope.launch {
                        try { PhoneSignIn.cancel(current) } catch (error: CancellationException) { throw error } catch (_: Exception) {}
                    }
                    screen = Screen.ACCOUNT
                }) {
                    refresh(); screen = Screen.HOME
                }
            }
        }
    }
}

@Composable
private fun Home(summary: DaySummary, status: String, configured: Boolean, refresh: () -> Unit, openWater: () -> Unit, openWeight: () -> Unit, openAccount: () -> Unit) {
    val listState = rememberScalingLazyListState()
    Scaffold(positionIndicator = { PositionIndicator(scalingLazyListState = listState) }) {
    ScalingLazyColumn(state = listState, verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(horizontal = 10.dp)) {
        item { Text("Сегодня", style = MaterialTheme.typography.title2, color = WearText) }
        item { Card(onClick = refresh, modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) { Text("${summary.calories} ккал", style = MaterialTheme.typography.title2, color = WearText); Text(if (summary.signedIn) "Данные из дневника" else "Войдите для синхронизации", color = WearText) } } }
        item { Chip(label = { Text("Вода: ${summary.waterGlasses} / 8") }, onClick = openWater, modifier = Modifier.fillMaxWidth()) }
        item { Chip(label = { Text("Вес: ${summary.weight?.let { "$it кг" } ?: "—"}") }, onClick = openWeight, modifier = Modifier.fillMaxWidth()) }
        item { Chip(label = { Text(if (summary.signedIn) "Аккаунт подключён" else if (configured) "Войти в аккаунт" else "Настроить Firebase", color = WearText) }, onClick = openAccount, modifier = Modifier.fillMaxWidth()) }
        if (status.isNotBlank()) item { Text(status, style = MaterialTheme.typography.caption1, color = WearText) }
    }
    }
}

@Composable
private fun WeightScreen(currentWeight: Double?, signedIn: Boolean, saving: Boolean, error: String, close: () -> Unit, save: (Double) -> Unit) {
    var value by remember(currentWeight) { mutableStateOf(currentWeight?.toString().orEmpty()) }
    val parsed = value.replace(',', '.').toDoubleOrNull()
    ScalingLazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 10.dp)) {
        item {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Вес", style = MaterialTheme.typography.body1)
            BasicTextField(value = value, onValueChange = { if (it.length <= 7 && it.all { char -> char.isDigit() || char == '.' || char == ',' }) value = it },
                singleLine = true, textStyle = TextStyle(color = WearText, fontSize = MaterialTheme.typography.body1.fontSize),
                cursorBrush = SolidColor(WearText), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.weight(1f).border(1.dp, Color.Gray, RoundedCornerShape(12.dp)).padding(12.dp).semantics { contentDescription = "Вес в килограммах" })
            Text("кг", style = MaterialTheme.typography.caption1)
        }
        }
        item { Chip(label = { Text("Сохранить вес") }, onClick = { parsed?.let(save) },
            enabled = !saving && signedIn && parsed != null && parsed in 20.0..500.0 && parsed != currentWeight, modifier = Modifier.fillMaxWidth()) }
        if (saving) item { Text("Сохраняем…", style = MaterialTheme.typography.caption1) }
        if (error.isNotBlank()) item { Text(error, style = MaterialTheme.typography.caption1) }
        if (!signedIn) item { Text("Войдите для записи веса", style = MaterialTheme.typography.caption1) }
        item { Chip(label = { Text("Назад") }, onClick = close, modifier = Modifier.fillMaxWidth()) }
    }
}

@Composable
private fun WaterScreen(current: Int, saving: Boolean, close: () -> Unit, save: (Int) -> Unit) {
    var draft by remember { mutableStateOf(current) }
    ScalingLazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 10.dp)) {
        item { Text("Вода", style = MaterialTheme.typography.title2) }
        item {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Button(onClick = { draft-- }, enabled = draft > 0,
                    modifier = Modifier.size(48.dp).semantics { contentDescription = "Убрать стакан воды" }) { Text("−", style = MaterialTheme.typography.title1) }
                Text("$draft / 8", style = MaterialTheme.typography.title1, textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f).semantics { contentDescription = "$draft из 8 стаканов воды" })
                Button(onClick = { draft++ }, enabled = draft < 8,
                    modifier = Modifier.size(48.dp).semantics { contentDescription = "Добавить стакан воды" }) { Text("+", style = MaterialTheme.typography.title1) }
            }
        }
        item { Chip(label = { Text("Сохранить") }, enabled = !saving && draft != current, onClick = { save(draft) }, modifier = Modifier.fillMaxWidth()) }
        item { Chip(label = { Text("Отмена") }, onClick = close, modifier = Modifier.fillMaxWidth()) }
    }
}

@Composable
private fun AccountScreen(repository: NutritionRepository, close: () -> Unit, phoneSignIn: () -> Unit, signedIn: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var message by remember { mutableStateOf(if (repository.isConfigured) "Вход по email и паролю" else "Добавьте firebase.properties при сборке") }
    val scope = rememberCoroutineScope()
    ScalingLazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 10.dp)) {
        item { Text("Аккаунт", style = MaterialTheme.typography.title2, color = WearText) }
        if (repository.isSignedIn) {
            item { Text("Синхронизация активна", color = WearText) }
            item { Chip(label = { Text("Выйти") }, onClick = { repository.signOut(); close() }, modifier = Modifier.fillMaxWidth()) }
        } else if (repository.isConfigured) {
            item { Chip(label = { Text("Войти с телефона") }, onClick = phoneSignIn, modifier = Modifier.fillMaxWidth()) }
            item { OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, singleLine = true, colors = wearTextFieldColors(), keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth()) }
            item { OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("Пароль") }, singleLine = true, colors = wearTextFieldColors(), visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth()) }
            item { Button(onClick = { scope.launch { runCatching { repository.signIn(email, password) }.onSuccess { signedIn() }.onFailure { message = signInErrorMessage(it) } } }, modifier = Modifier.fillMaxWidth()) { Text("Войти") } }
        }
        item { Text(message, style = MaterialTheme.typography.caption1, color = WearText) }
        item { Chip(label = { Text("Назад") }, onClick = close, modifier = Modifier.fillMaxWidth()) }
    }
}

@Composable
private fun PhoneSignInScreen(repository: NutritionRepository, close: (WatchPairing?) -> Unit, signedIn: () -> Unit) {
    var pairing by remember { mutableStateOf<WatchPairing?>(null) }
    var message by remember { mutableStateOf("Получаем код…") }
    var retry by remember { mutableStateOf(0) }
    var failed by remember { mutableStateOf(false) }
    fun cancel() {
        close(pairing)
    }
    BackHandler { cancel() }
    LaunchedEffect(retry) {
        failed = false
        pairing = null
        if (!PhoneSignIn.configured) {
            message = "Вход с телефона ещё не подключён."
            failed = true
            return@LaunchedEffect
        }
        try {
            val current = PhoneSignIn.start()
            pairing = current
            message = "На телефоне откройте «Мой нутрициолог» → Профиль → Подключить часы. Введите этот код и подтвердите."
            while (true) {
                delay(3000)
                val token = PhoneSignIn.poll(current)
                if (token != null) {
                    repository.signInWithDeviceToken(token)
                    signedIn()
                    break
                }
            }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            failed = true
            message = when ((error as? PairingException)?.code) {
                "expired", "closed" -> "Код истёк или использован. Получите новый."
                "rate_limited", "slow_down" -> "Подождите минуту и повторите."
                else -> "Не удалось завершить вход. Проверьте сеть и повторите."
            }
        }
    }
    ScalingLazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 10.dp)) {
        item { Text("Вход с телефона", style = MaterialTheme.typography.title2) }
        pairing?.let { current ->
            item { Text(current.code.chunked(5).joinToString("-"), style = MaterialTheme.typography.title1) }
            item { Text("Код действует 5 минут", style = MaterialTheme.typography.caption1) }
        }
        item { Text(message, style = MaterialTheme.typography.body2) }
        if (failed && PhoneSignIn.configured) item { Chip(label = { Text("Новый код") }, onClick = { retry++ }, modifier = Modifier.fillMaxWidth()) }
        item { Chip(label = { Text("Отмена") }, onClick = { cancel() }, modifier = Modifier.fillMaxWidth()) }
    }
}

private val WearText = Color(0xFFF4F4F4)

@Composable
private fun wearTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = WearText,
    unfocusedTextColor = WearText,
    focusedLabelColor = WearText,
    unfocusedLabelColor = WearText,
    cursorColor = WearText,
)

private fun signInErrorMessage(error: Throwable): String {
    val detail = error.message.orEmpty().uppercase()
    return when {
        "INVALID_LOGIN_CREDENTIALS" in detail || "WRONG_PASSWORD" in detail || "USER_NOT_FOUND" in detail -> "Неверный email или пароль."
        "OPERATION_NOT_ALLOWED" in detail -> "В Firebase включите Email/Password."
        "NETWORK" in detail -> "Нет соединения с Firebase."
        "API_KEY" in detail || "APP_NOT_AUTHORIZED" in detail -> "Проверьте firebase.properties."
        else -> "Firebase отклонил вход. Проверьте email и пароль."
    }
}
