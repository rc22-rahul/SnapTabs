# Chrome Extension Tab Save/Restore Research
## Technical Deep Dive -- Manifest V3, Incognito Mode, and Best Practices

---

## 1. Manifest V3 Requirements and Capabilities for Tab Management

### Key Changes from MV2 to MV3

- **Service Workers replace Background Pages**: The persistent background page is gone. MV3 uses service workers that run only when needed and are terminated when idle. This means all state must be stored externally (chrome.storage, IndexedDB) since service worker memory is not persistent.
- **Promise-based APIs**: All chrome.* APIs now support Promises in addition to callbacks (Promises are only available in MV3+).
- **No Remote Code Execution**: All JavaScript must be bundled within the extension package. No eval(), no remotely hosted scripts.
- **declarativeNetRequest replaces webRequest**: The blocking form of webRequest is deprecated.
- **chrome.action replaces chrome.browserAction/pageAction**: Unified into a single API.

### Minimum manifest.json for Tab Management

```json
{
  "manifest_version": 3,
  "name": "Tab Saver",
  "version": "1.0",
  "permissions": [
    "tabs",
    "storage",
    "sessions",
    "tabGroups"
  ],
  "incognito": "spanning",
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icon.png"
  }
}
```

---

## 2. Available APIs and Required Permissions

### chrome.tabs API

**Permissions needed:**
- `"tabs"` permission -- enables `tabs.query()` to access sensitive Tab properties: `url`, `pendingUrl`, `title`, `favIconUrl`
- Host permissions (e.g., `"<all_urls>"`) -- allow reading matching tabs' sensitive properties and using `captureVisibleTab()`, `scripting.executeScript()`, etc.
- `"activeTab"` -- grants temporary host permission for the current tab on user interaction (no warning shown)

**Key methods:**

| Method | Description |
|--------|-------------|
| `tabs.query(queryInfo)` | Find tabs matching criteria (windowId, active, pinned, url, status, incognito, groupId, etc.) |
| `tabs.create(createProperties)` | Open a new tab (url, windowId, index, active, pinned) |
| `tabs.remove(tabIds)` | Close one or more tabs |
| `tabs.update(tabId, updateProperties)` | Change tab properties (url, active, muted, pinned, etc.) |
| `tabs.move(tabIds, moveProperties)` | Reposition tabs within or between windows |
| `tabs.group(options)` | Add tabs to an existing or new tab group |
| `tabs.ungroup(tabIds)` | Remove tabs from their groups |
| `tabs.discard(tabId)` | Unload tab from memory (stays visible in tab strip) |
| `tabs.reload(tabId)` | Refresh a tab |
| `tabs.goBack(tabId)` / `tabs.goForward(tabId)` | Navigate tab history |
| `tabs.captureVisibleTab()` | Screenshot the active tab |
| `tabs.sendMessage()` | Communicate with content scripts |
| `tabs.detectLanguage()` | Detect primary language of tab content |

**Key events:**
- `onCreated` -- Tab created
- `onUpdated` -- Tab properties changed (url, title, loading status, etc.)
- `onRemoved` -- Tab closed
- `onActivated` -- Active tab changed in a window
- `onMoved` -- Tab repositioned in a window
- `onAttached` / `onDetached` -- Tab moved between windows
- `onHighlighted` -- Tab selection changed
- `onZoomChange` -- Zoom level changed

**Tab object properties (key ones for save/restore):**
- `id` (number) -- Unique tab identifier
- `windowId` (number) -- Window the tab belongs to
- `index` (number) -- Position in window
- `url` (string) -- Current URL (requires "tabs" permission)
- `title` (string) -- Page title (requires "tabs" permission)
- `favIconUrl` (string) -- Favicon URL (requires "tabs" permission)
- `status` (string) -- "loading" or "complete"
- `active` (boolean) -- Whether tab is active in its window
- `pinned` (boolean) -- Whether tab is pinned
- `incognito` (boolean) -- Whether tab is in incognito window
- `groupId` (number) -- Tab group ID (-1 if ungrouped)
- `discarded` (boolean) -- Whether tab content is unloaded
- `mutedInfo` (object) -- Mute state information

### chrome.sessions API

**Permission needed:** `"sessions"`

