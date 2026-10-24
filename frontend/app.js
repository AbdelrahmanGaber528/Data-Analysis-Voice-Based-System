/* ═════════════════════════════════════════════════════════════════
   AI Workspace Assistant — frontend

   Layout of this file (top → bottom):
     CONFIG ........ endpoints, limits, friendly error texts
     helpers ....... $, escapeHtml, wav encoding
     ApiClient ..... the ONLY place that calls fetch()  (+ ApiError)
     Status ........ one object for "what is the app doing right now"
     VoiceRecorder . microphone → 16 kHz WAV blob
     ConversationStore  conversations + localStorage
     Markdown ...... text → safe HTML
     Notice ........ the small banner above the textbox
     ChatView ...... everything that draws messages
     App ........... wires events, runs send / attach / record flows

   Backend contract (see CONFIG.endpoints):
     POST /api/v1/audio/transcribe[?language=]   multipart file      → { text, language, duration }
     POST /api/v1/data/upload/{id}               multipart file
     POST /api/v1/data/process/{id}              { file_id, chunk_size?, overlap_size? }
     POST /api/v1/data/analyze/{id}              { question, limit?, history? } → explanation + rows
     POST /api/v1/explain                        { query, history? }  → { mode, explanation, code, language }
     POST /api/v1/generate                       { query, history? }  → { mode, explanation, code, language }
   ═════════════════════════════════════════════════════════════════ */

(() => {
"use strict";

// ═══════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
    storageKey: "da_voice_workspace_conversations_v5",

    // Same origin when served by FastAPI; otherwise port 5000 on the same host (needs CORS).
    // Override with: <meta name="api-base" content="http://host:port">
    apiBase: (() => {
        const meta = document.querySelector('meta[name="api-base"]');
        if (meta && meta.content) return meta.content.replace(/\/+$/, "");
        const { protocol, hostname, port, origin } = window.location;
        if (protocol === "file:") return "http://localhost:5000";
        if (port === "5000" || port === "") return origin;
        return `${protocol}//${hostname}:5000`;
    })(),

    endpoints: {
        transcribe: "/api/v1/audio/transcribe",
        upload:     (id) => `/api/v1/data/upload/${encodeURIComponent(id)}`,
        process:    (id) => `/api/v1/data/process/${encodeURIComponent(id)}`,
        analyze:    (id) => `/api/v1/data/analyze/${encodeURIComponent(id)}`,
        explain:    "/api/v1/explain",
        generate:   "/api/v1/generate",
    },

    voiceLanguage: "",          // "" = server default. e.g. "ar" or "en"
    analyzeLimit: null,         // null = let the server choose; or a number to send as `limit`
    maxRecordSec: 60,
    minRecordSec: 0.4,
    maxTableRows: 200,          // rows drawn in a table
    maxStoredRows: 100,         // rows kept per answer in localStorage
    timeoutMs: { default: 120000, transcribe: 180000 },

    tableExts: ["csv", "xlsx"],
    notesExts: ["txt", "pdf"],
    audioExts: ["wav", "mp3", "m4a", "mp4", "ogg", "flac", "webm"],

    placeholders: {
        analysis: "Ask a question about your data...",
        explain:  "Paste code to analyze architecture, logic, and complexity...",
        generate: "Describe the function, endpoint, or algorithm to generate...",
    },
    modeLabels: { analysis: "📊 Analysis", explain: "🔍 Code Explain", generate: "⚙️ Code Gen" },
    modeNames:  { analysis: "Analysis", explain: "Code Explain", generate: "Code Gen" },

    // Conversation context sent to the backend with each new message.
    history: {
        maxMessages: 6,       // last 3 exchanges
        maxChars: 6000,       // total history payload
        maxMessageChars: 3000,
        maxCodeChars: 2500,
        previewRows: 3,
    },

    // Backend `Message` codes → friendly text (unknown codes are shown as-is)
    friendly: {
        audio_type_not_supported: "This audio format isn't supported. Use WAV, MP3 or M4A.",
        audio_size_exceeded: "The audio file is too large.",
        audio_transcribe_failed: "The server couldn't transcribe the audio.",
        audio_empty_transcript: "No clear speech was detected. Please try again.",
    },
};

// ═══════════════════════════════════════════════════════════════
//  helpers
// ═══════════════════════════════════════════════════════════════

const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
}

function fileExtension(file) {
    const name = (file.name || "").toLowerCase();
    return name.includes(".") ? name.split(".").pop() : "";
}

function formatSize(bytes) {
    return bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function encodeWAV(samples, sampleRate = 16000) {
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const str = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
    str(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true);
    str(8, "WAVE"); str(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);   // PCM, mono
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, "data"); view.setUint32(40, samples.length * 2, true);
    for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([view], { type: "audio/wav" });
}

function downsample(buffer, fromRate, toRate = 16000) {
    if (fromRate === toRate) return buffer;
    const ratio = fromRate / toRate;
    const out = new Float32Array(Math.round(buffer.length / ratio));
    let outIdx = 0, inIdx = 0;
    while (outIdx < out.length) {
        const next = Math.round((outIdx + 1) * ratio);
        let sum = 0, n = 0;
        for (let i = inIdx; i < next && i < buffer.length; i++) { sum += buffer[i]; n++; }
        out[outIdx++] = sum / (n || 1);
        inIdx = next;
    }
    return out;
}

// ═══════════════════════════════════════════════════════════════
//  ApiClient — the only code that talks to the server
// ═══════════════════════════════════════════════════════════════

class ApiError extends Error {
    constructor(message, { status = 0, path = "" } = {}) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.path = path;
    }
}

class ApiClient {
    constructor(config) {
        this.base = config.apiBase;
        this.ep = config.endpoints;
        this.friendly = config.friendly;
        this.timeouts = config.timeoutMs;
    }

