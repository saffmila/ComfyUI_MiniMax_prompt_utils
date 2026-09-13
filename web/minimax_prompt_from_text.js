/** MinimaxPromptFromText — slot colors + directory browse (Prev/Next / live preview). */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "MinimaxPromptFromText";
const DIR_WATCH = ["from_disk", "directory", "mode", "index", "seed", "pattern"];
const BAD_PATTERNS = new Set(["fixed", "increment", "decrement", "randomize"]);

function normalizePattern(value) {
    const p = String(value ?? "").trim() || "*.txt";
    if (BAD_PATTERNS.has(p.toLowerCase())) return "*.txt";
    return p;
}

function fixPatternWidget(node) {
    const w = widgetByName(node, "pattern");
    if (!w) return "*.txt";
    const fixed = normalizePattern(w.value);
    if (String(w.value) !== fixed) w.value = fixed;
    return fixed;
}

/** Match SLOT_COLORS in minimax_prompt_compiler.py */
const SLOT_THEME = {
    pose: { color: "#5a4e14", bgcolor: "#2a2410", accent: "#e6c84a" },
    camera: { color: "#143a5a", bgcolor: "#0e1e2e", accent: "#4a9eff" },
    zoom: { color: "#3a145a", bgcolor: "#1c0e2e", accent: "#b44aff" },
    env: { color: "#145a2e", bgcolor: "#0e2e18", accent: "#3dff6a" },
    motion: { color: "#5a3a14", bgcolor: "#2e1e0e", accent: "#ff9a3d" },
    action: { color: "#5a1430", bgcolor: "#2e0e18", accent: "#ff5a8a" },
    extra: { color: "#3a3a3a", bgcolor: "#1e1e1e", accent: "#c0c0c0" },
    pic1: { color: "#5a1414", bgcolor: "#2a1010", accent: "#ff6b6b" },
    pic2: { color: "#5a3a14", bgcolor: "#2a1e10", accent: "#ffa94d" },
    pic3: { color: "#145a2e", bgcolor: "#0e2a18", accent: "#69db7c" },
    pic4: { color: "#143a5a", bgcolor: "#0e1e2e", accent: "#4dabf7" },
    pic5: { color: "#3a145a", bgcolor: "#1c0e2e", accent: "#da77f2" },
    pic6: { color: "#5a4e14", bgcolor: "#2a2410", accent: "#ffd43b" },
    pic7: { color: "#145a5a", bgcolor: "#0e2a2a", accent: "#22b8cf" },
    pic8: { color: "#5a2020", bgcolor: "#2a1212", accent: "#ff8787" },
    pic9: { color: "#3a5a14", bgcolor: "#1e2a10", accent: "#a9e34b" },
};

function themeForSlot(key) {
    if (SLOT_THEME[key]) return SLOT_THEME[key];
    let hash = 0;
    const s = String(key || "extra");
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return {
        color: `hsl(${hue} 45% 22%)`,
        bgcolor: `hsl(${hue} 35% 12%)`,
        accent: `hsl(${hue} 70% 62%)`,
    };
}

function widgetByName(node, name) {
    return (node.widgets || []).find((w) => w.name === name);
}

function activeThemeKey(node) {
    const picture = String(widgetByName(node, "picture")?.value || "(none)").trim();
    if (/^[1-9]$/.test(picture)) return `pic${picture}`;
    return String(widgetByName(node, "slot")?.value || "action")
        .trim()
        .toLowerCase();
}

function applySlotColor(node) {
    const theme = themeForSlot(activeThemeKey(node));
    node.color = theme.color;
    node.bgcolor = theme.bgcolor;
    app.graph?.setDirtyCanvas?.(true, true);
}

function setControlAfterGenerate(node, widgetName, value) {
    const w = widgetByName(node, widgetName);
    if (!w) return;
    for (const lw of w.linkedWidgets || []) {
        if ((lw.options?.values || []).includes(value)) lw.value = value;
    }
    const idx = node.widgets.indexOf(w);
    for (let i = idx + 1; i < Math.min(idx + 4, node.widgets.length); i++) {
        const cand = node.widgets[i];
        if (cand?.name === "control_after_generate") {
            if ((cand.options?.values || []).includes(value)) cand.value = value;
            break;
        }
    }
}

