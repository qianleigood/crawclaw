# React Architecture and State Guide

Use this reference when you need architectural decisions, component rules, and state management guidance.

## Decide early

- rendering mode: SPA / SSR / static / hybrid
- server state approach
- client state approach
- styling approach
- forms approach

## Key rule

Server state and client state are different. Do not mix them casually.

## State defaults

- API data -> TanStack Query
- shared UI state -> Zustand or Context
- local UI state -> useState

## Component rules

- named exports
- small JSX blocks
- keep files from growing uncontrolled
- hooks first, handlers second, render last
