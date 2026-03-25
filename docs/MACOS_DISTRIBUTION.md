# macOS Distribution and Install Notes

Code Trail does not currently use an Apple Developer ID certificate or notarization. The macOS app bundle produced by this repo is re-signed ad-hoc so the bundle is internally valid, but macOS can still warn or block it after an internet download because the download is quarantined by Gatekeeper.

This means:

- A locally built app usually runs on the same Mac without extra steps.
- A `.zip` downloaded from GitHub may require one manual allow step.
- A downloaded app is expected to need either Finder `Open` or `xattr`.

## Install From A Downloaded Zip

1. Download the release `.zip`.
2. Extract it in Finder.
3. Open `INSTALL.txt` if you want the short version inside the archive itself.
4. Move `Code Trail.app` to `/Applications` if you want.
5. Try opening it normally.

If macOS blocks it, use one of these workarounds:

### Option 1: Finder Open

1. In Finder, right-click `Code Trail.app`.
2. Choose `Open`.
3. Confirm the dialog.

### Option 2: Remove Quarantine In Terminal

```bash
xattr -dr com.apple.quarantine "/Applications/Code Trail.app"
```

If you did not move it to `/Applications`, use the extracted path instead.

Example:

```bash
xattr -dr com.apple.quarantine "$HOME/Downloads/Code Trail.app"
```

## Build A Working App From Source

These steps are for macOS users who downloaded the source zip or cloned the repo and want to build their own `.app`.

### Prerequisites

- macOS
- Bun
- Node.js 20+
- Xcode Command Line Tools

Install Xcode Command Line Tools if needed:

```bash
xcode-select --install
```

### Build Steps

```bash
git clone https://github.com/anthropics/codetrail.git
cd codetrail
bun install
bun run desktop:make:mac
```

For a specific CPU architecture:

```bash
bun run desktop:make:mac:arm64
bun run desktop:make:mac:x64
```

The output is written under:

```text
apps/desktop/out/
```

Typical artifact paths:

```text
apps/desktop/out/CodeTrail-darwin-arm64/Code Trail.app
apps/desktop/out/CodeTrail-darwin-arm64/CodeTrail-arm64.zip
```

If you build locally and run locally on the same Mac, the app usually opens without extra steps.

## Sharing A Built App With Other macOS Users

If you upload the generated zip to GitHub or send it over the internet:

- recipients should expect the app to be quarantined
- they will usually need Finder `Open` or the `xattr` command above

Without an Apple Developer account, this is the best supported distribution path.
