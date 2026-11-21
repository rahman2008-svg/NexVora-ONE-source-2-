# Privacy

- No ads, no analytics SDK, no crash-reporting service, no mandatory account.
- Projects, databases, chat history, API history and settings are stored on your device only.
- Account tokens (GitHub/GitLab/Bitbucket/Vercel/Render, optional AI API key) are stored encrypted with a
  key in the Android Keystore. They are never written to logs; request results store redacted headers only;
  API Studio and saved requests never persist tokens/passwords.
- **Network connections the app can make:** (1) `https://acode.app` - the inherited extension store/update checks;
  (2) the providers you connect (api.github.com, github.com, gitlab.com, api.bitbucket.org, api.vercel.com,
  api.render.com); (3) servers you type in (Git remotes, API Studio targets, AI endpoint, model download URLs);
  (4) package mirrors used by the Linux environment when you install packages.
- Cleartext HTTP is only allowed to `localhost`, `127.0.0.1` and `10.0.2.2`; everything else must be HTTPS.
- Permissions: storage (Android ≤ 12), notifications, vibrate. They are explained on first launch **before** the prompt.
- Local AI: prompts go only to the endpoint you configure. With a server on this device nothing leaves it.
- This describes the code as written; it is not a legal review, and the app has not been security-audited.
