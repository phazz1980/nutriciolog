package ru.phazz.nutriciolog

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.MealType
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Mass
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.security.MessageDigest

@CapacitorPlugin(name = "NutritionHealth")
class HealthConnectPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val permissions = setOf(
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class)
    )
    private val permissionContract = PermissionController.createRequestPermissionResultContract()

    private fun sdkStatus(): Int = if (Build.VERSION.SDK_INT < 28)
        HealthConnectClient.SDK_UNAVAILABLE else HealthConnectClient.getSdkStatus(context)

    private fun availability(status: Int) = when (status) {
        HealthConnectClient.SDK_AVAILABLE -> "available"
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "install_required"
        else -> "unavailable"
    }

    private fun resolveStatus(call: PluginCall) = scope.launch {
        try {
            val status = sdkStatus()
            val granted = if (status == HealthConnectClient.SDK_AVAILABLE)
                withTimeout(20_000) { HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions() } else emptySet()
            call.resolve(JSObject().apply {
                put("availability", availability(status))
                put("weightGranted", HealthPermission.getReadPermission(WeightRecord::class) in granted)
                put("stepsGranted", HealthPermission.getReadPermission(StepsRecord::class) in granted)
                put("nutritionGranted", HealthPermission.getWritePermission(NutritionRecord::class) in granted)
                put("energyGranted", HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class) in granted)
            })
        } catch (_: Exception) { call.reject("Не удалось проверить доступ к Health Connect.", "HEALTH_UNAVAILABLE") }
    }

    @PluginMethod
    fun getStatus(call: PluginCall) { resolveStatus(call) }

    @PluginMethod
    fun connect(call: PluginCall) {
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) { resolveStatus(call); return }
        activity.runOnUiThread {
            val requested = if (call.getBoolean("nutrition", false) == true)
                setOf(HealthPermission.getWritePermission(NutritionRecord::class)) else permissions
            try { startActivityForResult(call, permissionContract.createIntent(context, requested), "permissionsResult") }
            catch (_: Exception) { call.reject("Не удалось открыть разрешения Health Connect.", "HEALTH_PERMISSIONS") }
        }
    }

    @ActivityCallback
    fun permissionsResult(call: PluginCall?, result: ActivityResult) {
        if (call != null) resolveStatus(call)
    }

    @PluginMethod
    fun readSummary(call: PluginCall) = scope.launch {
        try {
            if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
                call.reject("Health Connect недоступен.", "HEALTH_UNAVAILABLE"); return@launch
            }
            val client = HealthConnectClient.getOrCreate(context)
            // Check actual permissions before every read, including partial grants.
            val granted = withTimeout(20_000) { client.permissionController.getGrantedPermissions() }
            val weightGranted = HealthPermission.getReadPermission(WeightRecord::class) in granted
            val stepsGranted = HealthPermission.getReadPermission(StepsRecord::class) in granted
            val energyGranted = HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class) in granted
            val now = Instant.now()
            val zone = ZoneId.systemDefault()
            val response = JSObject().apply {
                put("weightGranted", weightGranted)
                put("stepsGranted", stepsGranted)
                put("energyGranted", energyGranted)
                put("energyDate", LocalDate.now(zone).toString())
                put("stepsDate", LocalDate.now(zone).toString())
            }
            if (stepsGranted) {
                val result = withTimeout(20_000) { client.aggregate(AggregateRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(LocalDate.now(zone).atStartOfDay(zone).toInstant(), now)
                )) }
                // Aggregation avoids counting overlapping phone/watch sources twice.
                response.put("steps", result[StepsRecord.COUNT_TOTAL] ?: 0L)
            }
            if (weightGranted) {
                val result = withTimeout(20_000) { client.readRecords(ReadRecordsRequest(
                    recordType = WeightRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(now.minus(30, ChronoUnit.DAYS), now),
                    ascendingOrder = false,
                    pageSize = 1
                )) }
                result.records.firstOrNull()?.let { record ->
                    response.put("weight", record.weight.inKilograms)
                    response.put("weightDate", record.time.atZone(record.zoneOffset ?: zone).toLocalDate().toString())
                }
            }
            if (energyGranted) {
                val result = withTimeout(20_000) { client.aggregate(AggregateRequest(
                    metrics = setOf(TotalCaloriesBurnedRecord.ENERGY_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(LocalDate.now(zone).atStartOfDay(zone).toInstant(), now)
                )) }
                // Missing data must not be presented as zero expenditure.
                result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.let { response.put("burnedCalories", it.inKilocalories) }
            }
            call.resolve(response)
        } catch (_: SecurityException) { call.reject("Доступ отозван. Проверьте разрешения Health Connect.", "HEALTH_PERMISSIONS") }
        catch (_: Exception) { call.reject("Не удалось прочитать Health Connect. Повторите попытку.", "HEALTH_READ") }
    }

    @PluginMethod
    fun writeNutrition(call: PluginCall) = scope.launch {
        try {
            require(sdkStatus() == HealthConnectClient.SDK_AVAILABLE)
            val client = HealthConnectClient.getOrCreate(context)
            val granted = withTimeout(20_000) { client.permissionController.getGrantedPermissions() }
            if (HealthPermission.getWritePermission(NutritionRecord::class) !in granted) {
                call.reject("Разрешите запись питания в Health Connect.", "HEALTH_PERMISSIONS"); return@launch
            }
            val owner = requireNotNull(call.getString("owner"))
            val id = requireNotNull(call.getString("id"))
            require(owner.isNotEmpty() && id.isNotEmpty() && owner.length <= 200 && id.length <= 200)
            // Stable per-account identifier, without exposing the Firebase UID to other apps.
            val clientId = "meal:" + MessageDigest.getInstance("SHA-256")
                .digest("${owner.length}:$owner:$id".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
            if (call.getBoolean("deleted", false) == true) {
                withTimeout(20_000) { client.deleteRecords(NutritionRecord::class, emptyList(), listOf(clientId)) }
            } else {
                val entry = requireNotNull(call.getObject("entry"))
                val date = LocalDate.parse(entry.getString("date"))
                val zone = ZoneId.systemDefault()
                require(!date.isAfter(LocalDate.now(zone)))
                val type = when (entry.optString("mealType")) {
                    "Завтрак" -> MealType.MEAL_TYPE_BREAKFAST
                    "Обед" -> MealType.MEAL_TYPE_LUNCH
                    "Ужин" -> MealType.MEAL_TYPE_DINNER
                    "Перекус" -> MealType.MEAL_TYPE_SNACK
                    else -> MealType.MEAL_TYPE_UNKNOWN
                }
                // Diary stores only the date, not the actual time; use start of that local day.
                val start = date.atStartOfDay(zone).toInstant()
                val end = minOf(start.plusSeconds(1), Instant.now())
                require(end.isAfter(start))
                fun amount(name: String): Double = entry.getDouble(name).also { require(it.isFinite() && it in 0.0..100000.0) }
                val version = requireNotNull(call.getLong("version"))
                require(version > 0)
                val record = NutritionRecord(
                    startTime = start, endTime = end,
                    startZoneOffset = zone.rules.getOffset(start), endZoneOffset = zone.rules.getOffset(end),
                    name = entry.optString("title").take(200), mealType = type,
                    energy = Energy.kilocalories(amount("calories")),
                    protein = Mass.grams(amount("protein")), totalFat = Mass.grams(amount("fat")),
                    totalCarbohydrate = Mass.grams(amount("carbs")),
                    metadata = Metadata.manualEntry(clientRecordId = clientId, clientRecordVersion = version,
                        device = Device(type = Device.TYPE_PHONE, manufacturer = Build.MANUFACTURER, model = Build.MODEL))
                )
                withTimeout(20_000) { client.insertRecords(listOf(record)) }
            }
            call.resolve()
        } catch (_: SecurityException) { call.reject("Доступ к записи питания отозван.", "HEALTH_PERMISSIONS") }
        catch (_: Exception) { call.reject("Не удалось передать питание в Health Connect.", "HEALTH_WRITE") }
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        activity.runOnUiThread {
            try {
                val intent = if (sdkStatus() == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED)
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata"))
                else Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
                activity.startActivity(intent)
                call.resolve()
            } catch (_: Exception) { call.reject("Откройте Health Connect в настройках телефона.", "HEALTH_SETTINGS") }
        }
    }

    override fun handleOnDestroy() { scope.cancel(); super.handleOnDestroy() }
}
