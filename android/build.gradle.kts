// Top-level. Versions are marked 待核实 — confirm against the official release
// pages before pinning; these are a known-compatible set (~late 2024):
//   AGP 8.7.x ↔ compileSdk 35, Kotlin 2.0.20, Gradle 8.9.
plugins {
    id("com.android.application") version "8.7.0" apply false        // 待核实
    id("org.jetbrains.kotlin.android") version "2.0.20" apply false  // 待核实
}