function applyModeControls(node) {
    const mode = widgetByName(node, "mode")?.value || "sequential";
    if (mode === "sequential") {
        setControlAfterGenerate(node, "index", "increment");
        setControlAfterGenerate(node, "seed", "fixed");
    } else if (mode === "random") {
        setControlAfterGenerate(node, "index", "fixed");
        setControlAfterGenerate(node, "seed", "randomize");
    } else {
        setControlAfterGenerate(node, "index", "fixed");
        setControlAfterGenerate(node, "seed", "fixed");
    }
}

function isFromDisk(node) {
    const w = widgetByName(node, "from_disk");
    if (!w) return false;
    return w.value === true || w.value === 1 || w.value === "true" || w.value === "directory";
}

function isNodeSelected(node) {
    const selected = app.canvas?.selected_nodes;
    if (selected && selected[node.id]) return true;
    return app.canvas?.node_over === node;
}

function setStatus(node, text) {
    const w = widgetByName(node, "status");
    if (w) w.value = text || "";
}

function setPromptPreview(node, text) {
    const w = widgetByName(node, "prompt_text");
    if (!w) return;
    const next = text || "";
    if (String(w.value ?? "") === next) return;
    w.value = next;
    // Keep DOM textarea in sync (Vue / native widgets).
    for (const el of [w.inputEl, w.element, w.domWidget?.element]) {
        if (el && "value" in el && el.value !== next) el.value = next;
    }
}

function setPromptTextReadonly(node, readonly) {
    const w = widgetByName(node, "prompt_text");
    if (!w) return;
    for (const el of [w.inputEl, w.element, w.domWidget?.element]) {
        if (!el) continue;
        if ("readOnly" in el) el.readOnly = !!readonly;
        if (el.style) el.style.opacity = readonly ? "0.95" : "";
    }
}

function enterDiskMode(node) {
    const pt = widgetByName(node, "prompt_text");
    if (pt && node._mmuManualPrompt === undefined) {
        const cur = String(pt.value ?? "");
        // Don't treat a leaked pattern as the user's manual text.
        node._mmuManualPrompt = BAD_PATTERNS.has(cur.toLowerCase()) || cur === "*.txt" ? "action: " : cur;
    }
    if (pt) pt.label = "prompt (loaded file)";
    setPromptTextReadonly(node, true);
}

function leaveDiskMode(node) {
    const pt = widgetByName(node, "prompt_text");
    if (pt) {
        pt.label = "prompt_text";
        if (node._mmuManualPrompt !== undefined) {
            setPromptPreview(node, node._mmuManualPrompt);
            node._mmuManualPrompt = undefined;
        }
    }
    setPromptTextReadonly(node, false);
    setStatus(node, "");
}

function snapWatched(node) {
    const out = {};
    for (const name of DIR_WATCH) {
        out[name] = widgetByName(node, name)?.value;
    }
    return out;
}

async function refreshPreview(node) {
    if (!isFromDisk(node)) {
        leaveDiskMode(node);
        return;
    }
    enterDiskMode(node);
    if (node._mmuRefreshing) {
        node._mmuNeedsRefresh = true;
        return;
    }
    node._mmuRefreshing = true;
    node._mmuNeedsRefresh = false;
    try {
        const directory = widgetByName(node, "directory")?.value || "";
        const pattern = fixPatternWidget(node);
        const mode = widgetByName(node, "mode")?.value || "sequential";
        const index = Number(widgetByName(node, "index")?.value || 0);
        const seed = widgetByName(node, "seed")?.value || 0;

        if (!String(directory).trim()) {
            setStatus(node, "Set directory path…");
            setPromptPreview(node, "");
            app.graph?.setDirtyCanvas?.(true, true);
            return;
        }

        const q = new URLSearchParams({
            directory,
            pattern,
            mode,
            index: String(index),
            seed: String(seed),
        });
        const res = await api.fetchApi(`/minimaxutils/resolveprompt?${q}`);
        if (!res.ok) {
            setStatus(node, `API error ${res.status}`);
            setPromptPreview(node, "");
            app.graph?.setDirtyCanvas?.(true, true);
            return;
        }
        const data = await res.json();
        node._mmuCount = data.count || 0;

        if (!data.file) {
            setStatus(node, "No prompts found");
            setPromptPreview(node, "");
            app.graph?.setDirtyCanvas?.(true, true);
            return;
        }

        setStatus(node, `${data.index + 1}/${node._mmuCount}  ${data.file.name}`);
        setPromptPreview(node, data.raw || "");
        app.graph?.setDirtyCanvas?.(true, true);
    } catch (err) {
        setStatus(node, String(err?.message || err));
        setPromptPreview(node, "");
        app.graph?.setDirtyCanvas?.(true, true);
    } finally {
        node._mmuRefreshing = false;
        if (node._mmuNeedsRefresh) {
            node._mmuNeedsRefresh = false;
            refreshPreview(node);
        }
    }
}

