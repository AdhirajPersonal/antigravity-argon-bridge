<div align="center">

# Antigravity Argon Bridge
### Google 4 Argon Reasoning Engine for the Antigravity Agentic IDE & MCP Ecosystem

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://github.com/AdhirajPersonal/antigravity-argon-bridge/blob/main/LICENSE)
[![VS Code Extension](https://img.shields.io/badge/VS%20Code-v1.85+-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![Antigravity](https://img.shields.io/badge/Google-Antigravity-10b981?style=for-the-badge&logo=google&logoColor=white)](https://antigravity.google)
[![Reasoning Engine](https://img.shields.io/badge/Model-Google%204%20Argon-38bdf8?style=for-the-badge&logo=google-gemini&logoColor=white)](https://gemini.google.com)
[![Protocol](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol%20(MCP)-a855f7?style=for-the-badge)](https://modelcontextprotocol.io)

[Quick Install](#1-minute-install-recommended) · [Chromium Setup](#first-run-requirement-playwright-chromium) · [Account Setup](#account-setup-2-easy-steps) · [MCP Tools](#native-mcp-tools) · [Security](#security--sandboxing)

</div>

<p align="center">
  <em>Pro users deserve full, unconstrained access to the high-depth reasoning models they have access to—paid subscriptions, carrier bundles, or trials alike.</em>
</p>

---

## What You Get

* **Deep Reasoning on Demand**: Directly query Google's flagship **4 Argon** multi-pass reasoning engine from your Antigravity workflows with variable thinking depths (`Low`, `Medium`, `High`, or `Auto`).
* **Automatic Multi-Account Failover**: Connect multiple Google Pro / Gemini Advanced accounts. When one account hits Google's rolling rate limit or cooldown, the bridge transparently rotates to the next available account without dropping your turn.
* **Stealth CDP Automation Engine**: Playwright-powered Chromium driver utilizing CDP-level evasion hooks (`navigator.webdriver` spoofing, authentic Chrome geometry, localized persistent storage) that bypass anti-bot challenges and safely preserve Google carrier SSO/passkey sessions.
* **Quantum Sync & Live Quota Dashboard**: Fast glassmorphic VS Code sidebar displaying real-time daily turns, estimated token usage, and live Google Pro rolling reset timers.
* **Workspace-Isolated Memory Threads**: Maintains continuous, isolated chat sessions per project folder so context never cross-contaminates across accounts or distinct repositories.
* **Dual-Mode Integration**: Operates simultaneously as a visual **VS Code Sidebar Control Panel** and as a standard **Model Context Protocol (MCP)** server for autonomous coding agents (Gemini 3.8 Flash, Claude Code, Cline, Cursor, Roo-Code).

---

## Quick Install (Recommended)

### Option A: Install from VS Code Marketplace / IDE Extensions

1. Open VS Code or Antigravity IDE.
2. Open the Extensions sidebar (`Ctrl+Shift+X`).
3. Search for **`Antigravity Argon Bridge`** (Publisher: `kobula`).
4. Click **Install**.

---

### Option B: Install from GitHub Release (.vsix)

1. Head to the **[Releases](https://github.com/AdhirajPersonal/antigravity-argon-bridge/releases)** page and download `antigravity-argon-bridge-1.0.1.vsix`.
2. Open VS Code or Antigravity IDE and install it:
   * **Via Terminal**:
     ```bash
     code --install-extension antigravity-argon-bridge-1.0.1.vsix --force
     ```
   * **Via UI**: Press `Ctrl+Shift+P` -> Type `Extensions: Install from VSIX...` -> Select the downloaded file.
3. The **Argon Bridge** tab will appear in your Activity Bar.

---

### Option B: Build & Run from Source

```bash
# 1. Clone the repository
git clone https://github.com/AdhirajPersonal/antigravity-argon-bridge.git
cd antigravity-argon-bridge

# 2. Install dependencies & build
#    `npm install` runs the postinstall hook that downloads the Playwright Chromium
#    build pinned by this checkout into ~/Library/Caches/ms-playwright (macOS).
npm install
npm run build

# 3. Package and install extension
npx @vscode/vsce package --no-dependencies
code --install-extension agy-argon-extension-1.0.0.vsix --force
```

---

## First-Run Requirement: Playwright Chromium

The Chromium build that Argon drives is **not bundled inside the VSIX** — it is pinned to an exact
revision by the bundled `playwright-core` and has to be downloaded once per Playwright version.

Marketplace / VSIX installs never run `npm install`, so this one-off download is **not** performed
for you. On a fresh install (or after an update that bumps Playwright), run **one** of these:

* **Recommended (one click):** Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **`Argon: Install / Repair Chromium Browser`**.
  If you forget, the "Add Google Pro Account" flow detects the missing browser and offers a **Download Chromium** button.
* **Terminal:** point it at the extension's *own* Playwright CLI so the revision matches exactly:

  ```bash
  # macOS / Linux
  node "<extension-dir>/node_modules/playwright-core/cli.js" install chromium
  # Windows
  node "<extension-dir>\node_modules\playwright-core\cli.js" install chromium
  ```

  `<extension-dir>` is `~/.vscode/extensions/kobula.antigravity-argon-bridge-<version>` or
  `~/.antigravity-ide/extensions/kobula.antigravity-argon-bridge-<version>`.

> [!IMPORTANT]
> Do **not** use a bare global `npx playwright install chromium`: if your global Playwright differs
> from the bundled one it downloads a *different* revision and the launch still fails with
> `Executable doesn't exist at .../chromium-<rev>/...`.

---

## Account Setup (2 Easy Steps)

1. Click the **Argon Bridge** tab in the VS Code Activity Bar.
2. Under **Google Accounts**, click **`+ Add Google Pro Account`**:
   * An authentic Chromium window will open.
   * Sign into your Google account (2FA, passkeys, and carrier SSO are fully supported).
   * Once Google Gemini opens, the window closes automatically and your account is linked.

> [!NOTE]
> **Have multiple accounts?** Click `+ Add Google Pro Account` again to connect your backup accounts. Argon Bridge will automatically pool their rate limits together.

---

## Native MCP Tools

Once installed, the bridge automatically syncs into your IDE's `mcp_config.json`, giving all your assistant agents native access to these tools:

| MCP Tool | Description | Parameters |
| :--- | :--- | :--- |
| `consult_argon` | Consult Google 4 Argon for high-complexity proofs, math, or architecture | `prompt`, `thinking_level` (`low`/`medium`/`high`), `fresh_conversation` |
| `get_argon_usage` | Inspect current rate limits, turns, and account pool status | *None* |
| `reset_argon_thread` | Clear conversation memory for the current workspace thread | `session_id` |

---

## Security, Privacy & Account Safety

* **100% Local Credentials**: All session cookies, persistent contexts, and token logs are stored exclusively in your local home directory (`~/.gemini/argon-extension/`).
* **Zero Telemetry or Relays**: No account cookies, prompts, or proprietary code ever pass through external servers or third-party proxies. Everything communicates directly on `localhost`.
* **Isolated Profiles**: Every Google account runs in its own sandboxed Chromium user-data profile to prevent cross-account session leakage.

> [!NOTE]
> **Account Safety & Best Practices**:
> This extension automates web interactions on `gemini.google.com` locally via Playwright at human-level query pacing whenever your coding agent requests deep reasoning. While built for personal development workflows, Google's consumer terms discourage automated access. For maximum peace of mind and protection of your personal communications, we recommend linking a secondary Google account or a dedicated promo/trial account (such as carrier perks or student trials) rather than your primary personal or work email.

---

## License

Distributed under the [MIT License](LICENSE).
