# DeepSeek Harness for VS Code

DeepSeek Harness is an AI coding agent in the editor. It runs a local `dsh` process and shows the conversation, tool calls, diffs, and approval prompts in a sidebar Chat view.

## Requirements

- Visual Studio Code or Cursor, `1.90.0` or later
- A `dsh` binary on this machine
- An API key for at least one model provider (for example DeepSeek)

If VS Code was started from the Dock or Start Menu, it may not see a shell-only `PATH`. Leave **DeepSeek Harness binary path** empty to probe nvm and common Homebrew locations, or set it in Settings → Extension.

Optional: `DSH_HOME` selects the harness home. Recent chats live under that home's sessions directory. Model, plugin, MCP, and credential settings stored by DeepSeek Harness are shared by every workspace that uses the same home — they are not per-folder VS Code settings.

## Start chatting

1. Open a folder as the workspace.
2. Click the DeepSeek Harness icon in the Activity Bar, or run **DeepSeek Harness: Start** from the Command Palette.
3. Wait until Chat is ready, then type in the composer and press Enter.

Opening the Chat view starts DeepSeek Harness in that workspace. **DeepSeek Harness: Stop** ends the running session.

The header lists recent chats for this workspace and **New Chat**. The composer chooses the current chat's permission preset and model, shows how much of the next-request context is used, and sends with Enter. Shift+Enter inserts a newline.

While DeepSeek Harness is idle, Enter always queues your message. While it is busy, Enter follows **Enter while DeepSeek Harness is busy** in Settings → General (queue the next message, or steer the current turn). Cmd/Ctrl+Enter does the other action.

**Full Access** asks for confirmation once per chat.

The + control, left of the context meter, attaches workspace files and folders, and can attach an image. File and folder chips are sent as `@path` references; DeepSeek Harness reads their contents when it needs them. Image chips require a model that accepts images and stay within DeepSeek Harness attachment limits.

Your prompts appear as you typed them. Answers render as markdown, including headings, lists, tables, links, and fenced code with a copy button. Images in model output appear as links rather than inline pictures. Injected context (plugins, session references, subagent reports) stays out of the transcript.

When a model shares its reasoning, a **Thinking** disclosure appears under your message and stays open with every reasoning segment from that turn. After the response finishes, it collapses to **Thought**. Expanding **Thought** shows the full reasoning again. Tool calls appear as expandable rows with their progress and results, while slash commands appear as separate command cards rather than prompts from you.

When tools propose file changes during the current turn, the timeline shows their diffs and an **Apply all diffs** button applies them to the editor together.

## Settings

The header gear opens Settings. Escape, the backdrop, the close control, and the gear again close it. Unsaved changes ask before they are discarded. Streaming continues while Settings is open.

Current-chat model and permission stay in the composer. Settings → General defaults apply to **future** chats.

### General

- Default agent preset and permission for new chats
- Language (including System default, which clears a stored locale preference)
- Appearance (configures DeepSeek Harness Web; this extension always follows the VS Code or Cursor theme)
- Enter while DeepSeek Harness is busy

Language and Busy Enter take effect in the extension after a successful save.

### Models

Configured providers, catalogs, and write-only API keys.

- Built-in providers list models from the catalog. You can override the model list (ID and optional context window) or reset it to the provider default.
- **Add a custom provider** needs a provider ID, base URL, API protocol, at least one model, and usually an API key. Each model is a card: **Model ID** is required (the id the API expects). Display name, context window, and max tokens are optional.
- Keys are write-only. After you submit, the field is cleared and the stored value cannot be read back. You can replace a key; you cannot inspect it.
- Provider settings are saved before credentials. A failed key write can leave the provider configured without a usable key.
- Deleting a provider may remove its credential first. If the later settings write fails, that secret is already gone.

If a saved model is no longer in any live catalog, DeepSeek Harness replaces it with a live model from the same provider when it can, saves the replacement, and notes the switch. An unreachable provider does not rewrite the saved choice.

### Plugins

Cards for mounted Shell, Agent Loop, and Web Search settings, plus a read-only inventory (module name, entry id, enabled, runtime phase). There is no generic editor for every plugin.

### MCP

Appears after Plugins only while the MCP manager is mounted in this profile.