    // ── public methods: one per backend route ──
    async transcribe(blob, filename, language = "") {
        const form = new FormData();
        form.append("file", blob, filename);
        const query = language ? `?language=${encodeURIComponent(language)}` : "";
        return this._request(`${this.ep.transcribe}${query}`, { method: "POST", body: form }, this.timeouts.transcribe);
    }

    uploadFile(datasetId, file) {
        const form = new FormData();
        form.append("file", file);
        return this._request(this.ep.upload(datasetId), { method: "POST", body: form });
    }

    processFile(datasetId, fileId) {
        return this._postJson(this.ep.process(datasetId), { file_id: fileId });
    }

    analyze(datasetId, question, limit = null, history = []) {
        const body = { question, history };
        if (limit != null) body.limit = limit;
        return this._postJson(this.ep.analyze(datasetId), body);
    }

    explain(query, history = []) {
        return this._postJson(this.ep.explain, { query, history });
    }

    generate(query, history = []) {
        return this._postJson(this.ep.generate, { query, history });
    }

    // ── internals ──
    _postJson(path, body) {
        return this._request(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    }

    async _request(path, options = {}, timeoutMs = this.timeouts.default) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res, text;
        try {
            res = await fetch(`${this.base}${path}`, { ...options, signal: controller.signal });
            text = await res.text();
        } catch (err) {
            if (err && err.name === "AbortError") throw new ApiError("The server took too long to respond.", { path });
            const cross = window.location.origin !== this.base;
            throw new ApiError(`Cannot reach the server at ${this.base}. Make sure it is running${cross ? " and CORS is enabled" : ""}.`, { path });
        } finally {
            clearTimeout(timer);
        }

        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }

        if (!res.ok) {
            throw new ApiError(`${this._errorText(data, text)} (HTTP ${res.status} on ${path})`, { status: res.status, path });
        }
        return data;
    }

    // Your routes answer errors with "Message" (+ "Detail"), "message", or FastAPI's "detail"
    _errorText(data, raw) {
        let msg = "";
        if (data && typeof data === "object") {
            msg = data.Message || data.message || "";
            if (!msg && typeof data.detail === "string") msg = data.detail;
            if (!msg && Array.isArray(data.detail) && data.detail[0]) {
                const d = data.detail[0];
                msg = `${(d.loc || []).slice(1).join(".")} ${d.msg || ""}`.trim();
            }
            msg = this.friendly[msg] || msg;
            const extra = data.Detail || data.error;
            if (extra) msg = msg ? `${msg}: ${extra}` : String(extra);
        }
        if (!msg) {
            const plain = (raw || "").trim();
            msg = plain && plain.length < 160 && !plain.startsWith("<") ? plain : "Request failed";
        }
        return msg;
    }
}

// ═══════════════════════════════════════════════════════════════
//  Status — single source of truth for "what is busy"
// ═══════════════════════════════════════════════════════════════

class Status {
    constructor(onChange) {
        this.onChange = onChange;
        this.state = { recording: false, transcribing: false, thinking: false, uploads: 0 };
    }
    set(key, value) { this.state[key] = value; this.onChange(); }
    bump(key, delta) { this.state[key] += delta; this.onChange(); }

    get recording()    { return this.state.recording; }
    get transcribing() { return this.state.transcribing; }
    get thinking()     { return this.state.thinking; }       // waiting for the answer OR typing it out
    get uploading()    { return this.state.uploads > 0; }

    // Can the user send a message / start the mic / switch conversation right now?
    canSend(hasInput) { return hasInput && !this.thinking && !this.uploading && !this.transcribing; }
    canRecord()       { return !this.recording && !this.transcribing; }
    canNavigate()     { return !this.thinking; }
}

// ═══════════════════════════════════════════════════════════════
//  VoiceRecorder — microphone → 16 kHz mono WAV
// ═══════════════════════════════════════════════════════════════

class VoiceRecorder {
    constructor({ maxSeconds, minSeconds, onTick, onAutoStop }) {
        this.maxSeconds = maxSeconds;
        this.minSeconds = minSeconds;
        this.onTick = onTick;
        this.onAutoStop = onAutoStop;
        this.active = false;
        this.analyser = null;
        this._reset();
    }

    _reset() {
        this.ctx = null; this.stream = null; this.processor = null;
        this.chunks = []; this.timer = null; this.startedAt = 0;
    }

    async start() {
        if (this.active) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("The microphone needs a secure page. Open the app at http://localhost:8000 (or over HTTPS), not via a LAN IP or file://.");
        }
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (this.ctx.state === "suspended") await this.ctx.resume();

            const source = this.ctx.createMediaStreamSource(this.stream);
            this.analyser = this.ctx.createAnalyser();
            this.analyser.fftSize = 256;
            this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
            this.processor.onaudioprocess = (e) => {
                if (this.active) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
            };
            source.connect(this.analyser);
            source.connect(this.processor);
            this.processor.connect(this.ctx.destination);

            this.active = true;
            this.startedAt = Date.now();
            this.timer = setInterval(() => {
                const sec = (Date.now() - this.startedAt) / 1000;
                this.onTick(sec);
                if (sec >= this.maxSeconds) this.onAutoStop();
            }, 500);
            this.onTick(0);
        } catch (err) {
            await this._release();
            throw new Error(VoiceRecorder.describe(err));
        }
    }

    // Returns a WAV Blob. Throws if the recording was too short.
    async stop() {
        if (!this.active) return null;
        const rate = this.ctx ? this.ctx.sampleRate : 44100;
        const chunks = this.chunks;
        await this._release();

        const total = chunks.reduce((n, c) => n + c.length, 0);
        if (total < rate * this.minSeconds) throw new Error("The recording was too short. Hold on a little longer and try again.");

        const merged = new Float32Array(total);
        let offset = 0;
        for (const c of chunks) { merged.set(c, offset); offset += c.length; }
        return encodeWAV(downsample(merged, rate, 16000), 16000);
    }

    async cancel() { await this._release(); }

    async _release() {
        this.active = false;
        clearInterval(this.timer);
        try { if (this.processor) { this.processor.onaudioprocess = null; this.processor.disconnect(); } } catch (_) {}
        try { if (this.analyser) this.analyser.disconnect(); } catch (_) {}
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        const ctx = this.ctx;
        this.analyser = null;
        this._reset();
        if (ctx) { try { await ctx.close(); } catch (_) {} }
    }

    static describe(err) {
        if (err && err.name === "NotAllowedError") return "Microphone permission was denied. Allow it in the browser's site settings.";
        if (err && err.name === "NotFoundError") return "No microphone was found on this device.";
        return `Could not start recording: ${(err && err.message) || err}`;
    }
}

