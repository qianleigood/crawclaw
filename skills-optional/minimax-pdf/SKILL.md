---
name: minimax-pdf
description: >
  PDF generation, form filling, and document reformatting skill for cases where visual quality,
  design identity, and print-ready output matter. Use this skill when the user wants to create a
  polished PDF from scratch, fill or inspect PDF form fields, or restyle an existing document into
  a professional PDF deliverable — such as reports, proposals, resumes, cover pages, client-ready
  decks, branded exports, or well-designed converted Markdown/text documents. Prefer this skill when
  appearance matters, not just when any PDF output is needed. Do not use it for Word-first editing
  workflows where the main deliverable should remain a .docx file.
license: MIT
metadata:
  version: "1.0"
  category: document-generation
---

# minimax-pdf

Use this skill for PDF-first deliverables where visual identity and print-readiness matter.

## Core workflow

### 1. Decide the route
- **CREATE**: generate a new PDF from scratch
- **FILL**: inspect and fill an existing PDF form
- **REFORMAT**: parse an existing source document and rebuild it into a polished PDF

### 2. Read the design layer when needed
For CREATE and REFORMAT work, read `design/design.md` before choosing the visual direction.

### 3. Execute the matching script path
- CREATE -> design / cover / body / merge pipeline
- FILL -> inspect fields, then write values
- REFORMAT -> parse source, then feed into CREATE pipeline

### 4. Check environment before handoff
Verify the supporting Python / Node / Playwright stack before promising output.

## Reference routing

### Route selection and design
Read `references/routes-and-design.md` when you need:
- CREATE vs FILL vs REFORMAT selection
- PDF-first positioning
- visual design decision guidance

### CLI and environment
Read `references/cli-and-environment.md` when you need:
- concrete command paths
- dependency verification
- CREATE / FILL / REFORMAT script entrypoints

## Working rules

- Prefer this skill only when the PDF itself is the real final artifact.
- Always inspect form fields before filling existing PDFs.
- For CREATE and REFORMAT, treat design choice as part of the task, not an afterthought.
- If the user really needs an editable Word document as the source of truth, prefer the DOCX workflow instead.
- Historical quick-start and fuller route examples live in `references/README.md`.
