---
name: argon-oracle
description: Guides the Antigravity assistant (e.g. Gemini 3.8) to consult Google's flagship 4 Argon reasoning model via the agy-argon MCP server for complex tasks, deep mathematical/algorithmic proofs, system architecture design, and qualitative code analysis.
---

# Argon Oracle Skill: Antigravity Reasoning Consultant

This skill instructs the assistant on how to consult Google's **4 Argon** model as an external oracle to elevate reasoning quality while preserving web quota and maintaining project context.

---

## 1. When to Consult Argon

Argon should be invoked via `consult_argon` when high-level qualitative judgment or deep reasoning is required:

- **Complex System Architecture**: Designing distributed patterns, database schemas, cache invalidation strategies, and decoupled event pipelines.
- **Subtle Bug Diagnosis**: Deeply nested race conditions, asynchronous deadlock scenarios, memory leaks, and complex cryptographic or security flows.
- **Algorithm Optimization**: Analyzing mathematical bounds, dynamic programming states, graph algorithms, or Big-O complexity proofs.
- **Qualitative Code Review**: Evaluating competing implementation options, API ergonomics, or domain-driven refactoring plans.

### When NOT to Consult Argon (Preserve Quota)
- Routine boilerplate, simple CRUD endpoints, or standard typing annotations.
- Direct syntax queries or common library questions that Gemini 3.8 can answer instantly.
- Iterative micro-edits within a single function.

---

## 2. Dynamic Thinking Depth & User Overrides

The `consult_argon` tool accepts a `thinking_level` parameter:

| Level | Value | Recommended For |
| :--- | :--- | :--- |
| **Low** | `"low"` | Fast sanity checks, prompt validation, quick trade-off checks. |
| **Medium** | `"medium"` | Standard code reviews, design comparisons, multi-step debugging. |
| **High** | `"high"` | Deep algorithmic proofs, extensive refactoring plans, critical security analysis. |

*Note: If the user has configured a hard thinking mode limit via `set_argon_settings` (e.g. locked to "high" or "low"), the server will automatically enforce their preference.*

---

## 3. Persistent Project Memory (`session_id`)

To ensure Argon remembers previous turns, past code reviews, and project context across multi-day IDE sessions:
- Always supply a consistent `session_id` (e.g. the workspace folder name or current Antigravity conversation ID).
- Leave `continue_thread: true` (the default) so the conversation history is maintained on `gemini.google.com`.
- If the user explicitly asks to start a fresh discussion or switch topics completely, set `continue_thread: false` or call `reset_argon_thread`.

---

## 4. Automatic Multi-Account Failover & Quota Exhaustion

The MCP server manages multiple Google Pro accounts automatically:
1. If Account A hits an hourly/daily web limit, the server automatically switches to Account B or Account C and retries seamlessly.
2. **When All Accounts Are Exhausted**:
   If the tool returns `[ARGON QUOTA EXHAUSTED]` with an upcoming reset timestamp:
   - **DO NOT** retry calling `consult_argon`.
   - **Immediately fall back to your own internal reasoning (Gemini 3.8)** to provide the best possible answer to the user.
   - Inform the user that their Argon Pro quota is temporarily exhausted across all connected accounts and mention the estimated reset time.

---

## 5. Tool Usage Examples

### A. Deep Architectural Consultation with Persistent Project Context
```json
{
  "prompt": "Evaluate whether our proposed event-driven CQRS architecture introduces potential consistency race conditions during customer checkout.",
  "context": "<paste relevant architecture docs or state diagram>",
  "thinking_level": "high",
  "session_id": "my-backend-project"
}
```

### B. Checking Usage Limits
```json
{}
// Call get_argon_usage to inspect current % used, weekly limits, and reset times.
```
