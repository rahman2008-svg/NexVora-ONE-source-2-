# Building NexVora ONE

## GitHub Actions (recommended)
1. Push this repository to `rahman2008-svg/NexVora-ONE`.
2. Open **Actions → NexVora ONE - Android Build → Run workflow** (also runs on push/tag).
3. Download artifacts: `NexVora-ONE-Debug` (`NexVora-ONE-Debug.apk`) and `NexVora-ONE-Release`.
4. Tag `v1.0.0` to also attach the APKs directly to a GitHub Release (no ZIP wrapper).

### Release signing
Without secrets the release build is **unsigned** (`NexVora-ONE-Release-unsigned.apk`, not installable).
To sign, add repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Never commit keystores.

## Local build
Requirements: Node 22, JDK 21, Android SDK (platform 36, build-tools), `npm i -g cordova@13`.
```
git clone https://github.com/Acode-Foundation/codemirror-lsp-client codemirror-lsp-client   # upstream submodule
node utils/setup.js
npm run build -- d apk     # debug
npm run build -- p apk     # release (unsigned)
```
Output: `platforms/android/app/build/outputs/apk/{debug,release}/`.

## Known build notes
- `codemirror-lsp-client` is an upstream git submodule that was not in the source archive; the workflow clones it.
- minSdk 26, targetSdk 36 (from `config.xml`). Not re-verified by an actual build here.
- Tests: `npm test` (vitest). Not executed by the author (no npm network in the authoring sandbox).

## Tests
`npm test` runs the whole suite. The NexVora module suites (`tests/unit/{toolbox,toolboxFormat,apiStudio,integrations,
databaseSql,gitStudio,gitCredentials,aiStudio,deploy,zip,projects,appStudio,nexvoraConfig}.test.js`) need Node >= 22
(built-in `node:sqlite`), `git`, `curl`, `unzip` and `python3` on the PATH (all present on `ubuntu-latest`).
The CI workflow runs them as a **blocking** step and the full upstream suite as a reported, non-blocking step.
The authors could not run vitest itself; the same assertions were run with a Node shim, so expect to fix small
runner differences on the first CI run.

## GitHub OAuth app (for "Sign in with GitHub")
1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App (any homepage/callback URL).
2. Tick **Enable Device Flow**. Copy the **Client ID** (it is public; there is no secret to embed).
3. In NexVora ONE: Settings → Connected accounts → GitHub → Connect → paste the client ID → enter the shown code at
   github.com/login/device. Or skip all this and paste a fine-grained personal access token instead.
Scopes requested: `public_repo` by default (public repositories). Choose a token with `repo` for private repositories
and `workflow` to trigger Actions. Never share your client ID's app with others' tokens - each user signs in themselves.

## Vercel / Render / GitLab / Bitbucket
Create a token/API key in YOUR account settings and paste it in Connected accounts. Bitbucket also needs your username.

## Local AI
1. Settings → Terminal → install the Linux environment.
2. Install llama.cpp inside the Linux environment (for example `apk add llama.cpp` if your Alpine repository carries it,
   otherwise build it from source). `llama-server` must be on the PATH.
3. Download a `.gguf` model (https link). Needs free storage and RAM roughly equal to the file size.
4. Press **Serve**, then Connection → `http://127.0.0.1:8080` → Check connection → pick the model.
Nothing here has been run on a device by the authors.

## Linux-env networking note
HTTP to other machines on your Wi-Fi (e.g. `http://192.168.1.5:8080`) is blocked by design. Use HTTPS or run the
server on the phone itself.

## Publishing this source to github.com/rahman2008-svg/NexVora-ONE (run on your own computer or in Termux)
No token is ever needed in chat. Authenticate with your own credentials (`gh auth login`, an SSH key, or the Git
credential manager) and run:
```
unzip NexVora-ONE-source.zip && cd Acode-main
git init -b main && git add -A && git commit -m "NexVora ONE 1.0.0"
git remote add origin https://github.com/rahman2008-svg/NexVora-ONE.git   # or git@github.com:...
git push -u origin main          # use --force-with-lease only if you intend to replace existing history
```
Then open **Actions → NexVora ONE - Android Build → Run workflow**, and download the `NexVora-ONE-Debug` artifact
(GitHub always wraps workflow artifacts in a ZIP; the APK inside is the real installable file). Tag `v1.0.0` to also
get the APKs attached directly to a GitHub Release. If the run fails, paste the failing step's log to get it fixed.
