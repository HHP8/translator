# Changelog

## 0.1.1 - 2026-10-24

Security maintenance release. The original 0.1.0 tag is preserved.

- Apply API origin and Fetch Metadata checks through the same Express route matcher as all API handlers, including mixed-case and trailing-slash paths.
- Validate actual decompressed DOCX entry bytes, reject ambiguous/duplicate paths, and rebuild a stored archive from validated content before Word conversion.
- Bound prepared PDF output to 20 MiB per page and 32 MiB of encoded data overall; stop preparation on cancellation between pages.
- Disable compressed JSON request inflation and update vulnerable direct/transitive dependencies.
- Add synthetic security regression cases and run npm advisory checks in CI.

Validation covers local mock requests, synthetic documents, normal document extraction, type checking, build and packaging. No real credentials, paid provider requests or physical microphone tests are used. In-process PDF operations already in progress are not preemptible; this release does not add worker-process isolation.

## 0.1.0 - 2026-10-24

Initial public source release, prepared as a separate copy of the local Translator application.

- Preserves text, live voice, recording, document, and image translation workflows.
- Adds MIT licensing, installation documentation, dependency license inventory, CI, and a public-source preflight.
- Omits credentials, local environment files, reference screenshots, personal QA records, exports, logs, dependencies, build output, and original Git metadata.

Validation is recorded in the GitHub release after local checks. Automated checks use mocks and synthetic inputs. Paid provider requests, model availability, real translation/OCR quality, physical microphones/WebRTC, and a new browser workflow pass are not verified by this release.
