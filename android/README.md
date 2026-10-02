# VS2000 Android apps

Two Android apps built from one source tree:

| App | Package | Opens on |
|---|---|---|
| **VS2000 Writers** | `com.vision2000.writers` | `/writer/login` |
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

**Actions → Build writer & agent APKs → Run workflow.** Give it a version name
such as `1.0`. About four minutes later both APKs are under **Artifacts** on the
run page, as `vs2000-apks.zip`.

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
