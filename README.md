# MotionDevLab OpenClaude Plugins

Short-name forks of upstream Claude plugins that exceed the 64-character
OpenAI-compatible function-name limit once OpenClaude namespaces them as
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
openclaude plugin marketplace add MotionDevLab/openclaude-plugins
openclaude plugin install cdt@motiondevlab-plugins
openclaude plugin disable chrome-devtools-mcp@claude-plugins-official
```

Then restart the session and verify with `openclaude mcp list` — the server
should show as `plugin:cdt:cdt`.
