# dsh-usage-widget (usage & balance)

English | [中文](README.md)

<img src="assets/icon.png" width="88" alt="Icon: an orca fluke above three ascending usage bars" align="right">

Shows the following at the **bottom left of the sidebar** (just above Settings) in the DeepSeek Harness desktop app:

- **Account balance** — read through the official account service `ctx.deepseekAccount.getBalance`, the same source as Settings → Account. Both the topped-up balance and any bonus wallets appear on the first line, without expanding anything.
- **Today's token usage** — summed across all sessions, with input (cache hit / cache miss) and output broken out, and reasoning tokens listed separately.
- **Today's spend** — derived from per-model prices and the **peak / off-peak** windows. Hover or click to expand the current session's detail.

By default it shows today's totals. Hovering or clicking expands: balance, today's breakdown, the per-model grouping, the **current session's** usage today, the last update time, and a refresh button.

**The whole balance is visible without expanding**: the first line reads `balance ¥5.83 · bonus ¥9.56`, the topped-up balance in the primary colour and bonus wallets dimmed — both readable at a glance. When the sidebar collapses to its 56px rail the widget shrinks to a single icon, and the full figures (bonus included) move into its tooltip.

## Where the data comes from

| Data | Source | Notes |
|---|---|---|
| Balance | `deepseekAccount.getBalance` | The official platform endpoint. The plugin never touches credentials and never calls an external API itself. |
| Tokens | Session logs `$DSH_HOME/sessions/**/session.*.jsonl.zstd` | Each billed request is one `assistant/message` event carrying `data.usage`; that event is the only source of truth. |
| Spend | The price table in this plugin's config | DSH itself has no per-token pricing — only image pricing. |

