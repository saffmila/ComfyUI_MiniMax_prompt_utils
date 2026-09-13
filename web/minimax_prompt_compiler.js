/** MinimaxPromptCompiler — scrollable preview + skeleton + live Preview button. */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "MinimaxPromptCompiler";
const PROMPT_FROM_IMAGE = "MinimaxPromptFromImage";
const PROMPT_FROM_TEXT = "MinimaxPromptFromText";
const LOAD_IMAGE_FROM_DIR = "LoadImageFromDir";

const SLOT_COLORS = {
    pose: "#e6c84a",
    camera: "#4a9eff",
    zoom: "#b44aff",
    env: "#3dff6a",
    motion: "#ff9a3d",
    action: "#ff5a8a",
    extra: "#c0c0c0",
    pic1: "#ff6b6b",
    pic2: "#ffa94d",
    pic3: "#69db7c",
    pic4: "#4dabf7",
    pic5: "#da77f2",
    pic6: "#ffd43b",
    pic7: "#22b8cf",
    pic8: "#ff8787",
    pic9: "#a9e34b",
};

const BEHAVIOR_SLOTS = ["pose", "camera", "zoom", "env", "motion", "action", "extra"];
const PIC_SLOTS = ["pic1", "pic2", "pic3", "pic4", "pic5", "pic6", "pic7", "pic8", "pic9"];
const BUILTIN_SLOTS = [...BEHAVIOR_SLOTS, ...PIC_SLOTS];
const SLOT_NAMES = BUILTIN_SLOTS;
const SLOT_INPUTS = ["bundle", ...SLOT_NAMES];
const PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

function slotColor(name) {
    const key = String(name || "").toLowerCase();
    if (SLOT_COLORS[key]) return SLOT_COLORS[key];
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return `hsl(${hue} 70% 62%)`;
}

function discoverSlots(skeleton) {
    const seen = new Set();
    const out = [];
    const re = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
    let m;
    const sk = String(skeleton || "");
    while ((m = re.exec(sk)) !== null) {
        const key = m[1].toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(key);
    }
    return out;
}

/** MiniMax <Picture N> / <Subject N> label colors (match picN / soft subject tint). */
const PICTURE_TAG_COLORS = {
    1: SLOT_COLORS.pic1,
    2: SLOT_COLORS.pic2,
    3: SLOT_COLORS.pic3,
    4: SLOT_COLORS.pic4,
    5: SLOT_COLORS.pic5,
    6: SLOT_COLORS.pic6,
    7: SLOT_COLORS.pic7,
    8: SLOT_COLORS.pic8,
    9: SLOT_COLORS.pic9,
};
const SUBJECT_TAG_COLORS = {
    1: "#ff8fab",
    2: "#74c0fc",
    3: "#b197fc",
    4: "#63e6be",
    5: "#ffe066",
    6: "#ffc078",
    7: "#91a7ff",
    8: "#e599f7",
    9: "#8ce99a",
};

const PREVIEW_H = 450;
const SKELETON_H = 300;
const PANEL_CHROME_H = 128; // template row + legend/preview row + skeleton label
const PANEL_H = PREVIEW_H + SKELETON_H + PANEL_CHROME_H;
const NODE_MIN_W = 560;
const NODE_DEFAULT_H = PANEL_H + 120;
const NODE_MAX_H = 1400;
const TEMPLATE_PROP = "mmu_template";

function widgetByName(node, name) {
    return (node.widgets || []).find((w) => w.name === name);
}

function moveWidgetToTop(node, widget) {
    const widgets = node.widgets;
    if (!widgets || !widget) return;
    const from = widgets.indexOf(widget);
    if (from <= 0) return;
    widgets.splice(from, 1);
    widgets.splice(0, 0, widget);
}

function clampNodeSize(node) {
    if (!node.size) return;
    let w = Math.max(NODE_MIN_W, node.size[0] || NODE_MIN_W);
    let h = node.size[1] || NODE_DEFAULT_H;
    if (h > NODE_MAX_H) h = NODE_DEFAULT_H;
    h = Math.min(NODE_MAX_H, Math.max(NODE_DEFAULT_H, h));
    if (node.setSize) node.setSize([w, h]);
    else {
        node.size[0] = w;
        node.size[1] = h;
    }
}