**Key methods:**
- `sessions.getRecentlyClosed(filter)` -- Get recently closed tabs/windows (max 25 results)
- `sessions.restore(sessionId)` -- Reopen a closed tab or window by sessionId
- `sessions.getDevices(filter)` -- Get synced sessions from other devices

**Key event:**
- `onChanged` -- Fires when recently closed items change (local only, not synced)

**Important:** `MAX_SESSION_RESULTS` is capped at 25.

### chrome.windows API

**Permission needed:** No special permission for basic use; `"tabs"` permission needed to access tab URLs within windows.

**Key methods:**
- `windows.create(createData)` -- Create a new window (can specify `incognito: true`, URLs, type, dimensions)
- `windows.get(windowId, queryOptions)` -- Get window details
- `windows.getAll(queryOptions)` -- Get all windows
- `windows.getCurrent(queryOptions)` -- Get the window running the current code
- `windows.getLastFocused(queryOptions)` -- Get most recently focused window
- `windows.remove(windowId)` -- Close a window
- `windows.update(windowId, updateInfo)` -- Modify window properties

**Window object properties:**
- `id`, `focused`, `incognito` (boolean), `type`, `state`, `height`, `width`, `left`, `top`, `alwaysOnTop`, `sessionId`
- `tabs` (optional array) -- Populated when `populate: true` is passed in queryOptions

---

## 3. Incognito Mode: "split" vs "spanning"

### Manifest Key

```json
{
  "incognito": "spanning"  // or "split" or "not_allowed"
}
```

### Spanning Mode (Default)

- Extension runs in a **single shared process** for both regular and incognito contexts
- Events/messages from incognito tabs are sent to the shared process with an `incognito` flag
- **Limitation**: Cannot load extension pages (popup, options, etc.) into the main frame of an incognito tab
- **Use when**: Your extension needs remote server authentication or doesn't need to load its own pages in incognito

### Split Mode

- Extension runs **separate processes** for regular and incognito contexts
- Each incognito window gets its own process with its own service worker instance
- Incognito process has its own **memory-only cookie storage**
- **Each process sees events and messages only from its own context**
- **The two processes cannot communicate with each other directly**
- **Use when**: Your extension needs to load its own pages in incognito tabs

### "not_allowed" (Chrome 47+)

- Extension is completely disabled during incognito sessions
- Use when your extension has no need to function in incognito

### Decision Framework

| Requirement | Recommended Mode |
|-------------|-----------------|
| Load extension pages in incognito tabs | `"split"` |
| Remote server authentication needed | `"spanning"` |
| No incognito support needed | `"not_allowed"` |
| Save/restore incognito tabs (basic) | `"spanning"` |

### Critical Note for Tab Save/Restore

For a tab save/restore extension, **`"spanning"` mode is typically preferred** because:
1. You get a single service worker that sees events from both regular and incognito tabs
2. You can query incognito tabs via `chrome.tabs.query({})` and check the `incognito` property
3. Storage is shared, making it simpler to persist data
4. The extension doesn't need to load its own pages in incognito windows

---

## 4. Storage Options for Tab Data

### chrome.storage.local

- **Quota**: 10 MB (expandable to unlimited with `"unlimitedStorage"` permission)
- **Persistence**: Data survives browser restarts; cleared only when extension is removed
- **Incognito behavior**: **Always shared** between regular and incognito processes (even in split mode)
- **Access**: Available to service workers, popups, options pages, content scripts
- **Best for**: Saved tab sessions, user preferences, persistent data

```javascript
// Save tabs
await chrome.storage.local.set({
  savedSessions: [{
    name: "Work Session",
    timestamp: Date.now(),
    tabs: tabsArray
  }]
});

// Retrieve tabs
const { savedSessions } = await chrome.storage.local.get('savedSessions');
```

### chrome.storage.sync

- **Quota**: ~100 KB total, 8 KB per item, 512 max items
- **Write limits**: 120 writes/minute, 1,800 writes/hour
- **Sync**: Automatically syncs across signed-in Chrome instances
- **Incognito behavior**: **Always shared** between regular and incognito processes
- **Best for**: User settings, small configuration data

### chrome.storage.session

- **Quota**: 10 MB
- **Persistence**: **In-memory only** -- cleared when extension is disabled, reloaded, updated, or browser restarts
- **Not exposed to content scripts** by default (configurable via `setAccessLevel()`)
- **Best for**: Temporary state for service workers, caching data that doesn't need to survive restarts
- **MV3 specific**: Recommended for service worker state persistence between wake-ups