// ═══════════════════════════════════════════════════════════════
//  ConversationStore — conversations + localStorage
// ═══════════════════════════════════════════════════════════════

class ConversationStore {
    constructor(storageKey) {
        this.key = storageKey;
        this.items = [];
        this.currentId = null;
    }

    load() {
        try {
            const saved = JSON.parse(localStorage.getItem(this.key) || "[]");
            this.items = Array.isArray(saved) ? saved.filter(c => c && c.id && Array.isArray(c.messages)) : [];
        } catch (_) {
            this.items = [];
        }
        this.currentId = this.items.length ? this.items[0].id : null;
        return this.items.length > 0;
    }

    save() {
        try { localStorage.setItem(this.key, JSON.stringify(this.items)); }
        catch (e) { console.warn("Could not save conversations:", e); }
    }

    get active() { return this.items.find(c => c.id === this.currentId) || this.items[0]; }

    create(mode = "analysis", title = "New Conversation") {
        const conv = {
            id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title, createdAt: Date.now(), mode, modeLocked: false, messages: [], dataset: null,
        };
        this.items.unshift(conv);
        this.currentId = conv.id;
        this.save();
        return conv;
    }

    select(id) { if (this.items.some(c => c.id === id)) this.currentId = id; }

    remove(id) {
        const idx = this.items.findIndex(c => c.id === id);
        if (idx === -1) return;
        this.items.splice(idx, 1);
        if (this.currentId === id) this.currentId = this.items.length ? this.items[0].id : null;
        this.save();
    }

    rename(id, title) {
        const conv = this.items.find(c => c.id === id);
        if (conv && title) { conv.title = title; this.save(); }
    }
}

// ═══════════════════════════════════════════════════════════════
//  Markdown — text → safe HTML
// ═══════════════════════════════════════════════════════════════

