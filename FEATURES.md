# NexVora ONE - features and honest status

**Legend.** IMPLEMENTED = code exists. TESTED = automated tests were actually executed (where, and how, is stated).
BUILD VERIFIED = a real APK build succeeded. DEVICE VERIFIED = run on an Android device/emulator.

> **Nothing is BUILD VERIFIED and nothing is DEVICE VERIFIED.** The authoring sandbox had no Android SDK, Gradle,
> network or device. "TESTED" below means: the pure logic module was exercised by the listed test file, run with
> Node 22 (using a thin vitest shim) against real local servers / the real `git`, `curl`, `unzip`, Python `zipfile`
> and real SQLite (`node:sqlite`). The vitest runner itself and every screen (UI) were **not** run.

| Module | Implemented | Tested (logic) | UI tested | Notes |
|---|---|---|---|---|
| Rebrand (id `com.nexvora.one`, name, About, licences, splash, onboarding) | yes | config checks only | no | upstream attribution kept |
| NexVora theme, global styles, Home dashboard, bottom navigation | yes | no | no | bottom nav lives on the Home page, not on every screen |
| Ads / AdMob / IAP / sponsors removed | yes | scan only | no | native `RewardPassManager` left inert |
| Developer Toolbox (19 tools + image optimizer) | yes | 16 tools' logic: `toolbox*.test.js` (20 tests) | no | HTML/JS formatters (Prettier) and Markdown preview (markdown-it + DOMPurify) need the app bundle: **not tested**; image optimizer: only sizing helper tested |
| API Studio | yes | `apiStudio.test.js` (9) real HTTP server | no | Cordova HTTP transport (no CORS) untested; no environment variables, no folders in collections |
| Connected accounts (GitHub, GitLab, Bitbucket, Vercel, Render) | yes | `integrations.test.js` (12), `gitCredentials.test.js` (2) against a **mock** provider server | no | endpoint shapes written from provider docs, **never run against the live services** |
| Secure token storage (Android Keystore plugin `SecureStore`) | yes (Java) | **no** | no | not compiled; no plaintext fallback: without it tokens are memory-only |
| GitHub sign-in | device flow (needs YOUR OAuth client ID) or token | state machine tested (pending, slow_down, expiry...) | no | see BUILD.md "GitHub OAuth app" |
| GitLab / Bitbucket | token / app password only | mock tested | no | no OAuth: GitLab/Bitbucket OAuth need a confidential backend or unverified flows - not claimed |
| Git Studio | yes | `gitStudio.test.js` (14) with the **real git binary** | no | runs inside the Alpine Linux env (must be installed); SSH key generation test was skipped (no ssh-keygen in sandbox); push/pull tested against a local bare repo, **not** against GitHub |
| Database Studio (sql.js / SQLite WASM) | yes | `databaseSql.test.js` (10) real SQLite via `node:sqlite` | no | the sql.js engine adapter and WASM bundling are **not tested** |
| AI Studio (OpenAI-compatible / llama.cpp server) | yes | `aiStudio.test.js` (14): streaming, SSE edge cases, model downloads with real curl | no | **no model has generated text on a device**; `llama-server` must be installed in the Linux env by the user |
| Model manager (download, GGUF check, delete, serve) | yes | real shell/curl tested | no | https only; downloads not validated against huggingface |
| Deploy Studio (GitHub Actions, Vercel, Render) | yes | `deploy.test.js` (7); generated YAML validated with a YAML parser | no | status shown only as the provider reports it; never run against live providers |
| App Studio (Android project generator, manifest/Gradle checks) | yes | `appStudio.test.js` (7) | no | generated project **never compiled**; APKs come from GitHub Actions |
| Projects, ZIP import/export, backup/restore | yes | `zip.test.js` (7) vs real unzip/Python, `projects.test.js` (10) on the real file system | no | the `fsOperation` adapter (SAF/content URIs) untested |
| Code editor, tabs, search, terminal, proot Linux, SFTP/FTP, preview server, plugins | upstream Acode | not re-tested | no | |
| Network policy | yes | no | no | HTTPS only; cleartext HTTP only to localhost/127.0.0.1/10.0.2.2 |

## Not implemented / known gaps
- Merge-conflict resolution UI, interactive rebase, GitHub pull requests/issues, Git LFS.
- GitLab/Bitbucket OAuth, multiple simultaneous GitHub accounts beyond switch-active.
- Vercel/Render OAuth (token only). Creating *new* Vercel/Render projects (only list/redeploy/trigger).
- Downloading Actions artifacts inside the app (the link opens GitHub).
- On-device APK compilation (not feasible).
- Redesign is theme + global stylesheet + new screens; some deep upstream screens only inherit colours.
- Light theme is the stock Acode light themes, not a NexVora light palette.
- Settings → Connected accounts exists; a unified NexVora settings screen (Appearance/Storage/Network panels) is **not** built - upstream settings are used.
- No notifications screen, no storage-management screen beyond project sizes.