function trapGraphEvents(el) {
    if (!el || el._mmuEventsTrapped) return;
    el._mmuEventsTrapped = true;
    for (const name of [
        "pointerdown",
        "pointerup",
        "pointermove",
        "mousedown",
        "mouseup",
        "mousemove",
        "click",
        "dblclick",
        "contextmenu",
    ]) {
        el.addEventListener(name, (ev) => ev.stopPropagation());
    }
    for (const name of ["keydown", "keyup", "keypress", "copy", "cut", "paste"]) {
        el.addEventListener(name, (ev) => ev.stopPropagation());
    }
    el.addEventListener("wheel", (ev) => ev.stopPropagation(), { passive: true });
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function parseFilled(filledJson) {
    const out = {};
    for (const line of String(filledJson || "").split("\n")) {
        const i = line.indexOf("=");
        if (i <= 0) continue;
        out[line.slice(0, i)] = line.slice(i + 1);
    }
    return out;
}

function formatPicInsert(value) {
    const v = String(value || "").trim();
    if (!v) return "";
    if (",:;.-(".includes(v[0])) return v.startsWith(" ") ? v : ` ${v}`;
    return ` - ${v}`;
}

function colorizeMinimaxLabels(html) {
    html = html.replace(/&lt;Picture (\d)&gt;/g, (full, n) => {
        const color = PICTURE_TAG_COLORS[Number(n)] || "#c0c0c0";
        return `<span class="mmu-pic-token" data-mmu-picture="${n}" style="color:${color};font-weight:700;background:${color}22;border-radius:3px;padding:0 2px;cursor:pointer;" title="&lt;Picture ${n}&gt; — hover for preview">${full}</span>`;
    });
    html = html.replace(/&lt;Subject (\d)&gt;/g, (full, n) => {
        const color = SUBJECT_TAG_COLORS[Number(n)] || "#c0c0c0";
        return `<span style="color:${color};font-weight:700;background:${color}22;border-radius:3px;padding:0 2px;" title="&lt;Subject ${n}&gt;">${full}</span>`;
    });
    return html;
}

/* —— Picture hover preview (floating popover, H3-style) —— */

const IMAGE_EXT_RE = /\.(?:avif|bmp|gif|jpe?g|png|webp|tif|tiff|jfif)$/i;
const VIDEO_EXT_RE = /\.(?:m4v|mkv|mov|mp4|webm)$/i;

let _mmuPopoverStyleReady = false;

function ensurePopoverStyle() {
    if (_mmuPopoverStyleReady) return;
    _mmuPopoverStyleReady = true;
    const style = document.createElement("style");
    style.textContent = `
      .mmu-pic-popover { position:fixed; z-index:100000; width:min(360px,calc(100vw - 24px));
        padding:9px; border-radius:8px; border:1px solid #3a3f4a; background:#12151a;
        color:#e8e8e8; box-shadow:0 10px 28px rgba(0,0,0,.55); font:12px Consolas,monospace; }
      .mmu-pic-popover[hidden] { display:none; }
      .mmu-pic-popover-title { margin-bottom:6px; font-weight:700; }
      .mmu-pic-popover-media { display:block; width:100%; max-height:240px; object-fit:contain;
        border-radius:6px; background:#08090c; }
      .mmu-pic-popover-detail { margin-top:6px; color:rgba(238,242,248,.62);
        white-space:pre-wrap; overflow-wrap:anywhere; }
      .mmu-pic-popover-muted { margin-top:4px; color:rgba(238,242,248,.45); }
    `;
    document.head.appendChild(style);
}

function basenamePath(path) {
    const s = String(path || "").replaceAll("\\", "/");
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
}

function filesystemPreviewUrl(path) {
    if (!path) return null;
    const qs = new URLSearchParams({
        path: String(path),
        preview: "webp;85",
    });
    return api.apiURL(`/minimaxutils/view?${qs.toString()}`);
}

function comfyViewUrl(filename, subfolder = "", type = "input") {
    const qs = new URLSearchParams({
        filename: String(filename),
        subfolder: String(subfolder || ""),
        type: String(type || "input"),
    });
    return api.apiURL(`/view?${qs.toString()}`);
}

function widgetMediaAsset(value) {
    if (value && typeof value === "object" && value.filename) {
        return {
            filename: String(value.filename),
            subfolder: String(value.subfolder ?? ""),
            type: String(value.type ?? "input"),
        };
    }
    let text = typeof value === "string" ? value.trim() : "";
    if (!text) return null;
    if (/^(?:blob:|data:|https?:|\/api\/view\?|\/view\?)/i.test(text)) {
        return { url: text };
    }
    let type = "input";
    const annotated = text.match(/\s+\[(input|output|temp)\]\s*$/i);
    if (annotated) {
        type = annotated[1].toLowerCase();
        text = text.slice(0, annotated.index).trim();
    }
    text = text.replaceAll("\\", "/").replace(/^\/+/, "");
    const isImage = IMAGE_EXT_RE.test(text);
    const isVideo = VIDEO_EXT_RE.test(text);
    if (!isImage && !isVideo) return null;
    const slash = text.lastIndexOf("/");
    return {
        filename: slash >= 0 ? text.slice(slash + 1) : text,
        subfolder: slash >= 0 ? text.slice(0, slash) : "",
        type,
        kind: isVideo ? "video" : "image",
    };
}

function previewFromGraphNode(node) {
    if (!node) return null;

    if (node.imgs?.[0]) {
        const rendered = node.imgs[0];
        const src = typeof rendered === "string" ? rendered : rendered?.src;
        if (src) {
            return {
                url: src,
                kind: "image",
                label: basenamePath(node._mmuLastPath) || node.title || nodeTypeName(node),
                source: node,
            };
        }
    }

    if (node._mmuLastPath) {
        return {
            url: filesystemPreviewUrl(node._mmuLastPath),
            kind: "image",
            label: basenamePath(node._mmuLastPath),
            source: node,
            path: node._mmuLastPath,
        };
    }

    for (const name of ["image_path", "path", "filename", "image", "video", "file"]) {
        const raw = widgetByName(node, name)?.value;
        if (raw == null || raw === "") continue;
        if (typeof raw === "string") {
            const text = raw.trim();
            // Absolute / UNC filesystem path → MinimaxUtils view endpoint.
            if (
                IMAGE_EXT_RE.test(text) &&
                (/^[A-Za-z]:[\\/]/.test(text) || text.startsWith("/") || text.startsWith("\\\\"))
            ) {
                return {
                    url: filesystemPreviewUrl(text),
                    kind: "image",
                    label: basenamePath(text),
                    source: node,
                    path: text,
                };
            }
        }
        const asset = widgetMediaAsset(raw);
        if (!asset) continue;
        if (asset.url) {
            const kind =
                VIDEO_EXT_RE.test(asset.url) || /video/i.test(name) ? "video" : "image";
            return { url: asset.url, kind, label: basenamePath(asset.url), source: node };
        }
        return {
            url: comfyViewUrl(asset.filename, asset.subfolder, asset.type),
            kind: asset.kind || "image",
            label: asset.filename,
            source: node,
        };
    }

    for (const widget of node.widgets || []) {
        if (["image_path", "path", "filename", "image", "video", "file"].includes(widget.name)) {
            continue;
        }
        const asset = widgetMediaAsset(widget.value);
        if (!asset) continue;
        if (asset.url) {
            return {
                url: asset.url,
                kind: asset.kind || "image",
                label: basenamePath(asset.url),
                source: node,
            };
        }
        return {
            url: comfyViewUrl(asset.filename, asset.subfolder, asset.type),
            kind: asset.kind || "image",
            label: asset.filename,
            source: node,
        };
    }
    return null;
}

function nodeTypeName(node) {
    return node?.comfyClass || node?.type || "node";
}

function graphLink(graph, linkId) {
    if (linkId == null) return null;
    return graph?.links?.[linkId] ?? app.graph?.links?.[linkId] ?? null;
}

function inputSourceNode(node, name) {
    const input = (node?.inputs || []).find((item) => item.name === name);
    if (!input || input.link == null) return null;
    const link = graphLink(node.graph, input.link);
    if (!link) return null;
    return (
        node.graph?.getNodeById?.(link.origin_id) ||
        app.graph?.getNodeById?.(link.origin_id) ||
        null
    );
}

function outputTargetNodes(node) {
    const targets = [];
    for (const output of node?.outputs || []) {
        for (const linkId of output.links || []) {
            const link = graphLink(node.graph, linkId);
            if (!link) continue;
            const target =
                node.graph?.getNodeById?.(link.target_id) ||
                app.graph?.getNodeById?.(link.target_id);
            if (target) targets.push(target);
        }
    }
    return targets;
}

const REF2VA_NODE_TYPES = new Set([
    "MiniMaxH3ReferenceToVideo",
    "MiniMaxH3ScheduledReferenceToVideo",
    "MiniMaxH3TaggedReferenceToVideo",
    "MiniMaxH3CurrentTaggedReferenceScene",
]);
const IMAGE_TO_VIDEO_TYPES = new Set(["MiniMaxH3ImageToVideo"]);

function walkUpstreamMedia(start) {
    const queue = [start];
    const seen = new Set();
    while (queue.length) {
        const candidate = queue.shift();
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        const hit = previewFromGraphNode(candidate);
        if (hit?.url) return hit;
        for (const input of candidate.inputs || []) {
            if (input.link == null) continue;
            const link = graphLink(candidate.graph, input.link);
            const parent = link
                ? candidate.graph?.getNodeById?.(link.origin_id) ||
                  app.graph?.getNodeById?.(link.origin_id)
                : null;
            if (parent) queue.push(parent);
        }
    }
    return null;
}

async function resolveMediaFromNode(start) {
    if (!start) return null;
    const queue = [start];
    const seen = new Set();
    while (queue.length) {
        const candidate = queue.shift();
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        if (isLoadImageFromDir(candidate)) {
            const media = await resolveLoaderPreview(candidate);
            if (media?.url) return media;
        }
        const hit = previewFromGraphNode(candidate);
        if (hit?.url) return hit;
        for (const input of candidate.inputs || []) {
            if (input.link == null) continue;
            const link = graphLink(candidate.graph, input.link);
            const parent = link
                ? candidate.graph?.getNodeById?.(link.origin_id) ||
                  app.graph?.getNodeById?.(link.origin_id)
                : null;
            if (parent) queue.push(parent);
        }
    }
    return null;
}

async function resolveLoaderPreview(loaderNode) {
    const cached = previewFromGraphNode(loaderNode);
    if (cached?.url) return cached;
    const path = await resolveLoaderPath(loaderNode);
    if (!path) return null;
    return {
        url: filesystemPreviewUrl(path),
        kind: "image",
        label: basenamePath(path),
        source: loaderNode,
        path,
    };
}

async function resolvePromptFromImageMedia(pfnNode) {
    let imagePath = String(widgetByName(pfnNode, "image_path")?.value || "").trim();
    if (!imagePath) {
        const upstream = inputSourceNode(pfnNode, "image_path");
        if (upstream) {
            if (isLoadImageFromDir(upstream)) return resolveLoaderPreview(upstream);
            const walked = await resolveMediaFromNode(upstream);
            if (walked?.url) return walked;
            imagePath =
                String(widgetByName(upstream, "path")?.value || "").trim() ||
                String(upstream._mmuLastPath || "");
        }
    }
    if (imagePath && IMAGE_EXT_RE.test(imagePath)) {
        return {
            url: filesystemPreviewUrl(imagePath),
            kind: "image",
            label: basenamePath(imagePath),
            source: pfnNode,
            path: imagePath,
        };
    }
    return resolveMediaFromNode(pfnNode);
}

function isPromptFromImage(node) {
    return node?.comfyClass === PROMPT_FROM_IMAGE || node?.type === PROMPT_FROM_IMAGE;
}

function isLoadImageFromDir(node) {
    return node?.comfyClass === LOAD_IMAGE_FROM_DIR || node?.type === LOAD_IMAGE_FROM_DIR;
}

function collectUpstreamNodes(start) {
    const out = [];
    const queue = [start];
    const seen = new Set();
    while (queue.length) {
        const candidate = queue.shift();
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        if (candidate !== start) out.push(candidate);
        for (const input of candidate.inputs || []) {
            if (input.link == null) continue;
            const link = graphLink(candidate.graph, input.link);
            const parent = link
                ? candidate.graph?.getNodeById?.(link.origin_id) ||
                  app.graph?.getNodeById?.(link.origin_id)
                : null;
            if (parent) queue.push(parent);
        }
    }
    return out;
}

function findDownstreamRefConsumer(start) {
    const queue = [start];
    const seen = new Set();
    let fallback = null;
    while (queue.length) {
        const node = queue.shift();
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (node !== start) {
            const t = nodeTypeName(node);
            if (REF2VA_NODE_TYPES.has(t) || IMAGE_TO_VIDEO_TYPES.has(t)) return node;
            const hasRefImage = (node.inputs || []).some((input) =>
                /ref_image_\d+/i.test(String(input.name || "")),
            );
            if (hasRefImage && !fallback) fallback = node;
        }
        queue.push(...outputTargetNodes(node));
    }
    return fallback;
}

function refImageInputSource(refNode, pictureNum) {
    const index = pictureNum - 1;
    const preferred = [
        `ref_images.ref_image_${index}`,
        `ref_image_${index}`,
    ];
    for (const name of preferred) {
        const src = inputSourceNode(refNode, name);
        if (src) return src;
    }
    for (const input of refNode?.inputs || []) {
        const match = String(input.name || "").match(/ref_image_(\d+)$/i);
        if (!match || input.link == null) continue;
        if (Number(match[1]) !== index) continue;
        return inputSourceNode(refNode, input.name);
    }
    const t = nodeTypeName(refNode);
    if (IMAGE_TO_VIDEO_TYPES.has(t)) {
        if (pictureNum === 1) return inputSourceNode(refNode, "first_frame");
        if (pictureNum === 2) return inputSourceNode(refNode, "last_frame");
    }
    return null;
}

async function resolvePictureMedia(compilerNode, pictureNum) {
    const n = Number(pictureNum);
    if (!(n >= 1 && n <= 9)) return null;

    // 1) Real MiniMax <Picture N> images live on the downstream REF2VA node.
    const refNode = findDownstreamRefConsumer(compilerNode);
    if (refNode) {
        const source = refImageInputSource(refNode, n);
        const media = await resolveMediaFromNode(source);
        if (media?.url) return media;
    }

    // 2) PromptFromImage.picture=N or slot=picN anywhere upstream of the compiler.
    const upstream = collectUpstreamNodes(compilerNode);
    for (const node of upstream) {
        if (!isPromptFromImage(node)) continue;
        const pic = String(widgetByName(node, "picture")?.value || "").trim();
        if (pic !== String(n)) continue;
        const media = await resolvePromptFromImageMedia(node);
        if (media?.url) return media;
    }
    for (const node of upstream) {
        if (!isPromptFromImage(node)) continue;
        const slot = String(widgetByName(node, "slot")?.value || "")
            .trim()
            .toLowerCase();
        if (slot !== `pic${n}`) continue;
        const media = await resolvePromptFromImageMedia(node);
        if (media?.url) return media;
    }

    // 3) Compiler.picN text socket (and whatever image path sits behind it).
    const picUpstream = linkedNode(compilerNode, `pic${n}`);
    if (picUpstream) {
        if (isPromptFromImage(picUpstream)) {
            const media = await resolvePromptFromImageMedia(picUpstream);
            if (media?.url) return media;
        }
        const media = await resolveMediaFromNode(picUpstream);
        if (media?.url) return media;
    }

    return null;
}

function ensurePicturePopover(node) {
    ensurePopoverStyle();
    if (node._mmuPicPopover) return node._mmuPicPopover;
    const popover = document.createElement("div");
    popover.className = "mmu-pic-popover";
    popover.hidden = true;
    popover.addEventListener("mouseenter", () => {
        if (node._mmuPicPopoverTimer != null) {
            window.clearTimeout(node._mmuPicPopoverTimer);
            node._mmuPicPopoverTimer = null;
        }
    });
    popover.addEventListener("mouseleave", () => scheduleHidePicturePopover(node));
    for (const eventName of [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "click",
        "dblclick",
        "wheel",
    ]) {
        popover.addEventListener(eventName, (ev) => ev.stopPropagation());
    }
    document.body.appendChild(popover);
    node._mmuPicPopover = popover;
    return popover;
}

function hidePicturePopover(node) {
    if (node._mmuPicPopoverTimer != null) {
        window.clearTimeout(node._mmuPicPopoverTimer);
        node._mmuPicPopoverTimer = null;
    }
    const popover = node._mmuPicPopover;
    if (!popover) return;
    for (const media of popover.querySelectorAll("audio,video")) {
        try {
            media.pause?.();
        } catch (_) {}
    }
    popover.hidden = true;
}

function scheduleHidePicturePopover(node) {
    if (node._mmuPicPopoverTimer != null) window.clearTimeout(node._mmuPicPopoverTimer);
    node._mmuPicPopoverTimer = window.setTimeout(() => {
        node._mmuPicPopoverTimer = null;
        hidePicturePopover(node);
    }, 180);
}

function positionPicturePopover(popover, anchor) {
    popover.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(360, globalThis.innerWidth - 24);
    const left = Math.max(12, Math.min(globalThis.innerWidth - width - 12, rect.left));
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(
        12,
        Math.min(globalThis.innerHeight - popover.offsetHeight - 12, rect.bottom + 7),
    )}px`;
}

async function showPicturePopover(node, pictureNum, anchor) {
    if (!anchor) return;
    if (node._mmuPicPopoverTimer != null) {
        window.clearTimeout(node._mmuPicPopoverTimer);
        node._mmuPicPopoverTimer = null;
    }
    const popover = ensurePicturePopover(node);
    const title = document.createElement("div");
    title.className = "mmu-pic-popover-title";
    title.textContent = `<Picture ${pictureNum}>`;
    const detail = document.createElement("div");
    detail.className = "mmu-pic-popover-detail";
    detail.textContent = "Resolving reference…";
    popover.replaceChildren(title, detail);
    positionPicturePopover(popover, anchor);

    node._mmuPicPopoverSeq = (node._mmuPicPopoverSeq || 0) + 1;
    const token = node._mmuPicPopoverSeq;

    let media = null;
    try {
        media = await resolvePictureMedia(node, pictureNum);
    } catch (_) {
        media = null;
    }
    if (node._mmuPicPopoverSeq !== token) return;

    popover.replaceChildren();
    const title2 = document.createElement("div");
    title2.className = "mmu-pic-popover-title";
    title2.textContent = `<Picture ${pictureNum}>`;
    popover.appendChild(title2);

    if (media?.url) {
        const kind = media.kind === "video" ? "video" : "image";
        const el = document.createElement(kind === "image" ? "img" : "video");
        el.className = "mmu-pic-popover-media";
        el.src = media.url;
        if (kind === "image") {
            el.alt = `Preview for <Picture ${pictureNum}>`;
            el.addEventListener("load", () => positionPicturePopover(popover, anchor), {
                once: true,
            });
        } else {
            el.controls = true;
            el.preload = "metadata";
            el.muted = true;
        }
        popover.appendChild(el);
        const info = document.createElement("div");
        info.className = "mmu-pic-popover-detail";
        const srcName = media.label || nodeTypeName(media.source);
        info.textContent = `${kind.toUpperCase()} · ${srcName}`;
        popover.appendChild(info);
    } else {
        const muted = document.createElement("div");
        muted.className = "mmu-pic-popover-muted";
        muted.textContent =
            "No image for this Picture. Connect Load Image → MiniMax ref_image_" +
            (Number(pictureNum) - 1) +
            ", or Prompt From Image (picture=" +
            pictureNum +
            ") with a path.";
        popover.appendChild(muted);
    }
    positionPicturePopover(popover, anchor);
}

function bindPictureHoverTargets(node, root) {
    if (!root) return;
    for (const el of root.querySelectorAll("[data-mmu-picture]")) {
        if (el._mmuPicHoverBound) continue;
        el._mmuPicHoverBound = true;
        el.addEventListener("mouseenter", () => {
            const n = Number(el.getAttribute("data-mmu-picture"));
            if (n >= 1 && n <= 9) showPicturePopover(node, n, el);
        });
        el.addEventListener("mouseleave", () => scheduleHidePicturePopover(node));
    }
}

function destroyPicturePopover(node) {
    hidePicturePopover(node);
    node._mmuPicPopover?.remove?.();
    node._mmuPicPopover = null;
}

function renderColoredPrompt(skeleton, filled, emptyPlaceholder) {
    const sk = String(skeleton || "");
    const empty = emptyPlaceholder == null ? "" : String(emptyPlaceholder);
    const re = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
    let html = "";
    let last = 0;
    let m;
    while ((m = re.exec(sk)) !== null) {
        html += escapeHtml(sk.slice(last, m.index));
        const key = m[1].toLowerCase();
        let raw =
            filled[key] != null && String(filled[key]).trim() !== ""
                ? String(filled[key])
                : empty;
        if (raw && /^pic[1-9]$/.test(key)) raw = formatPicInsert(raw);
        const color = slotColor(key);
        if (!raw) {
            html += `<span style="opacity:0.3;color:${color};font-size:10px;" title="{${key}} empty">[${key}]</span>`;
        } else {
            html += `<span style="color:${color};font-weight:600;background:${color}22;border-radius:3px;padding:0 2px;" title="{${key}}">${escapeHtml(raw)}</span>`;
        }
        last = m.index + m[0].length;
    }
    html += escapeHtml(sk.slice(last));
    return colorizeMinimaxLabels(html);
}

function hideNativeSkeletonWidget(node) {
    const w = widgetByName(node, "skeleton");
    if (!w) return;
    w.computeSize = function (width) {
        return [width || node.size?.[0] || 400, 0];
    };
    w.computedHeight = 0;
    if (w.options) w.options.getMinHeight = () => 0;
    for (const el of [
        w.inputEl,
        w.element,
        ...(w.linkedWidgets || []).flatMap((lw) => [lw.inputEl, lw.element]),
    ]) {
        if (!el?.style) continue;
        el.style.display = "none";
        el.style.height = "0";
        el.style.minHeight = "0";
        el.style.maxHeight = "0";
        el.style.overflow = "hidden";
        el.style.padding = "0";
        el.style.margin = "0";
        el.style.border = "none";
    }
}

function syncSkeletonFromDom(node) {
    const ta = node._mmuSkeletonTa;
    const w = widgetByName(node, "skeleton");
    if (!ta || !w) return;
    if (String(w.value ?? "") !== ta.value) w.value = ta.value;
}

function syncSkeletonToDom(node) {
    const ta = node._mmuSkeletonTa;
    const w = widgetByName(node, "skeleton");
    if (!ta || !w) return;
    const v = String(w.value ?? "");
    if (ta.value !== v) ta.value = v;
}

function setPreviewStatus(node, text, isError = false) {
    const el = node._mmuPreviewStatus;
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "#ff6b6b" : "#8a9099";
}

function refreshColoredPreview(node) {
    const pre = node._mmuCompilerPre;
    if (!pre) return;
    syncSkeletonFromDom(node);
    // After a live Preview / workflow run, show the real compiled prompt.
    if (node._mmuLastPrompt) {
        pre.innerHTML = colorizeCompiledPrompt(
            node._mmuLastPrompt,
            node._mmuLastFilled || {},
        );
        bindPictureHoverTargets(node, pre);
        return;
    }
    const skeleton =
        node._mmuSkeletonTa?.value ??
        String(widgetByName(node, "skeleton")?.value || "");
    const empty = String(widgetByName(node, "empty_placeholder")?.value || "");
    const map = node._mmuLastFilled || {};
    pre.innerHTML = renderColoredPrompt(skeleton, map, empty);
    bindPictureHoverTargets(node, pre);
}

/** Highlight injected slot values + MiniMax <Picture>/<Subject> labels. */
function colorizeCompiledPrompt(prompt, filled) {
    let html = escapeHtml(String(prompt || ""));
    const entries = Object.entries(filled || {})
        .filter(([, v]) => String(v || "").trim())
        .sort((a, b) => String(b[1]).length - String(a[1]).length);
    for (const [key, value] of entries) {
        const color = slotColor(key);
        const injected = /^pic[1-9]$/.test(key) ? formatPicInsert(value) : String(value);
        const token = escapeHtml(injected);
        if (!token) continue;
        const lit = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        html = html.replace(
            new RegExp(lit, "g"),
            `<span style="color:${color};font-weight:600;background:${color}22;border-radius:3px;padding:0 2px;" title="{${key}}">${token}</span>`,
        );
    }
    return colorizeMinimaxLabels(html);
}

function linkedNode(node, inputName) {
    const input = (node.inputs || []).find((i) => i.name === inputName);
    if (!input || input.link == null) return null;
    const link = graphLink(node.graph, input.link);
    if (!link) return null;
    return (
        node.graph?.getNodeById?.(link.origin_id) ||
        app.graph?.getNodeById?.(link.origin_id) ||
        null
    );
}

async function resolveLoaderPath(loaderNode) {
    if (!loaderNode) return "";
    if (loaderNode._mmuLastPath) return String(loaderNode._mmuLastPath);
    const directory = String(widgetByName(loaderNode, "directory")?.value || "").trim();
    if (!directory) return "";
    const qs = new URLSearchParams({
        directory,
        pattern: String(widgetByName(loaderNode, "pattern")?.value || "*"),
        mode: String(widgetByName(loaderNode, "mode")?.value || "sequential"),
        index: String(widgetByName(loaderNode, "index")?.value ?? 0),
        seed: String(widgetByName(loaderNode, "seed")?.value ?? 0),
    });
    const res = await api.fetchApi(`/minimaxutils/resolve?${qs.toString()}`);
    if (!res.ok) return "";
    const data = await res.json();
    const path = data?.file?.path || "";
    if (path) loaderNode._mmuLastPath = path;
    return path;
}

async function resolvePromptFromImageSnippet(pfnNode) {
    let imagePath = String(widgetByName(pfnNode, "image_path")?.value || "").trim();
    if (!imagePath) {
        const pathInput = (pfnNode.inputs || []).find((i) => i.name === "image_path");
        if (pathInput?.link != null) {
            const link = app.graph?.links?.[pathInput.link];
            const upstream = link ? app.graph.getNodeById(link.origin_id) : null;
            if (upstream?.comfyClass === LOAD_IMAGE_FROM_DIR || upstream?.type === LOAD_IMAGE_FROM_DIR) {
                imagePath = await resolveLoaderPath(upstream);
            } else if (upstream) {
                imagePath =
                    String(widgetByName(upstream, "path")?.value || "").trim() ||
                    String(upstream._mmuLastPath || "");
            }
        }
    }

    const payload = {
        image_path: imagePath,
        from_file: !!widgetByName(pfnNode, "from_file")?.value,
        extract_key: String(widgetByName(pfnNode, "extract_key")?.value || "(all)"),
        picture: String(widgetByName(pfnNode, "picture")?.value || "(none)"),
        slot: String(widgetByName(pfnNode, "slot")?.value || ""),
        prompt_text: String(widgetByName(pfnNode, "prompt_text")?.value || ""),
        fallback: String(widgetByName(pfnNode, "fallback")?.value || ""),
    };
    const res = await api.fetchApi("/minimaxutils/resolve_snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return String(data?.snippet || "");
}

async function resolvePromptFromTextSnippet(pftNode) {
    const payload = {
        image_path: "",
        from_file: false,
        extract_key: String(widgetByName(pftNode, "extract_key")?.value || "(all)"),
        picture: String(widgetByName(pftNode, "picture")?.value || "(none)"),
        slot: String(widgetByName(pftNode, "slot")?.value || ""),
        prompt_text: String(widgetByName(pftNode, "prompt_text")?.value || ""),
        fallback: String(widgetByName(pftNode, "fallback")?.value || ""),
    };
    const res = await api.fetchApi("/minimaxutils/resolve_snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return String(data?.snippet || "");
}

async function collectSlotPayload(node) {
    const out = { bundle: "" };
    for (const name of SLOT_NAMES) out[name] = "";
    for (const name of SLOT_INPUTS) {
        const upstream = linkedNode(node, name);
        if (!upstream) continue;
        if (
            upstream.comfyClass === PROMPT_FROM_IMAGE ||
            upstream.type === PROMPT_FROM_IMAGE
        ) {
            out[name] = await resolvePromptFromImageSnippet(upstream);
            continue;
        }
        if (
            upstream.comfyClass === PROMPT_FROM_TEXT ||
            upstream.type === PROMPT_FROM_TEXT
        ) {
            out[name] = await resolvePromptFromTextSnippet(upstream);
            continue;
        }
        // Generic STRING source — last known widget/text if any.
        const textW = widgetByName(upstream, "text") || widgetByName(upstream, "string");
        if (textW?.value) out[name] = String(textW.value);
    }
    return out;
}

async function runLivePreview(node) {
    if (node._mmuPreviewBusy) return;
    node._mmuPreviewBusy = true;
    const btn = node._mmuPreviewBtn;
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Preview…";
    }
    setPreviewStatus(node, "Resolving sidecars…");
    try {
        syncSkeletonFromDom(node);
        const slots = await collectSlotPayload(node);
        const skeleton =
            node._mmuSkeletonTa?.value ??
            String(widgetByName(node, "skeleton")?.value || "");
        const empty = String(widgetByName(node, "empty_placeholder")?.value || "");
        setPreviewStatus(node, "Compiling…");
        const res = await api.fetchApi("/minimaxutils/compile_preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                skeleton,
                empty_placeholder: empty,
                ...slots,
            }),
        });
        if (!res.ok) throw new Error(`compile_preview HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || "compile failed");
        node._mmuLastFilled = data.filled || {};
        node._mmuLastPrompt = data.prompt || "";
        refreshColoredPreview(node);
        const n = Object.keys(node._mmuLastFilled).length;
        setPreviewStatus(
            node,
            n
                ? `Preview OK — ${n} slot(s). Full prompt is in the black window above.`
                : "Preview OK — no slots filled (check links / sidecars).",
        );
        if (node._mmuCompilerWrap) node._mmuCompilerWrap.scrollTop = 0;
        app.graph?.setDirtyCanvas?.(true, true);
    } catch (err) {
        setPreviewStatus(node, `Preview failed: ${err}`, true);
    } finally {
        node._mmuPreviewBusy = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = "Preview";
        }
    }
}