const Markdown = {
    codeBlock(lang, code) {
        const label = (lang || "code").toLowerCase();
        return `
            <div class="code-block-wrap">
                <div class="code-block-header">
                    <span class="code-block-lang">${escapeHtml(label)}</span>
                    <button type="button" class="btn-copy-code-block" aria-label="Copy code">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        <span class="copy-label">Copy</span>
                    </button>
                </div>
                <pre class="code-block-pre"><code>${escapeHtml(code)}</code></pre>
            </div>`;
    },

    render(text) {
        if (!text) return "";
        const blocks = [], inlines = [];

        let out = text.replace(/```([a-zA-Z0-9_+-]*)[ \t]*\n?([\s\S]*?)```/g, (_, lang, code) => {
            blocks.push({ lang: (lang || "Code").trim(), code: code.replace(/\n$/, "") });
            return `\n@@CODEBLOCK${blocks.length - 1}@@\n`;
        });
        out = this._blocks(escapeHtml(out));

        out = out.replace(/`([^`\n]+)`/g, (_, code) => { inlines.push(code); return `@@INLINECODE${inlines.length - 1}@@`; });
        out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
                 .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                 .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
                 .replace(/~~(.+?)~~/g, "<del>$1</del>")
                 .replace(/@@INLINECODE(\d+)@@/g, (_, i) => `<code class="inline-code">${inlines[+i]}</code>`)
                 .replace(/@@CODEBLOCK(\d+)@@/g, (_, i) => this.codeBlock(blocks[+i].lang, blocks[+i].code));
        return out;
    },

    _blocks(text) {
        const html = [];
        let listType = null, para = [];
        const flush = () => { if (para.length) { html.push(`<p>${para.join("<br>")}</p>`); para = []; } };
        const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = null; } };
        const openList = (type) => { flush(); if (listType !== type) { closeList(); html.push(`<${type} class="md-list">`); listType = type; } };

        for (const raw of text.split("\n")) {
            const line = raw.trimEnd(), t = line.trim();
            if (!t) { flush(); closeList(); continue; }
            if (/^@@CODEBLOCK\d+@@$/.test(t)) { flush(); closeList(); html.push(t); continue; }

            let m = line.match(/^(#{1,6})\s+(.*)$/);
            if (m) { flush(); closeList(); html.push(`<h${m[1].length} class="md-heading md-h${m[1].length}">${m[2]}</h${m[1].length}>`); continue; }

            // **Section label** on its own line → ChatGPT-style subheading
            m = line.match(/^\*\*(.+?)\*\*:?\s*$/);
            if (m) { flush(); closeList(); html.push(`<h3 class="md-heading md-section">${m[1]}</h3>`); continue; }
            if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flush(); closeList(); html.push('<hr class="md-hr">'); continue; }
            if ((m = line.match(/^&gt;\s?(.*)$/))) { flush(); closeList(); html.push(`<blockquote class="md-quote">${m[1]}</blockquote>`); continue; }
            if ((m = line.match(/^[-*+]\s+(.*)$/))) { openList("ul"); html.push(`<li>${m[1]}</li>`); continue; }
            if ((m = line.match(/^\d+[.)]\s+(.*)$/))) { openList("ol"); html.push(`<li>${m[1]}</li>`); continue; }

            closeList();
            para.push(t);
        }
        flush(); closeList();
        return html.join("\n");
    },

    // Keep SQL-looking content out of analysis prose even if the model includes it.
    // Explain / generate answers are left untouched (their code blocks are the answer).
    prose(payload) {
        const text = payload.explanation || payload.text || "";
        return payload.mode === "analysis" ? this.stripSql(text) : text;
    },

    stripSql(text) {
        if (!text) return "";
        return text
            .replace(/```sql\b[\s\S]*?```/gi, "")
            .replace(/(?:^|\n)\s*(?:Result|Query|SQL)\s*:?\s*\n+(?:SELECT|WITH|PRAGMA)\b[\s\S]*?(?=\n\s*(?:Notes|Result|Explanation|Findings|Summary|Key|Takeaway)|$)/gi, "\n")
            .replace(/`[^`]*\b(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA)[^`]*`/gi, "")
            .replace(/^\s*sql\s*:?\s*$/gim, "").replace(/^\s*query\s*:?\s*$/gim, "")
            .replace(/\n{3,}/g, "\n\n").trim();
    },
};

// ═══════════════════════════════════════════════════════════════
//  Answer payloads (what the backend returns → what the UI draws)
// ═══════════════════════════════════════════════════════════════

// Accepts rows as arrays ("rows") or objects ("results"); derives missing columns.
function normalizePayload(data, mode) {
    if (!data || typeof data !== "object") throw new Error("The server returned an empty response.");
    const p = { ...data, mode };

    if (!p.explanation && p.text) p.explanation = p.text;

    if (!p.columns && Array.isArray(p.results) && p.results[0] && typeof p.results[0] === "object") {
        p.columns = Object.keys(p.results[0]);
    }
    if (Array.isArray(p.rows) && Array.isArray(p.columns) && !p.results) {
        p.results = p.rows.map(r => Array.isArray(r) ? Object.fromEntries(p.columns.map((c, i) => [c, r[i]])) : r);
    }
    if (p.results && p.row_count == null) p.row_count = p.results.length;

    if (!(p.explanation || p.code || (p.columns && p.columns.length))) {
        throw new Error("The server returned an answer with no content.");
    }
    return p;
}

// Keep localStorage small: cap stored rows (row_count still shows the real total)
function compactPayload(p) {
    return p && p.results && p.results.length > CONFIG.maxStoredRows
        ? { ...p, results: p.results.slice(0, CONFIG.maxStoredRows) }
        : p;
}

// ═══════════════════════════════════════════════════════════════
//  Notice — the banner above the textbox
// ═══════════════════════════════════════════════════════════════

class Notice {
    constructor() {
        this.box = $("#transcribedNotice");
        this.label = $(".notice-text", this.box);
        this.timer = null;
        $("#btnDismissNotice").addEventListener("click", () => this.hide());
    }
    show(text, { error = false } = {}) {
        this.label.textContent = text;
        this.box.style.display = "flex";
        this.box.style.background = error ? "rgba(239, 68, 68, 0.12)" : "";
        this.box.style.borderColor = error ? "rgba(239, 68, 68, 0.4)" : "";
        this.box.style.color = error ? "#fca5a5" : "";
        clearTimeout(this.timer);
        if (error) this.timer = setTimeout(() => this.hide(), 7000);
    }
    error(text) { this.show(text, { error: true }); }
    hide() { clearTimeout(this.timer); this.box.style.display = "none"; }
}

// ═══════════════════════════════════════════════════════════════
//  ChatView — draws messages
// ═══════════════════════════════════════════════════════════════

class ChatView {
    constructor() {
        this.stream = $("#chatStream");
        this.container = $("#messagesContainer");
        this.hero = $("#chatHero");
    }

    scrollToBottom() { this.stream.scrollTop = this.stream.scrollHeight; }

    renderConversation(conv) {
        this.container.innerHTML = "";
        if (!conv || !conv.messages.length) { this.hero.style.display = "block"; return; }
        this.hero.style.display = "none";
        conv.messages.forEach(m => m.role === "user"
            ? this.addUser(m.content, m.attachment, m.mode)
            : this.addAssistantStatic(m));
        this.scrollToBottom();
    }

    hideHero() { this.hero.style.display = "none"; }

    addUser(text, attachment, mode = "analysis") {
        const row = document.createElement("div");
        row.className = "message-row user-msg";
        let html = `<div class="user-meta-row">
            <span class="chat-mode-badge ${mode}" data-mode="${mode}">${CONFIG.modeLabels[mode] || CONFIG.modeLabels.analysis}</span>
        </div>`;
        if (attachment) {
            html += `<div class="user-attached-file">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span>${escapeHtml(attachment.name)} (${escapeHtml(attachment.size)})</span>
            </div>`;
        }
        html += `<div class="user-bubble" dir="auto">${escapeHtml(text)}</div>`;
        row.innerHTML = html;
        this.container.appendChild(row);
        this.scrollToBottom();
    }

    // Shows the spinner; returns a handle: { content, stop() }
    addThinking() {
        const row = document.createElement("div");
        row.className = "message-row assistant-msg";
        row.innerHTML = `<div class="assistant-content">
            <div class="assistant-thinking-indicator">
                <div class="thinking-spinner"></div>
                <span class="thinking-label">Thinking...</span>
            </div></div>`;
        this.container.appendChild(row);

        const label = $(".thinking-label", row);
        const t0 = Date.now();
        const timer = setInterval(() => {
            const s = Math.floor((Date.now() - t0) / 1000);
            label.textContent = s < 8 ? `Thinking... ${s}s` : `Still working... ${s}s`;
        }, 1000);

        this.scrollToBottom();
        return { content: $(".assistant-content", row), stop: () => clearInterval(timer) };
    }

    showError(handle, message) {
        handle.content.innerHTML = this._errorHtml(message);
        this.scrollToBottom();
    }

    // Types the explanation out, then adds code or the result table.
    async showAnswer(handle, payload) {
        handle.content.innerHTML = `
            <div class="answer-text" dir="auto"></div>
            <span class="cursor-blink"></span>
            <div class="assistant-append-zone"></div>`;
        const textEl = $(".answer-text", handle.content);
        await this._typewrite(textEl, Markdown.prose(payload));
        $(".cursor-blink", handle.content)?.remove();
        $(".assistant-append-zone", handle.content).innerHTML = this._extrasHtml(payload);
        this.scrollToBottom();
    }

    addAssistantStatic(msg) {
        const p = msg.payload || { explanation: msg.content || "" };
        const row = document.createElement("div");
        row.className = "message-row assistant-msg";
        row.innerHTML = `<div class="assistant-content">${
            p.error
                ? this._errorHtml(p.error)
                : `<div class="answer-text" dir="auto">${Markdown.render(Markdown.prose(p))}</div>${this._extrasHtml(p)}`
        }</div>`;
        this.container.appendChild(row);
    }

    // ── internals ──
    _typewrite(el, fullText) {
        return new Promise(resolve => {
            if (!fullText) return resolve();
            const step = Math.max(2, Math.ceil(fullText.length / 400));     // long answers stay under ~6s
            let i = 0;
            const timer = setInterval(() => {
                i += step;
                if (i >= fullText.length) {
                    clearInterval(timer);
                    el.innerHTML = Markdown.render(fullText);
                    resolve();
                } else {
                    el.innerHTML = Markdown.render(fullText.slice(0, i));
                    this.scrollToBottom();
                }
            }, 14);
        });
    }

    _errorHtml(msg) { return `<div class="assistant-error">⚠️ ${escapeHtml(msg)}</div>`; }

    _extrasHtml(p) {
        let html = "";
        if (p.code) html += Markdown.codeBlock(p.language || "Code", p.code);
        if (p.mode === "analysis" && p.columns) html += this._tableHtml(p);
        return html;
    }

    _tableHtml(p) {
        const cols = p.columns || [], rows = p.results || [];
        if (!cols.length) return "";
        const total = p.row_count != null ? p.row_count : rows.length;
        const shown = rows.slice(0, CONFIG.maxTableRows);

        let note = "";
        if (p.truncated) note = `The result was capped at ${Number(total).toLocaleString()} rows by the server.`;
        else if (total > shown.length) note = `Showing the first ${shown.length.toLocaleString()} of ${Number(total).toLocaleString()} rows.`;

        const table = shown.length
            ? `<div class="data-table-container"><table class="clean-table">
                   <thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
                   <tbody>${shown.map(r => `<tr>${cols.map(c => `<td>${escapeHtml(r[c] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>
               </table></div>`
            : `<div class="table-note">The query returned no rows.</div>`;

        return `<div class="analysis-visual-card">
            <div class="metrics-pill-row">
                <div class="metric-pill"><span class="metric-pill-label">Rows</span><span class="metric-pill-val">${Number(total).toLocaleString()}</span></div>
                <div class="metric-pill"><span class="metric-pill-label">Columns</span><span class="metric-pill-val">${cols.length}</span></div>
            </div>
            ${table}
            ${note ? `<div class="table-note">${escapeHtml(note)}</div>` : ""}
        </div>`;
    }
}

// ═══════════════════════════════════════════════════════════════
//  App — wires everything together
// ═══════════════════════════════════════════════════════════════

class App {
    constructor() {
        this.api = new ApiClient(CONFIG);
        this.store = new ConversationStore(CONFIG.storageKey);
        this.view = new ChatView();
        this.notice = new Notice();
        this.status = new Status(() => this.refreshControls());
        this.recorder = new VoiceRecorder({
            maxSeconds: CONFIG.maxRecordSec,
            minSeconds: CONFIG.minRecordSec,
            onTick: (sec) => this.onRecordTick(sec),
            onAutoStop: () => this.stopRecording(),
        });
        this.input = $("#userPrompt");
        this.waveFrame = null;
        this.targetRenameId = null;
    }

    // current conversation's mode / dataset live on the conversation itself
    get conv()    { return this.store.active; }
    get mode()    { return this.conv.mode || "analysis"; }
    get dataset() { return this.conv.dataset || null; }

    // ── startup ──
    init() {
        window.addEventListener("error", (e) => this.notice.error(`Unexpected error: ${e.message}`));
        window.addEventListener("unhandledrejection", (e) =>
            this.notice.error(`Unexpected error: ${(e.reason && e.reason.message) || e.reason}`));

        this.input.setAttribute("dir", "auto");               // Arabic input renders right-to-left
        if (!this.store.load()) this.store.create();
        this.bindEvents();
        this.showConversation();
    }

    bindEvents() {
        this.input.addEventListener("input", () => { this.autoGrow(); this.refreshControls(); });
        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
        });
        $("#btnSend").addEventListener("click", () => this.send());

        const fileInput = $("#fileUploadInput");
        $("#btnAttachFile").addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", (e) => { if (e.target.files.length) this.attach(e.target.files[0]); });
        $("#btnRemoveFile").addEventListener("click", () => this.removeDataset());

        $$(".hero-card").forEach(card => card.addEventListener("click", () => {
            const { mode, prompt } = card.dataset;
            if (mode) this.setMode(mode);
            if (prompt) { this.input.value = prompt; this.input.focus(); this.autoGrow(); this.refreshControls(); }
        }));
        $$(".mode-pill").forEach(pill => pill.addEventListener("click", () => this.setMode(pill.dataset.mode)));

        $("#btnMic").addEventListener("click", () => this.recorder.active ? this.stopRecording() : this.startRecording());
        $("#btnCancelVoice").addEventListener("click", () => this.cancelRecording());

        $("#btnNewChat").addEventListener("click", () => this.newConversation());
        $("#btnRenameCurrentChat").addEventListener("click", () => this.openRenameModal(this.store.currentId));
        $("#btnDeleteCurrentChat").addEventListener("click", () => this.deleteConversation(this.store.currentId));
        $("#btnCancelRename").addEventListener("click", () => this.closeRenameModal());
        $("#btnSaveRename").addEventListener("click", () => this.saveRename());
        $("#renameInput").addEventListener("keydown", (e) => {
            if (e.key === "Enter") this.saveRename();
            if (e.key === "Escape") this.closeRenameModal();
        });
        $("#renameModal").addEventListener("click", (e) => { if (e.target === $("#renameModal")) this.closeRenameModal(); });
        $("#btnToggleSidebar").addEventListener("click", () => $("#sidebar").classList.toggle("collapsed"));

        // One delegated listener replaces inline onclick="" attributes
        document.addEventListener("click", (e) => {
            const copy = e.target.closest(".btn-copy-code-block");
            if (copy) {
                const code = copy.closest(".code-block-wrap").querySelector("pre").innerText;
                navigator.clipboard.writeText(code).catch(() => {});
                const label = copy.querySelector(".copy-label");
                if (label) label.textContent = "Copied!";
                else copy.textContent = "Copied!";
                copy.classList.add("copied");
                setTimeout(() => {
                    if (label) label.textContent = "Copy";
                    else copy.textContent = "Copy";
                    copy.classList.remove("copied");
                }, 1800);
                return;
            }
            const badge = e.target.closest(".chat-mode-badge");
            if (badge) this.setMode(badge.dataset.mode);
        });
    }

    // ── UI state ──
    autoGrow() {
        this.input.style.height = "auto";
        this.input.style.height = Math.min(this.input.scrollHeight, 160) + "px";
    }

    refreshControls() {
        const hasInput = this.input.value.trim().length > 0 || this.dataset !== null;
        const ready = this.status.canSend(hasInput);
        const send = $("#btnSend");
        send.classList.toggle("active", ready);
        send.toggleAttribute("disabled", !ready);

        $("#transcribingBanner").style.display = this.status.transcribing ? "flex" : "none";
        $("#inputCapsule").classList.toggle("processing-audio", this.status.transcribing);
        $("#btnMic").disabled = this.status.transcribing;
    }

    showConversation() {
        this.syncMode();
        this.syncDatasetPill();
        this.renderSidebar();
        this.view.renderConversation(this.conv);
        this.refreshControls();
    }

    isModeLocked() {
        return Boolean(this.conv && (this.conv.modeLocked || this.conv.messages.length));
    }

    syncMode() {
        const locked = this.isModeLocked();

        $$(".mode-pill").forEach(p => {
            const active = p.dataset.mode === this.mode;
            p.classList.toggle("active", active);
            p.classList.toggle("locked", locked && !active);
            p.setAttribute("aria-disabled", String(locked && !active));
            p.title = locked && !active
                ? `This chat is locked to ${CONFIG.modeNames[this.mode]}. Start a new chat to use ${CONFIG.modeNames[p.dataset.mode]}.`
                : `Use ${CONFIG.modeNames[p.dataset.mode]} for this chat`;
        });

        const selector = $(".mode-selector");
        if (selector) {
            selector.classList.toggle("locked", locked);
            selector.title = locked
                ? `Mode is locked to ${CONFIG.modeNames[this.mode]} for this conversation. Start a new chat to switch.`
                : "Choose the mode for this conversation";
        }

        this.input.placeholder = CONFIG.placeholders[this.mode] || "Type your message or click the mic to speak...";
    }

    setMode(mode) {
        if (!CONFIG.placeholders[mode]) return;
        if (mode === this.mode) return;

        if (this.isModeLocked()) {
            this.notice.error(
                `This chat is locked to ${CONFIG.modeNames[this.mode]}. Start a new chat to use ${CONFIG.modeNames[mode]}.`
            );
            return;
        }

        this.conv.mode = mode;
        this.conv.modeLocked = true;
        this.store.save();
        this.syncMode();
    }

    buildConversationHistory(conv, mode) {
        const cfg = CONFIG.history;
        const turns = [];
        const datasetId = mode === "analysis" && conv.dataset ? conv.dataset.id : null;

        for (const msg of conv.messages) {
            if (msg.mode && msg.mode !== mode) continue;
            if (datasetId && msg.datasetId && msg.datasetId !== datasetId) continue;

            if (msg.role === "user") {
                const content = String(msg.content || "").trim();
                if (content) turns.push({ role: "user", content });
                continue;
            }

            if (msg.role !== "assistant") continue;

            const p = msg.payload || {};
            if (p.error) continue;

            let content = String(p.explanation || p.text || "").trim();

            if (mode === "analysis") {
                const columns = Array.isArray(p.columns) ? p.columns : [];
                const rows = Array.isArray(p.results) ? p.results : [];

                if (columns.length) {
                    content += `\n\nResult columns: ${columns.join(", ")}. Rows returned: ${p.row_count ?? rows.length}.`;
                    if (rows.length) {
                        content += `\nResult preview: ${JSON.stringify(rows.slice(0, cfg.previewRows))}`;
                    }
                }
            } else if (p.code) {
                content += `\n\nCode:\n\`\`\`${p.language || ""}\n${String(p.code).slice(0, cfg.maxCodeChars)}\n\`\`\``;
            }

            content = content.trim();
            if (content) turns.push({ role: "assistant", content });
        }

        const kept = [];
        let total = 0;

        for (let i = turns.length - 1; i >= 0; i--) {
            const content = turns[i].content.slice(0, cfg.maxMessageChars).trim();
            if (!content) continue;
            if (kept.length && total + content.length > cfg.maxChars) break;

            kept.unshift({ role: turns[i].role, content });
            total += content.length;

            if (kept.length >= cfg.maxMessages) break;
        }

        // Never start the context with an answer whose question was dropped.
        while (kept.length && kept[0].role === "assistant") kept.shift();

        return kept;
    }

    syncDatasetPill(sizeText) {
        const pill = $("#attachedFilePill");
        const ds = this.dataset;
        if (!ds) { pill.style.display = "none"; return; }
        $("#attachedFileName").textContent = ds.name;
        $("#attachedFileSize").textContent = sizeText || ds.size;
        pill.style.display = "flex";
    }

    // ── conversations ──
    newConversation() {
        if (!this.status.canNavigate()) return;
        this.store.create(this.mode);
        this.notice.hide();
        this.input.value = "";
        this.autoGrow();
        this.showConversation();
        this.input.focus();
    }

    switchConversation(id) {
        if (id === this.store.currentId || !this.status.canNavigate()) return;
        this.store.select(id);
        this.showConversation();
    }

    deleteConversation(id) {
        if (!id || !this.status.canNavigate()) return;
        this.store.remove(id);
        if (!this.store.items.length) this.store.create();
        this.showConversation();
    }

    renderSidebar() {
        const list = $("#chatHistoryList");
        list.innerHTML = "";
        this.store.items.forEach(conv => {
            const item = document.createElement("div");
            item.className = `chat-item ${conv.id === this.store.currentId ? "active" : ""}`;
            item.dataset.id = conv.id;
            item.innerHTML = `
                <div class="chat-item-main">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <span class="chat-item-title" title="Double click to rename">${escapeHtml(conv.title)}</span>
                </div>
                <div class="chat-item-actions">
                    <button type="button" class="chat-action-btn rename" title="Rename conversation">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    </button>
                    <button type="button" class="chat-action-btn delete" title="Delete conversation">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>`;
            item.addEventListener("click", () => this.switchConversation(conv.id));
            item.addEventListener("dblclick", (e) => this.startInlineRename(conv.id, e));
            $(".rename", item).addEventListener("click", (e) => this.startInlineRename(conv.id, e));
            $(".delete", item).addEventListener("click", (e) => { e.stopPropagation(); this.deleteConversation(conv.id); });
            list.appendChild(item);
        });
        $("#currentChatTitleDisplay").textContent = this.conv ? this.conv.title : "New Conversation";
    }

    startInlineRename(id, e) {
        if (e) e.stopPropagation();
        const conv = this.store.items.find(c => c.id === id);
        const item = $$(".chat-item").find(el => el.dataset.id === id);
        const span = item && $(".chat-item-title", item);
        if (!conv || !span) return;

        const input = document.createElement("input");
        input.type = "text";
        input.className = "inline-rename-input";
        input.value = conv.title;
        input.maxLength = 50;

        let done = false;
        const finish = (save) => {
            if (done) return;
            done = true;
            if (save) this.store.rename(id, input.value.trim());
            this.renderSidebar();
        };
        input.onkeydown = (ev) => {
            if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
            if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
        };
        input.onblur = () => finish(true);
        input.onclick = (ev) => ev.stopPropagation();
        span.replaceWith(input);
        input.focus();
        input.select();
    }

    openRenameModal(id) {
        const conv = this.store.items.find(c => c.id === id);
        if (!conv) return;
        this.targetRenameId = id;
        const input = $("#renameInput");
        input.value = conv.title;
        $("#renameModal").style.display = "flex";
        setTimeout(() => { input.focus(); input.select(); }, 50);
    }

    saveRename() {
        this.store.rename(this.targetRenameId, $("#renameInput").value.trim());
        this.closeRenameModal();
        this.renderSidebar();
    }

    closeRenameModal() {
        this.targetRenameId = null;
        $("#renameModal").style.display = "none";
    }

    // ── files ──
    async attach(file) {
        const ext = fileExtension(file);
        if (CONFIG.audioExts.includes(ext)) await this.transcribe(file, file.name);
        else if (CONFIG.tableExts.includes(ext)) await this.attachDataset(file);
        else if (CONFIG.notesExts.includes(ext)) await this.attachNotes(file);
        else this.notice.error(`".${ext}" files aren't supported. Attach CSV, XLSX, TXT, PDF or an audio file.`);
        $("#fileUploadInput").value = "";
    }

    async attachDataset(file) {
        const conv = this.conv;

        if (this.isModeLocked() && this.mode !== "analysis") {
            this.notice.error(
                `This chat is locked to ${CONFIG.modeNames[this.mode]}. Start a new chat to analyze a dataset.`
            );
            return;
        }

        const clean = file.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase().slice(0, 16);
        const dataset = { id: `ds_${Date.now().toString(36)}_${clean}`, name: file.name, size: formatSize(file.size) };
        conv.dataset = dataset;
        this.setMode("analysis");
        this.syncDatasetPill("Uploading...");

        this.status.bump("uploads", 1);
        try {
            await this.api.uploadFile(dataset.id, file);
            this.store.save();
            if (this.conv === conv) this.syncDatasetPill();
        } catch (err) {
            console.warn("Dataset upload failed:", err);
            if (conv.dataset === dataset) conv.dataset = null;
            this.store.save();
            if (this.conv === conv) this.syncDatasetPill();
            this.notice.error(`Dataset upload failed: ${err.message}`);
        } finally {
            this.status.bump("uploads", -1);
        }
    }

    // TXT / PDF: extra notes (e.g. a data dictionary) for the current dataset
    async attachNotes(file) {
        const ds = this.dataset;
        if (!ds) return this.notice.error("Attach your CSV or Excel file first, then add notes such as a data dictionary.");
        this.status.bump("uploads", 1);
        this.notice.show(`Uploading ${file.name}...`);
        try {
            await this.api.uploadFile(ds.id, file);
            await this.api.processFile(ds.id, file.name);
            this.notice.show(`📘 ${file.name} was added as notes for this dataset.`);
        } catch (err) {
            this.notice.error(`Couldn't add ${file.name}: ${err.message}`);
        } finally {
            this.status.bump("uploads", -1);
        }
    }

    removeDataset() {
        this.conv.dataset = null;
        $("#fileUploadInput").value = "";
        this.store.save();
        this.syncDatasetPill();
        this.refreshControls();
    }

    // ── voice ──
    async startRecording() {
        if (!this.status.canRecord()) return;
        this.notice.hide();
        try {
            await this.recorder.start();
        } catch (err) {
            console.error("Microphone error:", err);
            $("#btnMic").classList.remove("recording");
            $("#voiceBanner").style.display = "none";
            this.notice.error(err.message);
            return;
        }
        this.status.set("recording", true);
        $("#btnMic").classList.add("recording");
        $("#voiceBanner").style.display = "flex";
        this.drawWaveform();
    }

    onRecordTick(sec) {
        const s = Math.floor(sec);
        $("#voiceBannerText").textContent = `Listening... ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} — click the mic to finish`;
    }

    endRecordingUi() {
        cancelAnimationFrame(this.waveFrame);
        this.status.set("recording", false);
        $("#btnMic").classList.remove("recording");
        $("#voiceBanner").style.display = "none";
    }

    async cancelRecording() {
        if (!this.recorder.active) return;
        this.endRecordingUi();
        await this.recorder.cancel();
    }

    async stopRecording() {
        if (!this.recorder.active) return;
        this.endRecordingUi();
        try {
            const wav = await this.recorder.stop();
            await this.transcribe(wav, "voice_input.wav");
        } catch (err) {
            this.notice.error(err.message);
        }
    }

    drawWaveform() {
        const canvas = $("#voiceCanvas");
        const g = canvas.getContext("2d");
        const analyser = this.recorder.analyser;
        if (!g || !analyser) return;
        const data = new Uint8Array(analyser.frequencyBinCount);
        const usable = Math.min(data.length, 48);                 // low bins carry the speech energy
        const bars = 14, gap = 2;
        const barW = canvas.width / bars - gap;
        const step = Math.max(1, Math.floor(usable / bars));

        const frame = () => {
            if (!this.recorder.active) return;
            analyser.getByteFrequencyData(data);
            g.clearRect(0, 0, canvas.width, canvas.height);
            g.fillStyle = "#ea580c";
            for (let i = 0; i < bars; i++) {
                const h = Math.max(2, ((data[i * step] || 0) / 255) * canvas.height);
                const x = i * (barW + gap), y = (canvas.height - h) / 2;
                if (g.roundRect) { g.beginPath(); g.roundRect(x, y, barW, h, 2); g.fill(); }
                else g.fillRect(x, y, barW, h);
            }
            this.waveFrame = requestAnimationFrame(frame);
        };
        frame();
    }

    // Shared by the microphone and by uploaded audio files
    async transcribe(blobOrFile, filename) {
        this.notice.hide();
        this.status.set("transcribing", true);
        try {
            const data = await this.api.transcribe(blobOrFile, filename, CONFIG.voiceLanguage);
            const text = ((data && data.text) || "").trim();
            if (!text) throw new Error(CONFIG.friendly.audio_empty_transcript);
            const existing = this.input.value.trim();
            this.input.value = existing ? `${existing} ${text}` : text;
            this.autoGrow();
            this.input.focus();
            this.notice.show("🎙️ Voice converted to text — review or edit before sending");
        } catch (err) {
            console.error("Transcription failed:", err);
            this.notice.error(`Voice transcription failed: ${err.message}`);
        } finally {
            this.status.set("transcribing", false);
        }
    }

    // ── sending ──
    async send() {
        const query = this.input.value.trim();
        const dataset = this.dataset;
        if (!this.status.canSend(Boolean(query || dataset))) return;

        const conv = this.conv;
        const mode = this.mode;
        const history = this.buildConversationHistory(conv, mode);
        this.status.set("thinking", true);
        this.notice.hide();
        this.view.hideHero();

        try {
            if (!conv.messages.length) {
                conv.title = query ? (query.length > 28 ? query.slice(0, 28) + "..." : query) : (dataset ? dataset.name : "New Analysis");
                this.renderSidebar();
            }

            const userMsg = {
                role: "user",
                content: query || `Analyze ${dataset.name}`,
                attachment: dataset ? { name: dataset.name, size: dataset.size } : null,
                mode,
                datasetId: dataset ? dataset.id : null,
            };
            conv.messages.push(userMsg);
            this.store.save();
            this.syncMode();
            this.view.addUser(userMsg.content, userMsg.attachment, mode);

            this.input.value = "";
            this.autoGrow();

            const handle = this.view.addThinking();
            let payload;
            try {
                payload = await this.fetchAnswer(userMsg.content, dataset, mode, history);
            } catch (err) {
                console.error("Assistant request failed:", err);
                payload = { mode, error: err.message || String(err) };
            } finally {
                handle.stop();
            }

            conv.messages.push({
                role: "assistant",
                mode,
                datasetId: dataset ? dataset.id : null,
                payload: compactPayload(payload),
            });
            this.store.save();

            if (payload.error) this.view.showError(handle, payload.error);
            else await this.view.showAnswer(handle, payload);
        } catch (err) {
            console.error("Send failed:", err);
            this.notice.error(`Something went wrong: ${err.message}`);
        } finally {
            this.status.set("thinking", false);
            this.view.scrollToBottom();
        }
    }

    async fetchAnswer(query, dataset, mode, history = []) {
        let data;
        if (mode === "analysis") {
            if (!dataset) throw new Error("Attach a CSV or Excel file first (Attach File), then ask your question.");
            data = await this.api.analyze(dataset.id, query, CONFIG.analyzeLimit, history);
            console.debug("[analyze] raw response", data);
        } else if (mode === "explain") {
            data = await this.api.explain(query, history);
        } else {
            data = await this.api.generate(query, history);
        }
        return normalizePayload(data, mode);
    }
}

// ═══════════════════════════════════════════════════════════════
//  start
// ═══════════════════════════════════════════════════════════════

const start = () => new App().init();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
})();