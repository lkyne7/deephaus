# Hybrid PDF extraction worker

This Render worker claims `source_extraction_jobs`, streams the private source PDF to its
scratch disk, routes simple pages through pdfjs, and sends complex pages to the current
Mistral OCR model in bounded batches. It persists normalized page blocks before starting
card generation.

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_BASE_URL`
- `EXTRACTION_WORKER_SECRET` (the same secret must be set on the web deployment)
- `MISTRAL_API_KEY`

Optional: `EXTRACTION_WORKER_TMPDIR`, `EXTRACTION_WORKER_POLL_MS`.

Production Mistral accounts must have the required zero-data-retention agreement/settings
enabled before `PDF_EXTRACTION_V2` is turned on. Document content, signed URLs, and OCR
payloads must never be added to worker logs.