- **Add server** for stdio (command, arguments, working directory) or Streamable HTTP (URL).
- For an HTTP server that publishes OAuth discovery and Dynamic Client Registration, enter a **name** and **URL**, then **Add & Authorize**. The system browser opens the identity provider. After you sign in, the editor waits for the callback and connects the server. You do not need DeepSeek Harness Web for this path.
- **Authorize** on an existing OAuth HTTP server starts login again.
- Open **Advanced** when the provider does not register a client, or when you must set client ID, endpoints, scopes, redirect path, headers, or a client secret by hand. **Discover from server URL** fills what the server advertises.
- A client registered only for DeepSeek Harness Web's callback port cannot be reused on this editor's loopback port. Authorize again from the editor so the provider issues a client for the current callback URI.
- Enable, disable, connect, disconnect, inspect tools and logs, and clear OAuth tokens from the server detail.
- Secrets can be replaced but cannot be unset here. One Save writes the server record, then any staged secrets. Save stays disabled until the record is complete.

OAuth callbacks listen only on `127.0.0.1` with an OS-assigned port. The callback origin is shown under Advanced if you must register it with the identity provider.

Connection state is local to this editor's `dsh` process. Catalog changes apply immediately in the profile that wrote them; another already-running profile sees them after it restarts.

### Web Search

Appears after Plugins only while the Web Search manager is mounted. Choose Tavily, Brave Search, or SearXNG, optional endpoint overrides, and write-only API keys. Keys can be replaced but cannot be unset. Until that manager is present, use the core Web Search card under Plugins instead.

### Agent Presets

Inspect built-in compositions, set the default for future chats, copy a preset, and open or delete a user preset. Deleting the current default requires choosing a healthy replacement first. Running chats keep the composition they already have.

### Extension

Owned by VS Code configuration, not `$DSH_HOME`:

- DeepSeek Harness binary path
- Handshake timeout
- Open VS Code Settings, the DeepSeek Harness settings document, or the DeepSeek Harness home folder
- Restart DeepSeek Harness

Each field keeps the configuration target that currently supplies its value (folder, workspace, or user). Restart is unavailable while DeepSeek Harness is starting, thinking, awaiting approval, or already restarting, and remains available after a disconnect. A successful restart uses the same workspace and resumes the current chat when one exists.

Some DeepSeek Harness namespaces apply live; others show a persistent **Restart DeepSeek Harness to apply all changes** banner and do not restart on their own.

If another DeepSeek Harness client or an external file edit wins, the section refreshes, keeps your non-secret draft, and offers Retry or Discard. Disconnect keeps non-secret drafts and reconciles them after reconnect.

## Slash commands and skills

After Chat is ready, type `/` at the start of the draft, or after whitespace or punctuation, to open the session slash menu. Slashes inside words (`a/b`), `//`, URLs, and drive prefixes such as `C:/` do not open it. An active `@` file or folder mention takes priority.

Results are grouped as **Commands**, then **Skills**. Down and Up move the highlight, Enter picks it, Escape closes the menu, Shift+Enter inserts a newline.

- A **bare command** runs immediately and does not send the rest of the draft.
- A command that takes input becomes `/name ` in the composer; Send runs the completed line.
- A **skill** inserts `/name ` as ordinary prompt text.
- An unknown leading `/token` is sent as a normal user message.

Only commands marked as accepting images can run with image chips. If commands or skills cannot be listed, the other source still works; the menu closes when neither has a selectable result. Invoked commands appear as slash rows in the transcript and remain after you resume the chat.

## VS Code settings

| Setting | Meaning |
| --- | --- |
| `dsh.binaryPath` | Path to the `dsh` binary. Empty (default) probes nvm and common Homebrew locations, then the extension host `PATH`. |
| `dsh.handshakeTimeoutMs` | How long to wait for DeepSeek Harness to become ready, 1,000–300,000 ms (default 30,000). Raise this if Chat reports no handshake on a slow machine. |

## Commands

| Command | Action |
| --- | --- |
| **DeepSeek Harness: Start** | Start DeepSeek Harness in the active workspace folder |
| **DeepSeek Harness: Stop** | Stop the running DeepSeek Harness process |
