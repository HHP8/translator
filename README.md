# Translator 0.1.1

A local translation workspace for text, live speech, recordings, documents, and images. Built with React, TypeScript, and an Express server that keeps your OpenAI API key on your computer.

## Quick start

Requires **Node.js 22.6 or later**, npm, an OpenAI API key, and internet access for provider requests. OpenAI usage is billed to your account; access to the models configured in `app/shared/types.ts` depends on your project.

```sh
git clone https://github.com/HHP8/translator.git
cd translator/app
npm ci
```

Copy `app/.env.example` to `app/.env.local` (from inside `app`, copy `.env.example` to `.env.local`). Edit that local file securely and set `OPENAI_API_KEY` to your own key. Keep it out of Git and chat. If another Translator instance is running, set `PORT=5175` in this new file to run this copy separately.

On Windows, double-click **start-translator.cmd** at the repository root. It installs missing dependencies, builds, and opens the local app. On macOS/Linux, or to run in the terminal on Windows:

```sh
# From app/
npm run build
npm start
```

Open **http://127.0.0.1:5173**, or the port you configured. Settings -> Check connection checks configuration and model listings; a listing does not guarantee successful inference. The launcher reuses an existing non-mock Translator server on the selected port, so use a distinct port when running multiple copies.

## Features

- **Text:** select languages and a model, paste text, then Translate or Ctrl+Enter.
- **Live Voice:** allow microphone access and translate finalized phrases; Stop finishes pending phrases, while Cancel aborts unfinished work. No spoken replies.
- **Recordings:** upload MP3, MP4, MPEG, MPGA, M4A, WAV, or WebM, up to 25 MB.
- **Documents:** PDF, DOCX, TXT, and Markdown, up to 20 MB, 50 PDF pages, and 200,000 extracted characters. PDFs are processed page by page, including scans. DOCX text and tables are extracted locally; upload embedded images separately. DOCX archives are validated with an 80 MiB actual decompression limit. Prepared PDFs are limited to 20 MiB per serialized page and 32 MiB of encoded page data in total; split a document if it exceeds this processing budget.
- **Images:** upload, paste, or drop PNG, JPEG, or WebP, up to 20 MB.
- **Output:** copy or download TXT, Markdown, or DOCX. Partial exports carry incomplete markers. Original page layout and fonts are not reconstructed.
- Responsive layouts, right-to-left languages, cancellation, and explicit retries.

The source preserves the original curated translation models: GPT-6 Luna, GPT-6.1 Sol (default), and GPT-6 Astra. Audio uses `gpt-live-transcribe` and `gpt-transcribe`. Model IDs, availability, API compatibility, and quality have **not been verified against a live provider for this public release**. Review `app/shared/types.ts` and `app/server/provider.ts` if your account requires different models. There is no automatic substitution or provider retry.

## Data and local operation

Your key is read by the local server from the ignored `app/.env.local`; it is not included in browser assets. Text and files are sent to OpenAI for processing, subject to your account's provider terms and data settings. Content is held in memory and clears on refresh/close; language and model preferences use localStorage. The server binds to loopback and validates host/origin. Keep this app local: it does not include authentication or a multi-user hosting setup.

Static hosting and GitHub Pages cannot provide the Express API. The retained Sites worker serves static assets only. Publishing this source does not deploy a public translation service or include API credits.

## Development and verification

```sh
cd app
npm ci
npm run typecheck
npm test
npm run build
npm run test:sites
npm run release:check
npm audit --ignore-scripts
```

The test suite uses generated inputs and mocked provider/network responses; it does not load a real key or make paid requests. For a test preview, set `TRANSLATOR_MOCK=1` and a free `PORT` in the server process, then run `npm start`. The interface displays a test-provider banner. Mock mode cannot open live microphone sessions and is never used as a fallback after API errors. Optional browser QA fixtures can be generated with `node scripts/qa-fixtures.mjs`.

See [release notes](CHANGELOG.md) for validation limits. Live translation/transcription, OCR quality, and physical microphone/WebRTC operation require separate testing with your account. The security patch preserves the original 0.1.0 tag; use 0.1.1 or later for the security fixes. The public release excludes personal credentials, private setup records, reference images, local exports, logs, and original Git metadata.

## License

Project source is available under the [MIT license](LICENSE), permitting public and commercial use, modification, and redistribution with the copyright and license notice preserved. Dependencies retain their respective licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). OpenAI services remain subject to their own terms and charges. This is an independent project and is not endorsed by OpenAI.
