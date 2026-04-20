# Channels Settings Editor Web Awesome Redesign

## Summary

Redesign the `Channels` settings and account-editing subflow around a real component library and an explicit multi-account editor model.

This spec replaces the earlier tabbed-editor-only redesign baseline for this subflow. The previous version improved information architecture, but it still relied on hand-rolled controls and did not correctly express per-account credential editing for channels such as Feishu where each account owns its own `appId` and `appSecret`.

The new baseline keeps the same route-level scope:

- only the `Channels` settings and account-editing subflow is redesigned
- the management table and channel catalog are out of scope

The new baseline changes two things:

- adopt `Web Awesome` as the primary component layer for this subflow
- model account editing as a first-class editor, not just a list plus default-account toggle

## Source Of Truth

This spec supersedes `docs/superpowers/specs/2026-04-20-channels-settings-editor-redesign-design.md` for the `Channels` settings/account editor subflow.

That earlier spec remains useful as historical context, but this document is the canonical design source for the next implementation pass.

## Goals

- Replace the current hand-styled editor controls with a mature component system.
- Make tabs, forms, actions, and account editing visually coherent and readable.
- Represent multi-account channels correctly, including per-account credentials and defaults.
- Keep the channel editor approachable for non-technical operators.
- Preserve the existing backend contract when it already supports the target behavior.
- Avoid redesigning unrelated Control UI surfaces in this pass.

## Non-Goals

- Redesign the `Channels` management registry page.
- Redesign the `Channel Catalog` flow.
- Migrate the entire Control UI to a new component library in one pass.
- Rewrite backend channel config contracts unless a specific editor behavior is blocked.

## Problem Statement

The current editor still has three major failures.

### 1. The control layer is visually weak

The current tab strip is a set of raw buttons, and most editor controls are custom-styled primitives. They are functional, but they do not provide the quality, consistency, or interaction polish expected from a production settings surface.

This is why the editor still reads as "homemade" even after the information architecture was improved.

### 2. Multi-account channels are not represented correctly

The backend already supports:

- multiple accounts per channel
- per-account runtime snapshots
- a `defaultAccountId`

However, the current `Accounts` tab behaves like an account inventory, not an account editor. It can show accounts and set a default, but it does not provide a dedicated per-account editing surface.

For channels like Feishu, this is incorrect. Different accounts must be able to hold different values for fields such as:

- `appId`
- `appSecret`
- `encryptKey`
- `verificationToken`

The current UI shape makes the channel look effectively single-account even when the underlying model is not.

### 3. Readability is still undermined by raw-schema ergonomics

The previous redesign improved grouping, but a schema-driven form still dominates the experience. Operators still need stronger structure, better labels, and better control affordances to understand what they are changing.

## Backing Evidence

The current codebase already supports multi-account data at the protocol and gateway layers.

- `src/gateway/protocol/schema/channels.ts`
  - `channelAccounts`
  - `channelDefaultAccountId`
- `src/gateway/server-methods/channels.ts`
  - builds `ChannelAccountSnapshot[]`
  - emits `channelAccounts`
  - emits `defaultAccountId`

So the multi-account problem is primarily a UI/editor-model problem, not a missing backend primitive.

## Component Library Decision

### Recommendation

Adopt `Web Awesome` for the `Channels` settings/account editor subflow.

Reference:

