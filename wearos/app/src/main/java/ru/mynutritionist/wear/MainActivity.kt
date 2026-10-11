package ru.mynutritionist.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.background
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
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.style.TextOverflow
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Scaffold
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        var repository by mutableStateOf<NutritionRepository?>(null)
        setContent {
            repository?.let { WearApp(it) } ?: MaterialTheme {
                Scaffold(timeText = { TimeText() }) {
                    Column(Modifier.fillMaxWidth().padding(top = 70.dp), horizontalAlignment = Alignment.CenterHorizontally) { Text("Загрузка…") }
                }
            }
        }
        lifecycleScope.launch { repository = withContext(Dispatchers.IO) { NutritionRepository(applicationContext) } }
    }
}

private enum class Screen { HOME, NUTRITION, MEALS, WATER, WEIGHT, FOOD, ACCOUNT, PHONE_SIGN_IN }

@Composable
private fun WearApp(repository: NutritionRepository) {
    var screen by remember { mutableStateOf(Screen.HOME) }
    var summary by remember { mutableStateOf(repository.initialSummary) }
    var foodDraft by remember { mutableStateOf(FoodDraft()) }
    var status by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    var savingWater by remember { mutableStateOf(false) }
    var savingWeight by remember { mutableStateOf(false) }
    var weightError by remember { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(false) }
    var syncRejected by remember { mutableStateOf(repository.syncRejected) }

    fun refresh() = scope.launch {
        summary = repository.cachedToday()
        if (refreshing) return@launch
        refreshing = true
        try { summary = repository.loadToday(); status = "" }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { status = "Показаны данные с часов" }
        finally { refreshing = false; syncRejected = repository.syncRejected }
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
            catch (_: Exception) { summary = repository.cachedToday(); status = "Не удалось сохранить воду на часах" }
            finally { savingWater = false }
        }
    }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { refresh() }
    LaunchedEffect(repository) { repository.updates.collect {
        val updated = repository.cachedToday()
        syncRejected = repository.syncRejected
        if (summary.pendingChanges > 0 && updated.pendingChanges == 0 && updated.signedIn) status = "Синхронизировано"
        summary = updated
    } }

    BackHandler(enabled = screen != Screen.HOME) { screen = Screen.HOME }

    Scaffold(timeText = { TimeText() }) {
        MaterialTheme {
            when (screen) {
                Screen.HOME -> Home(summary, status, repository.isConfigured, syncRejected, { screen = Screen.NUTRITION; refresh() }, { screen = Screen.MEALS; refresh() }, { screen = Screen.WATER }, { screen = Screen.WEIGHT }, { scope.launch { foodDraft = repository.foodForm(); screen = Screen.FOOD } }, { screen = Screen.ACCOUNT })
                Screen.NUTRITION -> NutritionScreen(summary, refreshing, ::refresh) { screen = Screen.HOME }
                Screen.MEALS -> MealsScreen(summary, refreshing, ::refresh) { screen = Screen.HOME }
                Screen.FOOD -> FoodScreen(repository, foodDraft, { screen = Screen.HOME }) {
                    scope.launch {
                        summary = repository.cachedToday()
                        status = "Еда сохранена на часах"
                        screen = Screen.HOME
                    }
                }
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
                            status = if (synced) "Вес синхронизирован" else if (repository.isSignedIn) "Вес сохранён на часах, ожидает сети" else "Вес сохранён на часах"
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
private fun Home(summary: DaySummary, status: String, configured: Boolean, syncRejected: Boolean, openNutrition: () -> Unit, openMeals: () -> Unit, openWater: () -> Unit, openWeight: () -> Unit, openFood: () -> Unit, openAccount: () -> Unit) {
    val listState = rememberLazyListState()
    Scaffold(positionIndicator = { PositionIndicator(lazyListState = listState) }) {
    LazyColumn(state = listState, contentPadding = PaddingValues(top = 38.dp, bottom = 54.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(horizontal = 18.dp)) {
        item { Text("Сегодня", style = MaterialTheme.typography.title2, color = WearText) }
        item { Card(onClick = openNutrition, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${summary.calories} ккал", style = MaterialTheme.typography.title2, color = WearText,
                    modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                val protein = macroGrams(summary.protein)
                val fat = macroGrams(summary.fat)
                val carbs = macroGrams(summary.carbs)
                Text("Б $protein · Ж $fat · У $carbs г", style = MaterialTheme.typography.caption2,
                    fontSize = 10.sp, color = WearText, maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Белки: $protein граммов, жиры: $fat граммов, углеводы: $carbs граммов" })
            }
        } }
        item { Chip(label = { Text("Добавить еду") }, onClick = openFood, modifier = Modifier.fillMaxWidth()) }
        item { Chip(label = { Text("Съеденные блюда") }, onClick = openMeals, modifier = Modifier.fillMaxWidth()) }
        item { Chip(label = { Text("Вода: ${summary.waterGlasses} / 8") }, onClick = openWater, modifier = Modifier.fillMaxWidth()) }
        item { Chip(label = { Text("Вес: ${summary.weight?.let { "$it кг" } ?: "—"}") }, onClick = openWeight, modifier = Modifier.fillMaxWidth()) }
        item { Chip(label = { Text(if (summary.signedIn) "Аккаунт подключён" else if (configured) "Войти в аккаунт" else "Настроить Firebase", color = WearText) }, onClick = openAccount, modifier = Modifier.fillMaxWidth()) }
        if (status.isNotBlank()) item { Text(status, style = MaterialTheme.typography.caption1, color = WearText) }
        if (summary.pendingChanges > 0) item { Text(if (syncRejected) "Firebase отклонил отправку. На часах: ${summary.pendingChanges}. Нажмите калории для повтора." else "Ожидают отправки: ${summary.pendingChanges}", style = MaterialTheme.typography.caption1, color = WearText) }
    }
    }
}

private fun macroGrams(grams: Double) = String.format(Locale.forLanguageTag("ru"), "%.1f", grams).removeSuffix(",0")

@Composable
private fun MealsScreen(summary: DaySummary, refreshing: Boolean, refresh: () -> Unit, close: () -> Unit) {
    val listState = rememberLazyListState()
    Scaffold(positionIndicator = { PositionIndicator(lazyListState = listState) }) {
        LazyColumn(state = listState, contentPadding = PaddingValues(top = 38.dp, bottom = 54.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(horizontal = 22.dp)) {
            item { Text("Съедено сегодня", style = MaterialTheme.typography.title3, textAlign = TextAlign.Center) }
            if (summary.meals.isEmpty()) item {
                Text(if (refreshing) "Загружаем дневник…" else "На часах пока нет блюд за сегодня.",
                    style = MaterialTheme.typography.body2, textAlign = TextAlign.Center)
            }
            items(summary.meals, key = { it.id }) { meal ->
                Column(Modifier.fillMaxWidth().background(Color(0xFF252932), RoundedCornerShape(16.dp)).padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (meal.mealType.isNotBlank()) Text(meal.mealType, style = MaterialTheme.typography.caption2)
                    Text(meal.title, style = MaterialTheme.typography.body2, color = WearText)
                    meal.portion?.let { Text("${macroGrams(it)} ${meal.portionUnit}", style = MaterialTheme.typography.caption2) }
                    Text("${macroGrams(meal.calories)} ккал", style = MaterialTheme.typography.caption1,
                        maxLines = 1, softWrap = false)
                    if (meal.pending) Text("Ожидает отправки", style = MaterialTheme.typography.caption2)
                }
            }
            item { Chip(label = { Text(if (refreshing) "Обновляем…" else "Обновить") }, enabled = !refreshing,
                onClick = refresh, modifier = Modifier.fillMaxWidth()) }
            item { Button(onClick = close, modifier = Modifier.size(48.dp).semantics { contentDescription = "Назад" }) {
                Text("×", style = MaterialTheme.typography.title1)
            } }
        }
    }
}

@Composable
private fun NutritionScreen(summary: DaySummary, refreshing: Boolean, refresh: () -> Unit, close: () -> Unit) {
    val targets = NutritionTargets.fromCalories(summary.calorieGoal)
    val listState = rememberLazyListState()
    Scaffold(positionIndicator = { PositionIndicator(lazyListState = listState) }) {
        LazyColumn(state = listState, contentPadding = PaddingValues(top = 38.dp, bottom = 54.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(horizontal = 22.dp)) {
            item { Text("Питание сегодня", style = MaterialTheme.typography.title3, textAlign = TextAlign.Center) }
            item { Text("Съедено / цель", style = MaterialTheme.typography.caption1) }
            item { NutritionDetail("Калории", summary.calories.toDouble(), targets?.calories, "ккал") }
            item { NutritionDetail("Белки", summary.protein, targets?.protein?.toDouble(), "г") }
            item { NutritionDetail("Жиры", summary.fat, targets?.fat?.toDouble(), "г") }
            item { NutritionDetail("Углеводы", summary.carbs, targets?.carbs?.toDouble(), "г") }
            if (targets == null) item { Text(if (refreshing) "Загружаем цель…" else "Цель не загружена. Укажите её в профиле на телефоне и обновите.", style = MaterialTheme.typography.caption1, textAlign = TextAlign.Center) }
            else item {
                val difference = targets.calories - summary.calories
                Text(if (difference >= 0) "Осталось ${macroGrams(difference)} ккал" else "Сверх цели ${macroGrams(-difference)} ккал", style = MaterialTheme.typography.caption1, textAlign = TextAlign.Center)
            }
            item { Chip(label = { Text(if (refreshing) "Обновляем…" else "Обновить") }, enabled = !refreshing, onClick = refresh, modifier = Modifier.fillMaxWidth()) }
            item { Button(onClick = close, modifier = Modifier.size(48.dp).semantics { contentDescription = "Назад" }) { Text("×", style = MaterialTheme.typography.title1) } }
        }
    }
}

@Composable
private fun NutritionDetail(label: String, current: Double, target: Double?, unit: String) {
    val progress = if (target != null && target > 0) (current / target).coerceIn(0.0, 1.0).toFloat() else 0f
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(label, style = MaterialTheme.typography.caption1)
        Text("${macroGrams(current)} / ${target?.let(::macroGrams) ?: "—"} $unit", style = MaterialTheme.typography.body2, textAlign = TextAlign.Center)
        Box(Modifier.fillMaxWidth().height(3.dp).background(Color(0xFF353944), RoundedCornerShape(2.dp))
            .semantics { progressBarRangeInfo = ProgressBarRangeInfo(progress, 0f..1f) }) {
            if (progress > 0) Box(Modifier.fillMaxWidth(progress).height(3.dp).background(MaterialTheme.colors.primary, RoundedCornerShape(2.dp)))
        }
    }
}

@Composable
private fun WeightScreen(currentWeight: Double?, signedIn: Boolean, saving: Boolean, error: String, close: () -> Unit, save: (Double) -> Unit) {
    var value by remember(currentWeight) { mutableStateOf(currentWeight?.toString().orEmpty()) }
    val parsed = value.replace(',', '.').toDoubleOrNull()
    BoxWithConstraints(Modifier.fillMaxSize()) {
    LazyColumn(contentPadding = PaddingValues(top = ((maxHeight - 48.dp) / 2).coerceAtLeast(38.dp), bottom = 36.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 18.dp)) {
        item {
        Row(modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Вес", style = MaterialTheme.typography.body1)
            BasicTextField(value = value, onValueChange = { if (it.length <= 7 && it.all { char -> char.isDigit() || char == '.' || char == ',' }) value = it },
                singleLine = true, textStyle = TextStyle(color = WearText, fontSize = MaterialTheme.typography.body1.fontSize, textAlign = TextAlign.Center),
                cursorBrush = SolidColor(WearText), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.weight(1f).border(1.dp, Color.Gray, RoundedCornerShape(12.dp)).padding(12.dp).semantics { contentDescription = "Вес в килограммах" })
            Text("кг", style = MaterialTheme.typography.caption1)
        }
        }
        item { SaveCancelRow(!saving && parsed != null && parsed in 20.0..500.0 && parsed != currentWeight, { parsed?.let(save) }, close) }
        if (saving) item { Text("Сохраняем…", style = MaterialTheme.typography.caption1) }
        if (error.isNotBlank()) item { Text(error, style = MaterialTheme.typography.caption1) }
        if (!signedIn) item { Text("Без входа — только на часах", style = MaterialTheme.typography.caption1) }
    }
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
        item { SaveCancelRow(!saving && draft != current, { save(draft) }, close) }
    }
}

@Composable
private fun SaveCancelRow(canSave: Boolean, save: () -> Unit, close: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        Button(onClick = save, enabled = canSave, modifier = Modifier.size(48.dp).semantics { contentDescription = "Сохранить" }) { Text("✓", style = MaterialTheme.typography.title1) }
        Button(onClick = close, modifier = Modifier.size(48.dp).semantics { contentDescription = "Назад без сохранения" }) { Text("×", style = MaterialTheme.typography.title1) }
    }
}

@Composable
private fun AccountScreen(repository: NutritionRepository, close: () -> Unit, phoneSignIn: () -> Unit, signedIn: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var message by remember { mutableStateOf(if (repository.isConfigured) "Вход по email и паролю" else repository.configurationMessage) }
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
            item { Text(current.code.chunked(4).joinToString("-"), style = MaterialTheme.typography.title1) }
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
