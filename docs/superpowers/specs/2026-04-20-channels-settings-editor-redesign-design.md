# Channels Settings Editor Redesign Design

## Summary

Redesign the `Channels` page's settings and account-editing subflow as a dedicated tabbed editor that is readable for non-technical users. The redesign replaces the current single long-form editor layout with a clearer information architecture centered on comprehension first, editing second.

This redesign is intentionally scoped to the `Channels` subflow for channel settings and account management. It does not redesign the `Channels` management table or catalog flow in this pass.

## Goals

- Replace the current stacked settings layout with a clearer, more readable editor flow.
- Separate channel-level settings from account-level management without forcing a route change.
- Make field purpose understandable to first-time or non-technical operators.
- Keep `Save`, `Apply`, `Reload`, and reset behavior explicit and predictable.
- Reuse existing backend capabilities where they already support the target flow.
- Preserve a single editing context for one selected channel.

## Non-Goals

- Redesign the `Channels` management page.
- Redesign the channel catalog flow.
- Redesign unrelated Control UI pages.
- Replace the existing backend contract unless the current contract blocks the new editor behavior.

## Problem Statement

The current `Channels` settings surface has three related problems:

- visual hierarchy is weak, so the page reads like a long technical form rather than an editor
- account editing and channel editing compete for attention in one surface
- schema-driven fields are technically correct but not readable enough for non-expert operators

The result is poor task comprehension. A user can see fields, but it is not obvious:

- what each field does
- which fields are safe to ignore
- which changes are risky
- what happens when `Save` versus `Apply` is used

## Scope

This redesign applies only when a user opens the editor for a single channel from `Channels / 渠道管理`.

The subflow includes:

- the channel editor shell
- overview content for the selected channel
- account management for that channel
- grouped channel settings form
- advanced and low-frequency configuration areas
- the unified submission state and action bar

## Source Of Truth

The existing Stitch project remains the baseline for the broader Control UI shell and `Channels` route context. This redesign acts as a replacement baseline for the channel settings/editor subflow because the current Stitch material for this area is not sufficient for the desired usability target.

After approval, this spec becomes the canonical design source for the `Channels` settings/editor subflow until a matching Stitch screen is generated or updated from it.

## User Model

The primary user for this flow is an operator who may not understand the raw schema or internal terminology.

The editor must work for two user types:

- an operator who wants to complete a practical task such as setting a default account or fixing a connection
- a power user who needs access to lower-level configuration and advanced options

The default presentation must optimize for the first group. Advanced detail should be available, but not dominant.

## Information Architecture

The editor stays on one route and one `channelId` context. Inside that context, the page switches between four tabs:

- `Overview`
- `Accounts`
- `Settings`
- `Advanced`

These tabs replace the current mixed layout where summary, account management, and schema editing all compete in one screen region.

### Overview

Purpose: help the user understand the current state of the selected channel before editing.

Content:

- channel name and type
- current configuration status
- default account
- configured account count
- connected account count
- latest check time
- latest known error or warning
- recent action summary such as last save or apply

Behavior:

- no large editable form content
- only lightweight actions such as jumping to `Accounts` or `Settings`

### Accounts

Purpose: manage multiple accounts for the selected channel in one dedicated surface.

Content:

- account list with compact readable rows or cards
- account display name
- `accountId`
- default-account indicator
- connection/configuration state
- latest probe/check time
- actions such as `Set as default` and `Add account draft`

Behavior:

- account management is fully contained in this tab
- account-related actions do not appear in the main channel settings tab
- if an account editor is needed, it appears inside this tab only

### Settings

Purpose: edit the main channel configuration without account-management noise.

Content:

- grouped form sections for channel-level configuration
- common settings first
- low-frequency groups collapsed or deferred
- inline explanations for every user-facing field

Behavior:

- account-specific raw schema fields such as `accounts` and `defaultAccount` are not shown here when the dedicated account manager is active
- the form is grouped by operator task, not raw schema shape

Recommended groups:

- `Basic information`
- `Sending and defaults`
- `Connection and authentication`
- `Message formatting and limits`
- `Advanced options`

### Advanced

Purpose: isolate dangerous, low-frequency, or technical options from the main settings flow.

Content:

- advanced configuration sections
- diagnostic or raw configuration references
- experimental options
- reset or other dangerous actions when applicable

Behavior:

- visually distinct from the main settings tab
- dangerous actions require explicit confirmation

## Layout

### Editor Header

The page header remains stable across all tabs and contains:

- back action to return to the channel workspace
- selected channel name
- selected channel type or detail label
- current channel status badge
- primary action area

The header should not repeat the same summary data elsewhere on the page.

### Global Status Strip

Under the header, render one shared status strip that reflects editor state across all tabs.

This strip is the only global status surface for normal editing and submission feedback.

States:

