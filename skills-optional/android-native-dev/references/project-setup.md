# Android Native Project Setup

Use this reference when you need project bootstrap, Gradle structure, flavors, wrapper readiness, or baseline Android project configuration.

## Start by assessing the project state

Typical scenarios:
- empty directory
- existing Gradle wrapper
- Android Studio project without full wrapper setup
- partial / broken Android project

## Baseline rule

Before business logic, make sure the project can build with the equivalent of `assembleDebug`.

## Setup concerns

- `gradle.properties`
- root and app Gradle files
- Gradle wrapper
- AndroidManifest and resource layout
- build features such as `buildConfig`
- product flavors / build variants when relevant

## Flavor guidance

Use product flavors when environments or tiers truly differ.

Examples:
- dev / staging / prod
- free / paid

Keep flavor logic explicit and avoid accidental complexity if only one deploy target exists.
