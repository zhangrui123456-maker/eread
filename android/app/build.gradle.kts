plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.eread"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.eread"
        minSdk = 26          // Android 8.0; final minSdk TBD (PRD §18.5)
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

// Zero AndroidX deps for the spike — uses platform android.webkit.WebView and
// android.app.Activity, minimizing downloads (GFW-friendly). M2 adds AndroidX
// (appcompat/webkit) when the UI needs it.
dependencies {
}
