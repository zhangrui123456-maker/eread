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
        versionCode = 2
        versionName = "0.2.0"
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

// 每次构建前把 web/ 源文件同步进 assets（web 是唯一开发源，assets 只是 APK 打包副本）。
// 避免「改了 web 忘了拷 assets → gradle assemble 装机无变化」。
// node_modules 只收运行时真正需要的 foliate-js 与 jszip 压缩包，其余开发期依赖不进 APK。
val syncWebAssets = tasks.register<Copy>("syncWebAssets") {
    val webDir = rootProject.file("../web")
    from(webDir) {
        exclude("node_modules/**", "package.json", "package-lock.json", "probe.js")
    }
    from(webDir) {
        include("node_modules/foliate-js/**", "node_modules/jszip/dist/jszip.min.js")
    }
    into(layout.projectDirectory.dir("src/main/assets"))
}
tasks.named("preBuild") { dependsOn(syncWebAssets) }
