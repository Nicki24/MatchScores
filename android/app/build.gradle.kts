plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val ciVersionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 100

android {
    namespace = "mg.matchscores.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "mg.matchscores.app"
        minSdk = 26
        targetSdk = 35
        // > versions de la première appli (1 à 3) : s'installe par-dessus
        versionCode = 100 + ciVersionCode
        versionName = "2.0.$ciVersionCode"
    }

    // Même clé que la première version de l'appli : la mise à jour s'installe sans désinstaller.
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
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core:1.13.1")
}