function schedulePreview(node, immediate = false) {
    clearTimeout(node._mmuDebounce);
    if (immediate) {
        refreshPreview(node);
        return;
    }
    node._mmuDebounce = setTimeout(() => refreshPreview(node), 50);
}

function bumpIndex(node, delta) {
    const modeW = widgetByName(node, "mode");
    if (modeW?.value === "random") {
        const seedW = widgetByName(node, "seed");
        if (!seedW) return;
        seedW.value = Math.max(0, Number(seedW.value || 0) + delta);
        try {
            seedW.callback?.(seedW.value);
        } catch (_) {}
        schedulePreview(node, true);
        return;
    }
    const indexW = widgetByName(node, "index");
    if (!indexW) return;
    const count = Math.max(1, node._mmuCount || 1);
    let next = Number(indexW.value || 0) + delta;
    next = ((next % count) + count) % count;
    indexW.value = next;
    try {
        indexW.callback?.(next);
    } catch (_) {}
    schedulePreview(node, true);
}

function onWatchedChange(node, widgetName) {
    if (widgetName === "mode" || widgetName === "from_disk") applyModeControls(node);
    if (widgetName === "from_disk") {
        if (isFromDisk(node)) enterDiskMode(node);
        else leaveDiskMode(node);
    }
    const immediate =
        widgetName === "index" ||
        widgetName === "mode" ||
        widgetName === "seed" ||
        widgetName === "from_disk";
    schedulePreview(node, immediate);
}

function watchWidgetValue(node, widget, name) {
    if (!widget || widget._mmuValueWatched) return;
    widget._mmuValueWatched = true;

    let current = widget.value;
    try {
        Object.defineProperty(widget, "value", {
            configurable: true,
            enumerable: true,
            get() {
                return current;
            },
            set(next) {
                const prev = current;
                current = next;
                if (prev !== next) onWatchedChange(node, name);
            },
        });
    } catch (_) {}

    const prevCb = widget.callback;
    widget.callback = function (val) {
        const result = prevCb ? prevCb.apply(this, arguments) : undefined;
        onWatchedChange(node, name);
        return result;
    };

    for (const el of [widget.element, widget.inputEl, widget.domWidget?.element]) {
        if (!el || typeof el.addEventListener !== "function") continue;
        el.addEventListener("input", () => onWatchedChange(node, name));
        el.addEventListener("change", () => onWatchedChange(node, name));
    }
}

function ensureButton(node, name, label, fn) {
    let w = widgetByName(node, name);
    if (w) return w;
    w = node.addWidget("button", name, null, fn);
    if (w) w.label = label;
    return w;
}

function checkSnapAndRefresh(node) {
    const snap = snapWatched(node);
    const prev = node._mmuSnap;
    node._mmuSnap = snap;
    if (!prev) return;
    for (const name of DIR_WATCH) {
        if (String(prev[name]) !== String(snap[name])) {
            onWatchedChange(node, name);
            return;
        }
    }
}

function hookWidget(node, name, fn) {
    const w = widgetByName(node, name);
    if (!w || w._mmuHooked) return;
    w._mmuHooked = true;
    const prev = w.callback;
    w.callback = function (...args) {
        const result = prev?.apply(this, args);
        fn(node);
        return result;
    };
}

