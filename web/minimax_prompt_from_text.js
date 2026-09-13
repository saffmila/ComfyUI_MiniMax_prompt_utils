/** MinimaxPromptFromText — slot / Picture color coding for manual snippets. */

import { app } from "../../scripts/app.js";

const NODE_NAME = "MinimaxPromptFromText";

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
    if (node._mmuFromTextUi) return;
    node._mmuFromTextUi = true;
    hookWidget(node, "slot", applySlotColor);
    hookWidget(node, "picture", applySlotColor);
    applySlotColor(node);
}

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
            applySlotColor(this);
        };
    },

    nodeCreated(node) {
        if (node?.comfyClass === NODE_NAME || node?.type === NODE_NAME) {
            attachUi(node);
        }
    },
});