### IndexedDB

- **Quota**: Large (browser-dependent, typically hundreds of MB+)
- **Availability**: Available in service workers and extension pages
- **Incognito behavior**: Separate databases in split mode
- **Best for**: Large datasets, complex queries, binary data (favicons, screenshots)
- **Downside**: More complex API than chrome.storage

### Web Storage API (localStorage/sessionStorage)

- **NOT available in service workers** (critical for MV3)
- Available in popup, options page, and other extension pages
- **Not recommended** for MV3 extensions due to service worker limitation

### Recommendation for Tab Save/Restore

| Data Type | Storage | Reason |
|-----------|---------|--------|
| Saved tab sessions | `chrome.storage.local` | Persistent, shared across contexts, simple API |
| User settings | `chrome.storage.sync` | Syncs across devices |
| Temporary working state | `chrome.storage.session` | Fast, in-memory, survives service worker restarts |
| Large session archives | IndexedDB | No practical size limits |
| Tab thumbnails/screenshots | IndexedDB | Better for binary data |

---

## 5. Privacy Considerations -- Incognito Data Lifecycle

### Core Principle

Google's documentation states: **"Incognito mode promises that the window will leave no tracks."** Extensions must honor this commitment.

### What Happens When an Incognito Window Closes

- Chrome deletes all temporary data: cookies, site data, browsing history from that session
- The `chrome.sessions` API does **NOT** record incognito tabs in "recently closed" -- they are unrecoverable through the native API
- `chrome.storage.local` and `chrome.storage.sync` data **persists** (they are not cleared)
- In split mode, the incognito service worker process is terminated

### Extension Privacy Guidelines

**DO store from incognito:**
- User settings and preferences (these are not browsing data)

**DO NOT store from incognito (unless the user explicitly opts in):**
- Browsing history / URLs visited
- Page titles
- Tab session data

**For a tab saver extension, the recommended approach is:**
1. **Require explicit user action** to save incognito tabs (never auto-save)
2. **Clearly warn users** that saving incognito tabs persists data that would otherwise be deleted
3. **Offer automatic cleanup** options (e.g., auto-delete saved incognito sessions after restore)
4. **Label saved sessions** as originating from incognito so users know what they saved
5. **Never save incognito tab data to chrome.storage.sync** (this would sync private URLs to other devices)
6. Store sensitive incognito data only in `chrome.storage.local` (device-only)

### Security Note

Chrome extension storage is **not encrypted**. Sensitive user data should not be stored client-side without additional protection.

---

## 6. Detecting and Interacting with Incognito Tabs

### Permission Requirements

1. **User must manually enable** the extension for incognito mode in `chrome://extensions` -- extensions cannot programmatically enable themselves for incognito
2. The `"tabs"` permission is required to access `url`, `title`, and `favIconUrl` of incognito tabs
3. No special permission beyond the manifest `"incognito"` key is needed to detect incognito status

### Detecting Incognito Tabs

```javascript
// Query all incognito tabs
const incognitoTabs = await chrome.tabs.query({ incognito: true });

// Query all tabs and filter
const allTabs = await chrome.tabs.query({});
const incognito = allTabs.filter(tab => tab.incognito);
const regular = allTabs.filter(tab => !tab.incognito);
```

### Detecting Incognito Windows

```javascript
// Check if a specific window is incognito
const window = await chrome.windows.get(windowId);
if (window.incognito) {
  // Handle incognito window
}

// Get all incognito windows
const allWindows = await chrome.windows.getAll({ populate: true });
const incognitoWindows = allWindows.filter(w => w.incognito);
```

### Creating Incognito Windows for Restore

```javascript
// Create a new incognito window with specific URLs
const newWindow = await chrome.windows.create({
  url: savedUrls,        // Array of URLs to open as tabs
  incognito: true,
  focused: true
});
```

### Checking Extension's Incognito Access

```javascript
// Check if the extension is allowed in incognito
const isAllowedIncognito = await chrome.extension.isAllowedIncognitoAccess();
if (!isAllowedIncognito) {
  // Prompt user to enable incognito access in chrome://extensions
}
```

### Important Limitations