- [Web Awesome](https://webawesome.com/)
- [Components](https://webawesome.com/docs/components)

## Alternatives considered

### Spectrum Web Components

Pros:

- strong accessibility story
- high-quality enterprise-style controls
- Lit-based and standards-friendly

Cons:

- heavier visual opinion
- less aligned with the desired "operator console but still modern" direction
- adoption friction is somewhat higher for this repo’s current style layer

### FAST

Pros:

- flexible and standards-based
- strong design-token story

Cons:

- more infrastructure-oriented
- would require more styling work to avoid a generic foundation look

## Why Web Awesome

`Web Awesome` is the best fit because:

- it is actively maintained, unlike Shoelace
- it is built for standards-based web components
- it provides the exact primitives this subflow needs: tabs, inputs, selects, buttons, badges, cards, dialogs, split layouts
- it gives better visual quality quickly without forcing a framework rewrite

## Scope Of Adoption

This pass adopts `Web Awesome` only inside the `Channels` settings/account editor subflow.

It does not force a repo-wide component migration.

That means:

- existing Control UI shell remains in place
- existing route structure remains in place
- the `channels` editor content area becomes the first library-backed editor surface

## Information Architecture

The route and selected `channelId` model remain the same.

Inside the editor, the four tabs stay:

- `Overview`
- `Accounts`
- `Settings`
- `Advanced`

The difference is that each tab now has a stronger role and uses better components.

### Overview

Purpose:

- explain current channel state before editing

Content:

- channel label and type
- current status
- configured account count
- connected account count
- default account
- recent probe/check
- last save/apply summary

Behavior:

- no heavy form controls
- only lightweight navigation actions to `Accounts` or `Settings`

### Accounts

Purpose:

- fully manage account-level configuration for one channel

This is the most important change in this redesign.

The `Accounts` tab becomes a two-pane editor:

- left pane: account list
- right pane: selected account editor

The left pane shows:

- display name
- `accountId`
- status badge
- default badge
- last check
- add-account action

The right pane edits the selected account and is the only place where per-account credentials are edited.

For Feishu-like channels, this pane must support independent account-level values such as:

- `appId`
- `appSecret`
- `encryptKey`
- `verificationToken`

The editor must make it impossible to confuse channel-level settings with account-level settings.

### Settings

Purpose:

- edit channel-level settings only

Rules:

- no raw `accounts` field
- no raw `defaultAccount` field when the account manager is active
- no account credentials here

This tab is for shared channel behavior and operator-facing options, grouped into readable sections.

### Advanced

Purpose:

- hold low-frequency or dangerous options

Rules:

- visually distinct from the normal settings flow
- dangerous actions always require confirmation

## Layout

### Header

The editor header remains stable and contains:

- back to channel workspace
- channel label
- channel type/detail
- status badge

The old repeated summary pattern must not return.

### Shared Status Strip

A single shared submission strip remains under the header.

It reflects:

- clean
- dirty
- saving
- applying
- error
- last successful save/apply time
- last failure reason

This strip is shared across all tabs.

### Tab Strip

Replace the current raw tab buttons with `Web Awesome` tabs.

Use:

- `wa-tab-group`
- `wa-tab`
- `wa-tab-panel`

Requirements:

- clearer active state
- stronger keyboard and focus behavior
- better spacing and hierarchy
- icon support for tab labels when helpful

### Accounts Tab Layout

Use a split-pane or two-column layout with stronger structure than the current list block.

Desktop:

- left column fixed or narrow fluid width for the account navigator
- right column primary editing pane

Mobile:

- stack vertically
- account navigator becomes a top list or segmented selector

### Settings Tab Layout

Use cards/sections with better form rhythm.

Each section includes:

- section title
- one-sentence purpose
- grouped fields

Low-frequency groups may be collapsed.

## Control System

### Tabs

Use `Web Awesome` tab components.

Raw button tabs must be removed.

### Form Controls

Prefer `Web Awesome` controls where they cover the needed behavior:

- text input
- textarea
- select
- radio group
- switch
- button
- dialog
- tag/badge-like status surfaces where appropriate

Where the schema renderer cannot use a `Web Awesome` component directly, wrap the field in a thin adapter so the visible control still uses the library component.

## Visual Direction

The editor should look like a high-quality operator console, not a generic marketing app and not a debug form.

Principles:

- dense but readable
- strong field grouping
- high-contrast focus and status states
- restrained use of accent color
- polished tabs and primary actions
- visible hierarchy between summaries, lists, and forms

## Data Model And Editing Rules

### Channel-level vs account-level split

The editor must explicitly separate:

- channel-level config
- account-level config

Channel-level values live in `Settings`.

Account-level values live in `Accounts`.

For channels that expose account collections in schema form, the editor must map those fields into the account editor instead of dumping them into a generic object form.

### Default account

`defaultAccount` or `defaultAccountId` remains a channel-level concept, but it is edited through the `Accounts` tab because that is where users understand account context.

The account navigator should make it obvious:

- which account is default now
- how to change it

### Account drafts

Adding an account draft remains supported, but the action belongs in `Accounts`, not in `Settings`.

When a new draft is created:

- it appears immediately in the account list
- it becomes selected in the editor pane
- the right pane focuses the most important required field

## Submission Model

The shared status strip remains the single source of truth for editor submission state.

### Actions

- `Save`
- `Apply`
- `Reload`
- `Reset edits`

### Rules

- `Save` persists draft edits
- `Apply` is the primary action and communicates immediate effect
- `Reload` requires confirmation when the editor is dirty
- `Reset edits` discards unsaved local changes only

### Dirty State

Changes from both:

- the selected account editor
- the channel settings editor

must feed one shared dirty state.

Tab switching must never discard edits.

## Readability Requirements

Every user-facing field must have:

- a human-readable label
- a plain-language description
- optional expanded technical help only when needed

Do not rely on placeholders as documentation.

Do not expose raw schema keys as the primary label when a clearer label exists.

Examples:

- show `Default sending account`, not `defaultAccount`
- show `App ID`, `App Secret`, `Verification token` with explanations of when each matters

## Library Integration Strategy

Adoption should be incremental and local.

### Initial package scope

Add `Web Awesome` only to `ui/package.json`.

Only import the components needed by this subflow.

Do not add a giant all-components bootstrap.

### Styling strategy

- use `Web Awesome` theme + component styles as the baseline
- layer local tokens/classes only where needed to match CrawClaw’s dark operator-console look
- do not keep old hand-rolled tab/button/input visuals in parallel

### Adapter strategy

Where the schema renderer currently assumes native inputs or local primitives, introduce narrow field adapters rather than rewriting the whole form system in one pass.

## Testing

Required verification:

- controller tests for dirty/apply/save/reset state
- browser tests for tab rendering and switching
- browser tests for multi-account editing flow
- browser tests confirming account-level credential fields are edited in `Accounts`, not `Settings`
- browser tests for default-account switching
- `pnpm --dir ui build`

## Migration Plan

Implementation should proceed in this order:

1. add `Web Awesome` dependency and minimal bootstrapping
2. replace the tab strip
3. rebuild `Accounts` as navigator + account editor
4. remove account fields from `Settings`
5. adapt shared submit/status strip styling and actions
6. replace remaining hand-rolled controls inside this subflow
7. run browser-based visual review and refine

## Risks

### Risk: schema/account mapping becomes ambiguous

Mitigation:

- maintain explicit field mapping rules for account-level keys
- fall back safely when a channel schema does not match known multi-account patterns

### Risk: partial component-library adoption creates visual mismatch

Mitigation:

- scope the library adoption to this full subflow, not a single widget
- replace tabs and primary form controls together

### Risk: changing account editing breaks save/apply semantics

Mitigation:

- keep controller state centralized
- preserve existing backend calls
- add browser regression coverage for draft, save, apply, reload, and default-account changes

## Acceptance Criteria

This redesign is complete when:

- tabs no longer look like raw buttons
- the editor uses a mature component library for its primary controls
- multi-account channels can edit different credentials per account
- `Settings` no longer pretends account credentials are channel-global
- account list and account editor are clearly separate
- the editor remains understandable to non-technical operators
- browser review confirms a materially improved visual and interaction quality
