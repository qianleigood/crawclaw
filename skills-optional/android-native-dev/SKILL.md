---
name: android-native-dev
description: Android native application development and UI design guide. Use when building or fixing Android native apps, Kotlin / Jetpack Compose features, Gradle configuration, Material Design 3 UI, accessibility, build troubleshooting, or test coverage for Android projects. Prefer this skill whenever the task is specifically about Android native implementation rather than cross-platform mobile work.
license: MIT
metadata:
  version: "1.0.0"
  category: mobile
  sources:
    - Material Design 3 Guidelines (material.io)
    - Android Developer Documentation (developer.android.com)
    - Google Play Quality Guidelines
    - WCAG Accessibility Guidelines
---

# Android Native Development

## Core workflow

### 1. Assess project state
Figure out whether the project is:
- empty
- already using Gradle wrapper
- an Android Studio project that still needs wrapper / config cleanup
- partially configured or broken

### 2. Stabilize the build first
Before business logic, ensure the equivalent of `assembleDebug` can succeed.

### 3. Implement with the right layer in mind
Route your work between:
- project / Gradle setup
- Kotlin and coroutine logic
- Jetpack Compose UI
- resources and icons
- build debugging
- quality / testing

### 4. Verify before handoff
Check:
- build success
- important warnings and errors
- test coverage at the correct layer
- accessibility / M3 quality for user-facing UI

## Reference routing

### Project setup
Read `references/project-setup.md` when you need:
- Gradle / wrapper readiness
- baseline Android project files
- product flavors and build variants
- configuration bootstrap

### Kotlin and Compose
Read `references/kotlin-compose-standards.md` when you need:
- Kotlin code standards
- null safety / coroutines / lifecycle rules
- Compose state and UI guidance
- Material Design 3 alignment

### Build, testing, and quality
Read `references/build-and-quality.md` when you need:
- build error diagnosis
- Android quality checks
- testing strategy
- accessibility and design verification

## Working rules

- Do not start feature work on a broken build foundation.
- Prefer clear, explicit Android-native solutions over framework cargo culting.
- Treat lifecycle, threading, and state ownership as first-class concerns.
- Default to Material Design 3 unless the product clearly calls for another system.
