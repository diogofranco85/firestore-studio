# Firestore Studio — Design Spec

Date: 2026-09-09

## Purpose

A local web tool for browsing and editing data in a running Firestore
emulator, similar in spirit to Prisma Studio: a tree of collections,
a table of documents, and a type-aware document editor, with full
CRUD support.

## Context / Constraints

- Target emulator: Firestore emulator for GCP project `floci-gcp`,
  listening on `localhost:4588`.
- Root-collection discovery requires the Admin SDK (`listCollections`)
  — the client-side Firebase SDK has no equivalent API — so the tool
  needs a small backend, not a pure static page.
- No existing codebase to integrate with; this is a new, standalone
  project.

## Non-goals

- Production/live Firestore support (emulator only; no auth, no
  security-rule evaluation).
- Query builder / complex filtering beyond simple pagination (future
  enhancement, not in this spec).
- Real-time updates via listeners (a manual refresh is enough for a
  local dev tool).

## Architecture

Single Node.js project, two top-level pieces:

- `server/` — Express app using `firebase-admin`, connected to the
  emulator via `FIRESTORE_EMULATOR_HOST` and a configured `projectId`.
  Serves both the REST API and the static frontend.
- `public/` — vanilla HTML/CSS/JS frontend, no build step, talking to
  the backend over `fetch`.

Configuration (project id, emulator host:port, server port) comes from
a `.env` file with sensible defaults:

```
FIRESTORE_PROJECT_ID=floci-gcp
FIRESTORE_EMULATOR_HOST=localhost:4588
PORT=4001
```

`npm start` runs the server, which serves the app at
`http://localhost:4001`.

## Backend

### `server/firestore.js`

Initializes the Admin SDK against the emulator and exposes:

- `listCollections(parentPath?)` — root collections if no parent,
  otherwise subcollections of the document at `parentPath`.
- `listDocuments(collectionPath, { pageSize, cursorDocId })` —
  documents ordered by document ID, paginated with `startAfter`.
- `getDocument(docPath)` — single document data + list of its
  subcollection IDs.
- `createDocument(collectionPath, { id?, data })` — auto-ID when `id`
  is omitted.
- `updateDocument(docPath, data)` — full overwrite of the document
  (`set`, not merge — the editor always submits the complete document).
- `deleteDocument(docPath)`.

### Type serialization

Firestore has types JSON can't represent natively. The backend maps
them to tagged objects on the way out, and reverses the mapping on the
way in:

| Firestore type | Wire format |
|---|---|
| Timestamp | `{ "__type": "timestamp", "value": "<ISO 8601>" }` |
| GeoPoint | `{ "__type": "geopoint", "lat": <num>, "lng": <num> }` |
| DocumentReference | `{ "__type": "reference", "path": "<doc path>" }` |
| Bytes | `{ "__type": "bytes", "base64": "<string>" }` |
| string / number / boolean / null | passed through as-is |
| array / map | recursively converted, same rules per element |

### `server/routes.js`

REST endpoints keyed on a generic path segment so navigation works at
any nesting depth:

- `GET /api/collections` — root collections.
- `GET /api/collections/*` — subcollections, where `*` is a document
  path (e.g. `/api/collections/users/abc123`).
- `GET /api/documents/*?pageSize=&cursor=` — list documents in the
  collection at path `*` (e.g. `/api/documents/users`).
- `GET /api/document/*` — one document's data + its subcollection IDs.
- `POST /api/document/*` — create a document in the collection at `*`
  (body: `{ id?, data }`).
- `PUT /api/document/*` — overwrite the document at path `*` (body:
  `{ data }`).
- `DELETE /api/document/*` — delete the document at path `*`.

All error responses: `{ "error": "<message>" }` with an appropriate
HTTP status (400 bad input, 404 not found, 503 emulator unreachable,
500 unexpected).

## Frontend

Single page, three panels:

1. **Sidebar** — tree of collections. Each collection node lists its
   documents lazily on expand; each document node fetches and lists
   its own subcollections lazily on expand.
2. **Table** — documents of the currently selected collection.
   Columns are the union of top-level field names seen on the current
   page (plus a fixed "id" column). Cells show a short, type-aware
   preview of the value. Row click opens the document editor. A
   "Next / Previous" control drives pagination (default page size 50).
   An "Add document" button opens the editor pre-filled empty, with an
   optional custom-ID input (blank = auto-ID).
3. **Document editor** (side panel) — one row per top-level field:
   a type badge (derived from the wire format above) and an input
   matching the type — text for string, number input, checkbox for
   boolean, `datetime-local` for timestamp, paired lat/lng inputs for
   geopoint, plain text (doc path) for reference. Map and array fields
   are edited as a single JSON textarea (validated as JSON before
   save) rather than a recursive field-by-field UI — keeps the editor
   simple while still covering nested data. "Save" issues a `PUT` with
   the full reconstructed document; "Delete" issues a `DELETE` after a
   confirm dialog.

No frontend framework or bundler — plain `<script>` files, `fetch`,
and DOM APIs.

## Error handling

- Backend startup checks the emulator is reachable and logs a clear
  message either way.
- Any API failure surfaces as a dismissible banner in the UI instead
  of a silent failure or a blank screen; the previously loaded table/
  editor state stays visible underneath.
- Destructive actions (document delete) require an explicit confirm
  step.
- Invalid JSON in a map/array textarea blocks save with an inline
  error instead of being sent to the server.

## Testing

- One integration test script (`server/test-integration.js` or
  similar, run with the real emulator up) that exercises the full
  round trip through the REST API: create a document with each
  special type, list it, read it back, update it, delete it, and
  assert the responses at each step. This is the part of the system
  where a regression would be most costly to miss.
- No unit-test framework overhead beyond that; frontend behavior is
  verified manually in the browser during development.

## Open questions

None outstanding — scope confirmed with the user during design.
