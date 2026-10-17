---
name: markline-review
description: Review loop for a markdown file. Opens the file in Markline in the browser, waits for the user's inline comments, edits the file to address them, and replies in the browser. Use when the user wants to review or iterate on a markdown document (plan, spec, README, notes) with inline comments.
---
# Markdown review loop

`MARKLINE` below is the `markline` binary (the installed app, the AppImage, or `src-tauri/target/release/markline`). Use its absolute path. It runs these commands without opening a window.

1. Open the file for the user: `MARKLINE open <file.md>`. It starts a server if none is running (or reuses the desktop app's, if it is sharing) and prints a link; give it to the user. Add `--lan` if they will read it from a phone on the same network or Tailscale.
2. Wait for feedback: `MARKLINE poll` (blocks up to 10 minutes; run it as a background command if your tool has one). If it prints "No comments yet", run it again.
3. When it prints comments, edit the file **in place**. Change only what each comment needs; keep everything else exactly as is (front matter, tables, code fences, mermaid blocks). If a comment is a question, do not edit; answer it in the reply.
4. Reply once per comment, after saving the file: `MARKLINE reply --batch <id> --comment <comment id> --lines <A-B> "what you changed"`. `--lines` are the 1-based lines that now hold the edited passage; the comment is re-anchored to that text, so the user can click it and land on your change. For a comment you answered without editing, leave out `--lines`. The browser reloads the file by itself and shows the reply under each comment.
5. Go back to step 2 until the user says they are done, then run `MARKLINE stop` if you started the server. Do not rewrite or delete the `*.comments.json` file yourself; `reply` updates it.
