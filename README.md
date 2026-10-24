# Receipt Box / Rejse

Existing receipt archive plus AI reading, reversible cropping and private trip expense sharing. No build step: deploy the repository root with Cloudflare Pages.

## Cloudflare configuration

Keep the existing D1 `DB`, R2 `BUCKET` and secret `SYNC_KEY` bindings. Add a Workers AI binding named **AI** in the Pages project's Settings → Bindings and redeploy. The default receipt vision model is `@cf/meta/llama-3.2-11b-vision-instruct`. Activate that model and accept its licence in your Cloudflare account before using it (the documented initial model request uses `prompt: "agree"`). Optional `RECEIPT_AI_MODEL` must name a compatible vision model using the same prompt/image input format.

No credentials go into browser source. The owner enters the existing Sync key on their own device. AI runs on the server and receives receipt images; if unavailable, the app labels the OCR fallback. Scanned PDFs use page one for AI, with a review warning. Local OCR examines up to three PDF pages. Auto cropping keeps the original; uncertain boundaries can be adjusted manually. This version crops rectangles; it does not straighten perspective.

## Private trips

- Trips are stored in a separate IndexedDB database, offline on the device, until the owner explicitly creates a sharing link.
- Equal, percentage, fixed-amount and weighted shares; multiple payers; participant subsets; repayments; receipt-to-expense copying; CSV export.
- Each trip uses one settlement currency. Foreign receipts use an explicit user-supplied exchange rate. All accounting uses integer minor currency units; rounding is distributed deterministically.
- Creating a shared trip requires the owner's Sync key. A random 256-bit capability link grants its holders read/write access to **that trip only**. The URL fragment is cleared on arrival. Never share your Sync key with companions. Receipt images and other trips are not included.
- Shared trips are stored under a SHA-256-derived R2 key. Every update requires an ETag. Concurrent updates return a conflict rather than overwriting changes. The UI keeps the local draft and offers to save a separate draft copy before loading the shared version.
- Sharing is link-based, not individual accounts. This release does not revoke individual participants or issue read-only links. Removing a trip from a device does not delete its shared copy. Backups include private trip links; keep backups private.
- Shared trip synchronization happens after local edits, on network reconnection, or through “Hent / gem ændringer”. Offline edits are kept locally.

## Validation

Run `node --test tests/*.test.cjs`. Tests cover currency minor units, uneven allocations, all split types, multi-payer balances, repayments, malformed records, private authorization, trip isolation and conflicting R2 writes. AI calls are mocked; a real scan requires the configured Cloudflare account.

## Ferieportal / account-based holidays

The **Ferieportal** tab is separate from receipt storage and the existing **Udlæg & splits** ledger. Create a holiday such as Thailand 2027, add flights/PNRs, hotel reservations, transport, activities and practical notes, then use the date strip, route strip, search and timeline to review the itinerary. Times are entered and displayed as local wall times with explicit IANA time zone labels; they are not automatically converted. Hotel stays appear on the relevant days. Plans can be entered manually or imported from airline itinerary PDFs through the review flow below. Emails are not imported.

The existing D1 **DB**, R2 **BUCKET** and **SYNC_KEY** bindings are reused. New, namespaced `holiday_*` tables and indexes are created idempotently on the first portal API request. No existing receipt or expense data is migrated, changed or shared. Preview deployments need their own configured bindings; production bindings do not automatically imply preview bindings.

