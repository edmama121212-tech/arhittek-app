# Clean catalogue plans — ARHITTEK template 1

New PDF imports render plans before uploading card images. `catalog-plan.js` reads PDF.js vector operations, separates floor drawings and renders one consistent 1800 × 1600 PNG per floor. Facade extraction remains separate. No generation service changes or invents architectural geometry.

## Drawing

The style uses white/light room backgrounds, dark structural walls, blue glazing/overall dimensions, restrained door and stair lines, and room names. Technical text, internal dimension chains, dashed axes, sheet borders, legends, tables and adjacent drawings are excluded. The original PDF remains unchanged.

The watermark uses the ARHITTEK house silhouette, 44px wide, and `+79226593872`, rotated together −45° with opacity 0.075. Room labels are drawn above it. Plans are uploaded as PNG with `image/png`, not mislabeled JPEG.

Geometry comes from filled structural contours (including compound holes), or white structural contours with repeated diagonal wall hatching. Stroke-only plans require an explicit closed main outline. PDF graphic-state clipping, optional-layer visibility, opacity, paint order and pattern occlusion are respected. A technical line covered by a later floor fill is not resurrected in the catalogue image.

Room names are linked to native labels and the correct floor explication; number-only labels additionally require a nearby matching room area. Two floors on one page are split by structural groups and floor headings, including headings without the word “План”.

## Dimensions and uncertain input

Explicit local dimensions have priority. A declared drawing scale can determine dimensions. For the first floor, dimension-line values already found elsewhere in the album may be used only if the aspect ratio agrees. Otherwise at least three independent source room areas and their vector floor polygons must yield the same uniform scale within 0.5%, with at least 70% agreement. Area-calibrated/derived dimensions are marked approximately (≈), their basis is stored, and the import reports how many rooms supported the calculation.

A scan without reliably extractable vectors, ambiguous floor separation, unlocated room labels or unconfirmed dimensions returns a specific review blocker. The importer does not silently insert the original technical sheet as a supposedly cleaned plan, and does not auto-save an incomplete result. Extracted card data remains available for review.

## Existing cards

On a duplicate import, only an exactly matching original PDF hash and project number can refresh legacy plan image slots and thumbnails. Existing title, price, facade images, room tables and other card fields remain unchanged. A card update is conditional on its read `updated_at`; concurrent edits cause a retry message. Current/newer style versions and unknown custom styles are preserved. A different PDF sharing the number does not overwrite the card. Successful image refresh is synced to the existing website card, not a duplicate.

## Validation

`npm run test:catalog:pdf` includes real PDF.js vector rendering, floor/basement extraction, compound wall holes checked at pixel level, rejection of missing room positions/scans; plans with unconfirmed dimensions omit dimension chains, drag-and-drop, duplicate/legacy refresh and correct PNG uploads. CI runs this on Chromium and WebKit, with missing stream async iteration reproduced. Local real-album checks also cover project 16626 (two floors on one sheet) and project 13225 (36-page album, hatched walls, two floors).

Recognition v2: numbered bedroom abbreviations, negative basement levels, page-level project-number consensus, aggregate site rows excluded from floor totals, alternate plan candidates, and dimension-free clean plans when source dimensions are unavailable. Unknown project numbers remain manual.
