plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// URL de l'app web (Vercel) affichée dans l'appli et dans le panneau de la bulle.
val appUrl = (project.findProperty("appUrl") as String?) ?: "https://match-scores.vercel.app"
val ciVersionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1

android {
    namespace = "mg.matchscores.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "mg.matchscores.app"
        minSdk = 26
        targetSdk = 35
        versionCode = ciVersionCode
        versionName = "1.0.$ciVersionCode"
        buildConfigField("String", "APP_URL", "\"$appUrl\"")
    }

    // Clé partagée (dans le dépôt) : chaque nouvelle version s'installe par-dessus l'ancienne.
    signingConfigs {
        create("shared") {
            storeFile = file("matchscores.keystore")
            storePassword = "matchscores"
            keyAlias = "matchscores"
            keyPassword = "matchscores"
        }
    }

    buildTypes {
        getByName("debug") { signingConfig = signingConfigs.getByName("shared") }
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // Reconnaissance de texte embarquée (hors ligne) pour lire l'écran par capture.
    implementation("com.google.mlkit:text-recognition:16.0.1")
}
