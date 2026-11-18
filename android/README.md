# VS2000 Android apps

Two Android apps built from one source tree:

| App | Package | Opens on |
|---|---|---|
| **VS2000 Writers** | `com.vision2000.writers` | `/writer/login?app=writers` |
| **VS2000 Agents**  | `com.vision2000.agents`  | `/` (main login) |

## What these actually are

Each app is a **Trusted Web Activity** — it runs vs2000smartportal.com inside the
phone's own Chrome engine, full screen, with no address bar. It is not a copy of
the site; there is nothing to keep in sync. Deploy the web app and every phone
has the new version on next launch.

A plain WebView wrapper was the alternative and was rejected on purpose: the Web
Share API does not exist in Android WebView, so a writer sharing a ticket image
to WhatsApp would have been broken by the app itself. A TWA is real Chrome, so
downloads, printing, the QR camera and sharing behave exactly as they do today.

## The Writers app stays on the writer portal

`?app=writers` on the launch URL (and, for older installs, the
`android-app://com.vision2000.writers` referrer Android gives the app) marks the
tab as the Writers app. From then on the site sends every route to a login -
signing out, an expired session, `/`, `/login` - to `/writer/login`. The office
login, whose role list has no Writer, cannot be reached from the app. Signing
out revokes the session on the server (with the refresh token too, if the
access token has lapsed), clears both tokens and every cached response, and
replaces the history entry so Back cannot return into the signed-out app.

All of that is in the web app, so it reaches installed phones on the next
deploy. The APK itself adds the launch marker and the galaxy splash
(`app/src/writers/res`).

One thing a flavour cannot separate: a Trusted Web Activity uses the phone's
Chrome, so both apps and Chrome share the site's storage. If an office user is
signed in in Chrome or the Agents app, the Writers app does not show their
pages - it sends them to the writer login, and a writer signing in there
replaces that session.

## The one thing that must be true

`https://vs2000smartportal.com/.well-known/assetlinks.json` must be reachable and
must contain the signing certificate's fingerprint. That file is committed at
`artifacts/web/public/.well-known/assetlinks.json` and deploys with the site.

**If it is missing or the fingerprint does not match, the apps still work but show
a browser address bar across the top.** That is the symptom to look for.

Check it after any deploy:

```
curl -s https://vs2000smartportal.com/.well-known/assetlinks.json
```

## One-time setup

In the repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|---|---|
| `VS2000_KEYSTORE_BASE64` | contents of `keystore-base64.txt` |
| `VS2000_KEYSTORE_PASSWORD` | the password from `KEYSTORE-README.txt` |
| `VS2000_KEY_ALIAS` | `vs2000` |
| `VS2000_KEY_PASSWORD` | same as `VS2000_KEYSTORE_PASSWORD` |

## Building

A push to `main` that changes anything under `android/` builds both APKs
automatically. You can also use **Actions → Build writer & agent APKs → Run
workflow**. About four minutes later the signed APKs are on the
**Releases → "Android apps - latest"** page (tag `android-latest`), which always
holds the newest build. They are also under **Artifacts** on the run page.

Tagging a release does the same and attaches the APKs to it:

```
git tag v1.0 && git push origin v1.0
```

The build fails loudly rather than quietly shipping an unsigned APK — it runs
`apksigner verify` on both files before uploading them.

## Installing on a phone

Share the `.apk` on WhatsApp. On first install Android asks to allow installing
from that source; the writer taps **Settings → Allow from this source**, once per
phone. This is normal for apps distributed outside the Play Store.

## Updating

Writers do **not** need a new APK when the site changes — the app loads the live
site. A new APK is only needed to change the app's name, icon, or start page.

When you do rebuild, keep using the same keystore. A different key makes Android
treat it as a different app, and writers would have to uninstall the old one
first, so **the keystore file is the single thing here worth backing up.**
Lose it and you can never update an installed app in place.
