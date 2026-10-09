# Provider architecture

Task 4 introduces a formal OpenAI-compatible Provider Profile boundary.

## Metadata and secrets

`ProviderProfile` stores `id`, `name`, normalized `baseUrl`, `model`, `createdAt`, and `updatedAt`. UI projections may add `isDefault` and `hasApiKey`; they never include the API key. Keys are stored in a separate map under `chrome.storage.local`. `settingsStorage.resolveProvider(id)` combines one metadata profile with its secret only for the immediate privileged AI call.

The legacy `yt-summarizer.provider.configs` array is migrated idempotently. New metadata and secret storage are written before the old secret-bearing record is removed. Existing metadata wins on repeated migration, and a failed write leaves the old record available for retry. Removing a profile removes its key; clear-all removes profiles, keys, legacy settings, IndexedDB records, and transcript logs.

The Dexie v2 migration appends a metadata-only provider schema and scrubs any historical `apiKey` field from `providerConfigs`. Existing migration blocks remain unchanged. Export sanitization remains defense-in-depth and emits only metadata plus `hasApiKey`.

## URL and permission rules

Base URLs are normalized by trimming trailing slashes while preserving a valid path prefix. Credentials, query strings, fragments, and non-HTTP(S) schemes are rejected. HTTPS is allowed for arbitrary hosts; HTTP is allowed only for `localhost`, `127.0.0.1`, or IPv6 loopback. Provider hosts use `optional_host_permissions`, and only the concrete origin pattern for the current profile is requested during an explicit user action. Chrome match patterns scope by scheme and host, not port, so permission requests omit a configured port while fetches retain it. Analyze and Ask AI never prompt for permission automatically.

## Transport and models

The shared OpenAI-compatible client joins `<baseUrl>/models` and `<baseUrl>/chat/completions`, sends `model: profile.model` on every chat request, and uses `Authorization: Bearer <key>` only in the privileged request boundary. `/models` is best-effort and requires only a valid base URL plus API key: duplicate/empty IDs are filtered, malformed or failed responses produce a manual-entry message, and saving does not depend on discovery. Test connection uses a minimal `POST /chat/completions` request with temperature `0` and does not depend on `/models`.

Errors are centrally redacted before reaching UI state: the active API key, Bearer tokens, Authorization values, and raw header dumps are replaced with `[REDACTED]`. Provider secrets never enter content scripts, active-video messages, transcript messages, export JSON, diagnostic logs, or URL query strings.
