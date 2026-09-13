/** MinimaxDirector (sketch) — refs + timed beats, directory load, one prompt out. */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "MinimaxPromptDirector";
const MAX_REFS = 9;
const PREVIEW_DOCK_H = 360;
const SCROLL_H = 1480; // ~2× previous upper pane (~740)
const PANEL_H = SCROLL_H + PREVIEW_DOCK_H;
const BAD_PATTERNS = new Set(["fixed", "increment", "decrement", "randomize"]);

function widgetByName(node, name) {
    return (node.widgets || []).find((w) => w.name === name);
}

function defaultRef() {
    return {
        directory: "",
        file: "",
        mode: "sequential",
        index: 0,
        seed: 0,
        pattern: "*",
        description: "",
    };
}

function defaultBeat() {
    return {
        text: "",
        duration: 3.0,
        from_disk: false,
        text_unlocked: false,
        template: "",
        directory: "",
        mode: "sequential",
        index: 0,
        seed: 0,
        pattern: "*.txt",
    };
}

function fillBeatSkeleton(skeleton, defaults = {}, overrides = {}) {
    const values = { ...(defaults || {}), ...(overrides || {}) };
    let text = String(skeleton || "").replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, key) => {
        const v = values[String(key).toLowerCase()];
        return v != null ? String(v) : "";
    });
    text = text.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
    return text;
}