function currentTemplateName(node) {
    node.properties ??= {};
    return String(node.properties[TEMPLATE_PROP] || "basic");
}

function setTemplateName(node, name) {
    node.properties ??= {};
    node.properties[TEMPLATE_PROP] = name;
    if (node._mmuTemplateSelect) node._mmuTemplateSelect.value = name;
}

async function fetchTemplateList() {
    const res = await api.fetchApi("/minimaxutils/templates");
    if (!res.ok) throw new Error(`templates HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || "list failed");
    return data.templates || [];
}

async function fetchTemplate(name) {
    const res = await api.fetchApi(`/minimaxutils/templates/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`load HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok || !data.template) throw new Error(data?.error || "load failed");
    return data.template;
}

function fillTemplateSelect(node, templates, selected) {
    const sel = node._mmuTemplateSelect;
    if (!sel) return;
    const names = (templates || []).map((t) => t.name);
    sel.innerHTML = "";
    for (const t of templates || []) {
        const opt = document.createElement("option");
        opt.value = t.name;
        const src = t.source && t.source !== "pack" ? ` [${t.source}]` : "";
        opt.textContent = `${t.label || t.name}${src}`;
        sel.appendChild(opt);
    }
    const pick = names.includes(selected) ? selected : names[0] || "basic";
    sel.value = pick;
    setTemplateName(node, pick);
}

async function refreshTemplateList(node, { reloadBody = false } = {}) {
    try {
        const templates = await fetchTemplateList();
        const selected = currentTemplateName(node);
        fillTemplateSelect(node, templates, selected);
        if (reloadBody) await loadSelectedTemplate(node, { confirmDirty: false });
        setPreviewStatus(node, `Templates: ${templates.length}`);
    } catch (err) {
        setPreviewStatus(node, `Template list failed: ${err}`, true);
    }
}

async function loadSelectedTemplate(node, { confirmDirty = true } = {}) {
    const name = node._mmuTemplateSelect?.value || currentTemplateName(node);
    const ta = node._mmuSkeletonTa;
    if (!ta) return;
    if (confirmDirty && node._mmuSkeletonDirty) {
        const ok = window.confirm(
            `Discard unsaved skeleton edits and load template "${name}"?`,
        );
        if (!ok) {
            if (node._mmuTemplateSelect) node._mmuTemplateSelect.value = currentTemplateName(node);
            return;
        }
    }
    try {
        const tmpl = await fetchTemplate(name);
        ta.value = tmpl.skeleton || "";
        syncSkeletonFromDom(node);
        node._mmuLastPrompt = "";
        node._mmuSkeletonDirty = false;
        node._mmuTemplateSlots = tmpl.slots || discoverSlots(tmpl.skeleton);
        setTemplateName(node, name);
        refreshSlotLegend(node);
        refreshColoredPreview(node);
        setPreviewStatus(
            node,
            `Loaded template: ${name}${tmpl.source && tmpl.source !== "pack" ? ` [${tmpl.source}]` : ""} (${(node._mmuTemplateSlots || []).length} slots)`,
        );
        app.graph?.setDirtyCanvas?.(true, true);
    } catch (err) {
        setPreviewStatus(node, `Load failed: ${err}`, true);
    }
}

async function saveSelectedTemplate(node) {
    const name = node._mmuTemplateSelect?.value || currentTemplateName(node);
    syncSkeletonFromDom(node);
    const skeleton = node._mmuSkeletonTa?.value ?? "";
    const slots = discoverSlots(skeleton);
    try {
        const res = await api.fetchApi(`/minimaxutils/templates/${encodeURIComponent(name)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ skeleton, label: name, slots }),
        });
        if (!res.ok) throw new Error(`save HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || "save failed");
        node._mmuSkeletonDirty = false;
        node._mmuTemplateSlots = data.template?.slots || slots;
        setTemplateName(node, name);
        refreshSlotLegend(node);
        setPreviewStatus(
            node,
            `Saved template: ${name}${data.template?.source ? ` → ${data.template.source}` : ""}`,
        );
    } catch (err) {
        setPreviewStatus(node, `Save failed: ${err}`, true);
    }
}

function refreshSlotLegend(node) {
    const legend = node._mmuSlotLegend;
    if (!legend) return;
    const skeleton =
        node._mmuSkeletonTa?.value ??
        String(widgetByName(node, "skeleton")?.value || "");
    const slots =
        (node._mmuTemplateSlots && node._mmuTemplateSlots.length
            ? node._mmuTemplateSlots
            : null) || discoverSlots(skeleton);
    legend.innerHTML = "";
    const show = slots.length ? slots : BEHAVIOR_SLOTS;
    for (const name of show) {
        const chip = document.createElement("span");
        const color = slotColor(name);
        chip.textContent = name;
        chip.title = `{${name}}`;
        chip.style.cssText = `color:${color};border:1px solid ${color}66;border-radius:999px;padding:1px 7px;`;
        const picMatch = /^pic([1-9])$/.exec(name);
        if (picMatch) {
            chip.dataset.mmuPicture = picMatch[1];
            chip.style.cursor = "pointer";
            chip.title = `{${name}} — hover for <Picture ${picMatch[1]}> preview`;
        }
        legend.appendChild(chip);
    }
    bindPictureHoverTargets(node, legend);
}

function makeToolButton(label, title) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.title = title;
    btn.style.cssText = [
        "cursor:pointer",
        "border:1px solid #3d5a45",
        "background:#1a2a1e",
        "color:#3dff6a",
        "border-radius:6px",
        "padding:4px 10px",
        "font:12px Consolas,monospace",
    ].join(";");
    return btn;
}

function ensurePanel(node) {
    if (node._mmuCompilerPreview) {
        moveWidgetToTop(node, node._mmuCompilerPreview);
        hideNativeSkeletonWidget(node);
        syncSkeletonToDom(node);
        refreshColoredPreview(node);
        return node._mmuCompilerPreview;
    }

    const root = document.createElement("div");
    root.className = "mmu-compiler-panel";
    root.style.cssText = [
        "display:flex",
        "flex-direction:column",
        "gap:8px",
        "width:100%",
        "max-width:100%",
        "box-sizing:border-box",
        "pointer-events:auto",
        `height:${PANEL_H}px`,
        `min-height:${PANEL_H}px`,
        `max-height:${PANEL_H}px`,
    ].join(";");
    trapGraphEvents(root);

    const templateRow = document.createElement("div");
    templateRow.style.cssText =
        "display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:0 0 auto;";

    const tmplLabel = document.createElement("span");
    tmplLabel.textContent = "template";
    tmplLabel.style.cssText = "font:11px Consolas,monospace;color:#9aa0a6;";
    templateRow.appendChild(tmplLabel);

    const sel = document.createElement("select");
    sel.style.cssText = [
        "min-width:140px",
        "max-width:220px",
        "background:#12151a",
        "color:#e8e8e8",
        "border:1px solid #2a2a32",
        "border-radius:6px",
        "padding:4px 8px",
        "font:12px Consolas,monospace",
    ].join(";");
    sel.addEventListener("change", () => {
        loadSelectedTemplate(node, { confirmDirty: true });
    });
    templateRow.appendChild(sel);
    node._mmuTemplateSelect = sel;

    const saveBtn = makeToolButton("Save", "Save current skeleton into the selected template file");
    saveBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        saveSelectedTemplate(node);
    });
    templateRow.appendChild(saveBtn);

    const refreshBtn = makeToolButton("Refresh", "Reload template list from prompt_templates/");
    refreshBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        refreshTemplateList(node, { reloadBody: false });
    });
    templateRow.appendChild(refreshBtn);
    root.appendChild(templateRow);

    const toolbar = document.createElement("div");
    toolbar.style.cssText =
        "display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:0 0 auto;";

    const legend = document.createElement("div");
    legend.style.cssText =
        "display:flex;flex-wrap:wrap;gap:8px;font:11px Consolas,monospace;";
    node._mmuSlotLegend = legend;
    toolbar.appendChild(legend);

    const btn = makeToolButton("Preview", "Compile prompt from skeleton + linked sidecars (no workflow run)");
    btn.style.marginLeft = "auto";
    btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        runLivePreview(node);
    });
    toolbar.appendChild(btn);
    node._mmuPreviewBtn = btn;

    const status = document.createElement("div");
    status.style.cssText =
        "flex:1 0 100%;font:11px Consolas,monospace;color:#8a9099;min-height:14px;";
    status.textContent = "Preview compiles without running the workflow.";
    toolbar.appendChild(status);
    node._mmuPreviewStatus = status;
    root.appendChild(toolbar);

    const preview = document.createElement("div");
    preview.className = "mmu-compiler-preview";
    preview.style.cssText = [
        "flex:0 0 auto",
        `height:${PREVIEW_H}px`,
        `min-height:${PREVIEW_H}px`,
        `max-height:${PREVIEW_H}px`,
        "overflow-x:hidden",
        "overflow-y:scroll",
        "overscroll-behavior:contain",
        "background:#0a0a0c",
        "border:1px solid #2a2a32",
        "border-radius:6px",
        "padding:10px 12px",
        "box-sizing:border-box",
        "pointer-events:auto",
    ].join(";");
    trapGraphEvents(preview);

    const pre = document.createElement("pre");
    pre.style.cssText = [
        "margin:0",
        "padding:0",
        "font-family:Consolas,'Courier New',monospace",
        "font-size:12px",
        "line-height:1.45",
        "color:#c8c8c8",
        "white-space:pre-wrap",
        "word-break:break-word",
        "background:transparent",
        "border:none",
    ].join(";");
    pre.innerHTML =
        "<span style='color:#666'>(click Preview — no workflow / no video generation)</span>";
    preview.appendChild(pre);
    root.appendChild(preview);

    const skLabel = document.createElement("div");
    skLabel.textContent = "skeleton";
    skLabel.style.cssText =
        "flex:0 0 auto;font:11px Consolas,monospace;color:#9aa0a6;padding-left:2px;";
    root.appendChild(skLabel);

    const ta = document.createElement("textarea");
    ta.className = "mmu-compiler-skeleton";
    ta.spellcheck = false;
    ta.style.cssText = [
        "flex:0 0 auto",
        `height:${SKELETON_H}px`,
        `min-height:${SKELETON_H}px`,
        `max-height:${SKELETON_H}px`,
        "width:100%",
        "box-sizing:border-box",
        "resize:none",
        "overflow-x:hidden",
        "overflow-y:scroll",
        "overscroll-behavior:contain",
        "background:#12151a",
        "color:#e8e8e8",
        "border:1px solid #2a2a32",
        "border-radius:6px",
        "padding:10px 12px",
        "font:12px/1.45 Consolas,'Courier New',monospace",
        "white-space:pre-wrap",
        "pointer-events:auto",
    ].join(";");
    trapGraphEvents(ta);
    ta.addEventListener("input", () => {
        syncSkeletonFromDom(node);
        node._mmuSkeletonDirty = true;
        node._mmuLastPrompt = "";
        node._mmuTemplateSlots = discoverSlots(ta.value);
        refreshSlotLegend(node);
        refreshColoredPreview(node);
        app.graph?.setDirtyCanvas?.(true, true);
    });
    root.appendChild(ta);

    const widget = node.addDOMWidget("compiler_panel", "div", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => PANEL_H,
    });
    widget.serialize = false;
    widget.computeSize = function (width) {
        return [width || NODE_MIN_W, PANEL_H];
    };
    widget.computedHeight = PANEL_H;

    node._mmuCompilerRoot = root;
    node._mmuCompilerWrap = preview;
    node._mmuCompilerPre = pre;
    node._mmuSkeletonTa = ta;
    node._mmuCompilerPreview = widget;
    node._mmuSkeletonDirty = false;

    moveWidgetToTop(node, widget);
    hideNativeSkeletonWidget(node);
    syncSkeletonToDom(node);
    node._mmuTemplateSlots = discoverSlots(
        node._mmuSkeletonTa?.value ?? String(widgetByName(node, "skeleton")?.value || ""),
    );
    refreshSlotLegend(node);
    refreshColoredPreview(node);
    clampNodeSize(node);

    requestAnimationFrame(() => {
        moveWidgetToTop(node, widget);
        hideNativeSkeletonWidget(node);
        syncSkeletonToDom(node);
        refreshSlotLegend(node);
        refreshColoredPreview(node);
        clampNodeSize(node);
        refreshTemplateList(node, { reloadBody: false });
        app.graph?.setDirtyCanvas?.(true, true);
    });

    return widget;
}

function hookEmptyPlaceholder(node) {
    const emptyW = widgetByName(node, "empty_placeholder");
    if (!emptyW || emptyW._mmuCompilerHooked) return;
    emptyW._mmuCompilerHooked = true;
    const prev = emptyW.callback;
    emptyW.callback = function (...args) {
        const result = prev?.apply(this, args);
        refreshColoredPreview(node);
        return result;
    };
}

function attachCompilerUi(node) {
    if (node._mmuCompilerUiAttached) return;
    node._mmuCompilerUiAttached = true;
    ensurePanel(node);
    hookEmptyPlaceholder(node);
    clampNodeSize(node);
    node._mmuSlotColors = SLOT_COLORS;

    const prevResize = node.onResize;
    node.onResize = function (size) {
        const r = prevResize?.apply(this, arguments);
        if (size?.[1] > NODE_MAX_H) {
            size[1] = NODE_MAX_H;
            if (this.size) this.size[1] = NODE_MAX_H;
        }
        hideNativeSkeletonWidget(this);
        return r;
    };
}

app.registerExtension({
    name: "Comfyui-MinimaxUtils.MinimaxPromptCompiler",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated?.apply(this, arguments);
            attachCompilerUi(this);
            return r;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const r = onConfigure?.apply(this, arguments);
            requestAnimationFrame(() => {
                ensurePanel(this);
                hideNativeSkeletonWidget(this);
                syncSkeletonToDom(this);
                refreshColoredPreview(this);
                clampNodeSize(this);
                refreshTemplateList(this, { reloadBody: false });
            });
            return r;
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            this._mmuLastFilled = parseFilled(message?.filled_json?.[0] || "");
            this._mmuLastPrompt = message?.prompt?.[0] || this._mmuLastPrompt || "";
            ensurePanel(this);
            syncSkeletonFromDom(this);
            refreshColoredPreview(this);
            setPreviewStatus(this, "Updated from last workflow run");
        };

        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            onDrawForeground?.apply(this, arguments);
            hideNativeSkeletonWidget(this);
            if (!this.inputs || !this._mmuSlotColors) return;
            for (const input of this.inputs) {
                const color = this._mmuSlotColors[input.name];
                if (!color || input.link == null) continue;
                const pos = this.getConnectionPos(true, this.inputs.indexOf(input));
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(pos[0] - this.pos[0], pos[1] - this.pos[1], 4, 0, Math.PI * 2);
                ctx.fill();
            }
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            destroyPicturePopover(this);
            return onRemoved?.apply(this, arguments);
        };
    },

    nodeCreated(node) {
        if (node?.comfyClass === NODE_NAME || node?.type === NODE_NAME) {
            attachCompilerUi(node);
        }
    },
});

console.log("[MinimaxUtils] MinimaxPromptCompiler UI extension loaded");
