---
title: "Control UI Stitch Rebuild Design"
summary: "Design for rebuilding Control UI against the canonical Stitch screens"
read_when:
  - You are reviewing the Control UI Stitch rebuild
  - You need the source-of-truth and migration goals for the UI rebuild
---

# Control UI Stitch Rebuild Design

## Summary

Rebuild Control UI against the Stitch canonical screens as the only UI source of truth. This is a replacement-style redesign, not an incremental polish pass. Frontend structure, routes, controllers, and control-plane methods may all change if required to achieve 1:1 parity with Stitch.

The rebuild keeps data semantics only where they still fit the Stitch screens. Existing UI implementation details are not preserved by default. After the new implementation lands, obsolete UI code must be removed rather than left behind as fallback debt.

## Goals

- Match the canonical Stitch screens 1:1 in structure, spacing, component language, and page flow.
- Treat Stitch HTML as the baseline for app shell, page layout, and control semantics.
- Allow backend contract changes when current APIs do not support the target UI cleanly.
- Keep `Channel Catalog / 渠道目录` and `Feishu Channel Editor / 飞书编辑器 (Final)` inside the `Channels` page as subflows, not top-level routes.
- Support runtime language switching with clean English and Simplified Chinese variants.
- Remove replaced UI code after migration.
- Update implementation and parity docs so the rebuilt system has an accurate maintenance baseline.

## Non-Goals

- Preserve the current Control UI component structure for compatibility.
- Keep mixed bilingual labels on the same screen.
- Keep duplicate Stitch screens as implementation references.
- Build a temporary dual-UI system that lasts beyond the migration window.

## Source Of Truth

The implementation baseline is the canonical Stitch screen set already normalized in `docs/zh-CN/concepts/project-control-ui-stitch-baseline.md`. Those screens define:

- app shell
- navigation
- page section order
- component hierarchy
- panel density
- empty/loading/error states when available

If a canonical Stitch screen is incomplete, a replacement design must be produced before implementation for that missing area. The replacement then becomes the new canonical baseline for that area and must be documented alongside the existing screen inventory.

## Canonical Screen Set

The rebuild targets these 12 canonical screens:

- `System Overview / 系统概览`
- `Sessions & Chat / 会话控制台`
- `Channels / 渠道管理`
- `Workflows / 工作流运行`
- `Agents / 智能体自省`
- `Usage / 用量与观察`
- `Config / 审批与配置`
- `Debug / RPC 调试`
- `Memory / 记忆`
- `Agent Runtime / 后台运行`
- `Channel Catalog / 渠道目录`
- `Feishu Channel Editor / 飞书编辑器 (Final)`

`Channel Catalog` and `Feishu Channel Editor` are implemented as `Channels` subflows, not standalone primary routes.

## Product Constraints

### 1. Absolute Stitch Parity

When current frontend behavior conflicts with Stitch, Stitch wins. When current backend contract conflicts with Stitch, the backend contract may change. The system is not allowed to stop at "close enough".

### 2. Runtime Language Switching

Each page must render in either English or Simplified Chinese at runtime. Language resources are separate. Mixed bilingual labels on one screen are not allowed except where a proper noun or external product name must remain unchanged.

### 3. No Legacy UI Tail

Once a rebuilt screen is fully adopted, the replaced UI path must be deleted. This includes:

- unused route metadata
- unused view components
- dead CSS
- orphaned helpers
- obsolete controllers or view-model adapters
- outdated page-specific tests that only validate removed UI

### 4. Documentation Must Land With Code

The rebuild is not complete until the screen baseline, implementation plan, and developer-facing UI docs describe the new architecture and the final page mapping accurately.

## Architecture

### Frontend Strategy

Rebuild the Control UI as a Stitch-first surface with new shared primitives instead of continuing to mutate the current page skeletons.

The frontend is split into four layers:

1. `app shell`
   - sidebar
   - top bar
   - language switch
   - page container
   - global status surfaces

2. `page primitives`
   - cards
   - section headers
   - tab strips
   - split panels
   - list rows
   - badges
   - metric tiles
   - timeline/event blocks
   - forms and action bars

3. `screen components`
   - one screen component per canonical page
   - channels subflow components live under `Channels`

4. `i18n resources`
   - page copy
   - labels
   - empty states
   - error strings
   - action text

The implementation should favor new files and focused modules over further growth inside large mixed-responsibility UI files. Existing files may be split as part of the migration where that improves clarity.

### Backend Strategy

The backend contract is allowed to change to fit the target UI. Existing `control-ui-methods` and controllers are inputs, not hard constraints.

