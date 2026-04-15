# React 19 and Performance Guide

Use this reference when the task involves React 19 features, performance, Suspense, memoization, or rendering pitfalls.

## React 19 focus areas

- Server Components
- `use()`
- `useActionState`

## Performance priorities

- route-level splitting
- image optimization
- virtualization for large lists
- debounce expensive operations
- avoid premature memoization when React Compiler already handles the case

## Rendering traps

Watch for:
- unstable keys
- mutated state
- accidental rerender loops
- missing cleanup in effects
- object dependencies that change every render
