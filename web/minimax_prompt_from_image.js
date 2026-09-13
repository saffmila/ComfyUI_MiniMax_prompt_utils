/** MinimaxPromptFromImage — sidecar preview + slot / Picture color coding. */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "MinimaxPromptFromImage";

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

function setWidgetDisabled(widget, disabled) {
    if (!widget) return;
    widget.disabled = disabled;
    for (const linked of widget.linkedWidgets || []) {
        linked.disabled = disabled;
    }
}

function moveWidgetAfter(node, widget, afterName) {
    const widgets = node.widgets;
    if (!widgets || !widget) return;
    const from = widgets.indexOf(widget);
    const after = widgets.findIndex((w) => w.name === afterName);
    if (from < 0 || after < 0) return;
    widgets.splice(from, 1);
    const insertAt = widgets.findIndex((w) => w.name === afterName) + 1;
    widgets.splice(insertAt, 0, widget);
}

function activeThemeKey(node) {
    const picture = String(widgetByName(node, "picture")?.value || "(none)").trim();
    if (/^[1-9]$/.test(picture)) return `pic${picture}`;
    return String(widgetByName(node, "slot")?.value || "pose")
        .trim()
        .toLowerCase();
}

function applySlotColor(node) {
    const theme = themeForSlot(activeThemeKey(node));
    node.color = theme.color;
    node.bgcolor = theme.bgcolor;
    const pre = node._mmuPreviewPre;
    const wrap = node._mmuPreviewWrap;
    if (pre) pre.style.color = theme.accent;
    if (wrap) wrap.style.borderColor = theme.accent + "66";
    app.graph?.setDirtyCanvas?.(true, true);
}

function resolveUpstreamPath(node) {
    const input = (node.inputs || []).find((i) => i.name === "image_path");
    if (!input || input.link == null) return "";
    const link = app.graph?.links?.[input.link];
    if (!link) return "";
    const upstream = app.graph.getNodeById(link.origin_id);
    if (!upstream) return "";
    if (upstream._mmuLastPath) return String(upstream._mmuLastPath);
    for (const name of ["path", "image_path", "filename"]) {
        const v = widgetByName(upstream, name)?.value;
        if (v && String(v).trim()) return String(v).trim();
    }
    return "";
}

function getImagePath(node) {
    const widgetVal = String(widgetByName(node, "image_path")?.value || "").trim();
    if (widgetVal) return widgetVal;
    return resolveUpstreamPath(node);
}

function setPreviewText(node, text, ok = true) {
    const pre = node._mmuPreviewPre;
    if (!pre) return;
    pre.textContent = text || "(empty)";
    if (!ok) pre.style.color = "#8a8a8a";
    else applySlotColor(node);
}

function ensurePreviewWidget(node) {
    if (node._mmuPreviewWidget) return node._mmuPreviewWidget;

    const wrap = document.createElement("div");
    wrap.className = "mmu-sidecar-preview";
    wrap.style.cssText = [
        "background:#0b0f0c",
        "border:1px solid #1f3d28",
        "border-radius:6px",
        "padding:8px 10px",
        "margin:2px 0 4px 0",
        "min-height:72px",
        "max-height:140px",
        "overflow:auto",
        "box-sizing:border-box",
        "width:100%",
    ].join(";");

    const pre = document.createElement("pre");
    pre.style.cssText = [
        "margin:0",
        "padding:0",
        "font-family:Consolas, 'Courier New', monospace",
        "font-size:12px",
        "line-height:1.45",
        "color:#e6c84a",
        "white-space:pre-wrap",
        "word-break:break-word",
        "background:transparent",
        "border:none",
    ].join(";");
    pre.textContent = "(waiting for sidecar…)";
    wrap.appendChild(pre);

    const widget = node.addDOMWidget("sidecar_preview", "preview", wrap, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 88,
    });
    widget.computeSize = (width) => [width, 96];

    node._mmuPreviewPre = pre;
    node._mmuPreviewWrap = wrap;
    node._mmuPreviewWidget = widget;
    moveWidgetAfter(node, widget, "from_file");
    return widget;
}

