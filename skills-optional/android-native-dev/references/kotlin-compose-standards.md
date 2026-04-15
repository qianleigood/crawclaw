# Kotlin and Compose Standards

Use this reference when implementing Kotlin, coroutines, Compose UI, naming, state handling, or lifecycle-sensitive Android code.

## Kotlin rules

- prefer null-safe patterns over `!!`
- keep threading explicit
- use coroutines intentionally
- preserve visibility discipline
- avoid swallowing exceptions
- keep logging level choice deliberate

## Compose rules

- isolate UI state cleanly
- keep composables pure where possible
- avoid common composition / recomposition mistakes
- design state ownership before writing complex screens

## Lifecycle / resource management

Treat lifecycle-sensitive resources carefully:
- subscriptions
- flows
- camera / media resources
- background jobs

## Material Design 3

Use M3 as the default design language unless the product clearly needs another system.