- `clean`
- `dirty`
- `saving`
- `applying`
- `error`

Displayed messages may include:

- unsaved changes
- saving in progress
- applying in progress
- last saved time
- last applied time
- last failure reason

### Tab Strip

Place the four tabs directly below the shared status strip. Switching tabs must not discard local edits.

### Tab Content Rules

- only one primary editing surface is visible per tab
- no duplicated summary cards between tabs
- no mixed account-management and channel-settings form inside the same content block

## Readability Requirements

Readability is a first-class requirement, not cosmetic polish.

### Field Presentation

Each field must expose information in three layers:

1. display label in plain language
2. one-sentence explanation of what the field controls
3. expandable technical help, examples, or risk notes when needed

Example principle:

- do not surface `defaultAccount` as the primary visible label
- instead show a user-facing label like `Default sending account`
- explain it in plain language such as "When no specific account is chosen, CrawClaw will send through this account."

### Help Text Rules

- placeholders are examples only, not explanations
- explanations live under the field label
- advanced detail uses expandable help
- dangerous fields must explicitly warn about behavior changes

### Terminology Strategy

The UI may remap raw schema field names into user-facing display labels and descriptions. The raw field name is not the source of truth for presentation.

### Group Introductions

Each settings group begins with a short sentence explaining what the group controls and when a user would need to change it.

### Progressive Disclosure

Low-frequency and technical content must stay collapsed, secondary, or moved to `Advanced`. The default screen should be readable without understanding the full schema.

## Submission Model

The redesign keeps one unified submission model across all tabs.

### Submission States

Tracked editor state:

- `clean`
- `dirty`
- `saving`
- `applying`

Tracked recent result metadata:

- `lastSubmitKind`
- `lastSubmitMethod`
- `lastSubmitAt`
- `lastError`

### Actions

#### Save

- saves current edits
- does not promise immediate runtime effect
- if the actual backend path falls back to `channels.config.apply`, the UI must disclose the real submission method in status feedback

#### Apply

- primary action
- applies the current edits immediately
- should be visually emphasized as the main commit-to-runtime action

#### Reload

- available directly only when the editor is clean
- if edits are dirty, the user must confirm before reload discards local changes

#### Reset edits

- reverts local unsaved changes only
- does not roll back already saved or applied backend state

### Cross-Tab Behavior

- edits made in `Accounts` and `Settings` contribute to the same dirty state
- switching tabs preserves local edits
- `Overview` reflects status but does not produce edits
- `Advanced` can contain special actions, but those must not silently bypass the shared editor state model

## Backend Contract

The current backend contract is sufficient for the first implementation of this redesign, assuming the frontend adds a presentation layer for grouping and field metadata.

Existing capabilities used by the redesigned editor:

- `channels.config.get`
- `channels.config.schema`
- `channels.config.patch`
- `channels.config.apply`

The primary frontend work is not new transport, but better structuring of:

- field groups
- user-facing labels
- help text
- risk levels
- example text
- advanced versus common placement

If current `uiHints` already contain useful metadata, the redesign should use them first. Missing readability metadata may be added through a dedicated frontend mapping layer before expanding the protocol.

## Controller Responsibilities

The current controller path can remain the base implementation if it is reshaped to support:

- tab-level view state
- shared dirty-state tracking across tabs
- recent submission result summary
- grouped field presentation metadata
- account-manager specific view model separation

The controller should stop exposing the editor as one undifferentiated form surface. It should instead provide a view model that cleanly separates:

- overview data
- accounts data
- grouped settings data
- advanced data
- shared submission state

## Visual Direction

This editor should read as a settings product, not a debug surface.

Required visual direction:

- stronger hierarchy at the page and section level
- fewer simultaneous panels
- more whitespace around high-value information
- consistent controls across tabs
- obvious primary action
- calmer treatment of low-value metadata

The editor should avoid:

- duplicate chips and repeated summary data
- deeply nested panel-in-panel layouts
- overuse of technical badges where plain text is clearer
- presenting raw schema structure as the visible IA

## Error Handling

Errors must be surfaced in two layers:

- global submission/status strip for request-level failure
- field-level validation where the backend/schema already supports it

Account-specific failures should stay visible in `Accounts` without polluting the main `Settings` form.

## Validation

Validation for this redesign includes:

- the editor works for single-account and multi-account channels
- the account manager and settings form no longer duplicate the same concepts
- tab switches preserve local edits
- the shared status strip reflects real submission method and timing
- readability checks confirm each visible field has a user-facing explanation path
- dangerous or advanced changes are clearly marked

## Delivery Notes

This spec is the design baseline for the next implementation-planning step. The implementation plan should cover:

- tabbed editor information architecture
- shared submission state strip
- grouped field presentation layer
- account manager extraction
- advanced tab isolation
- cleanup of replaced single-page settings layout
