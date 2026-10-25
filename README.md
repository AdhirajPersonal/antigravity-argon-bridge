<div align="center">

<p align="center">
  <img src="media/icon.svg" width="96" height="96" alt="Argon Bridge Logo" />
</p>

# ⚛️ Antigravity Argon Bridge
### Google 4 Argon Reasoning Engine for the Antigravity Agentic IDE & MCP Ecosystem

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://github.com/AdhirajPersonal/antigravity-argon-bridge/blob/main/LICENSE)
[![VS Code Extension](https://img.shields.io/badge/VS%20Code-v1.85+-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![Antigravity](https://img.shields.io/badge/Google-Antigravity-10b981?style=for-the-badge&logo=google&logoColor=white)](https://antigravity.google)
[![Reasoning Engine](https://img.shields.io/badge/Model-Google%204%20Argon-38bdf8?style=for-the-badge&logo=google-gemini&logoColor=white)](https://gemini.google.com)
[![Protocol](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol%20(MCP)-a855f7?style=for-the-badge)](https://modelcontextprotocol.io)

[Quick Install](#-1-minute-install-recommended) · [What You Get](#-what-you-get) · [How It Works](#-how-it-works) · [MCP Tools](#-native-mcp-tools) · [Publish to Marketplace](#-publishing-to-vs-code-marketplace)

</div>

<p align="center">
  <em>Pro users deserve full, unconstrained access to the high-depth reasoning models they have access to—paid subscriptions, carrier bundles, or trials alike.</em>
</p>

---

## ⚡ What You Get

* **🧠 Deep Reasoning on Demand**: Directly query Google's flagship **4 Argon** multi-pass reasoning engine from your Antigravity workflows with variable thinking depths (`Low`, `Medium`, `High`, or `Auto`).
* **👥 Automatic Multi-Account Failover**: Connect multiple Google Pro / Gemini Advanced accounts. When one account hits Google's rolling rate limit or cooldown, the bridge transparently rotates to the next available account without dropping your turn.
* **🛡️ Stealth CDP Automation Engine**: Playwright-powered Chromium driver utilizing CDP-level evasion hooks (`navigator.webdriver` spoofing, authentic Chrome geometry, localized persistent storage) that bypass anti-bot challenges and safely preserve Google carrier SSO/passkey sessions.
* **📊 Quantum Sync & Live Quota Dashboard**: Ultra-fast glassmorphic VS Code sidebar displaying real-time daily turns, estimated token usage, and live Google Pro rolling reset timers.
* **🧵 Workspace-Isolated Memory Threads**: Maintains continuous, isolated chat sessions per project folder so context never cross-contaminates across accounts or distinct repositories.
* **🔌 Dual-Mode Integration**: Operates simultaneously as a visual **VS Code Sidebar Control Panel** and as a standard **Model Context Protocol (MCP)** server for autonomous coding agents (Gemini 3.8 Flash, Claude Code, Cline, Cursor, Roo-Code).

---

## 🚀 1-Minute Install (Recommended)

### Option A: Install from GitHub Release (.vsix)

1. Head to the **[Releases](https://github.com/AdhirajPersonal/antigravity-argon-bridge/releases)** page and download `agy-argon-extension-1.0.0.vsix`.
2. Open VS Code or Antigravity IDE and install it:
   * **Via Terminal**:
     ```bash
     code --install-extension agy-argon-extension-1.0.0.vsix --force
     ```
   * **Via UI**: Press `Ctrl+Shift+P` -> Type `Extensions: Install from VSIX...` -> Select the downloaded file.
3. Done! The **Argon Bridge** emblem will appear in your Activity Bar.

---

### Option B: Build & Run from Source

```bash
# 1. Clone the repository
git clone https://github.com/AdhirajPersonal/antigravity-argon-bridge.git
cd antigravity-argon-bridge

# 2. Install dependencies & build
npm install
npm run build

# 3. Package and install extension
npx @vscode/vsce package --no-dependencies
code --install-extension agy-argon-extension-1.0.0.vsix --force
```

---

## ⚙️ Account Setup (2 Easy Steps)

1. Click the **Argon Bridge** tab in the VS Code Activity Bar.
2. Under **Google Accounts**, click **`+ Add Google Pro Account`**:
   * An authentic Chromium window will open.
   * Sign into your Google account (2FA, passkeys, and carrier SSO are fully supported).
   * Once Google Gemini opens, the window closes automatically and your account is linked!

> [!TIP]
> **Have multiple accounts?** Click `+ Add Google Pro Account` again to connect your backup accounts. Argon Bridge will automatically pool their rate limits together.

---

## 🛠️ Native MCP Tools

Once installed, the bridge automatically syncs into your IDE's `mcp_config.json`, giving all your assistant agents native access to these tools:

| MCP Tool | Description | Parameters |
| :--- | :--- | :--- |
| `consult_argon` | Consult Google 4 Argon for high-complexity proofs, math, or architecture | `prompt`, `thinking_level` (`low`/`medium`/`high`), `fresh_conversation` |
| `get_argon_usage` | Inspect current rate limits, turns, and account pool status | *None* |
| `reset_argon_thread` | Clear conversation memory for the current workspace thread | `session_id` |

---

## 📦 Publishing to VS Code Marketplace & Open VSX

Want to distribute this extension to millions of users on the official [VS Code Marketplace](https://marketplace.visualstudio.com/) and [Open VSX Registry](https://open-vsx.org/)?

### 1. Create a Publisher Account
1. Sign in to the [Visual Studio Marketplace Management Portal](https://marketplace.visualstudio.com/manage).
2. Create a unique **Publisher ID** (e.g. `adhirajpersonal`).
3. Generate a **Personal Access Token (PAT)** from Azure DevOps with `Marketplace (Manage)` scope.

### 2. Update `package.json`
In your `package.json`, set your publisher ID:
```json
{
  "name": "antigravity-argon-bridge",
  "publisher": "YOUR_PUBLISHER_ID",
  "repository": {
    "type": "git",
    "url": "https://github.com/AdhirajPersonal/antigravity-argon-bridge.git"
  }
}
```

### 3. Publish with VSCE
```bash
# Login with your publisher token
npx @vscode/vsce login YOUR_PUBLISHER_ID

# Publish directly to the Visual Studio Marketplace
npx @vscode/vsce publish

# (Optional) Publish to Open VSX for VSCodium / Antigravity / Cursor
npx ovsx publish agy-argon-extension-1.0.0.vsix -p YOUR_OPEN_VSX_TOKEN
```

---

## 🔒 Security & Sandboxing

* **100% Local Credentials**: All session cookies, persistent contexts, and token logs are stored exclusively in your local home directory: `~/.gemini/argon-extension/`.
* **Zero Telemetry Leaks**: No account cookies, prompts, or proprietary code ever pass through external servers or third-party proxies.
* **Isolated Profiles**: Every Google account runs in its own sandboxed Chromium user-data profile to prevent cross-account session leakage.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
