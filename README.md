# Markline

A desktop Markdown editor built with Tauri. It renders as you type, edits Mermaid diagrams visually, and lets you review a document with comments that a coding agent can read and answer. The same editor runs in a phone browser through a built-in web server.

## Features

- Rendered and Source views, with a folder panel for browsing notes.
- Review comments anchored to quoted text, stored next to the file as `NAME.md.comments.json`.
- Built-in web server (**Share**) so a phone or another computer gets the same editor.
- Command line mode for agents (Claude Code, Codex, Grok): `poll` for comments, `reply` after editing.
- Runs offline. No Node server at runtime.

## Install

### Prebuilt

Every push to `main` is built by GitHub Actions for Linux and Windows and attached to the [`latest` release](https://github.com/diegogusava/markline/releases/tag/latest). The repo is private, so sign in to GitHub first.

| Platform | Asset |
|----------|-------|
| Arch Linux | `*.pkg.tar.zst` (`sudo pacman -U` it). Uses the system WebKit, so it works on Wayland. |
| Other Linux | `*.AppImage` (`chmod +x` it) or `.deb` |
| Windows | `*-setup.exe` or `.msi` |

If the release is missing, check the **Actions** tab for a failed build. Re-run it by pushing to `main` or using **Run workflow**.

### From source

Needs Rust, Node.js and npm. On Linux also `webkit2gtk-4.1` and `gtk3`.

```sh
npm install
node build-app.js              # assembles dist/ from editor/src
npx tauri build --no-bundle    # binary: src-tauri/target/release/markline
```

Run the Markdown conversion regression tests with `node --test`.

On Arch, `makepkg -si` uses the included `PKGBUILD`:

```sh
sudo pacman -S --needed webkit2gtk-4.1 gtk3 rust nodejs npm base-devel
```

Put the binary on your `PATH` for the CLI:

```sh
sudo install -m755 src-tauri/target/release/markline /usr/local/bin/
```

## Using the app

| Action | How |
|--------|-----|
| Show or hide the side panel | **Files** or **Outline** tab on the left edge, or `Ctrl+\` |
| Jump to a heading | **Outline** tab, then click the heading |
| Open a folder | **Open...** (the last folder is remembered) |
| Text size | **A-** / **A+**, `Ctrl` + `-` / `=` / `0`, or `Ctrl` + wheel |
| Page width | arrows next to the size buttons (Narrow to Full) |
| Comment on a passage | select text, then `Ctrl+Alt+M` or click the Comment bubble |

Comments are highlighted in Rendered view and listed in the side panel with line numbers. They are anchored to the quoted text, so they survive edits.

### Review with Copilot

- **Copy prompt** puts the commented passages and their open comments on the clipboard, without the rest of the document. Paste it into Copilot Chat and apply the passages it returns.
- **Save for Copilot** saves the file and its comments file. Copy `prompts/apply-comments.prompt.md` to your project's `.github/prompts/`, open the `.md` in VS Code and run `/apply-comments` in agent mode. Copilot edits the file and marks comments `applied`. Click reload in the Comments panel to pick up the changes.

## Use it from your phone

1. Open the app, then **Files > Open...** and pick your notes folder.
2. Click **Share**, keep **Allow other devices** ticked, press **Start sharing**.
3. Open the link under **On your phone** in your phone's browser (same Wi-Fi, or Tailscale away from home).

Tick **Start sharing when the app starts** to keep it on. The link stays the same between restarts.

Security:

- The phone reaches only the shared folder, only `.md`, `.markdown` and `.txt` files plus their comments files, and needs the link's token.
- The connection is plain HTTP. Use a network you trust, or Tailscale.
- Sharing stops when you close the app.

## Command line

The app binary doubles as a CLI. Run `markline --help` for usage.

```sh
markline FILE.md                  # open the desktop app
markline serve --root ~/notes --lan   # headless server, runs in the foreground
markline open notes/plan.md       # start a headless server if none runs, print the link
markline open notes/plan.md --lan # same, reachable from your phone
markline poll                     # block until "Send to agent" is pressed; print the comments
markline reply --batch ID "what I changed"
markline status
markline stop
```

Flags: `--root DIR`, `--port N` (default 8080), `--lan`, `--token T`, `--no-open`, `--file F`, `--timeout SECS`, `--json`, `--resolved`.

`open` and `poll` find the running server by themselves, whether it is the app's Share server or a headless one.

### Agent review loop

1. In the browser or the desktop app, select text, add comments, then press **Send to agent** in the Comments panel.
2. The agent runs `poll`, edits the file in place, then runs `reply --batch ID "..."`.
3. The page reloads about 2 seconds after the save (unless you have unsaved edits) and shows the reply under each comment: *Waiting for the agent*, then *Applied*.

On a touch screen, a Comment bubble appears when you select text.

Teach your agent the loop by copying `skills/markline-review/SKILL.md` to `.claude/skills/markline-review/SKILL.md` (Claude Code), or paste its steps into `AGENTS.md` (Codex and others).

On Windows the release app has no console, so CLI output is not shown. Use Linux or macOS for the agent loop.
