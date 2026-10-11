# MotionDevLab Claude Plugins

Works on Claude Code and OpenClaude.

Short-name forks of upstream Claude plugins that stay under the 64-character
OpenAI-compatible function-name limit once namespaced as
`mcp__plugin_<plugin>_<server>__<tool>`.

## Plugins

### cdt (v1.10.1)

Fork of
[ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)
with the MCP server renamed `chrome-devtools` → `cdt`.

Why: the upstream name produces tools like
`mcp__plugin_chrome-devtools-mcp_chrome-devtools__get_console_message`
(68 chars), which OpenAI-compatible endpoints reject with
`400: 'name' must be at most 64 characters`. The fork produces
`mcp__plugin_cdt_cdt__get_console_message` (40 chars). Longest tool is
`mcp__plugin_cdt_cdt__performance_analyze_insight` at 48 chars.

Skills are copied from upstream v1.10.1 (Apache-2.0, Google Chrome) with one localization: the extension-setup example uses the `cdt` server name.
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

## Browser selection (Chrome / Edge / Brave)

The plugin boots through `plugins/cdt/scripts/cdt-launch.js`
(`node ${CLAUDE_PLUGIN_ROOT}/scripts/cdt-launch.js`), which picks a Chromium
executable at server-start time — no post-install step, survives
update/reinstall:

1. `$CDT_EXECUTABLE_PATH` if set (explicit override)
2. Real Google Chrome → stock args, byte-identical to upstream
3. Microsoft Edge → `--executablePath=<edge>`
4. Brave → `--executablePath=<brave>`

A `chrome.exe` shim that re-launches Edge **cannot work**: the CDP pipe
transport needs CRT fds 3/4 set up by Node/libuv's direct spawn, and any
native intermediate breaks the mapping (proven across shim v1-v9: handles
forwarded correctly, Edge still exits 13 in ~70ms). The launcher is not such
an intermediate — it sits *above* chrome-devtools-mcp
(harness → launcher → npx → browser), and the browser pipes are created by
chrome-devtools-mcp's own Node process directly. Extra args after the script
path are forwarded, e.g. `"${CLAUDE_PLUGIN_ROOT}/scripts/cdt-launch.js",
"--headless"`. Check resolution without launching:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/cdt-launch.js --dry-run
```

Verify live with `list_pages` → `navigate_page` → `take_snapshot`.
Most durable long-term fix: install real per-user Chrome, and the launcher
takes the stock path untouched.

Legacy: `scripts/patch-cdt-edge.ps1` (manual cache patch) is kept for
reference but no longer needed.