- **No programmatic enable**: Extensions cannot grant themselves incognito access
- **chrome.sessions.getRecentlyClosed()** does NOT include incognito tabs
- **In spanning mode**: Extension sees incognito events but cannot load its own pages in incognito frames
- **In split mode**: Separate processes mean the regular instance cannot see incognito tabs and vice versa
- **Tab URLs in incognito**: Still require the `"tabs"` permission to read

---

## 7. Recommended Tech Stack (2025-2026)

### Framework Comparison

| Framework | Build Tool | Bundle Size | Best For | Status (2026) |
|-----------|-----------|-------------|----------|---------------|
| **WXT** | Vite | ~400 KB | Production extensions | Actively maintained, recommended |
| **Plasmo** | Parcel | ~800 KB | Content script-heavy projects | Maintenance slowing |
| **Bedframe** | Vite | ~450 KB | Team/CI/CD environments | Actively maintained |
| **Extension.js** | Custom | ~500 KB | Learning, prototyping | Actively maintained |
| **CRXJS** | Vite plugin | ~450 KB | Learning raw APIs | Maintenance uncertain |

### Top Recommendation: WXT + React/Svelte + TypeScript

**WXT** is the leading framework in 2025-2026 for browser extension development:
- **File-based routing**: Place files in `entrypoints/` and WXT auto-generates manifest entries
- **Framework-agnostic**: First-class support for React, Vue, Svelte, Solid
- **Cross-browser**: Single codebase builds for Chrome, Firefox, Edge, Safari
- **MV2 and MV3**: Supports both from the same codebase
- **Fast HMR**: Vite-powered hot module replacement
- **Auto-publishing**: Built-in utilities for Chrome Web Store submission
- **TypeScript**: Full type safety out of the box
- **Smallest bundles**: ~43% smaller than Plasmo

### Alternative: Manual Setup with Vite