async function fetchBeatTemplateList() {
    const res = await api.fetchApi("/minimaxutils/beat_templates");
    if (!res.ok) throw new Error(`beat_templates HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || "list failed");
    return data.templates || [];
}

async function fetchBeatTemplate(name) {
    const res = await api.fetchApi(`/minimaxutils/beat_templates/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`beat template HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok || !data.template) throw new Error(data?.error || "load failed");
    return data.template;
}

async function ensureBeatTemplateCatalog(node) {
    if (Array.isArray(node._mmuBeatTemplates) && node._mmuBeatTemplates.length) {
        return node._mmuBeatTemplates;
    }
    try {
        node._mmuBeatTemplates = await fetchBeatTemplateList();
    } catch (_) {
        node._mmuBeatTemplates = [];
    }
    return node._mmuBeatTemplates;
}

function defaultState() {
    return {
        globals: {
            style: "Cinematic, live-action, high-quality film aesthetic.",
            soundscape: "Quiet ambient sound matching the scene.",
            music: "N/A",
        },
        refs: [defaultRef(), defaultRef(), defaultRef()],
        beats: [defaultBeat()],
    };
}

function normalizePattern(value, fallback = "*.txt") {
    const p = String(value ?? "").trim() || fallback;
    if (BAD_PATTERNS.has(p.toLowerCase())) return fallback;
    return p;
}

function readState(node) {
    const w = widgetByName(node, "director_state");
    if (!w) return defaultState();
    try {
        const data = JSON.parse(String(w.value || ""));
        if (!data || typeof data !== "object") return defaultState();
        const base = defaultState();
        if (data.globals && typeof data.globals === "object") {
            Object.assign(base.globals, data.globals);
        }
        if (Array.isArray(data.refs) && data.refs.length) {
            base.refs = data.refs.slice(0, MAX_REFS).map((r) => ({
                ...defaultRef(),
                ...(r || {}),
                pattern: normalizePattern(r?.pattern, "*"),
            }));
        }
        if (Array.isArray(data.beats) && data.beats.length) {
            base.beats = data.beats.map((b) => ({
                ...defaultBeat(),
                ...(b || {}),
                pattern: normalizePattern(b?.pattern, "*.txt"),
                duration: Math.max(0.1, Number(b?.duration) || 3),
                from_disk: !!b?.from_disk,
            }));
        }
        return base;
    } catch (_) {
        return defaultState();
    }
}

function writeState(node, state, { refresh = true } = {}) {
    const w = widgetByName(node, "director_state");
    if (!w) return;
    const json = JSON.stringify(state);
    if (String(w.value ?? "") === json) {
        if (refresh) schedulePreview(node);
        return;
    }
    w.value = json;
    // Nodes 2.0 / Vue widgets sometimes ignore plain .value writes.
    for (const elmt of [w.inputEl, w.element, w.domWidget?.element]) {
        if (elmt && "value" in elmt && String(elmt.value) !== json) elmt.value = json;
    }
    try {
        w.callback?.(json);
    } catch (_) {
        /* ignore */
    }
    if (refresh) schedulePreview(node);
    app.graph?.setDirtyCanvas?.(true, true);
}

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k === "className") node.className = v;
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    for (const c of children) {
        if (c == null) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
}

function fieldLabel(text) {
    return el("div", {
        style: {
            font: "10px Consolas,monospace",
            color: "#9aa0a6",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            marginBottom: "3px",
        },
    }, [text]);
}

function textInput(value, onInput, opts = {}) {
    const input = el(opts.multiline ? "textarea" : "input", {
        style: {
            width: "100%",
            boxSizing: "border-box",
            background: "#12151a",
            color: "#e8e8e8",
            border: "1px solid #2a2a32",
            borderRadius: "6px",
            padding: "6px 8px",
            font: "12px/1.4 Consolas,monospace",
            resize: opts.multiline ? "vertical" : "none",
            minHeight: opts.multiline ? `${opts.minHeight || 56}px` : undefined,
        },
    });
    if (!opts.multiline) input.type = "text";
    input.value = value ?? "";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.addEventListener("input", () => onInput(input.value));
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => e.stopPropagation());
    return input;
}

function numInput(value, onInput, step = 0.1) {
    const input = el("input", {
        type: "number",
        step: String(step),
        style: {
            width: "72px",
            background: "#12151a",
            color: "#e8e8e8",
            border: "1px solid #2a2a32",
            borderRadius: "6px",
            padding: "4px 6px",
            font: "12px Consolas,monospace",
        },
    });
    input.value = String(value);
    input.addEventListener("input", () => onInput(Number(input.value)));
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    return input;
}

function selectInput(value, options, onChange) {
    const sel = el("select", {
        style: {
            background: "#12151a",
            color: "#e8e8e8",
            border: "1px solid #2a2a32",
            borderRadius: "6px",
            padding: "4px 6px",
            font: "12px Consolas,monospace",
        },
    });
    for (const opt of options) {
        const o = el("option", { value: opt }, [opt]);
        if (opt === value) o.selected = true;
        sel.appendChild(o);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    sel.addEventListener("pointerdown", (e) => e.stopPropagation());
    return sel;
}

function btn(label, onClick, primary = false) {
    const b = el("button", {
        type: "button",
        style: {
            cursor: "pointer",
            border: `1px solid ${primary ? "#3d5a45" : "#3a3a45"}`,
            background: primary ? "#1a2a1e" : "#1a1a22",
            color: primary ? "#3dff6a" : "#c8c8c8",
            borderRadius: "6px",
            padding: "4px 10px",
            font: "12px Consolas,monospace",
            pointerEvents: "auto",
        },
    }, [label]);
    // Stop LiteGraph/canvas from eating the gesture before click fires.
    for (const name of ["pointerdown", "mousedown", "mouseup", "pointerup"]) {
        b.addEventListener(name, (ev) => ev.stopPropagation());
    }
    b.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        onClick(ev);
    });
    return b;
}

function trapGraphEvents(root) {
    if (!root || root._mmuTrapped) return;
    root._mmuTrapped = true;
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
        root.addEventListener(name, (ev) => ev.stopPropagation());
    }
    root.addEventListener("wheel", (ev) => ev.stopPropagation(), { passive: true });
}

async function resolveImage(ref) {
    const file = String(ref.file || "").trim().replace(/^["']|["']$/g, "");
    const q = new URLSearchParams({
        mode: ref.mode || "sequential",
        index: String(ref.index || 0),
        seed: String(ref.seed || 0),
        pattern: "*",
    });
    if (file) q.set("file", file);
    else {
        q.set(
            "directory",
            String(ref.directory || "").trim().replace(/^["']|["']$/g, ""),
        );
    }
    const res = await api.fetchApi(`/minimaxutils/resolve?${q}`);
    if (!res.ok) return null;
    return res.json();
}

async function classifyPath(path) {
    const raw = String(path || "").trim().replace(/^["']|["']$/g, "");
    if (!raw) return { type: "empty", path: "" };
    const q = new URLSearchParams({ path: raw });
    const res = await api.fetchApi(`/minimaxutils/pathinfo?${q}`);
    if (!res.ok) return { type: "missing", path: raw };
    return res.json();
}

async function pickImageFile() {
    const res = await api.fetchApi("/minimaxutils/pick_image", { method: "POST" });
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const data = await res.json();
            if (data?.error) msg = data.error;
        } catch (_) {
            /* ignore */
        }
        throw new Error(msg);
    }
    return res.json();
}

async function fetchSidecar(imagePath) {
    const path = String(imagePath || "").trim();
    if (!path) return null;
    const q = new URLSearchParams({ path, extract_key: "(all)" });
    const res = await api.fetchApi(`/minimaxutils/sidecar?${q}`);
    if (!res.ok) return null;
    try {
        return await res.json();
    } catch (_) {
        return null;
    }
}

function insertAtCursor(ta, text) {
    if (!ta) return;
    const wasReadOnly = ta.readOnly;
    if (wasReadOnly) ta.readOnly = false;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const padL = before.length && !/\s$/.test(before) ? " " : "";
    const padR = after.length && !/^\s/.test(after) ? " " : "";
    const insert = `${padL}${text}${padR}`;
    ta.value = before + insert + after;
    const caret = (before + insert).length;
    ta.focus();
    try {
        ta.setSelectionRange(caret, caret);
    } catch (_) {
        /* ignore */
    }
    if (wasReadOnly) ta.readOnly = true;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
}

function mentionedPictures(text) {
    const found = new Set();
    const re = /<Picture\s+(\d)\s*>/gi;
    let m;
    while ((m = re.exec(String(text || ""))) !== null) {
        const n = Number(m[1]);
        if (n >= 1 && n <= MAX_REFS) found.add(n);
    }
    return [...found].sort((a, b) => a - b);
}

function removePictureFromText(text, pictureNum) {
    const n = Number(pictureNum);
    if (!(n >= 1 && n <= MAX_REFS)) return String(text || "");
    return String(text || "")
        .replace(new RegExp(`\\s*<Picture\\s+${n}\\s*>`, "gi"), "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function colorizeBeatTextHtml(text) {
    const raw = String(text || "");
    if (!raw) return "";
    let html = escapeHtml(raw);
    html = html.replace(/&lt;Picture (\d)&gt;/gi, (full, n) => {
        const color = PIC_COLORS[Number(n)] || "#c0c0c0";
        return `<span style="color:${color};font-weight:700;background:${color}22;border-radius:3px;padding:0 1px;">${full}</span>`;
    });
    return html;
}

/** Transparent textarea over colored backdrop so <Picture N> tags match chip colors. */
function ensureBeatEditorStyle() {
    if (document.getElementById("mmu-beat-editor-style")) return;
    const style = document.createElement("style");
    style.id = "mmu-beat-editor-style";
    style.textContent = `
      textarea.mmu-beat-ta::placeholder { color:#6a7078; opacity:1; }
      textarea.mmu-beat-ta { caret-color:#f0f0f0; }
    `;
    document.head.appendChild(style);
}

function makeColoredBeatEditor(initial, onChange, opts = {}) {
    ensureBeatEditorStyle();
    const minH = opts.minHeight || 100;
    const font = "12px/1.4 Consolas,monospace";
    const pad = "6px 8px";

    const wrap = el("div", {
        style: {
            position: "relative",
            width: "100%",
            boxSizing: "border-box",
        },
    });

    const backdrop = el("div", {
        style: {
            position: "absolute",
            left: "0",
            top: "0",
            right: "0",
            bottom: "0",
            boxSizing: "border-box",
            padding: pad,
            font,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflow: "hidden",
            color: "#e8e8e8",
            background: "#12151a",
            border: "1px solid #2a2a32",
            borderRadius: "6px",
            pointerEvents: "none",
        },
    });

    const ta = el("textarea", {
        className: "mmu-beat-ta",
        style: {
            position: "relative",
            zIndex: "1",
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            minHeight: `${minH}px`,
            padding: pad,
            font,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "transparent",
            caretColor: "#f0f0f0",
            background: "transparent",
            border: "1px solid #2a2a32",
            borderRadius: "6px",
            resize: "vertical",
            overflow: "auto",
        },
    });
    ta.value = initial ?? "";
    if (opts.placeholder) ta.placeholder = opts.placeholder;
    ta.spellcheck = false;

    const sync = () => {
        backdrop.innerHTML = colorizeBeatTextHtml(ta.value) || " ";
        backdrop.scrollTop = ta.scrollTop;
        backdrop.scrollLeft = ta.scrollLeft;
    };
    ta.addEventListener("input", () => {
        sync();
        onChange?.(ta.value);
    });
    ta.addEventListener("scroll", () => {
        backdrop.scrollTop = ta.scrollTop;
        backdrop.scrollLeft = ta.scrollLeft;
    });
    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    ta.addEventListener("keydown", (e) => e.stopPropagation());

    wrap.appendChild(backdrop);
    wrap.appendChild(ta);
    ta._mmuColorSync = sync;
    sync();
    return { wrap, ta, sync };
}

async function resolvePrompt(beat) {
    const q = new URLSearchParams({
        directory: beat.directory || "",
        pattern: "*.txt",
        mode: beat.mode || "sequential",
        index: String(beat.index || 0),
        seed: String(beat.seed || 0),
    });
    const res = await api.fetchApi(`/minimaxutils/resolveprompt?${q}`);
    if (!res.ok) return null;
    return res.json();
}

function diskControls(obj, keys, onPatch) {
    const patternFixed = normalizePattern(keys.patternFallback, keys.patternFallback || "*");
    // Pattern is fixed for now (all images / all prompts); not shown in UI.
    obj.pattern = patternFixed;
    const allowFile = !!keys.allowFile;
    const isFile = allowFile && String(obj.file || "").trim();

    const wrap = el("div", { style: { marginTop: "6px" } });

    const pathValue = isFile ? obj.file : obj.directory || "";
    const pathInput = textInput(pathValue || "", async (v) => {
        const raw = String(v || "").trim().replace(/^["']|["']$/g, "");
        if (!allowFile) {
            onPatch({ directory: raw, pattern: patternFixed });
            return;
        }
        if (!raw) {
            onPatch({ directory: "", file: "", pattern: patternFixed });
            return;
        }
        const info = await classifyPath(raw);
        if (info?.type === "file") {
            onPatch({
                file: info.path,
                directory: info.directory || "",
                pattern: patternFixed,
                description_manual: false,
            });
        } else if (info?.type === "dir") {
            onPatch({
                file: "",
                directory: info.path,
                pattern: patternFixed,
                description_manual: false,
            });
        } else {
            onPatch({ file: "", directory: raw, pattern: patternFixed });
        }
    }, {
        placeholder: allowFile
            ? "folder or image file path"
            : "paste folder path — e.g. E:\\Images\\refs",
    });
    pathInput.style.fontSize = "11px";
    pathInput.style.padding = "5px 6px";
    pathInput.style.marginBottom = "4px";
    pathInput.style.width = "100%";
    pathInput.title = pathValue || "";
    wrap.appendChild(pathInput);

    const folderRow = el("div", {
        style: {
            display: isFile ? "none" : "grid",
            gridTemplateColumns: "1fr auto 72px",
            gap: "6px",
            alignItems: "center",
        },
    });

    const modeSel = selectInput(obj.mode || "sequential", ["sequential", "random", "custom"], (v) =>
        onPatch({ mode: v, pattern: patternFixed }),
    );
    const seedLab = fieldLabel("seed");
    seedLab.style.margin = "0";
    const seedInp = numInput(obj.seed || 0, (v) => onPatch({ seed: Math.max(0, v | 0), pattern: patternFixed }), 1);

    folderRow.appendChild(modeSel);
    folderRow.appendChild(seedLab);
    folderRow.appendChild(seedInp);
    wrap.appendChild(folderRow);

    wrap._mmuSync = (next) => {
        const nextFile = String(next.file || "").trim();
        const show = nextFile || next.directory || "";
        pathInput.value = show;
        pathInput.title = show;
        if (next.mode != null) modeSel.value = next.mode;
        if (next.seed != null) seedInp.value = String(next.seed);
        folderRow.style.display = nextFile ? "none" : "grid";
    };
    return wrap;
}

function renderRefCard(node, state, idx, container) {
    const ref = state.refs[idx];
    const card = el("div", {
        style: {
            background: "#14181f",
            border: "1px solid #2a2a32",
            borderRadius: "8px",
            padding: "8px",
            minWidth: "200px",
            flex: "1 1 200px",
        },
    });
    card.appendChild(fieldLabel(`Picture ${idx + 1}`));

    const img = el("img", {
        style: {
            width: "100%",
            height: "110px",
            objectFit: "contain",
            background: "#0a0a0c",
            borderRadius: "6px",
            display: "block",
            marginBottom: "4px",
            pointerEvents: "auto",
            cursor: "default",
        },
    });
    img.alt = "";
    card.appendChild(img);

    const status = el("div", {
        style: {
            font: "11px Consolas,monospace",
            color: "#8a9099",
            marginBottom: "6px",
            minHeight: "14px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            cursor: "help",
        },
    }, ["…"]);
    card.appendChild(status);

    let controls = null;
    const patch = (partial) => {
        const cur = readState(node);
        if (!cur.refs[idx]) return;
        Object.assign(cur.refs[idx], partial);
        if (partial.directory != null) {
            cur.refs[idx].directory = String(partial.directory || "")
                .trim()
                .replace(/^["']|["']$/g, "");
        }
        if (partial.file != null) {
            cur.refs[idx].file = String(partial.file || "")
                .trim()
                .replace(/^["']|["']$/g, "");
        }
        cur.refs[idx].index = Math.max(0, Number(cur.refs[idx].index) || 0);
        cur.refs[idx].seed = Math.max(0, Number(cur.refs[idx].seed) || 0);
        cur.refs[idx].pattern = "*";
        if (
            partial.description_manual == null &&
            (partial.directory != null ||
                partial.file != null ||
                partial.index != null ||
                partial.seed != null ||
                partial.mode != null)
        ) {
            cur.refs[idx].description_manual = false;
        }
        writeState(node, cur);
        controls?._mmuSync?.(cur.refs[idx]);
        refreshRefPreview(node, idx, img, status, card);
        syncRefNav(cur.refs[idx]);
    };

    controls = diskControls(ref, { patternFallback: "*", allowFile: true }, patch);
    card.appendChild(controls);
    card.appendChild(fieldLabel("describes"));
    const descInput = textInput(ref.description || "", (v) => {
        patch({ description: v, description_manual: true });
    }, {
        placeholder: "auto from sidecar .txt, or type identity lock",
    });
    card.appendChild(descInput);
    card._mmuDescInput = descInput;

    const bump = (dir) => {
        const cur = readState(node);
        const r = cur.refs[idx];
        if (!r || String(r.file || "").trim()) return;
        const count = Math.max(1, Number(img._mmuCount || card._mmuCount || 1));
        if ((r.mode || "sequential") === "random") {
            const seed = Math.max(0, (Number(r.seed) || 0) + dir);
            patch({ seed, description_manual: false });
        } else {
            const index = (((Number(r.index) || 0) + dir) % count + count) % count;
            patch({ index, description_manual: false });
        }
    };

    const nav = el("div", {
        style: { display: "flex", gap: "6px", marginTop: "6px", alignItems: "center" },
    });
    const prevBtn = btn("◀", () => bump(-1));
    const nextBtn = btn("▶", () => bump(1));
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    nav.appendChild(el("span", { style: { flex: "1" } }));

    const clearFileBtn = btn("Use folder", () => {
        const cur = readState(node);
        const r = cur.refs[idx];
        const dir = r?.directory || "";
        patch({ file: "", directory: dir, description_manual: false });
    });
    nav.appendChild(clearFileBtn);

    const browseBtn = btn("Browse…", async () => {
        browseBtn.disabled = true;
        const prevStatus = status.textContent;
        status.textContent = "Pick file…";
        try {
            const picked = await pickImageFile();
            if (picked?.cancelled) {
                status.textContent = prevStatus || "Cancelled";
                return;
            }
            if (!picked?.ok || !picked.path) {
                status.textContent = picked?.error || "Browse failed";
                return;
            }
            patch({
                file: picked.path,
                directory: picked.directory || "",
                description_manual: false,
            });
        } catch (err) {
            status.textContent = `Browse failed: ${err?.message || err}`;
        } finally {
            browseBtn.disabled = false;
        }
    }, true);
    nav.appendChild(browseBtn);
    card.appendChild(nav);

    function syncRefNav(r) {
        const fileMode = !!String(r?.file || "").trim();
        prevBtn.style.display = fileMode ? "none" : "";
        nextBtn.style.display = fileMode ? "none" : "";
        clearFileBtn.style.display = fileMode ? "" : "none";
    }
    syncRefNav(ref);

    container.appendChild(card);
    refreshRefPreview(node, idx, img, status, card);
}

async function refreshRefPreview(node, idx, img, status, card = null) {
    const state = readState(node);
    const ref = state.refs[idx];
    if (!ref) return;
    const file = String(ref.file || "").trim().replace(/^["']|["']$/g, "");
    const dir = String(ref.directory || "").trim().replace(/^["']|["']$/g, "");
    if (!file && !dir) {
        img.removeAttribute("src");
        status.textContent = "Set directory or Browse file…";
        refreshAllBeatSelectedThumbs(node);
        return;
    }
    const reqId = (img._mmuReq = (img._mmuReq || 0) + 1);
    status.textContent = "Loading…";
    try {
        const data = await resolveImage({
            ...ref,
            file,
            directory: dir,
            index: Math.max(0, Number(ref.index) || 0),
            seed: Math.max(0, Number(ref.seed) || 0),
            pattern: "*",
        });
        if (reqId !== img._mmuReq) return;
        if (!data?.file) {
            img.removeAttribute("src");
            status.textContent = file ? "Image not found" : "No images";
            img._mmuCount = 0;
            if (card) card._mmuCount = 0;
            refreshAllBeatSelectedThumbs(node);
            return;
        }
        img._mmuCount = data.count || 0;
        if (card) card._mmuCount = data.count || 0;

        const path = data.file.path;
        const viewQ = new URLSearchParams({
            path,
            preview: "webp;80",
            t: String(Date.now()),
        });
        img.onerror = () => {
            if (reqId !== img._mmuReq) return;
            status.textContent = `Preview failed: ${data.file.name}`;
        };
        img.onload = () => {
            if (reqId !== img._mmuReq) return;
        };
        img.src = api.apiURL(`/minimaxutils/view?${viewQ}`);

        // Sidecar .txt → describes (same as Prompt From Image).
        const allowAuto =
            !ref.description_manual || !String(ref.description || "").trim();
        let sideNote = ref.description_manual ? "manual" : "kept";
        if (allowAuto) {
            const side = await fetchSidecar(path);
            if (reqId !== img._mmuReq) return;
            const cur = readState(node);
            if (!cur.refs[idx]) return;
            cur.refs[idx].resolved_path = path;
            if (side?.ok && side.raw) {
                cur.refs[idx].description = side.raw;
                cur.refs[idx].description_manual = false;
                sideNote = "sidecar";
                if (card?._mmuDescInput) card._mmuDescInput.value = side.raw;
            } else {
                sideNote = "no sidecar";
            }
            writeState(node, cur);
        } else {
            const cur = readState(node);
            if (cur.refs[idx]) {
                cur.refs[idx].resolved_path = path;
                writeState(node, cur, { refresh: false });
            }
        }

        const srcNote = data.source === "file" ? "file" : `${data.index + 1}/${data.count}`;
        const shortLine = `${data.file.name} · ${sideNote}`;
        const hoverLine = `${srcNote}  ${data.file.path} · ${sideNote}`;
        status.textContent = shortLine;
        status.title = hoverLine;
        img.title = hoverLine;
        refreshAllBeatSelectedThumbs(node);
    } catch (err) {
        if (reqId !== img._mmuReq) return;
        img.removeAttribute("src");
        status.textContent = String(err?.message || err);
    }
}

function renderBeatCard(node, state, idx, container) {
    const beat = state.beats[idx];
    const card = el("div", {
        id: `mmu-beat-${idx}`,
        style: {
            background: "#14181f",
            border: "1px solid #2a2a32",
            borderRadius: "8px",
            padding: "8px",
            marginBottom: "8px",
        },
    });

    const head = el("div", {
        style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" },
    });
    head.appendChild(fieldLabel(`Beat ${idx + 1}`));
    head.appendChild(el("span", { style: { flex: "1" } }));
    head.appendChild(fieldLabel("sec"));
    head.appendChild(
        numInput(beat.duration || 3, (v) => {
            const cur = readState(node);
            if (!cur.beats[idx]) return;
            cur.beats[idx].duration = Math.max(0.1, Number(v) || 0.1);
            writeState(node, cur);
            // Refresh strip widths without nuking the focused input.
            const strip = node._mmuDirectorRoot?.querySelector?.("[data-mmu-timeline]");
            if (strip) {
                const next = renderTimelineStrip(cur);
                strip.replaceWith(next);
            }
        }, 0.1),
    );
    head.appendChild(
        btn("Remove", () => {
            const cur = readState(node);
            if (cur.beats.length <= 1) return;
            cur.beats.splice(idx, 1);
            writeState(node, cur, { refresh: false });
            rebuildPanel(node);
        }),
    );
    card.appendChild(head);

    const diskToggle = el("label", {
        style: {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            font: "12px Consolas,monospace",
            color: "#c8c8c8",
            marginBottom: "6px",
            flexWrap: "wrap",
        },
    });
    const cb = el("input", { type: "checkbox" });
    cb.checked = !!beat.from_disk;
    cb.addEventListener("change", () => {
        const cur = readState(node);
        if (!cur.beats[idx]) return;
        cur.beats[idx].from_disk = cb.checked;
        cur.beats[idx].text_unlocked = false;
        writeState(node, cur, { refresh: false });
        rebuildPanel(node);
    });
    diskToggle.appendChild(cb);
    diskToggle.appendChild(document.createTextNode("from disk"));
    if (beat.from_disk) {
        diskToggle.appendChild(el("span", { style: { flex: "1", minWidth: "8px" } }));
        const unlocked = !!beat.text_unlocked;
        diskToggle.appendChild(
            btn(unlocked ? "Lock / reload" : "Edit", () => {
                const cur = readState(node);
                if (!cur.beats[idx]) return;
                if (cur.beats[idx].text_unlocked) {
                    // Lock → reload file from disk (discards manual edits).
                    cur.beats[idx].text_unlocked = false;
                    writeState(node, cur, { refresh: false });
                    rebuildPanel(node);
                } else {
                    cur.beats[idx].text_unlocked = true;
                    writeState(node, cur, { refresh: false });
                    rebuildPanel(node);
                }
            }, unlocked),
        );
    }
    card.appendChild(diskToggle);

    const patch = (partial) => {
        const cur = readState(node);
        if (!cur.beats[idx]) return;
        Object.assign(cur.beats[idx], partial);
        cur.beats[idx].pattern = "*.txt";
        // Changing disk source always re-locks and reloads file text.
        if (
            partial.directory != null ||
            partial.index != null ||
            partial.seed != null ||
            partial.mode != null
        ) {
            cur.beats[idx].text_unlocked = false;
        }
        writeState(node, cur);
        if (cur.beats[idx].from_disk && !cur.beats[idx].text_unlocked) {
            refreshBeatPreview(node, idx, ta, status, () =>
                refreshBeatSelectedThumbs(node, ta.value, selectedPane, { ta, beatIdx: idx }),
            );
        } else if (cur.beats[idx].from_disk) {
            refreshBeatSelectedThumbs(node, ta.value, selectedPane, { ta, beatIdx: idx });
        }
    };

    const status = el("div", {
        style: { font: "11px Consolas,monospace", color: "#8a9099", marginBottom: "4px" },
    }, [""]);
    card.appendChild(status);

    // Beat templates only in free-text mode (from disk owns the beat body).
    if (!beat.from_disk) {
        const tmplRow = el("div", {
            style: {
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "6px",
                marginBottom: "6px",
            },
        });
        tmplRow.appendChild(
            el("span", {
                style: { font: "11px Consolas,monospace", color: "#9aa0a6" },
            }, ["template"]),
        );
        const tmplSel = el("select", {
            style: {
                flex: "1 1 160px",
                minWidth: "140px",
                background: "#12151a",
                color: "#e8e8e8",
                border: "1px solid #2a2a32",
                borderRadius: "6px",
                padding: "4px 8px",
                font: "12px Consolas,monospace",
            },
        });
        tmplSel.addEventListener("pointerdown", (e) => e.stopPropagation());
        tmplSel.appendChild(el("option", { value: "" }, ["(none — free text)"]));
        tmplRow.appendChild(tmplSel);
        card.appendChild(tmplRow);

        const applyBeatTemplate = async (name) => {
            name = String(name || "").trim();
            if (!name) {
                const cur = readState(node);
                if (!cur.beats[idx]) return;
                cur.beats[idx].template = "";
                writeState(node, cur);
                status.style.color = "#8a9099";
                status.textContent = "";
                return;
            }
            try {
                const tmpl = await fetchBeatTemplate(name);
                const filled =
                    tmpl.filled ||
                    fillBeatSkeleton(tmpl.skeleton || "", tmpl.defaults || {});
                const cur = readState(node);
                if (!cur.beats[idx]) return;
                cur.beats[idx].text = filled;
                cur.beats[idx].template = name;
                writeState(node, cur, { refresh: false });
                if (ta) {
                    ta.value = filled;
                    ta._mmuColorSync?.();
                }
                status.style.color = "#8a9099";
                status.textContent = `${tmpl.label || name} — edit free text / Pic chips as needed`;
                refreshBeatSelectedThumbs(node, filled, selectedPane, { ta, beatIdx: idx });
                schedulePreview(node);
            } catch (err) {
                status.textContent = `Template failed: ${err?.message || err}`;
                status.style.color = "#ff6b6b";
            }
        };

        tmplSel.addEventListener("change", () => {
            applyBeatTemplate(tmplSel.value);
        });

        ensureBeatTemplateCatalog(node).then((templates) => {
            const keep = String(beat.template || "").trim();
            for (const t of templates || []) {
                tmplSel.appendChild(
                    el("option", { value: t.name }, [
                        `${t.label || t.name}${t.source && t.source !== "pack" ? ` [${t.source}]` : ""}`,
                    ]),
                );
            }
            if (keep && [...tmplSel.options].some((o) => o.value === keep)) {
                tmplSel.value = keep;
            }
        });
    }

    if (beat.from_disk) {
        card.appendChild(diskControls(beat, { patternFallback: "*.txt" }, patch));
        const nav = el("div", { style: { display: "flex", gap: "6px", margin: "6px 0", alignItems: "center" } });
        nav.appendChild(
            btn("◀", () => {
                const cur = readState(node);
                const b = cur.beats[idx];
                if (!b) return;
                if ((b.mode || "sequential") === "random") {
                    patch({ seed: Math.max(0, (Number(b.seed) || 0) - 1) });
                } else {
                    patch({ index: Math.max(0, (Number(b.index) || 0) - 1) });
                }
            }),
        );
        nav.appendChild(
            btn("▶", () => {
                const cur = readState(node);
                const b = cur.beats[idx];
                if (!b) return;
                if ((b.mode || "sequential") === "random") {
                    patch({ seed: (Number(b.seed) || 0) + 1 });
                } else {
                    patch({ index: (Number(b.index) || 0) + 1 });
                }
            }),
        );
        if (beat.text_unlocked) {
            nav.appendChild(
                el("span", {
                    style: { font: "11px Consolas,monospace", color: "#3dff6a", marginLeft: "4px" },
                }, ["editing — arrows reload file"]),
            );
        }
        card.appendChild(nav);
    }

    // Pic chips above text (hover = preview, click = insert). Right = only selected.
    const chipRow = el("div", {
        style: { display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" },
    });
    const stateForChips = readState(node);
    stateForChips.refs.forEach((_, ri) => {
        const n = ri + 1;
        const color = PIC_COLORS[n] || "#c0c0c0";
        const chip = btn(`Pic ${n}`, () => {
            insertAtCursor(ta, `<Picture ${n}>`);
            refreshBeatSelectedThumbs(node, ta.value, selectedPane, { ta, beatIdx: idx });
        });
        chip.style.borderColor = color;
        chip.style.color = color;
        chip.style.padding = "2px 8px";
        chip.style.fontSize = "11px";
        chip.title = `Hover preview · click inserts <Picture ${n}>`;
        chip.addEventListener("mouseenter", () => showDirectorPicturePopover(node, n, chip));
        chip.addEventListener("mouseleave", () => scheduleHideDirectorPopover(node));
        chipRow.appendChild(chip);
    });
    card.appendChild(chipRow);

    const body = el("div", {
        style: {
            display: "grid",
            gridTemplateColumns: "1fr minmax(140px, 200px)",
            gap: "8px",
            alignItems: "stretch",
        },
    });

    const canEdit = !beat.from_disk || !!beat.text_unlocked;
    const editor = makeColoredBeatEditor(
        beat.text || "",
        (v) => {
            const cur = readState(node);
            if (!cur.beats[idx]) return;
            cur.beats[idx].text = v;
            writeState(node, cur);
            refreshBeatSelectedThumbs(node, v, selectedPane, { ta, beatIdx: idx });
        },
        {
            minHeight: 100,
            placeholder: canEdit
                ? "action… Apply a template, or type free text · Pic N inserts <Picture N>"
                : "from disk — click Edit to change text / add Picture tags",
        },
    );
    const ta = editor.ta;
    ta.readOnly = !canEdit;
    if (!canEdit) {
        ta.style.opacity = "0.92";
        editor.wrap.style.opacity = "0.92";
    }

    const selectedPane = el("div", {
        style: {
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            minWidth: "0",
            background: "#0a0a0c",
            border: "1px solid #2a2a32",
            borderRadius: "6px",
            padding: "6px",
            boxSizing: "border-box",
            overflowY: "auto",
            maxHeight: "160px",
        },
    });

    body.appendChild(editor.wrap);
    body.appendChild(selectedPane);
    card.appendChild(body);

    container.appendChild(card);
    if (!node._mmuBeatThumbPanes) node._mmuBeatThumbPanes = [];
    node._mmuBeatThumbPanes.push({
        pane: selectedPane,
        getText: () => ta.value,
        ta,
        beatIdx: idx,
    });
    refreshBeatSelectedThumbs(node, ta.value, selectedPane, { ta, beatIdx: idx });
    if (beat.from_disk && !beat.text_unlocked) {
        refreshBeatPreview(node, idx, ta, status, () => {
            ta._mmuColorSync?.();
            refreshBeatSelectedThumbs(node, ta.value, selectedPane, { ta, beatIdx: idx });
        });
    } else if (beat.from_disk && beat.text_unlocked) {
        status.textContent = "Editing loaded text — Lock/reload to restore file";
    }
}

function refreshAllBeatSelectedThumbs(node) {
    for (const entry of node._mmuBeatThumbPanes || []) {
        if (!entry?.pane) continue;
        refreshBeatSelectedThumbs(node, entry.getText?.() || "", entry.pane, {
            ta: entry.ta,
            beatIdx: entry.beatIdx,
        });
    }
}

async function refreshBeatSelectedThumbs(node, text, pane, opts = {}) {
    if (!pane) return;
    const ta = opts.ta || pane._mmuTa || null;
    const beatIdx = opts.beatIdx ?? pane._mmuBeatIdx ?? null;
    if (ta) pane._mmuTa = ta;
    if (beatIdx != null) pane._mmuBeatIdx = beatIdx;

    const reqId = (pane._mmuThumbReq = (pane._mmuThumbReq || 0) + 1);
    pane.innerHTML = "";
    pane.appendChild(
        el("div", {
            style: { font: "10px Consolas,monospace", color: "#8a9099" },
        }, ["selected in text"]),
    );
    const nums = mentionedPictures(text);
    if (!nums.length) {
        pane.appendChild(
            el("div", {
                style: { font: "10px Consolas,monospace", color: "#666", padding: "6px 2px" },
            }, ["(none yet — click Pic N)"]),
        );
        return;
    }
    const state = readState(node);
    const grid = el("div", {
        style: {
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "5px",
        },
    });
    pane.appendChild(grid);
    for (const n of nums) {
        if (reqId !== pane._mmuThumbReq) return;
        const ref = state.refs[n - 1];
        const color = PIC_COLORS[n] || "#c0c0c0";
        const cell = el("div", {
            style: {
                position: "relative",
                border: `1px solid ${color}`,
                borderRadius: "6px",
                overflow: "hidden",
                background: "#12151a",
            },
        });
        const img = el("img", {
            style: {
                width: "100%",
                height: "56px",
                objectFit: "cover",
                display: "block",
                background: "#111",
            },
        });
        img.alt = `Picture ${n}`;
        cell.appendChild(img);
        cell.appendChild(
            el("div", {
                style: {
                    font: "10px Consolas,monospace",
                    color,
                    textAlign: "center",
                    padding: "2px 0",
                },
            }, [`P${n}`]),
        );

        const removeBtn = el("button", {
            type: "button",
            title: `Remove <Picture ${n}> from this beat`,
            style: {
                position: "absolute",
                top: "3px",
                right: "3px",
                zIndex: "2",
                width: "22px",
                height: "22px",
                padding: "0",
                border: "1px solid #5a3030",
                borderRadius: "5px",
                background: "rgba(20,10,10,.82)",
                color: "#ff6b6b",
                cursor: "pointer",
                font: "13px/22px Consolas,monospace",
                textAlign: "center",
                pointerEvents: "auto",
            },
        }, ["×"]);
        for (const name of ["pointerdown", "mousedown"]) {
            removeBtn.addEventListener(name, (ev) => ev.stopPropagation());
        }
        removeBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const editor = pane._mmuTa;
            if (!editor) return;
            const next = removePictureFromText(editor.value, n);
            const wasReadOnly = editor.readOnly;
            if (wasReadOnly) editor.readOnly = false;
            editor.value = next;
            if (wasReadOnly) editor.readOnly = true;
            editor._mmuColorSync?.();
            editor.dispatchEvent(new Event("input", { bubbles: true }));
        });
        cell.appendChild(removeBtn);
        grid.appendChild(cell);

        if (ref && (String(ref.file || "").trim() || String(ref.directory || "").trim())) {
            try {
                const data = await resolveImage(ref);
                if (reqId !== pane._mmuThumbReq) return;
                if (data?.file?.path) {
                    const q = new URLSearchParams({
                        path: data.file.path,
                        preview: "webp;70",
                        t: String(Date.now()),
                    });
                    img.src = api.apiURL(`/minimaxutils/view?${q}`);
                }
            } catch (_) {
                /* ignore */
            }
        }
    }
}

async function refreshBeatPreview(node, beatIdx, ta, status, after = null) {
    const cur = readState(node);
    const beat = cur.beats[beatIdx];
    if (!beat) return;
    if (!String(beat.directory || "").trim()) {
        status.textContent = "Set directory…";
        return;
    }
    try {
        const data = await resolvePrompt(beat);
        if (!data?.file) {
            status.textContent = "No prompts";
            ta.value = "";
            return;
        }
        status.textContent = `${data.index + 1}/${data.count}  ${data.file.name}`;
        const raw = data.raw || "";
        ta.value = raw;
        ta._mmuColorSync?.();
        cur.beats[beatIdx].text = raw;
        writeState(node, cur);
        after?.();
    } catch (err) {
        status.textContent = String(err?.message || err);
    }
}

function schedulePreview(node) {
    clearTimeout(node._mmuDirDebounce);
    node._mmuDirDebounce = setTimeout(() => refreshCompiledPreview(node), 120);
}

const PIC_COLORS = {
    1: "#ff6b6b",
    2: "#ffa94d",
    3: "#69db7c",
    4: "#4dabf7",
    5: "#da77f2",
    6: "#ffd43b",
    7: "#22b8cf",
    8: "#ff8787",
    9: "#a9e34b",
};
const SUBJECT_COLORS = {
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
const BEAT_COLORS = ["#ff5a8a", "#ff9a3d", "#e6c84a", "#3dff6a", "#4a9eff", "#b44aff"];

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function ensurePopoverStyle() {
    if (document.getElementById("mmu-director-popover-style")) return;
    const style = document.createElement("style");
    style.id = "mmu-director-popover-style";
    style.textContent = `
      .mmu-dir-popover { position:fixed; z-index:100000; width:min(360px,calc(100vw - 24px));
        padding:9px; border-radius:8px; border:1px solid #3a3f4a; background:#12151a;
        color:#e8e8e8; box-shadow:0 10px 28px rgba(0,0,0,.55); font:12px Consolas,monospace; }
      .mmu-dir-popover[hidden] { display:none; }
      .mmu-dir-popover img { display:block; width:100%; max-height:240px; object-fit:contain;
        border-radius:6px; background:#08090c; }
    `;
    document.head.appendChild(style);
}

function hideDirectorPopover(node) {
    clearTimeout(node._mmuPopHide);
    node._mmuPopHide = null;
    if (node._mmuPopover) node._mmuPopover.hidden = true;
}

function scheduleHideDirectorPopover(node) {
    clearTimeout(node._mmuPopHide);
    node._mmuPopHide = setTimeout(() => hideDirectorPopover(node), 180);
}

async function showDirectorPicturePopover(node, pictureNum, anchor) {
    ensurePopoverStyle();
    hideDirectorPopover(node);
    let pop = node._mmuPopover;
    if (!pop) {
        pop = document.createElement("div");
        pop.className = "mmu-dir-popover";
        pop.hidden = true;
        pop.addEventListener("mouseenter", () => clearTimeout(node._mmuPopHide));
        pop.addEventListener("mouseleave", () => scheduleHideDirectorPopover(node));
        document.body.appendChild(pop);
        node._mmuPopover = pop;
    }
    pop.innerHTML = "";
    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.marginBottom = "6px";
    title.textContent = `<Picture ${pictureNum}>`;
    pop.appendChild(title);

    let path = "";
    let filename = "";
    let description = "";
    const compiled = (node._mmuLastRefs || []).find((r) => Number(r.n) === Number(pictureNum));
    if (compiled?.path) {
        path = compiled.path;
        filename = compiled.filename || compiled.path;
        description = compiled.description || "";
    } else {
        const live = readState(node).refs[Number(pictureNum) - 1];
        description = live?.description || "";
        if (live && String(live.directory || "").trim()) {
            try {
                const data = await resolveImage(live);
                if (data?.file?.path) {
                    path = data.file.path;
                    filename = data.file.name || "";
                }
            } catch (_) {
                /* ignore */
            }
        }
    }

    const detail = document.createElement("div");
    detail.style.color = "rgba(238,242,248,.62)";
    detail.style.marginBottom = "6px";
    detail.style.whiteSpace = "pre-wrap";
    detail.style.maxHeight = "80px";
    detail.style.overflow = "auto";
    detail.textContent = description || "(no description)";
    pop.appendChild(detail);

    if (path) {
        const img = document.createElement("img");
        const q = new URLSearchParams({ path, preview: "webp;85" });
        img.src = api.apiURL(`/minimaxutils/view?${q}`);
        pop.appendChild(img);
        const file = document.createElement("div");
        file.style.marginTop = "6px";
        file.style.color = "rgba(238,242,248,.45)";
        file.textContent = filename || path;
        pop.appendChild(file);
    } else {
        const muted = document.createElement("div");
        muted.style.color = "rgba(238,242,248,.45)";
        muted.textContent = "No image resolved for this Picture slot.";
        pop.appendChild(muted);
    }

    pop.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 380);
    const top = Math.min(rect.bottom + 8, window.innerHeight - 320);
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${Math.max(8, top)}px`;
}

function colorizeDirectorPrompt(prompt, filled) {
    let html = escapeHtml(String(prompt || ""));
    const entries = Object.entries(filled || {})
        .filter(([k, v]) => String(v || "").trim() && (k.startsWith("pic") || k.startsWith("beat")))
        .sort((a, b) => String(b[1]).length - String(a[1]).length);
    for (const [key, value] of entries) {
        const token = escapeHtml(String(value));
        if (!token) continue;
        let color = "#c0c0c0";
        if (key.startsWith("pic")) {
            const n = Number(key.slice(3));
            color = PIC_COLORS[n] || color;
        } else if (key.startsWith("beat")) {
            const n = Number(key.slice(4)) - 1;
            color = BEAT_COLORS[((n % BEAT_COLORS.length) + BEAT_COLORS.length) % BEAT_COLORS.length];
        }
        const lit = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        html = html.replace(
            new RegExp(lit, "g"),
            `<span style="color:${color};font-weight:600;background:${color}22;border-radius:3px;padding:0 2px;" title="${key}">${token}</span>`,
        );
    }
    html = html.replace(/&lt;Picture (\d)&gt;/g, (full, n) => {
        const color = PIC_COLORS[Number(n)] || "#c0c0c0";
        return `<span class="mmu-dir-pic" data-mmu-picture="${n}" style="color:${color};font-weight:700;background:${color}22;border-radius:3px;padding:0 2px;cursor:pointer;" title="hover for preview">${full}</span>`;
    });
    html = html.replace(/&lt;Subject (\d)&gt;/g, (full, n) => {
        const color = SUBJECT_COLORS[Number(n)] || "#c0c0c0";
        return `<span style="color:${color};font-weight:700;background:${color}22;border-radius:3px;padding:0 2px;" title="Subject ${n}">${full}</span>`;
    });
    return html;
}

function bindDirectorPictureHover(node, root) {
    if (!root) return;
    for (const tok of root.querySelectorAll("[data-mmu-picture]")) {
        if (tok._mmuBound) continue;
        tok._mmuBound = true;
        tok.addEventListener("mouseenter", () => {
            const n = Number(tok.getAttribute("data-mmu-picture"));
            if (n >= 1 && n <= 9) showDirectorPicturePopover(node, n, tok);
        });
        tok.addEventListener("mouseleave", () => scheduleHideDirectorPopover(node));
    }
}

function setPreviewStatus(node, text, isError = false) {
    const el = node._mmuDirectorStatus;
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "#ff6b6b" : "#8a9099";
}

async function refreshCompiledPreview(node) {
    const pre = node._mmuDirectorPre;
    if (!pre) return;
    if (node._mmuPreviewBusy) {
        node._mmuPreviewAgain = true;
        return;
    }
    node._mmuPreviewBusy = true;
    node._mmuPreviewAgain = false;
    setPreviewStatus(node, "Compiling preview…");
    try {
        // Beat text in state is authoritative (includes <Picture N> inserts).
        const state = readState(node);

        const res = await api.fetchApi("/minimaxutils/director_preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ director_state: state }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || "preview failed");

        node._mmuLastPrompt = data.prompt || "";
        node._mmuLastFilled = data.filled || {};
        node._mmuLastRefs = data.refs || [];
        pre.innerHTML = colorizeDirectorPrompt(node._mmuLastPrompt, node._mmuLastFilled);
        bindDirectorPictureHover(node, pre);
        const n = (data.refs || []).filter((r) => r.path || r.description).length;
        const b = (data.beats || []).length;
        const dur = Number(data.total_duration || 0).toFixed(1);
        setPreviewStatus(node, `Live preview · ${n} ref(s) · ${b} beat(s) · ~${dur}s · hover <Picture N>`);
    } catch (err) {
        pre.textContent = String(err?.message || err);
        setPreviewStatus(node, `Preview failed: ${err?.message || err}`, true);
    } finally {
        node._mmuPreviewBusy = false;
        if (node._mmuPreviewAgain) {
            node._mmuPreviewAgain = false;
            refreshCompiledPreview(node);
        }
    }
}

function renderTimelineStrip(state) {
    const wrap = el("div", {
        style: {
            display: "flex",
            gap: "4px",
            alignItems: "stretch",
            margin: "4px 0 10px",
            minHeight: "36px",
            background: "#0a0a0c",
            border: "1px solid #2a2a32",
            borderRadius: "8px",
            padding: "4px",
            overflow: "hidden",
        },
    });
    wrap.dataset.mmuTimeline = "1";
    const total = state.beats.reduce((s, b) => s + Math.max(0.1, Number(b.duration) || 0.1), 0) || 1;
    state.beats.forEach((beat, i) => {
        const dur = Math.max(0.1, Number(beat.duration) || 0.1);
        const pct = Math.max(8, (dur / total) * 100);
        const color = BEAT_COLORS[((i % BEAT_COLORS.length) + BEAT_COLORS.length) % BEAT_COLORS.length];
        const seg = el("div", {
            title: `Beat ${i + 1} · ${dur}s`,
            style: {
                flex: `${dur} 1 0`,
                minWidth: `${pct * 0.6}px`,
                background: `${color}33`,
                border: `1px solid ${color}`,
                borderRadius: "6px",
                padding: "4px 6px",
                font: "11px Consolas,monospace",
                color,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                cursor: "pointer",
            },
            onclick: () => {
                const card = document.getElementById(`mmu-beat-${i}`);
                card?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
            },
        });
        seg.appendChild(document.createTextNode(`B${i + 1}`));
        const sub = el("div", { style: { opacity: "0.85", fontSize: "10px" } }, [`${dur.toFixed(1)}s`]);
        seg.appendChild(sub);
        wrap.appendChild(seg);
    });
    const sum = el("div", {
        style: {
            flex: "0 0 auto",
            alignSelf: "center",
            marginLeft: "6px",
            font: "11px Consolas,monospace",
            color: "#8a9099",
            whiteSpace: "nowrap",
        },
    }, [`Σ ${total.toFixed(1)}s`]);
    wrap.appendChild(sum);
    return wrap;
}

function rebuildPanel(node) {
    const root = node._mmuDirectorRoot;
    if (!root) return;
    root.innerHTML = "";
    node._mmuBeatThumbPanes = [];
    const state = readState(node);

    // Upper pane scrolls; live preview stays docked at the bottom.
    const scroll = el("div", {
        className: "mmu-director-scroll",
        style: {
            flex: "1 1 auto",
            minHeight: "0",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: "2px",
        },
    });
    trapGraphEvents(scroll);

    scroll.appendChild(fieldLabel("Global"));
    scroll.appendChild(fieldLabel("style"));
    scroll.appendChild(
        textInput(state.globals.style, (v) => {
            const cur = readState(node);
            cur.globals.style = v;
            writeState(node, cur);
        }, { multiline: true, minHeight: 40 }),
    );
    const gRow = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", margin: "6px 0 10px" } });
    const left = el("div");
    left.appendChild(fieldLabel("overall soundscape"));
    left.appendChild(
        textInput(state.globals.soundscape, (v) => {
            const cur = readState(node);
            cur.globals.soundscape = v;
            writeState(node, cur);
        }, { multiline: true, minHeight: 40 }),
    );
    const right = el("div");
    right.appendChild(fieldLabel("non-diegetic music"));
    right.appendChild(
        textInput(state.globals.music, (v) => {
            const cur = readState(node);
            cur.globals.music = v;
            writeState(node, cur);
        }, { multiline: true, minHeight: 40 }),
    );
    gRow.appendChild(left);
    gRow.appendChild(right);
    scroll.appendChild(gRow);

    const beatHead = el("div", {
        style: { display: "flex", alignItems: "center", gap: "8px", margin: "4px 0 6px" },
    });
    beatHead.appendChild(fieldLabel(`Timeline / beats (${state.beats.length})`));
    beatHead.appendChild(el("span", { style: { flex: "1" } }));
    beatHead.appendChild(
        btn("Add beat", () => {
            const cur = readState(node);
            cur.beats.push(defaultBeat());
            writeState(node, cur, { refresh: false });
            rebuildPanel(node);
            requestAnimationFrame(() => {
                const last = document.getElementById(`mmu-beat-${cur.beats.length - 1}`);
                last?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
            });
        }, true),
    );
    scroll.appendChild(beatHead);
    scroll.appendChild(
        el("div", {
            style: { font: "11px Consolas,monospace", color: "#8a9099", marginBottom: "4px" },
        }, ["Ordered action beats inside this one Extender shot. Duration builds the timeline."]),
    );
    scroll.appendChild(renderTimelineStrip(state));

    const beatsWrap = el("div", { style: { marginBottom: "12px" } });
    state.beats.forEach((_, i) => renderBeatCard(node, state, i, beatsWrap));
    scroll.appendChild(beatsWrap);

    const refHead = el("div", {
        style: { display: "flex", alignItems: "center", gap: "8px", margin: "4px 0 8px" },
    });
    refHead.appendChild(fieldLabel(`Refs (${state.refs.length})`));
    refHead.appendChild(el("span", { style: { flex: "1" } }));
    refHead.appendChild(
        btn("Add ref", () => {
            const cur = readState(node);
            if (cur.refs.length >= MAX_REFS) return;
            cur.refs.push(defaultRef());
            writeState(node, cur, { refresh: false });
            rebuildPanel(node);
        }, true),
    );
    refHead.appendChild(
        btn("Remove ref", () => {
            const cur = readState(node);
            if (cur.refs.length <= 1) return;
            cur.refs.pop();
            writeState(node, cur, { refresh: false });
            rebuildPanel(node);
        }),
    );
    scroll.appendChild(refHead);

    const refsWrap = el("div", {
        style: { display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "8px" },
    });
    state.refs.forEach((_, i) => renderRefCard(node, state, i, refsWrap));
    scroll.appendChild(refsWrap);

    const dock = el("div", {
        className: "mmu-director-dock",
        style: {
            flex: `0 0 ${PREVIEW_DOCK_H}px`,
            height: `${PREVIEW_DOCK_H}px`,
            minHeight: `${PREVIEW_DOCK_H}px`,
            maxHeight: `${PREVIEW_DOCK_H}px`,
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            borderTop: "1px solid #2a2a32",
            paddingTop: "8px",
            marginTop: "4px",
            background: "#0d1016",
            boxSizing: "border-box",
        },
    });

    const previewHead = el("div", {
        style: { display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" },
    });
    previewHead.appendChild(fieldLabel("Live preview"));
    previewHead.appendChild(el("span", { style: { flex: "1" } }));
    previewHead.appendChild(
        btn("Preview", () => refreshCompiledPreview(node), true),
    );
    dock.appendChild(previewHead);

    const status = el("div", {
        style: {
            font: "11px Consolas,monospace",
            color: "#8a9099",
            minHeight: "14px",
            flex: "0 0 auto",
        },
    }, ["Always visible — scroll the upper pane for beats/refs."]);
    node._mmuDirectorStatus = status;
    dock.appendChild(status);

    const pre = el("pre", {
        style: {
            margin: "0",
            padding: "10px 12px",
            background: "#0a0a0c",
            border: "1px solid #2a2a32",
            borderRadius: "6px",
            color: "#c8c8c8",
            font: "12px/1.45 Consolas,monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            flex: "1 1 auto",
            minHeight: "0",
            overflow: "auto",
        },
    });
    node._mmuDirectorPre = pre;
    dock.appendChild(pre);

    root.appendChild(scroll);
    root.appendChild(dock);
    node._mmuDirectorScroll = scroll;
    refreshCompiledPreview(node);
}

function ensurePanel(node) {
    // Reuse existing panel — recreating addDOMWidget stacks duplicate UIs and breaks clicks.
    if (node._mmuDirectorWidget && node.widgets?.includes(node._mmuDirectorWidget) && node._mmuDirectorRoot) {
        const root = node._mmuDirectorRoot;
        root.style.height = `${PANEL_H}px`;
        const w = node._mmuDirectorWidget;
        w.computedHeight = PANEL_H;
        w.computeSize = (width) => [width || 720, PANEL_H];
        if (typeof w.options?.getMinHeight === "function" || w.options) {
            w.options = w.options || {};
            w.options.getMinHeight = () => PANEL_H;
        }
        return w;
    }

    const root = el("div", {
        className: "mmu-director-panel",
        style: {
            display: "flex",
            flexDirection: "column",
            gap: "0",
            width: "100%",
            boxSizing: "border-box",
            height: `${PANEL_H}px`,
            overflow: "hidden",
            padding: "4px 2px",
            pointerEvents: "auto",
        },
    });
    trapGraphEvents(root);
    node._mmuDirectorRoot = root;

    const widget = node.addDOMWidget("director_panel", "div", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => PANEL_H,
    });
    widget.serialize = false;
    widget.computeSize = (width) => [width || 720, PANEL_H];
    widget.computedHeight = PANEL_H;
    node._mmuDirectorWidget = widget;

    // Hide raw JSON widget visually.
    const stateW = widgetByName(node, "director_state");
    if (stateW) {
        stateW.computeSize = (width) => [width || 400, 0];
        stateW.computedHeight = 0;
        for (const elmt of [stateW.inputEl, stateW.element]) {
            if (elmt?.style) {
                elmt.style.display = "none";
                elmt.style.height = "0";
            }
        }
    }

    if (!node.size || node.size[0] < 760 || (node.size[1] || 0) < PANEL_H) {
        if (node.setSize) node.setSize([Math.max(760, node.size?.[0] || 760), Math.max(PANEL_H, node.size?.[1] || PANEL_H)]);
        else {
            node.size = node.size || [760, PANEL_H];
            node.size[0] = Math.max(760, node.size[0]);
            node.size[1] = Math.max(PANEL_H, node.size[1]);
        }
    }

    rebuildPanel(node);
    return widget;
}

function attachUi(node) {
    ensurePanel(node);
    node._mmuDirectorAttached = true;
}

app.registerExtension({
    name: "Comfyui-MinimaxUtils.MinimaxPromptDirector",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated?.apply(this, arguments);
            attachUi(this);
            return r;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const r = onConfigure?.apply(this, arguments);
            requestAnimationFrame(() => {
                ensurePanel(this);
                rebuildPanel(this);
            });
            return r;
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            if (message?.prompt?.[0]) {
                this._mmuLastPrompt = String(message.prompt[0]);
                try {
                    const resolved = JSON.parse(String(message.resolved_json?.[0] || "{}"));
                    this._mmuLastRefs = resolved.refs || [];
                    const filled = {};
                    for (const r of this._mmuLastRefs) {
                        if (r.description) filled[`pic${r.n}`] = r.description;
                    }
                    for (let i = 0; i < (resolved.beats || []).length; i++) {
                        const t = resolved.beats[i]?.text;
                        if (t) filled[`beat${i + 1}`] = t;
                    }
                    this._mmuLastFilled = filled;
                } catch (_) {
                    this._mmuLastFilled = {};
                }
                if (this._mmuDirectorPre) {
                    this._mmuDirectorPre.innerHTML = colorizeDirectorPrompt(
                        this._mmuLastPrompt,
                        this._mmuLastFilled,
                    );
                    bindDirectorPictureHover(this, this._mmuDirectorPre);
                    setPreviewStatus(this, "Updated from last workflow run");
                }
            }
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            hideDirectorPopover(this);
            this._mmuPopover?.remove?.();
            this._mmuPopover = null;
            return onRemoved?.apply(this, arguments);
        };
    },

    nodeCreated(node) {
        if (node?.comfyClass === NODE_NAME || node?.type === NODE_NAME) attachUi(node);
    },
});

console.log("[MinimaxUtils] MinimaxPromptDirector sketch UI loaded");
