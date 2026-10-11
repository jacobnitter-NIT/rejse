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
