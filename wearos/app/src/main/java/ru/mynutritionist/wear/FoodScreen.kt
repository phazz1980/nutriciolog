package ru.mynutritionist.wear

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun FoodScreen(repository: NutritionRepository, initial: FoodDraft, close: () -> Unit, saved: () -> Unit) {
    val owner = remember { repository.currentUid }
    var text by remember { mutableStateOf(initial.text) }
    var question by remember { mutableStateOf(initial.question) }
    var answer by remember { mutableStateOf(initial.answer) }
    var context by remember { mutableStateOf(initial.context) }
    var voiceForAnswer by remember { mutableStateOf(false) }
    var estimate by remember { mutableStateOf<MealEstimate?>(null) }
    var mealType by remember { mutableStateOf("Перекус") }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun leave() { scope.launch {
        try { repository.saveFoodForm(owner, FoodDraft(text, question, answer, context)); close() }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { message = "Не удалось сохранить черновик на часах." }
    } }
    BackHandler { leave() }
    fun replaceText(value: String) { text = value.take(300); estimate = null; message = ""; question = ""; answer = ""; context = "" }
    val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let {
                if (voiceForAnswer) answer = it.take(200) else replaceText(it)
            }
        }
    }
    fun dictate(forAnswer: Boolean) {
        voiceForAnswer = forAnswer
        try {
            voice.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
                putExtra(RecognizerIntent.EXTRA_PROMPT, if (forAnswer) question else "Продукт и порция: яблоко 150 граммов")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            })
        } catch (_: ActivityNotFoundException) { message = "Диктовка недоступна. Введите текст клавиатурой." }
        catch (_: SecurityException) { message = "Система не разрешила диктовку. Используйте клавиатуру." }
    }
    LaunchedEffect(text, question, answer, context) { delay(300); repository.saveFoodForm(owner, FoodDraft(text, question, answer, context)) }
    val listState = rememberScalingLazyListState()
    LaunchedEffect(question) { if (question.isNotBlank()) listState.animateScrollToItem(4) }
    val white = Color(0xFFF4F4F4)
    ScalingLazyColumn(state = listState, verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 10.dp)) {
        item { Text("Добавить еду", style = MaterialTheme.typography.title2) }
        item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedTextField(value = text, onValueChange = ::replaceText, enabled = !busy,
            modifier = Modifier.weight(1f).semantics { contentDescription = "Продукт и порция" },
            colors = OutlinedTextFieldDefaults.colors(focusedTextColor = white, unfocusedTextColor = white,
                focusedLabelColor = white, unfocusedLabelColor = white, cursorColor = white))
            Button(enabled = !busy, modifier = Modifier.size(48.dp), onClick = { dictate(false) }) {
                Image(painterResource(R.drawable.ic_microphone), contentDescription = "Продиктовать продукт",
                    modifier = Modifier.size(24.dp), colorFilter = ColorFilter.tint(if (busy) MaterialTheme.colors.onSurface.copy(alpha = 0.38f) else MaterialTheme.colors.onPrimary))
            }
        } }
        if (question.isNotBlank()) {
            item { Text("Уточнение", style = MaterialTheme.typography.title3) }
            item { Text(question) }
            item { OutlinedTextField(value = answer, onValueChange = { answer = it.take(200) }, enabled = !busy,
                label = { Text("Ваш ответ") }, modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(focusedTextColor = white, unfocusedTextColor = white,
                    focusedLabelColor = white, unfocusedLabelColor = white, cursorColor = white)) }
            item { Chip(label = { Text("Ответить голосом") }, enabled = !busy, onClick = { dictate(true) }, modifier = Modifier.fillMaxWidth()) }
        }
        item { Chip(label = { Text("Рассчитать") },
            enabled = !busy && text.isNotBlank() && owner != null && (question.isBlank() || answer.isNotBlank()),
            modifier = Modifier.fillMaxWidth(), onClick = {
                busy = true; message = "Рассчитываем…"; estimate = null
                scope.launch {
                    try {
                        check(repository.currentUid == owner) { "Аккаунт изменился. Откройте форму заново." }
                        repository.saveFoodForm(owner, FoodDraft(text, question, answer, context))
                        val requestContext = if (question.isBlank()) context else FoodAi.appendAnswer(context, question, answer)
                        try {
                            estimate = repository.estimateFood(text, requestContext)
                            context = requestContext; question = ""; answer = ""
                        } catch (clarification: FoodClarification) {
                            context = requestContext; question = clarification.question; answer = ""; message = ""
                            repository.saveFoodForm(owner, FoodDraft(text, question, answer, context))
                            return@launch
                        }
                        message = "Оценка ИИ. Проверьте порцию и БЖУ перед добавлением."
                    } catch (error: CancellationException) { throw error }
                    catch (error: Exception) { message = error.message ?: "Нет сети. Черновик сохранён на часах." }
                    finally { busy = false }
                }
            }) }
        estimate?.let { meal ->
            item { Text(meal.title, style = MaterialTheme.typography.title3) }
            item { Text("${number(meal.portion)} г · ${number(meal.calories)} ккал") }
            item { Text("Б ${number(meal.protein)} · Ж ${number(meal.fat)} · У ${number(meal.carbs)}", style = MaterialTheme.typography.caption1) }
            item { Chip(label = { Text(mealType) }, enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = {
                val types = listOf("Завтрак", "Обед", "Ужин", "Перекус")
                mealType = types[(types.indexOf(mealType) + 1) % types.size]
            }) }
            item { Text("Дата записи: сегодня", style = MaterialTheme.typography.caption1) }
            item { Chip(label = { Text("Добавить в дневник") }, enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = {
                busy = true
                scope.launch {
                    try { repository.addFood(owner, meal, mealType); saved() }
                    catch (error: CancellationException) { throw error }
                    catch (error: Exception) { message = error.message ?: "Не удалось сохранить. Повторите." }
                    finally { busy = false }
                }
            }) }
        }
        if (message.isNotBlank()) item { Text(message, style = MaterialTheme.typography.caption1) }
        if (owner == null) item { Text("Черновик доступен без входа. Для ИИ подключите аккаунт.", style = MaterialTheme.typography.caption1) }
        item { Chip(label = { Text("Назад") }, onClick = ::leave, modifier = Modifier.fillMaxWidth()) }
    }
}

private fun number(value: Double) = String.format(java.util.Locale.forLanguageTag("ru-RU"), "%.1f", value).removeSuffix(",0")
