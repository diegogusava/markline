---
mode: agent
agent: agent
description: Apply the review comments saved by Markline to the open Markdown file
---
Apply the review comments for the Markdown file I have open (`${file}`).

The comments are in `${fileDirname}/${fileBasename}.comments.json`. Read that file and, for every entry whose `status` is `"open"`:

1. Find the passage using `quote` (and `startLine`/`endLine` as a hint; the lines may be slightly off if the file changed since).
2. Make the change that `comment` asks for in `${fileBasename}`.
3. Set that entry's `status` to `"applied"` in the comments file. If the comment is a question and not a change request, leave the document alone, answer it in the chat, and set `status` to `"resolved"`.

Rules:
- Change only what each comment needs. Do not reformat, reword or reorder anything else.
- Keep front matter, tables, code fences and ```mermaid blocks intact unless a comment is about them.
- Do not touch other fields of the comments file (`id`, `quote`, `pre`, `suf`, `created`).
- When done, summarise in one line per comment what you changed.
