plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.swarmforge.floatcompanion"
    compileSdk = 34

    defaultConfig {
        // Fresh id: sideload cannot update over an older install signed with a
        // different debug key (generic "App not installed"). Distinct from both
        // legacy ids: com.swarmforge.floatcompanion and com.swarmforge.bubble.
        applicationId = "com.swarmforge.float"
        minSdk = 26
        targetSdk = 34
        versionCode = 30
        versionName = "0.3.14-echo-ptt"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
    }
    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // BL-769: JVM unit suite for Bubble's pure logic — no emulator, no device.
    testImplementation("junit:junit:4.13.2")
    // android.jar's org.json is a stub that throws at runtime; a real jar is
    // needed on the unit test classpath for BridgeClient to load and run.
    testImplementation("org.json:json:20240303")
}
