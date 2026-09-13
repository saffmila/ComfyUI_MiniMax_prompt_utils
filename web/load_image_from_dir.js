/** Live preview for LoadImageFromDir — auto-updates on index/arrows + Prev/Next buttons. */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "LoadImageFromDir";
const WATCH = ["directory", "mode", "index", "seed", "pattern"];

function widgetByName(node, name) {
    return (node.widgets || []).find((w) => w.name === name);
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

function isNodeSelected(node) {
    const selected = app.canvas?.selected_nodes;
    if (selected && selected[node.id]) return true;
    return app.canvas?.node_over === node;
}

function setStatus(node, text) {
    const w = widgetByName(node, "status");
    if (w) w.value = text || "";
}

function snapWatched(node) {
    const out = {};
    for (const name of WATCH) {
        out[name] = widgetByName(node, name)?.value;
    }
    return out;
}

async function refreshPreview(node) {
    if (node._mmuRefreshing) {
        node._mmuNeedsRefresh = true;
        return;
    }
    node._mmuRefreshing = true;
    node._mmuNeedsRefresh = false;
    try {
        const directory = widgetByName(node, "directory")?.value || "";
        const pattern = widgetByName(node, "pattern")?.value || "*";
        const mode = widgetByName(node, "mode")?.value || "sequential";
        const index = Number(widgetByName(node, "index")?.value || 0);
        const seed = widgetByName(node, "seed")?.value || 0;

        if (!String(directory).trim()) {
            node.imgs = undefined;
            setStatus(node, "Set directory path…");
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
        const res = await api.fetchApi(`/minimaxutils/resolve?${q}`);
        if (!res.ok) {
            node.imgs = undefined;
            setStatus(node, `API error ${res.status}`);
            app.graph?.setDirtyCanvas?.(true, true);
            return;
        }
        const data = await res.json();
        node._mmuCount = data.count || 0;

        if (!data.file) {
            node.imgs = undefined;
            setStatus(node, "No images found");
            app.graph?.setDirtyCanvas?.(true, true);
            return;
        }

        if (node._mmuLastPath === data.file.path && node.imgs?.length) {
            setStatus(node, `${data.index + 1}/${node._mmuCount}  ${data.file.name}`);
            return;
        }

        const file = data.file;
        const viewQ = new URLSearchParams({
            path: file.path,
            preview: "webp;85",
            t: String(Date.now()),
        });
        const url = api.apiURL(`/minimaxutils/view?${viewQ}`);

        await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                node.imgs = [img];
                node.imageIndex = 0;
                node._mmuLastPath = file.path;
                if (node.size && node.size[1] < 320) node.size[1] = 320;
                setStatus(
                    node,
                    `${data.index + 1}/${node._mmuCount}  ${file.name}  ·  ${img.naturalWidth}×${img.naturalHeight}`
                );
                app.graph?.setDirtyCanvas?.(true, true);
                resolve();
            };
            img.onerror = () => {
                node.imgs = undefined;
                node._mmuLastPath = null;
                setStatus(node, "Preview failed");
                app.graph?.setDirtyCanvas?.(true, true);
                resolve();
            };
            img.src = url;
        });
    } catch (err) {
        node.imgs = undefined;
        node._mmuLastPath = null;
        setStatus(node, String(err?.message || err));
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
        node._mmuLastPath = null;
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
    node._mmuLastPath = null;
    schedulePreview(node, true);
}

function onWatchedChange(node, widgetName) {
    if (widgetName === "mode") applyModeControls(node);
    if (widgetName === "directory" || widgetName === "pattern") {
        node._mmuLastPath = null;
    }
    const immediate =
        widgetName === "index" || widgetName === "mode" || widgetName === "seed";
    schedulePreview(node, immediate);
}

/** Catch value writes even when LiteGraph/Vue skips widget.callback. */
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
    } catch (_) {
        // Some Vue widgets are non-configurable — fall back below.
    }

    const prevCb = widget.callback;
    widget.callback = function (val) {
        const result = prevCb ? prevCb.apply(this, arguments) : undefined;
        onWatchedChange(node, name);
        return result;
    };

    // DOM input (Nodes 2.0 / Vue widgets)
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
    // Keep label readable in UI
    if (w) w.label = label;
    return w;
}

function checkSnapAndRefresh(node) {
    const snap = snapWatched(node);
    const prev = node._mmuSnap;
    node._mmuSnap = snap;
    if (!prev) return;
    for (const name of WATCH) {
        if (String(prev[name]) !== String(snap[name])) {
            onWatchedChange(node, name);
            return;
        }
    }
}

function attachPreviewUi(node) {
    // Buttons: always (re)ensure — even if an older attach ran without them
    if (!widgetByName(node, "status")) {
        node.addWidget("text", "status", "…", () => {}, { serialize: false });
    }
    ensureButton(node, "◀ Previous", "◀ Previous", () => bumpIndex(node, -1));
    ensureButton(node, "Next ▶", "Next ▶", () => bumpIndex(node, 1));

    if (node._mmuWatchAttached) return;
    node._mmuWatchAttached = true;

    for (const name of WATCH) {
        watchWidgetValue(node, widgetByName(node, name), name);
    }

    const prevWidgetChanged = node.onWidgetChanged;
    node.onWidgetChanged = function (name) {
        prevWidgetChanged?.apply(this, arguments);
        if (WATCH.includes(name)) onWatchedChange(this, name);
    };

    // After any mouse interaction on the node, re-check widget values
    // (covers native ◀▶ on INT widgets that don't fire callback).
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

    // Light poll while selected — Vue arrow clicks sometimes skip mouse hooks
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
    node._mmuSnap = snapWatched(node);
    setTimeout(() => refreshPreview(node), 50);

    if (!node._mmuKeyHandler) {
        node._mmuKeyHandler = (ev) => {
            if (!isNodeSelected(node)) return;
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

console.log("[MinimaxUtils] LoadImageFromDir UI extension loaded");

app.registerExtension({
    name: "Comfyui-MinimaxUtils.LoadImageFromDir",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated?.apply(this, arguments);
            attachPreviewUi(this);
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
            if (message?.index?.[0] != null) {
                const indexW = widgetByName(this, "index");
                if (indexW) indexW.value = message.index[0];
            }
            this._mmuLastPath = null;
            schedulePreview(this, true);
        };
    },

    nodeCreated(node) {
        if (node?.comfyClass === NODE_NAME || node?.type === NODE_NAME) {
            attachPreviewUi(node);
        }
    },
});