Session logs are **multi-frame Zstandard** containers (one frame is appended per batch). The plugin reads them incrementally at frame boundaries: only frames appended since the last read are decompressed, and a trailing frame that is not yet complete is skipped and picked up on the next pass. Counting can therefore never double up, and the cost does not grow with the size of the log (on the author's machine, 15 session files and 20k lines take ~0.3s on the first scan and only read the delta afterwards).

## Install

From the GitHub Release (recommended — no clone needed):

```bash
dsh plugin --profile desktop add "https://github.com/ZeroOT-Liu/dsh-usage-widget/releases/latest/download/dsh-usage-widget.tgz"
```

Or straight from the repository:

```bash
dsh plugin --profile desktop add "github:ZeroOT-Liu/dsh-usage-widget"
```

Either way `dsh-usage-widget` is written into the profile's `dsh.profile.bundles` (`~/.dsh/profiles/<profile>/package.json`), which applies to every session in that profile and survives restarts.

After installing, **refresh the page (Ctrl+R)** so the browser picks up the new module manifest.

Uninstall:

```bash
dsh plugin --profile desktop remove dsh-usage-widget
```

### Local development

Point `link:` at your working copy; code changes take effect on a page refresh with no reinstall:

```bash
dsh plugin --profile desktop add "link:/absolute/path/to/dsh-usage-widget"
```

## Configuration

Configuration lives on this plugin's row in [cordis.patch.yml](cordis.patch.yml). Prices are in currency units per **million** tokens and you enter the **off-peak** price; the peak window is multiplied by `peakMultiplier` (default 2, matching the published DeepSeek price list).

| Field | Default | Meaning |
|---|---|---|
| `currency` | `CNY` | Currency used to display spend |
| `refreshSeconds` | `30` | Widget polling interval |
| `balanceRefreshSeconds` | `180` | Balance cache lifetime (the balance comes from an external platform, so it is not polled aggressively) |
| `peakMultiplier` | `2` | Price multiplier applied during peak hours |
| `keepDays` | `45` | How many days of aggregated logs to retain |
| `sessionsDir` | automatic | Session directory; defaults to `$DSH_HOME/sessions`, falling back to `~/.dsh/sessions` |
| `models` | DeepSeek published prices | Model → `{ cacheHit, cacheMiss, output }` |
| `aliases` | see the file | Maps legacy, dated or `-exp` model ids onto a priced key |
| `allowHosts` | `[]` | Extra hostnames allowed to reach the summary route, besides loopback |

Peak hours are **Beijing time**, Monday–Friday 09:00–12:00 and 14:00–18:00, and cost double; every other time (weekends included) is half price. Chinese statutory holidays are not modelled — holidays are billed as peak.

A model with no configured price still contributes its tokens but not to the spend figure, and the expanded panel flags it as having no price.

## Security

The summary route `/api/dsh-usage-widget/summary` is an exact route, so it **wins over** the API gateway's `/api` prefix and does not inherit that layer's browser session check. To compensate, the route applies the same trust rules the gateway does: it only answers loopback `Host` values (`127.x.x.x`, `localhost`, `::1`, plus anything in `allowHosts`), rejects cross-site `Origin` / `sec-fetch-site`, and returns 403 otherwise. Only `GET` and `HEAD` are accepted.

## Files

| File | Responsibility |
|---|---|
| [index.js](index.js) | Host half: registers the summary route and the trust check |
| [lib/service.js](lib/service.js) | Assembles the summary response, balance caching and degradation |
| [lib/usage-index.js](lib/usage-index.js) | Incremental session-log aggregation, bucketed by local day and model |
| [lib/session-log.js](lib/session-log.js) | Multi-frame Zstandard frame scanning and decoding |
| [lib/pricing.js](lib/pricing.js) | Price table, alias resolution, peak-window detection, cost maths |
| [lib/config.js](lib/config.js) | Row-config normalisation (no schemastery dependency) |
| [client.js](client.js) | Client half: the `sidebar.footer.action` widget |
| [icon.svg](icon.svg) | Plugin icon (orca fluke + ascending bars); [assets/icon.png](assets/icon.png) is the bitmap version used by this README |

The plugin is **dependency-free**: only Node built-ins and relative imports. Plugins installed into a profile cannot resolve DSH's own `@deepseek-ai/*` packages, so the host half does not import them (and exports no Cordis `Config` schema), the client half does not `require` any Harness Client package, and styling only references `--dsw-alias-*` theme tokens.

## Tests

```bash
node test/run-tests.mjs      # frame decoding, pricing, incremental aggregation (cross-checked against a full decode of the real logs)
node test/client-smoke.mjs   # loads the client half through its real handshake and renders the widget in Node
```

## Known limitations

- Spend is a **reference figure derived from a price table**, not a bill; the platform's usage page is authoritative. Update the config when prices change.
- "Today" follows the host machine's local timezone.
- Session logs are flushed in batches, so the widget can lag the conversation by one batch (usually a few seconds). The refresh button re-reads immediately.

## Requirements

- DeepSeek Harness desktop (`desktop` profile, verified on `0.2.0-rc.2`). It also works in the `web` profile as long as that profile includes the official account plugin (`@deepseek-ai/dsh-deepseek-account-platform`); without it the widget still shows usage and the balance slot reads "account service unavailable".
- The widget also reads the profile's session services (`sessions`, `uiSession`) to resolve the current session; every standard composition ships both.
- Session logs use multi-frame Zstandard, which needs Node ≥ 22.15 inside the host (the DSH runtime is Node 24, so there is nothing to do).
- When not signed in to a DeepSeek account the balance reads "signed out" and usage and spend keep working.

## FAQ

**`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `fetch failed` while installing** — the machine has a TLS-intercepting proxy (corporate network, antivirus, a packet capture tool) and Node only trusts its bundled root certificates. Point Node at the system certificate store:

```bash
NODE_OPTIONS="--use-system-ca" dsh plugin --profile desktop add "https://github.com/ZeroOT-Liu/dsh-usage-widget/releases/latest/download/dsh-usage-widget.tgz"
```

**The balance slot reads "account service unavailable"** — that profile has no official account plugin; usage and spend still work.

**The spend figure does not match the real bill** — the prices are an estimate from the config; update `models` in `cordis.patch.yml` when the official prices change.

## License

[MIT](LICENSE)
