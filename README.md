# MotionDevLab Claude Plugins

Works on Claude Code and OpenClaude.

Short-name forks of upstream Claude plugins that stay under the 64-character
OpenAI-compatible function-name limit once namespaced as
`mcp__plugin_<plugin>_<server>__<tool>`.

## Plugins

### cdt (v1.9.0)

Fork of
[ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)
with the MCP server renamed `chrome-devtools` → `cdt`.

Why: the upstream name produces tools like
`mcp__plugin_chrome-devtools-mcp_chrome-devtools__get_console_message`
(68 chars), which OpenAI-compatible endpoints reject with
`400: 'name' must be at most 64 characters`. The fork produces
`mcp__plugin_cdt_cdt__get_console_message` (40 chars). Longest tool is
`mcp__plugin_cdt_cdt__performance_analyze_insight` at 48 chars.

Skills are copied unchanged from upstream v1.9.0 (Apache-2.0, Google Chrome).
To update: re-copy `skills/` from the upstream release and bump the version
in `plugins/cdt/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json`.

## Install (on each machine)

```
openclaude plugin marketplace add MotionDevLab/claude-code-plugins
openclaude plugin install cdt@motiondevlab-plugins
openclaude plugin disable chrome-devtools-mcp@claude-plugins-official
```

Then restart the session and verify with `openclaude mcp list` — the server
should show as `plugin:cdt:cdt`.

## Windows without Chrome (Edge/Brave only)

The stock config launches `chrome.exe` via Puppeteer's `--remote-debugging-pipe`.
A `chrome.exe` shim that re-launches Edge **cannot work**: the CDP pipe transport
needs CRT fds 3/4 set up by Node/libuv's direct spawn, and any native intermediate
breaks the mapping (proven across shim v1–v9: handles forwarded correctly, Edge
still exits 13 in ~70ms). So on a machine with no real Chrome, patch the
**local installed copy** (not the repo — the repo stays stock for portability):

```jsonc
// C:\Users\<you>\.openclaude\plugins\cache\motiondevlab-plugins\cdt\1.9.0\.claude-plugin\plugin.json
"args": [
  "chrome-devtools-mcp@1.9.0",
  "--executablePath=C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
]
```

Then reload plugins and verify with `list_pages` → `navigate_page` →
`take_snapshot`. Re-apply after every plugin update/reinstall (the cache copy
gets rewritten). Most durable long-term fix: install real per-user Chrome, and
the stock config works untouched.