If you prefer more control:
```
React + Vite + TypeScript + TailwindCSS
```
Popular boilerplate: [chrome-extension-boilerplate-react-vite](https://github.com/Jonghakseo/chrome-extension-boilerplate-react-vite)

### Recommended Stack for a Tab Saver Extension

```
Framework:     WXT (or Vite manual setup)
UI Library:    Svelte 5 or React 19  (Svelte for smallest bundle, React for largest ecosystem)
Language:      TypeScript (mandatory for extension development -- API types catch errors early)
Styling:       TailwindCSS + shadcn/ui (or DaisyUI)
State:         chrome.storage.local + chrome.storage.session
Testing:       Vitest + Playwright (for E2E)
```

### Project Structure (WXT)

```
my-extension/
  entrypoints/
    background.ts          # Service worker (auto-registered)
    popup/
      index.html           # Popup UI (auto-registered)
      App.tsx              # Popup component
      main.tsx             # Popup entry
    options/
      index.html           # Options page
  components/              # Shared UI components
  utils/
    storage.ts             # Storage helpers
    tabs.ts                # Tab management logic
  public/
    icon-16.png
    icon-48.png
    icon-128.png
  wxt.config.ts            # WXT configuration
  package.json
  tsconfig.json
```

---

## 8. Tab Groups in the Chrome Extensions API

### Permissions

The `"tabGroups"` permission is required but is **not shown to users** in permission prompts (silent permission).

### Tab Group Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | number | Unique within a browser session |
| `windowId` | number | Window containing the group |
| `title` | string (optional) | Group name |
| `color` | enum | grey, blue, red, yellow, green, pink, purple, cyan, orange |
| `collapsed` | boolean | Whether grouped tabs are hidden |
| `shared` | boolean (Chrome 137+) | Whether the group is shared |

### chrome.tabGroups Methods

```javascript
// Get a specific group
const group = await chrome.tabGroups.get(groupId);

// Query groups by properties
const groups = await chrome.tabGroups.query({
  color: 'blue',
  collapsed: false,
  windowId: windowId,
  title: 'Work'
});

// Update group properties
await chrome.tabGroups.update(groupId, {
  title: 'My Group',
  color: 'green',
  collapsed: true
});

// Move a group to a new position or window
await chrome.tabGroups.move(groupId, {
  index: 0,
  windowId: targetWindowId  // optional
});
```

### chrome.tabs Methods for Grouping

```javascript
// Group tabs into a new group
const groupId = await chrome.tabs.group({
  tabIds: [tabId1, tabId2, tabId3]
});

// Group tabs into an existing group
await chrome.tabs.group({
  tabIds: [tabId4],
  groupId: existingGroupId
});

// Ungroup tabs
await chrome.tabs.ungroup([tabId1, tabId2]);
```

### Tab Group Events

- `tabGroups.onCreated` -- Group created
- `tabGroups.onUpdated` -- Group properties changed (title, color, collapsed)
- `tabGroups.onMoved` -- Group repositioned
- `tabGroups.onRemoved` -- Group closed/dissolved

### Saving and Restoring Tab Groups

To fully save and restore tab groups, you need to capture:

```javascript
// Save: Capture group info alongside tabs
async function saveSession() {
  const tabs = await chrome.tabs.query({});
  const groups = await chrome.tabGroups.query({});

  const session = {
    timestamp: Date.now(),
    tabs: tabs.map(t => ({
      url: t.url,
      title: t.title,
      pinned: t.pinned,
      groupId: t.groupId,
      index: t.index,
      active: t.active,
      incognito: t.incognito
    })),
    groups: groups.map(g => ({
      id: g.id,
      title: g.title,
      color: g.color,
      collapsed: g.collapsed
    }))
  };

  await chrome.storage.local.set({ session });
}

// Restore: Recreate groups and assign tabs
async function restoreSession() {
  const { session } = await chrome.storage.local.get('session');
  if (!session) return;

  // Create window (incognito if needed)
  const window = await chrome.windows.create({
    url: session.tabs[0]?.url,
    incognito: session.tabs[0]?.incognito
  });

  // Map old group IDs to new ones
  const groupMap = new Map();

  // Create remaining tabs
  for (let i = 1; i < session.tabs.length; i++) {
    const tabData = session.tabs[i];
    const newTab = await chrome.tabs.create({
      url: tabData.url,
      windowId: window.id,
      pinned: tabData.pinned,
      active: tabData.active
    });

    // Handle group assignment
    if (tabData.groupId !== -1) {
      if (!groupMap.has(tabData.groupId)) {
        const newGroupId = await chrome.tabs.group({
          tabIds: [newTab.id],
          createProperties: { windowId: window.id }
        });
        groupMap.set(tabData.groupId, newGroupId);

        // Apply group properties
        const oldGroup = session.groups.find(g => g.id === tabData.groupId);
        if (oldGroup) {
          await chrome.tabGroups.update(newGroupId, {
            title: oldGroup.title,
            color: oldGroup.color,
            collapsed: oldGroup.collapsed
          });
        }
      } else {
        await chrome.tabs.group({
          tabIds: [newTab.id],
          groupId: groupMap.get(tabData.groupId)
        });
      }
    }
  }
}
```

---

## Summary: Architecture for an Incognito Tab Saver Extension

```
Manifest V3 + Service Worker
    |
    |-- chrome.tabs.query({ incognito: true })  --> Get incognito tabs
    |-- chrome.tabs.query({ incognito: false })  --> Get regular tabs
    |-- chrome.tabGroups.query({})               --> Get tab groups
    |
    |-- User clicks "Save" in popup
    |       |
    |       |-- Serialize tab URLs, titles, groups, positions
    |       |-- Store in chrome.storage.local (persistent)
    |       |-- Label session as incognito/regular
    |       |-- Warn user about privacy implications for incognito data
    |
    |-- User clicks "Restore" in popup
    |       |
    |       |-- Read from chrome.storage.local
    |       |-- chrome.windows.create({ incognito: true/false, url: [...] })
    |       |-- Recreate tab groups with chrome.tabs.group()
    |       |-- Apply group properties with chrome.tabGroups.update()
    |       |-- Optionally auto-delete saved incognito data after restore
    |
    |-- Privacy Layer
            |-- Check chrome.extension.isAllowedIncognitoAccess()
            |-- Never auto-save incognito tabs
            |-- Never sync incognito data (avoid chrome.storage.sync for URLs)
            |-- Offer "burn after restore" option
```

### Required Permissions Summary

```json
{
  "permissions": [
    "tabs",           // Read tab URLs, titles, favicons
    "storage",        // chrome.storage.local and .session
    "sessions",       // Access recently closed tabs (regular only)
    "tabGroups"       // Read and manage tab groups (silent permission)
  ],
  "optional_permissions": [
    "unlimitedStorage"  // If saving many sessions / screenshots
  ]
}
```
