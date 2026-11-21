# Architecture

NexVora ONE keeps Acode's **Cordova + WebView** architecture (not native Kotlin, not a website wrapper).

```
src/main.js                  startup, onboarding, splash hand-off
src/pages/welcome            Home dashboard + bottom navigation
src/pages/<module>           UI per module (accounts, ai, apiStudio, appstudio, database, deploy, git, projects, toolbox)
src/lib/<module>             framework-free logic per module - everything unit-tested lives here
src/lib/integrations         provider-independent integration layer (see below)
src/plugins/securestore      Android Keystore secret storage (Java Cordova plugin)
src/plugins/*                upstream Acode plugins (terminal, proot, sftp, ftp, server, ...)
```

## Integration layer (multi-user, user-owned accounts)
- `providers/{github,gitlab,bitbucket,vercel,render}.js` - one adapter each: `getIdentity()` + provider operations.
  Adapters receive the user's token by injection; nothing is hard-coded and no developer account exists.
- `oauth.js` - OAuth 2.0 **Device Authorization Grant** (public client, no secret, no redirect). `pkce.js` has
  PKCE S256 + state/redirect validation for providers that offer authorization-code flows (RFC 7636 vector tested).
- `credentialStore.js` - account *metadata* in localStorage; **secrets only in the secure backend** (`SecureStore`
  plugin → EncryptedSharedPreferences/Keystore). If the plugin fails, tokens stay in memory and the UI says so.
- `registry.js` - `AccountManager`: connect (token / device flow, validated against the provider before saving),
  disconnect (deletes the secret), switch active account, `adapter(provider)` for the active account.
- Isolation: each install has its own Android sandbox storage; accounts/keys/history are per app install.
- Tokens are only sent to the matching provider host (`git/credentials.js` maps URL → provider; unknown hosts get nothing).

## Why no confidential OAuth secrets
A public APK cannot keep a client secret. GitHub's device flow needs only a *client ID* (public) which each user/
organisation registers themselves. GitLab, Bitbucket, Vercel and Render are used with user-created tokens. If you
want browser-redirect sign-in for those, run a small backend that holds the client secret; this repo does not
include one and does not pretend otherwise.

## Git
Real `git` in the Alpine proot environment through `Executor.BackgroundExecutor`. Commands are shell-quoted, inputs
validated (no `ext::` transports, no option injection), HTTPS auth via an askpass script that reads the secret from
the process environment (never written to disk or into URLs), error output scrubbed of the secret.

## Removed from upstream
AdMob/rewarded ads/consent, in-app purchases, sponsor UI, alternate launcher icons, promotions fetch, Acode
community links. Residual: inert native `RewardPassManager`; third-party paid-plugin purchase code behind
`helpers.isIapAvailable()` (always false); the extension store still talks to `https://acode.app`.

## Security review (static, by the authors; not an external audit)
- No secrets in the repository (pattern scan for GitHub/GitLab/OpenAI/Google/AWS/Slack tokens and private keys: none).
- Tokens: Keystore-backed storage, redacted from errors/results/history; sent only to the matching provider host.
- Network: HTTPS only, cleartext limited to loopback/emulator (network_security_config + manifest flag).
- WebView: `allow-navigation` restricted to localhost/127.0.0.1 (was `*`); external links use system intents.
- Files: ZIP import rejects traversal/absolute/backslash paths, zip bombs, duplicate and encrypted entries and verifies CRCs;
  backups are checksum-verified and never overwrite without explicit confirmation; deletes require confirmation.
- Shell: every dynamic value passes `shq()` quoting plus validators; remote URLs cannot use `ext::`/option injection.
- SQL: identifiers quoted, values bound; destructive statements require confirmation.
- Known weak spots: untested Java plugin; inherited upstream code (Acode plugin sandboxing, `acode.app` store) not re-audited;
  the extension system executes third-party JS with app privileges - install only extensions you trust.
