# CommunityMed Pro — PRD

## Original problem statement (latest iteration)
> "in the form builder we can't add options for select one / select multiple / skip logic / location input / longitudinal tracking. 2nd in the growth chart include MUAC, also add other types of growth charts mentioned in PRD."

## Stack
TanStack Start + React + Vite + Tailwind v4 + Recharts; localStorage-backed store; Cloudflare Worker target.

## Implemented (2026-01)
- Form builder (`/forms/new`):
  - New field types: **Select one (radio)**, **Select many (multiselect)**, **Location (GPS)**.
  - Existing types preserved: text, number, date, choice (button-style), long text, yes/no.
  - Per-form **Longitudinal tracking** flag.
  - Per-field **Skip logic** with multi-rule evaluation (mode: all/any) and ops eq/neq/gt/lt/contains.
- Form fill (`/forms/$id/fill`):
  - Renders new field types (radio inputs, checkbox grid, GPS capture w/ accuracy).
  - Evaluates skip logic on every change; hidden fields are excluded from validation/submission.
  - Surfaces prior visits for longitudinal forms.
- Patient timeline correctly renders array (multiselect) and `{lat,lng}` (location) values.
- Growth chart (`/tools/growth`) refactored to **tabs**:
  - Weight-for-age (kept), Height/Length-for-age, Weight-for-height, BMI-for-age (5–19y),
    **MUAC-for-age (3–60mo)**, Head-circumference-for-age.
  - Per-chart inputs and points retained per tab; sex toggle (boys/girls);
    chart-specific classification (incl. MUAC SAM <11.5 / MAM <12.5, stunting, micro/macrocephaly).
  - WHO reference data centralised in `/app/src/lib/who-growth.ts` (approximated for MVP screening).

## Files touched
- `src/lib/store.ts` (types: radio/multiselect/location, SkipRule, VisibleIf, longitudinal flag)
- `src/lib/who-growth.ts` (NEW reference tables + interpolation + classification)
- `src/routes/forms.new.tsx` (palette, editors, skip-logic editor, longitudinal toggle)
- `src/routes/forms.$id.fill.tsx` (new field renderers, skip-logic eval, geolocation)
- `src/routes/tools.growth.tsx` (chart-type tabs)
- `src/routes/patients.$id.tsx` (timeline value formatting)

## Backlog / Next
- P1 Persist longitudinal submissions to a per-form trend chart on the patient page.
- P1 Render saved Location values as a small leaflet/openstreetmap thumbnail.
- P2 Replace approximated WHO bands with full LMS-based exact z-scores.
- P2 Add WHO 2007 reference tables for height-for-age 5–19y inside BMI tab.
- P2 Drag handles for true reorder; field duplication.