- First register your own portal account with your name, email, a password of 12–128 characters and your existing Sync key. The key is only sent to authorize registration. Registration also works with the device's already configured receipt Sync key. Never share that key with companions.
- A holiday owner can create an invitation bound to one email address, with read-only or editor access. The owner copies and sends the link themselves; no emails are sent by the application. Invitations expire after seven days and can be cancelled before acceptance. They grant no document/holiday access until the recipient signs in or registers and accepts. The invitation email is tied to possession of the link, rather than a separate email-verification service.
- Each invited account sees only holidays where it has membership. Owners can change roles and remove membership; subsequent API requests, including document downloads, are checked again. Editors can update plans/documents, but cannot manage invitations or membership. These controls apply to the new account-based portal; legacy link-shared expense trips keep their existing behavior.
- Passwords use salted PBKDF2-SHA256 (100,000 iterations). Sessions use hashed random tokens, a 30-day expiry and Secure/HttpOnly/SameSite cookies. Auth attempts are rate-limited in D1. Password changes revoke all existing sessions, then create a new one. Self-service email password recovery is not included.
- Upload PDF, JPEG, PNG or WebP documents (20 MB per file, 100 documents and 1 GB per holiday). Uploads validate content signatures. Metadata is in D1; files are under a separate `holiday-documents/` R2 prefix. Documents can be linked to bookings. Downloads require current membership and are attachment-only/no-store. Only owners and editors can remove them.
- Portal API responses and private documents are never cached by the service worker. Opening or editing the portal requires a connection; the receipt archive and existing local expense trips retain their offline functionality. Downloaded documents remain on the recipient's device outside the portal.
- Holiday and itinerary edits carry versions. A stale edit returns a conflict and leaves the editing form available rather than overwriting a companion's newer work. Use “Hent seneste” after closing the editor to review the latest plan.

`node --test tests/*.test.cjs` uses Node 24's built-in SQLite for portal integration tests against the actual SQL statements. It checks registration/login/logout, password changes, origin checks, invitation binding/expiry/cancellation, cross-holiday isolation, role enforcement, immediate membership revocation, concurrency, private document downloads and authentication rate limits.

Portal administrators are stored separately in `holiday_admins`. They can manage all holidays and their invitations/documents. Ordinary account access remains limited to explicit membership. Administrator status is shown beside the signed-in name. Invalid owner registration without an invitation now explicitly requests the correct Sync key instead of reporting an expired invitation.


## Airline itinerary PDF import

In a holiday's **Rejseplan** or **Dokumenter**, select **Importér rejseplan**. Upload an original airline PDF (for example SAS, up to 20 MB). The original is saved to that holiday's document archive before analysis. Existing PDFs have a **Læs fly & PNR** action. If analysis fails, the saved document remains available and can be retried.

Workers AI's `AI.toMarkdown` extracts PDF text server-side, then a text model proposes individual flight segments with PNR, airline, flight number, airports and local departure/arrival dates and times. The default model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; optional `ITINERARY_AI_MODEL` must support messages and JSON mode. This uses the existing **AI** binding and the account's model availability. The parser supports text PDFs; image-only scans or password-protected PDFs may need the original booking PDF instead. No browser PDF/OCR dependency is added.

The preview does not create flights. A user with edit rights must select, review and confirm the proposals; from/to and complete departure/arrival dates and times are required for selected flights. Missing or invalid fields remain blank for correction. Times retain their local meaning, including next-day arrival dates, and unknown time zones are not inferred. PNRs may vary per segment. Evidence is displayed only when the excerpt is found in the converted source text. Suggestions are not guaranteed to be correct; the preview asks the user to check them against the PDF.

Confirmation saves the selected flights in one D1 batch and links the source document to all corresponding events through `holiday_event_documents`. Stable IDs deduplicate repeated imported segments with the same flight number, local departure, route and PNR, including request retries, without overwriting later manual edits. Matching existing manual events are also retained. Different PNRs are treated as separate bookings. Deleting an event or a document clears its import associations.

Access to analysis and confirmation is checked against the same holiday membership/administrator rules as other edits. An account can run at most 20 analyses per ten-minute window. Source documents are treated as untrusted data; the model receives no tools and cannot follow document instructions, and its output is whitelisted before confirmation. Up to 30 proposals are returned. Long document text is capped with a visible warning.

Integration tests use synthetic SAS-style booking text and mocked model/conversion responses to cover multi-leg/overnight data, preserved PNRs, the review/save boundary, document associations, duplicate prevention, retained manual edits, authorization and failed extraction. Real provider extraction quality requires checking an actual airline PDF in the deployed app.
