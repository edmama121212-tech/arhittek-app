# Catalogue plans — ARHITTEK template 3

`src/features/catalog/catalog-plan.js` isolates a floor from its source PDF and
paints it with PDF.js inside the ARHITTEK template, producing a 3600 × 3200 PNG.
PDF.js retains the source walls, windows, doors, straight and winding stairs,
thin/unnumbered treads, entrance steps, dashed flights, furniture, room labels,
clipping, optional layers, opacity, patterns and paint order. The original
labels keep their own positions and sizes. No architectural lines are removed
or invented by a selective detail classifier.

Floor detection includes patterned balconies and landings beyond the structural
walls. The crop has a margin for door swings and exterior steps. Nearby floor
tables are masked only when their region does not intersect detected walls or
floor fills. Surrounding sheet borders and adjacent drawings fall outside the
crop. Internal source annotations remain intact to preserve drawing fidelity.

The template adds the heading, a light diagonal logo/phone watermark, and
confirmed overall dimensions. Derived dimensions retain the ≈ marker and their
recorded calibration basis. Source rendering and the crop are recorded as
`renderer: pdfjs-native`, `detailPolicy: preserve-all`, and `sourceCrop`.
PNG images retain the correct MIME type and extension.

Plans in catalogue cards link to their full resolution image for phone zoom.
The same markup is used in internal, public and standalone cards.

## Existing cards

Reimporting an exactly matching original PDF and project number can refresh
older ARHITTEK plan image slots and thumbnails. Manual fields, facade images,
current/newer styles and unknown custom styles are preserved. Updates check
the previously read `updated_at` to avoid overwriting concurrent edits. The
existing website card is synced after a successful refresh.

## Validation

`npm run test:catalog:pdf` covers actual PDF.js rendering and pixel comparisons
for thin straight/winding stairs, dashed flights, exterior steps, compound wall
holes, paint-order occlusion, patterned balcony bounds, safe full-image links,
floor/basement extraction, duplicate refresh, and correct PNG uploads.
The browser suite runs on Chromium and WebKit, including missing stream async
iteration. Unsupported scans and ambiguous floor/room extraction still require
review instead of silently saving an incomplete card.