async function refreshSidecarPreview(node) {
    if (node._mmuPreviewBusy) {
        node._mmuPreviewQueued = true;
        return;
    }
    node._mmuPreviewBusy = true;
    node._mmuPreviewQueued = false;
    try {
        const fromFile = !!widgetByName(node, "from_file")?.value;
        const extractKey = String(widgetByName(node, "extract_key")?.value || "(all)");
        const picture = String(widgetByName(node, "picture")?.value || "(none)");
        const slot = String(widgetByName(node, "slot")?.value || "");
        if (!fromFile) {
            const manual = String(widgetByName(node, "prompt_text")?.value || "").trim();
            if (manual) {
                const prefix = /^[1-9]$/.test(picture) ? `<Picture ${picture}>\n` : "";
                setPreviewText(node, prefix + manual, true);
            } else setPreviewText(node, "(manual mode — type prompt_text)", false);
            return;
        }

        const path = getImagePath(node);
        if (!path) {
            setPreviewText(node, "(no image path — connect Load Image From Dir)", false);
            return;
        }

        const qs = new URLSearchParams({ path, extract_key: extractKey, picture, slot });
        const res = await api.fetchApi(`/minimaxutils/sidecar?${qs.toString()}`);
        if (!res.ok) {
            setPreviewText(node, "(sidecar fetch failed)", false);
            return;
        }
        const data = await res.json();
        setPreviewText(node, data.display || "(empty)", !!data.ok);
    } catch (err) {
        setPreviewText(node, `(preview error) ${err}`, false);
    } finally {
        node._mmuPreviewBusy = false;
        if (node._mmuPreviewQueued) refreshSidecarPreview(node);
    }
}

function schedulePreview(node) {
    clearTimeout(node._mmuPreviewTimer);
    node._mmuPreviewTimer = setTimeout(() => refreshSidecarPreview(node), 80);
}

function applyFromFileUi(node) {
    const fromFile = !!widgetByName(node, "from_file")?.value;
    setWidgetDisabled(widgetByName(node, "prompt_text"), fromFile);
    applySlotColor(node);
    schedulePreview(node);
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

function attachPreviewUi(node) {
    if (node._mmuPromptUiAttached) return;
    node._mmuPromptUiAttached = true;

    ensurePreviewWidget(node);
    hookWidget(node, "from_file", applyFromFileUi);
    hookWidget(node, "prompt_text", schedulePreview);
    hookWidget(node, "image_path", schedulePreview);
    hookWidget(node, "extract_key", schedulePreview);
    hookWidget(node, "slot", applySlotColor);
    hookWidget(node, "picture", () => {
        applySlotColor(node);
        schedulePreview(node);
    });

    if (!node._mmuPreviewPoll) {
        node._mmuPreviewPoll = setInterval(() => {
            if (!node.graph) {
                clearInterval(node._mmuPreviewPoll);
                node._mmuPreviewPoll = null;
                return;
            }
            const path = getImagePath(node);
            if (path !== node._mmuPreviewPathSnap) {
                node._mmuPreviewPathSnap = path;
                schedulePreview(node);
            }
        }, 250);
    }

    requestAnimationFrame(() => applyFromFileUi(node));
}

app.registerExtension({
    name: "Comfyui-MinimaxUtils.MinimaxPromptFromImage",

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
            if (this._mmuPreviewPoll) {
                clearInterval(this._mmuPreviewPoll);
                this._mmuPreviewPoll = null;
            }
            clearTimeout(this._mmuPreviewTimer);
            return onRemoved?.apply(this, arguments);
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            const display = message?.display?.[0];
            if (display != null) setPreviewText(this, display, true);
            else schedulePreview(this);
            if (message?.slot?.[0]) {
                const slotW = widgetByName(this, "slot");
                const key = String(message.slot[0]);
                if (slotW && !key.startsWith("pic")) slotW.value = key;
                applySlotColor(this);
            }
            if (message?.picture?.[0]) {
                const picW = widgetByName(this, "picture");
                const n = String(message.picture[0]);
                if (picW && n) picW.value = n;
                applySlotColor(this);
            }
        };
    },

    nodeCreated(node) {
        if (node?.comfyClass === NODE_NAME || node?.type === NODE_NAME) {
            attachPreviewUi(node);
        }
    },
});

console.log("[MinimaxUtils] MinimaxPromptFromImage UI extension loaded");
