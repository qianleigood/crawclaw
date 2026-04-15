---
summary: "A simple, beginner-friendly redesign plan for the browser Control UI"
read_when:
  - You want to simplify the Control UI for non-technical users
  - You want a concrete page-by-page UX plan before implementing UI changes
title: "Control UI UX Plan"
---

# Control UI UX Plan

## Goal

Make the browser Control UI easy enough that a first-time user can:

1. connect to the gateway
2. connect one channel
3. enable the right skills
4. pick the right agent
5. send a successful test message

The current UI already has strong capabilities. The main problem is not missing features. The problem is that the default surface still feels like an engineering control panel.

## Current problems

From the current source layout:

- Top-level navigation is too large for beginners.
- Settings are grouped by internal system boundaries rather than user tasks.
- Channels and skills expose too much raw status detail by default.
- The browser UI does not yet provide a complete first-run setup flow comparable to the CLI onboarding path.
- Advanced observability is valuable, but it is too visible for non-technical users.

## Design principles

- Default to `Simple Mode`, with an explicit `Advanced Mode` toggle.
- Make every page answer one user question.
- Prefer guided actions over raw status.
- Hide JSON, payloads, and low-level diagnostics behind disclosure panels.
- Use plain language:
  - `Connected`
  - `Needs login`
  - `Ready to use`
  - `Needs setup`
- Treat the first screen as a workspace, not a dashboard grid.

## Target information architecture

### Simple Mode

- `Home`
- `Chat`
- `Connect`
- `Skills`
- `Agents`

### Advanced Mode

- `Sessions`
- `Usage`
- `Cron`
- `Nodes`
- `Logs`
- `Debug`
- `Raw Config`

## Page plans

## Home

Purpose: tell the user what is working and what to do next.

Primary blocks:

- `System status`
  - gateway connected or not
  - default agent
  - connected channels count
  - enabled skills count
- `Next steps`
  - connect a channel
  - log into Feishu user tools
  - enable recommended skills
  - send a test message
- `Quick actions`
  - go to Connect
  - go to Skills
  - go to Agents
  - send test message
- `Recent problems`
  - show only the top 3 issues
  - every issue gets one repair action

What to avoid:

- large raw status walls
- full JSON blocks
- too many cards with equal weight

## Chat

Purpose: keep the conversation surface simple and calm.

Default visible:

- message history
- message input
- attachments
- current agent picker
- `New session`
- `Inspect current run`

Collapsed by default:

- action feed
- tool stream detail
- internal debug information

Rule:

- the page should feel like a messaging workspace first
- runtime diagnostics should be secondary

## Connect

Purpose: make setup understandable without CLI knowledge.

This page should merge the current login and channel setup mental model into one place.

Sections:

- `Gateway connection`
  - address
  - token or password
  - connect button
- `Channel connections`
  - Feishu
  - Telegram
  - Discord
  - Slack
  - others as needed
- `Identity connections`
  - `Feishu Bot`
  - `Feishu User`
  - explain clearly that they are different identities

Each channel card should show only:

- current state
- what is already complete
- what is still missing
- one primary next step

Advanced details:

- raw payload
- full snapshot
- troubleshooting internals

These should be hidden behind `Show advanced details`.

## Skills

Purpose: turn skill management into an ability center.

Main groups:

- `Recommended`
- `Enabled`
- `Needs setup`
- `Optional`

Each skill card should show:

- name
- one-line purpose
- prerequisites
- status
- one primary action:
  - `Enable`
  - `Configure`
  - `Install`
  - `Open details`

Do not lead with:

- `eligible`
- `bundled`
- `blockedByAllowlist`
- raw source identifiers

These can remain available inside the detail drawer.

## Agents

Purpose: help users understand and choose agents, not inspect internals by default.

Default content:

- default agent
- what each agent is for
- which skills it uses
- which channels it is suitable for
- switch default agent

Advanced panel:

- `Inspect`
- timeline
- query context
- provider request
- channel streaming state

Rule:

- beginners should first learn what each agent does
- observability remains available, but not as the main default surface

## Settings

Purpose: organize configuration by user intent.

Suggested sections:

- `Basics`
- `Channels & Accounts`
- `Models & Agents`
- `Skills & Tools`
- `Memory & Privacy`
- `Advanced`

Move these into `Advanced`:

- raw config
- diagnostics
- debug
- logs
- bindings
- wizard state
- MCP/server internals

## First-run flow

The browser UI should have a complete guided setup flow, not just a special mode toggle.

Recommended flow:

1. Connect gateway
2. Choose default agent
3. Connect one channel
4. Enable recommended skills
5. Send a test message

The existing CLI setup logic is still useful as the policy and sequencing reference. The UI should mirror that experience visually and interactively.

## Visual direction

Visual thesis: `quiet workstation`

Guidance:

- use whitespace and typography before adding chrome
- prefer section layout over card-heavy grids
- keep one accent color
- use short support copy
- reserve warning and error colors for true operational states

Motion:

- light page transitions
- clear save-state feedback
- smooth state change for connect/ready/error
- no decorative motion without information value

## Motion system

Use motion to improve confidence, hierarchy, and orientation.

The UI should feel more refined, but never busy.

### Motion rules

- keep animations short
- avoid stacked simultaneous effects
- respect `prefers-reduced-motion`
- use motion to confirm state changes, not decorate empty space
- never hide important information behind delayed entrance effects

### Recommended motion patterns

#### Home

- staged reveal for the main summary and next-step actions
- soft highlight pulse when a blocked item becomes ready
- subtle count-up only for small status numbers, not for everything

#### Connect

- state transitions for channel cards:
  - `disconnected -> connecting -> ready`
- success state should feel like a clean morph, not a toast explosion
- connection steps can use a progress rail or active step marker

#### Skills

- filter changes should animate as soft reflow, not hard jumps
- skill detail panels should slide/fade in as a side sheet or modal
- enable/install actions should use inline progress states and completion confirmation

#### Agents

- agent switch should preserve orientation with a soft content transition
- inspect timeline should reveal incrementally while polling rather than popping in abruptly

#### Chat

- streaming should stay readable and stable
- tool/action sections can expand and collapse with height + opacity transitions
- avoid aggressive animation in the message column

### Good places for advanced motion

- page transitions between major tabs
- onboarding step changes
- connection card state updates
- inspect timeline reveal
- save/apply confirmation states

### Bad places for advanced motion

- every card on the page
- every message bubble
- large decorative background movement
- long hero-style animations on operational screens

### Skills to use while implementing

- `frontend-skill`
  - use for visual restraint, hierarchy, motion tone, and page feel
- `playwright`
  - use to verify real browser behavior, timings, and regressions after motion changes

## Implementation order

1. Simplify top navigation and add `Simple Mode` / `Advanced Mode`
2. Redesign `Home`
3. Merge login + channel setup into `Connect`
4. Redesign `Skills`
5. Re-group `Settings`
6. Add full browser onboarding

## Definition of done

The redesign is successful when a non-technical user can complete setup from the browser without reading raw config or CLI docs.

That means they can:

- connect
- configure one working channel
- enable the correct skills
- choose the correct agent
- verify success with a test message