The backend should expose page-oriented view models where that reduces frontend stitching. Preferred shape:

- one summary query per top-level page where practical
- detail/list queries for drill-down regions
- targeted mutations for actions surfaced in Stitch
- channels subflow methods scoped to listing, catalog browsing, editor loading, draft editing, validation, and apply flows

The frontend should not have to assemble core page sections from a large number of unrelated RPC calls if Stitch represents them as one coherent screen.

### Route Model

Top-level routes remain aligned with the canonical main pages. `Channel Catalog` and `Feishu Channel Editor` remain nested flows within `Channels`. They may use internal stateful subroutes or flow state, but they do not become primary navigation entries.

## Screen Design Rules

### App Shell

- Rebuild sidebar and top bar directly from canonical Stitch HTML structure.
- Use one shared shell across the rebuilt product, even if some old drafts in Stitch conflict.
- Any shell divergence required for engineering reasons must be explicitly documented and justified.

### Controls And Spacing

- Controls must come from one shared primitive set.
- Padding, gaps, border radius, typography scale, icon sizing, and panel density must be tokenized and reused consistently.
- Per-page custom controls are only allowed when the canonical screen clearly requires them.

### States

Each rebuilt screen must define:

- loading state
- empty state
- populated state
- error state
- disabled/action-pending states where actions exist

If Stitch does not show a state, the missing state must be designed before implementation and added to the baseline notes.

## Internationalization

Runtime language switching is required.

Rules:

- English and Simplified Chinese are separate resources.
- Templates contain translation keys, not bilingual literal strings.
- Page titles, navigation labels, buttons, empty states, helper text, and system notices must all be localizable.
- Proper nouns may remain untranslated if they are product identifiers.
- Data payloads should carry stable semantic fields; translation stays in presentation where possible.

The default language behavior should follow existing project conventions unless the rebuild reveals a stronger product requirement.

## Channels Subflows

`Channels` owns three internal surfaces:

1. Management overview
2. Channel catalog subflow
3. Feishu editor subflow

Requirements:

- navigation into and out of subflows must preserve user context
- subflows must visually follow the same shell and component system
- subflow state must be modeled explicitly, not hidden in ad hoc conditionals
- Feishu editing should be driven by a clear draft/view/apply lifecycle aligned with the design

## Cleanup Plan

Legacy code cleanup is mandatory, not optional.

After each rebuilt area is switched over:

- delete superseded UI implementations
- delete dead exports
- delete dead tests
- remove old route branches
- remove unused styles and tokens
- remove controller methods that only served deleted UI
- collapse compatibility shims once no rebuilt page depends on them

No long-term duplicate implementation paths should remain after the final migration.

## Documentation Updates

The following documentation work is part of the rebuild:

- update the Stitch baseline and parity docs where implementation details or missing-state addenda change
- add developer-facing notes for the new screen/component architecture
- update any Control UI implementation docs that still describe the old page structure
- document the language-resource layout and contribution rules
- document backend method changes where protocol or controller contracts move

## Validation

Validation is required at four levels:

### 1. Screen Inventory Validation

- verify the canonical screen set and IDs before implementation
- record any Stitch gaps that require supplemental design

### 2. Structural Parity Validation

- compare implemented DOM structure against Stitch HTML section-by-section
- confirm app shell, panel ordering, tab groups, and subflow structure match

### 3. Visual Parity Validation

- run screenshot comparisons for each rebuilt page
- fix spacing, typography, and component inconsistencies before calling the page complete

### 4. Engineering Validation

- build passes
- targeted tests pass
- route-level smoke checks pass
- language switching works across all rebuilt pages
- no removed page path is still reachable

## Delivery Sequence

Recommended execution order:

1. freeze canonical screen inventory
2. document supplemental designs for Stitch gaps
3. define shared shell and primitive system
4. rebuild page screens against Stitch
5. rebuild `Channels` subflows
6. align backend contracts and controllers
7. remove legacy UI code
8. update docs
9. run parity and engineering validation

## Risks

- current UI logic is concentrated in large files, which increases migration risk if not decomposed
- backend contract changes may ripple into tests and supporting tooling
- language separation may uncover hardcoded mixed-language strings across the current implementation
- leaving legacy code in place would hide incomplete migration and increase maintenance cost

## Acceptance Criteria

The rebuild is complete only when all of the following are true:

- every canonical Stitch page has a corresponding rebuilt screen or subflow
- app shell and page layout match the canonical Stitch baseline
- English and Simplified Chinese render as separate runtime language modes
- replaced UI code is deleted
- required docs are updated
- parity validation and engineering validation both pass
