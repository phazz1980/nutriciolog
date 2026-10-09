import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val firebaseProperties = Properties().apply {
    val file = rootProject.file("firebase.properties")
    if (file.exists()) file.inputStream().use(::load)
}
fun firebaseValue(name: String) = firebaseProperties.getProperty(name, "")

android {
    namespace = "ru.mynutritionist.wear"
    compileSdk = 37
    compileSdkMinor = 2
    buildToolsVersion = "37.0.0"

    defaultConfig {
        applicationId = "ru.mynutritionist.wear"
        minSdk = 30
        targetSdk = 37
        versionCode = 2
        versionName = "0.2.0"

        buildConfigField("String", "FIREBASE_APP_ID", "\"${firebaseValue("FIREBASE_APP_ID")}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${firebaseValue("FIREBASE_API_KEY")}\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${firebaseValue("FIREBASE_PROJECT_ID")}\"")
        buildConfigField("String", "WEAR_AUTH_ENDPOINT", "\"${firebaseValue("WEAR_AUTH_ENDPOINT")}\"")
    }

    buildFeatures { compose = true; buildConfig = true }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.wear.compose:compose-material:1.7.1")
    implementation("androidx.wear:wear:1.3.0")
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