function attachUi(node) {
    if (!widgetByName(node, "status")) {
        node.addWidget("text", "status", "…", () => {}, { serialize: false });
    }
    ensureButton(node, "◀ Previous", "◀ Previous", () => bumpIndex(node, -1));
    ensureButton(node, "Next ▶", "Next ▶", () => bumpIndex(node, 1));

    if (!node._mmuFromTextUi) {
        node._mmuFromTextUi = true;
        hookWidget(node, "slot", applySlotColor);
        hookWidget(node, "picture", applySlotColor);
        applySlotColor(node);
    }

    if (node._mmuWatchAttached) return;
    node._mmuWatchAttached = true;

    for (const name of DIR_WATCH) {
        watchWidgetValue(node, widgetByName(node, name), name);
    }

    const prevWidgetChanged = node.onWidgetChanged;
    node.onWidgetChanged = function (name) {
        prevWidgetChanged?.apply(this, arguments);
        if (DIR_WATCH.includes(name)) onWatchedChange(this, name);
        if (name === "slot" || name === "picture") applySlotColor(this);
    };

    const prevMouseUp = node.onMouseUp;
    node.onMouseUp = function () {
        const r = prevMouseUp?.apply(this, arguments);
        checkSnapAndRefresh(this);
        return r;
    };
    const prevMouseDown = node.onMouseDown;
    node.onMouseDown = function () {
        this._mmuSnap = snapWatched(this);
        return prevMouseDown?.apply(this, arguments);
    };

    if (!node._mmuPoll) {
        node._mmuPoll = setInterval(() => {
            if (!node.graph) {
                clearInterval(node._mmuPoll);
                node._mmuPoll = null;
                return;
            }
            if (isNodeSelected(node)) checkSnapAndRefresh(node);
        }, 200);
    }

    applyModeControls(node);
    fixPatternWidget(node);
    node._mmuSnap = snapWatched(node);
    setTimeout(() => refreshPreview(node), 50);

    if (!node._mmuKeyHandler) {
        node._mmuKeyHandler = (ev) => {
            if (!isNodeSelected(node) || !isFromDisk(node)) return;
            const tag = (ev.target?.tagName || "").toLowerCase();
            if (tag === "input" || tag === "textarea" || ev.target?.isContentEditable) return;
            if (ev.key === "ArrowUp") {
                ev.preventDefault();
                ev.stopPropagation();
                bumpIndex(node, 1);
            } else if (ev.key === "ArrowDown") {
                ev.preventDefault();
                ev.stopPropagation();
                bumpIndex(node, -1);
            }
        };
        window.addEventListener("keydown", node._mmuKeyHandler, true);
    }
}

console.log("[MinimaxUtils] MinimaxPromptFromText UI extension loaded");

app.registerExtension({
    name: "Comfyui-MinimaxUtils.MinimaxPromptFromText",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated?.apply(this, arguments);
            attachUi(this);
            return r;
        };

        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (o) {
            onSerialize?.apply(this, arguments);
            if (!o || typeof o !== "object") return;
            const named = {};
            for (const w of this.widgets || []) {
                if (!w?.name || w.serialize === false) continue;
                named[w.name] = w.value;
            }
            // Don't persist the live file preview over the user's manual text.
            if (isFromDisk(this) && this._mmuManualPrompt !== undefined) {
                named.prompt_text = this._mmuManualPrompt;
            }
            o.mmu_widgets = named;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            const r = onConfigure?.apply(this, arguments);
            if (info?.mmu_widgets && typeof info.mmu_widgets === "object") {
                for (const [name, value] of Object.entries(info.mmu_widgets)) {
                    const w = widgetByName(this, name);
                    if (w) w.value = value;
                }
            }
            requestAnimationFrame(() => {
                this._mmuWatchAttached = false;
                attachUi(this);
                applyModeControls(this);
                schedulePreview(this, true);
            });
            return r;
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (this._mmuKeyHandler) {
                window.removeEventListener("keydown", this._mmuKeyHandler, true);
                this._mmuKeyHandler = null;
            }
            if (this._mmuPoll) {
                clearInterval(this._mmuPoll);
                this._mmuPoll = null;
            }
            return onRemoved?.apply(this, arguments);
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            if (message?.slot?.[0]) {
                const slotW = widgetByName(this, "slot");
                const key = String(message.slot[0]);
                if (slotW && !key.startsWith("pic")) slotW.value = key;
            }
            if (message?.picture?.[0]) {
                const picW = widgetByName(this, "picture");
                const n = String(message.picture[0]);
                if (picW && n) picW.value = n;
            }
            if (message?.index?.[0] != null) {
                const indexW = widgetByName(this, "index");
                if (indexW) indexW.value = message.index[0];
            }
            applySlotColor(this);
            schedulePreview(this, true);
        };
    },

    nodeCreated(node) {
        if (node?.comfyClass === NODE_NAME || node?.type === NODE_NAME) {
            attachUi(node);
        }
    },
});
