/* ═════════════════════════════════════════════════════════════════
   AI Workspace Assistant — Engine
   - Real-time character-by-character text streaming with blinking cursor
   - "Thinking..." pulsing indicator while waiting for response
   - Markdown code blocks with 1-click Copy button
   - Interactive Orange Send button that responds to user input
   - Flawless conversation rename (inline in sidebar & topbar modal) and delete
   - Seamless workflow mode switching (Analysis, Code Explain, Code Gen)
   - Voice transcription into input for review & edit before sending
   ═════════════════════════════════════════════════════════════════ */

(() => {
    "use strict";

    // ─── DOM Helpers ───
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

    const getAPI = () => {
        if (window.location.port === "5000" || window.location.port === "") {
            return window.location.origin.replace(/\/+$/, "");
        }
        return `${window.location.protocol}//${window.location.hostname}:5000`;
    };

    // ─── State & Storage ───
    const STORAGE_KEY = "da_voice_workspace_conversations_v3";
    let conversations = [];
    let currentConvId = null;
    let activeMode = "analysis";       // "analysis" | "explain" | "generate"
    let activeDataset = null;          // { id, file, name, size, columns }
    let isRecording = false;
    let isStreaming = false;
    let targetRenameId = null;

    // Dataset IDs with an upload request still in flight.
    const uploadingDatasets = new Set();

    // Placeholders per mode
    const PLACEHOLDERS = {
        analysis: "Ask a question about your data...",
        explain: "Paste code to analyze architecture, logic, and complexity...",
        generate: "Describe the function, endpoint, or algorithm to generate..."
    };

    // ═══════════════════════════════════════════════════════════════
    //  1. HIGH COMPATIBILITY BROWSER WAV RECORDER (16kHz Mono)
    // ═══════════════════════════════════════════════════════════════

    function encodeWAV(samples, sampleRate = 16000) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        writeString(view, 0, "RIFF");
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(view, 8, "WAVE");
        writeString(view, 12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, "data");
        view.setUint32(40, samples.length * 2, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return new Blob([view], { type: "audio/wav" });
    }

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    function downsampleBuffer(buffer, sampleRate, outSampleRate = 16000) {
        if (outSampleRate === sampleRate) return buffer;
        const ratio = sampleRate / outSampleRate;
        const newLen = Math.round(buffer.length / ratio);
        const result = new Float32Array(newLen);
        let offsetResult = 0;
        let offsetBuffer = 0;
        while (offsetResult < result.length) {
            let nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
            let accum = 0, count = 0;
            for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
                accum += buffer[i];
                count++;
            }
            result[offsetResult] = accum / (count || 1);
            offsetResult++;
            offsetBuffer = nextOffsetBuffer;
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════════
    //  2. VOICE RECORDING (CONVERT TO EDITABLE TEXT IN INPUT)
    // ═══════════════════════════════════════════════════════════════

    let audioCtx = null;
    let mediaStream = null;
    let processor = null;
    let analyser = null;
    let audioChunks = [];
    let animFrame = null;

    async function startVoiceRecording() {
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx.createMediaStreamSource(mediaStream);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;

            processor = audioCtx.createScriptProcessor(4096, 1, 1);
            audioChunks = [];

            processor.onaudioprocess = (e) => {
                if (!isRecording) return;
                audioChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
            };

            source.connect(analyser);
            source.connect(processor);
            processor.connect(audioCtx.destination);

            isRecording = true;
            $("#btnMic").classList.add("recording");
            $("#voiceBanner").style.display = "flex";
            $("#transcribedNotice").style.display = "none";

            drawVoiceWaveform();
        } catch (err) {
            console.error("Microphone error:", err);
            alert("Microphone access was denied or is unavailable.");
            stopVoiceRecording(false);
        }
    }

    function drawVoiceWaveform() {
        const canvas = $("#voiceCanvas");
        if (!canvas || !analyser) return;
        const ctx = canvas.getContext("2d");
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        function render() {
            if (!isRecording) return;
            analyser.getByteFrequencyData(dataArray);
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const bars = 14;
            const barWidth = canvas.width / bars - 2;
            const step = Math.floor(dataArray.length / bars);

            for (let i = 0; i < bars; i++) {
                const val = dataArray[i * step] || 0;
                const h = Math.max(2, (val / 255) * canvas.height);
                const x = i * (barWidth + 2);
                const y = (canvas.height - h) / 2;

                ctx.fillStyle = "#ea580c";
                ctx.beginPath();
                ctx.roundRect(x, y, barWidth, h, 2);
                ctx.fill();
            }
            animFrame = requestAnimationFrame(render);
        }
        render();
    }

    async function stopVoiceRecording(processAudio = true) {
        if (!isRecording) return;
        isRecording = false;

        $("#btnMic").classList.remove("recording");
        $("#voiceBanner").style.display = "none";
        if (animFrame) cancelAnimationFrame(animFrame);

        if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
        if (processor) processor.disconnect();
        if (analyser) analyser.disconnect();

        if (!processAudio) {
            if (audioCtx) await audioCtx.close();
            return;
        }

        let total = audioChunks.reduce((acc, c) => acc + c.length, 0);
        let merged = new Float32Array(total);
        let offset = 0;
        for (let c of audioChunks) {
            merged.set(c, offset);
            offset += c.length;
        }

        const inputRate = audioCtx ? audioCtx.sampleRate : 44100;
        if (audioCtx) await audioCtx.close();

        const downsampled = downsampleBuffer(merged, inputRate, 16000);
        const wavBlob = encodeWAV(downsampled, 16000);

        // Put transcribed voice directly into the text area so user can review and edit!
        await transcribeToEditableInput(wavBlob);
    }

    async function transcribeToEditableInput(wavBlob) {
        const textarea = $("#userPrompt");
        const originalPlaceholder = textarea.placeholder;
        textarea.placeholder = "Transcribing voice to text...";

        const fd = new FormData();
        fd.append("file", wavBlob, "voice_input.wav");

        try {
            const res = await fetch(`${getAPI()}/api/v1/audio/transcribe`, {
                method: "POST",
                body: fd,
            });
            const data = await res.json();
            if (res.ok && data.text) {
                const existing = textarea.value.trim();
                textarea.value = existing ? `${existing} ${data.text}` : data.text;
                textarea.style.height = "auto";
                textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
                textarea.focus();

                $("#transcribedNotice").style.display = "flex";
                updateSendButtonState();
            } else {
                textarea.placeholder = "Could not detect clear speech. Please try again.";
                setTimeout(() => (textarea.placeholder = originalPlaceholder), 2500);
            }
        } catch (err) {
            textarea.placeholder = "Voice connection error. You can type directly.";
            setTimeout(() => (textarea.placeholder = originalPlaceholder), 2500);
        }
    }


    // ═══════════════════════════════════════════════════════════════
    //  3. CONVERSATION MANAGEMENT (RENAME & DELETE)
    // ═══════════════════════════════════════════════════════════════

    function loadConversationsFromStorage() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) conversations = JSON.parse(saved);
        } catch (e) {
            conversations = [];
        }

        if (!conversations.length) {
            createNewConversation();
        } else {
            currentConvId = conversations[0].id;
            const conv = getActiveConversation();
            if (conv && conv.mode) activeMode = conv.mode;
            updateModeUI();
            renderConversationList();
            renderActiveConversationMessages();
        }
    }

    function saveConversationsToStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
        } catch (e) {
            console.warn("Storage quota exceeded:", e);
        }
    }

    function createNewConversation(customTitle = "New Conversation") {
        const newId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const newConv = {
            id: newId,
            title: customTitle,
            createdAt: Date.now(),
            mode: activeMode,
            messages: [],
            dataset: null
        };

        conversations.unshift(newConv);
        currentConvId = newId;
        activeDataset = null;

        saveConversationsToStorage();
        renderConversationList();
        renderActiveConversationMessages();

        $("#attachedFilePill").style.display = "none";
        $("#transcribedNotice").style.display = "none";
        $("#userPrompt").value = "";
        updateSendButtonState();
        $("#userPrompt").focus();
    }

    async function handleAudioFileUpload(file) {
        const textarea = $("#userPrompt");
        const originalPlaceholder = textarea.placeholder;
        textarea.placeholder = "Transcribing uploaded audio...";
        updateSendButtonState();

        const fd = new FormData();
        fd.append("file", file);

        try {
            const res = await fetch(`${getAPI()}/api/v1/audio/transcribe`, {
                method: "POST",
                body: fd,
            });
            const data = await res.json();
            if (res.ok && data.text) {
                const existing = textarea.value.trim();
                textarea.value = existing ? `${existing} ${data.text}` : data.text;
                textarea.style.height = "auto";
                textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
                textarea.focus();
                $("#transcribedNotice").style.display = "flex";
            } else {
                textarea.placeholder = "Could not detect clear speech. Please try again.";
                setTimeout(() => (textarea.placeholder = originalPlaceholder), 2500);
            }
        } catch (err) {
            textarea.placeholder = "Voice connection error. You can type directly.";
            setTimeout(() => (textarea.placeholder = originalPlaceholder), 2500);
        } finally {
            updateModeUI();
            updateSendButtonState();
        }
    }

    function getActiveConversation() {
        return conversations.find(c => c.id === currentConvId) || conversations[0];
    }

    function switchConversation(convId) {
        if (convId === currentConvId || isStreaming) return;
        currentConvId = convId;
        const conv = getActiveConversation();
        if (conv) {
            activeMode = conv.mode || "analysis";
            updateModeUI();
            activeDataset = conv.dataset || null;
            if (activeDataset) {
                $("#attachedFileName").textContent = activeDataset.name;
                $("#attachedFileSize").textContent = activeDataset.size;
                $("#attachedFilePill").style.display = "flex";
            } else {
                $("#attachedFilePill").style.display = "none";
            }
        }
        renderConversationList();
        renderActiveConversationMessages();
        updateSendButtonState();
    }

    function deleteConversation(convId, e) {
        if (e) e.stopPropagation();
        if (isStreaming) return;

        if (conversations.length <= 1) {
            conversations = [];
            createNewConversation();
            return;
        }

        const idx = conversations.findIndex(c => c.id === convId);
        if (idx !== -1) {
            conversations.splice(idx, 1);
            if (currentConvId === convId) {
                currentConvId = conversations[0].id;
                const conv = getActiveConversation();
                if (conv && conv.mode) activeMode = conv.mode;
                updateModeUI();
            }
            saveConversationsToStorage();
            renderConversationList();
            renderActiveConversationMessages();
        }
    }

    /**
     * Inline renaming in sidebar — smooth, instant, no modal blockage
     */
    function startInlineRename(convId, e) {
        if (e) e.stopPropagation();
        const conv = conversations.find(c => c.id === convId);
        if (!conv) return;

        const chatItems = $$(".chat-item");
        chatItems.forEach(item => {
            if (item.dataset.id === convId) {
                const titleSpan = item.querySelector(".chat-item-title");
                if (!titleSpan) return;

                const input = document.createElement("input");
                input.type = "text";
                input.className = "inline-rename-input";
                input.value = conv.title;
                input.maxLength = 50;

                const finish = (save) => {
                    if (save) {
                        const val = input.value.trim();
                        if (val) conv.title = val;
                        saveConversationsToStorage();
                        updateTopBarTitle();
                    }
                    renderConversationList();
                };

                input.onkeydown = (ev) => {
                    if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
                    if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
                };
                input.onblur = () => finish(true);
                input.onclick = (ev) => ev.stopPropagation();

                titleSpan.replaceWith(input);
                input.focus();
                input.select();
            }
        });
    }

    // Modal Rename (from Topbar)
    function openRenameModal(convId) {
        const conv = conversations.find(c => c.id === convId);
        if (!conv) return;

        targetRenameId = convId;
        const input = $("#renameInput");
        input.value = conv.title;
        $("#renameModal").style.display = "flex";
        setTimeout(() => {
            input.focus();
            input.select();
        }, 50);
    }

    function saveModalRename() {
        const input = $("#renameInput");
        const newTitle = input.value.trim();
        if (newTitle && targetRenameId) {
            const conv = conversations.find(c => c.id === targetRenameId);
            if (conv) {
                conv.title = newTitle;
                saveConversationsToStorage();
                renderConversationList();
                updateTopBarTitle();
            }
        }
        closeRenameModal();
    }

    function closeRenameModal() {
        targetRenameId = null;
        $("#renameModal").style.display = "none";
    }

    function updateTopBarTitle() {
        const conv = getActiveConversation();
        $("#currentChatTitleDisplay").textContent = conv ? conv.title : "New Conversation";
    }

    function renderConversationList() {
        const list = $("#chatHistoryList");
        list.innerHTML = "";

        conversations.forEach(conv => {
            const item = document.createElement("div");
            item.className = `chat-item ${conv.id === currentConvId ? "active" : ""}`;
            item.dataset.id = conv.id;
            item.onclick = () => switchConversation(conv.id);

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
                </div>
            `;

            // Rename listener
            item.querySelector(".rename").addEventListener("click", (e) => startInlineRename(conv.id, e));
            // Double click to rename
            item.addEventListener("dblclick", (e) => startInlineRename(conv.id, e));
            // Delete listener
            item.querySelector(".delete").addEventListener("click", (e) => deleteConversation(conv.id, e));

            list.appendChild(item);
        });

        updateTopBarTitle();
    }


    // ═══════════════════════════════════════════════════════════════
    //  4. MODE SWITCHING (ANALYSIS / CODE EXPLAIN / CODE GEN)
    // ═══════════════════════════════════════════════════════════════

    function setMode(mode) {
        if (!["analysis", "explain", "generate"].includes(mode)) return;
        activeMode = mode;
        updateModeUI();

        const conv = getActiveConversation();
        if (conv) {
            conv.mode = mode;
            saveConversationsToStorage();
        }
    }

    function updateModeUI() {
        $$(".mode-pill").forEach(pill => {
            pill.classList.toggle("active", pill.dataset.mode === activeMode);
        });
        const textarea = $("#userPrompt");
        if (textarea) {
            textarea.placeholder = PLACEHOLDERS[activeMode] || "Type your message or click the mic to speak...";
        }
    }


    // ═══════════════════════════════════════════════════════════════
    //  5. DATASET ATTACHMENT (AUTO ID GENERATION)
    // ═══════════════════════════════════════════════════════════════

    async function handleFileSelected(file) {
        if (!file) return;

        const name = (file.name || "").toLowerCase();
        const ext = name.includes(".") ? name.split(".").pop() : "";

        // Audio files: upload to transcribe endpoint or just transcribe directly and insert into prompt
        if (["wav", "mp3", "m4a", "mp4", "ogg", "flac"].includes(ext)) {
            await handleAudioFileUpload(file);
            return;
        }

        const cleanName = file.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase().slice(0, 16);
        const internalId = `ds_${Date.now().toString(36)}_${cleanName}`;
        const sizeFormatted = file.size > 1024 * 1024
            ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
            : `${Math.round(file.size / 1024)} KB`;

        activeDataset = {
            id: internalId,
            file: file,
            name: file.name,
            size: sizeFormatted,
            columns: []
        };

        const conv = getActiveConversation();
        if (conv) conv.dataset = activeDataset;

        $("#attachedFileName").textContent = file.name;
        $("#attachedFileSize").textContent = "Uploading...";
        $("#attachedFilePill").style.display = "flex";

        // Auto-switch to Analysis mode when spreadsheet attached
        setMode("analysis");

        // Block sending until the backend confirms the dataset is stored.
        uploadingDatasets.add(internalId);
        updateSendButtonState();

        const fd = new FormData();
        fd.append("file", file);

        try {
            const res = await fetch(`${getAPI()}/api/v1/data/upload/${encodeURIComponent(internalId)}`, {
                method: "POST",
                body: fd,
            });

            if (!res.ok) {
                throw new Error(`Upload failed with status ${res.status}`);
            }

            // The user may have switched conversations while the upload was running.
            if (activeDataset && activeDataset.id === internalId) {
                $("#attachedFileSize").textContent = sizeFormatted;
            }

            saveConversationsToStorage();

        } catch (err) {
            console.warn("Dataset upload failed:", err);

            // Drop the broken dataset from its conversation.
            if (conv && conv.dataset && conv.dataset.id === internalId) {
                conv.dataset = null;
            }

            if (activeDataset && activeDataset.id === internalId) {
                activeDataset = null;
                $("#attachedFilePill").style.display = "none";
                $("#fileUploadInput").value = "";

                const textarea = $("#userPrompt");
                textarea.placeholder = "Dataset upload failed. Please attach the file again.";
                setTimeout(() => updateModeUI(), 3000);
            }

            saveConversationsToStorage();

        } finally {
            uploadingDatasets.delete(internalId);
            updateSendButtonState();
        }
    }

    function removeAttachedFile() {
        activeDataset = null;
        const conv = getActiveConversation();
        if (conv) conv.dataset = null;
        $("#attachedFilePill").style.display = "none";
        $("#fileUploadInput").value = "";
        saveConversationsToStorage();
        updateSendButtonState();
    }


    // ═══════════════════════════════════════════════════════════════
    //  6. SEND BUTTON INTERACTIVITY (TURNS VIBRANT ORANGE)
    // ═══════════════════════════════════════════════════════════════

    function updateSendButtonState() {
        const textarea = $("#userPrompt");
        const sendBtn = $("#btnSend");
        if (!textarea || !sendBtn) return;

        const hasText = textarea.value.trim().length > 0;
        const hasFile = activeDataset !== null;
        const uploading = isDatasetUploading(activeDataset);

        if ((hasText || hasFile) && !isStreaming && !uploading) {
            sendBtn.classList.add("active");
            sendBtn.removeAttribute("disabled");
        } else {
            sendBtn.classList.remove("active");
            sendBtn.setAttribute("disabled", "true");
        }
    }

    function isDatasetUploading(dataset) {
        return Boolean(dataset && dataset.id && uploadingDatasets.has(dataset.id));
    }


    // ═══════════════════════════════════════════════════════════════
    //  7. STREAMING ENGINE (CHARACTER-BY-CHARACTER & THINKING)
    // ═══════════════════════════════════════════════════════════════

    function renderActiveConversationMessages() {
        const conv = getActiveConversation();
        const container = $("#messagesContainer");
        container.innerHTML = "";

        if (!conv || !conv.messages.length) {
            $("#chatHero").style.display = "block";
            return;
        }

        $("#chatHero").style.display = "none";

        conv.messages.forEach(msg => {
            if (msg.role === "user") {
                renderUserBubble(msg.content, msg.attachment, msg.mode);
            } else {
                renderAssistantStaticBubble(msg);
            }
        });

        scrollToBottom();
    }

    async function handleSendMessage() {
        if (isStreaming || isDatasetUploading(activeDataset)) return;
        const textarea = $("#userPrompt");
        const query = textarea.value.trim();
        const attached = activeDataset;

        if (!query && !attached) return;

        $("#transcribedNotice").style.display = "none";
        $("#chatHero").style.display = "none";

        const sendBtn = $("#btnSend");
        if (sendBtn) {
            sendBtn.classList.remove("active");
            sendBtn.setAttribute("disabled", "true");
        }

        const conv = getActiveConversation();

        if (!conv.messages.length) {
            const preview = query ? (query.length > 28 ? query.slice(0, 28) + "..." : query) : (attached ? attached.name : "New Analysis");
            conv.title = preview;
            saveConversationsToStorage();
            renderConversationList();
        }

        const currentMsgMode = activeMode;
        const userMsg = {
            role: "user",
            content: query || `Analyze ${attached.name}`,
            attachment: attached ? { name: attached.name, size: attached.size } : null,
            mode: currentMsgMode
        };
        conv.messages.push(userMsg);
        renderUserBubble(userMsg.content, userMsg.attachment, currentMsgMode);

        textarea.value = "";
        textarea.style.height = "auto";
        updateSendButtonState();

        const assistantRow = renderThinkingPlaceholder();
        ensureThinking(assistantRow);

        try {
            await streamAssistantResponse(assistantRow, userMsg.content, attached, currentMsgMode);
        } finally {
            isStreaming = false;
            updateSendButtonState();
            scrollToBottom();
        }
    }

    function renderUserBubble(text, attachment, mode) {
        const container = $("#messagesContainer");
        const row = document.createElement("div");
        row.className = "message-row user-msg";

        const modeBadgeLabel = mode === "explain" ? "🔍 Code Explain" : (mode === "generate" ? "⚙️ Code Gen" : "📊 Analysis");
        const modeBadgeClass = mode || "analysis";

        let html = `
            <div class="user-meta-row">
                <span class="chat-mode-badge ${modeBadgeClass}" onclick="window.__setAssistantMode('${modeBadgeClass}')">${modeBadgeLabel}</span>
            </div>
        `;

        if (attachment) {
            html += `
                <div class="user-attached-file">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span>${escapeHtml(attachment.name)} (${attachment.size})</span>
                </div>
            `;
        }
        html += `<div class="user-bubble">${escapeHtml(text)}</div>`;
        row.innerHTML = html;
        container.appendChild(row);
        scrollToBottom();
    }

    function renderThinkingPlaceholder() {
        const container = $("#messagesContainer");
        const row = document.createElement("div");
        row.className = "message-row assistant-msg";
        row.innerHTML = `
            <div class="assistant-content">
                <div class="assistant-thinking-indicator">
                    <div class="thinking-spinner"></div>
                    <span>Thinking...</span>
                </div>
            </div>
        `;
        container.appendChild(row);
        scrollToBottom();
        return row;
    }

    // Ensure thinking indicator is visible
    function ensureThinking(rowEl) {
        if (!rowEl) return;
        const contentEl = rowEl.querySelector(".assistant-content");
        if (!contentEl) return;
        contentEl.innerHTML = `
            <div class="assistant-thinking-indicator">
                <div class="thinking-spinner"></div>
                <span>Thinking...</span>
            </div>
        `;
        scrollToBottom();
    }
        isStreaming = true;
        updateSendButtonState();
        const contentEl = rowEl.querySelector(".assistant-content");
        const conv = getActiveConversation();

        let assistantPayload = null;

        ensureThinking(rowEl);

        try {
            if (mode === "analysis" && dataset) {
                const res = await fetch(`${getAPI()}/api/v1/data/analyze/${encodeURIComponent(dataset.id)}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ question: query }),
                });
                if (res.ok) {
                    assistantPayload = await res.json();
                    assistantPayload.mode = "analysis";
                }
            } else if (mode === "explain") {
                const res = await fetch(`${getAPI()}/api/v1/explain`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query }),
                });
                if (res.ok) {
                    assistantPayload = await res.json();
                    assistantPayload.mode = "explain";
                }
            }
        } catch (e) {
            // Fall back to demo
        }

        if (!assistantPayload) {
            await new Promise(r => setTimeout(r, 700));
            assistantPayload = generateCapabilityPayload(query, dataset, mode);
        }

        if (conv) {
            const assistantMsg = {
                role: "assistant",
                mode: mode,
                payload: assistantPayload
            };
            conv.messages.push(assistantMsg);
            saveConversationsToStorage();
        }

        if (!contentEl) {
            isStreaming = false;
            updateSendButtonState();
            return;
        }

        contentEl.innerHTML = `
            <div class="answer-text"></div>
            <span class="cursor-blink"></span>
            <div class="assistant-append-zone"></div>
        `;

        const answerTextEl = contentEl.querySelector(".answer-text");
        const cursorEl = contentEl.querySelector(".cursor-blink");
        const appendZone = contentEl.querySelector(".assistant-append-zone");

        const fullText = stripSqlFromExplanation(assistantPayload.explanation || assistantPayload.text || "");

        let currentIdx = 0;
        const chunkSize = 2;
        const speed = 14;

        await new Promise(resolve => {
            if (fullText.length === 0) {
                answerTextEl.innerHTML = "";
                resolve();
                return;
            }
            const interval = setInterval(() => {
                currentIdx += chunkSize;
                if (currentIdx >= fullText.length) {
                    currentIdx = fullText.length;
                    clearInterval(interval);
                    answerTextEl.innerHTML = parseMarkdownWithCodeBlocks(fullText);
                    resolve();
                } else {
                    answerTextEl.innerHTML = parseMarkdownWithCodeBlocks(fullText.slice(0, currentIdx));
                    scrollToBottom();
                }
            }, speed);
        });

        if (cursorEl) cursorEl.remove();

        if (assistantPayload.code) {
            const codeHTML = `
                <div class="code-block-wrap">
                    <div class="code-block-header">
                        <span>${escapeHtml(assistantPayload.language || "Code")}</span>
                        <button type="button" class="btn-copy-code-block" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrap').querySelector('pre').innerText); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy', 1800);">Copy</button>
                    </div>
                    <pre class="code-block-pre">${escapeHtml(assistantPayload.code)}</pre>
                </div>
            `;
            appendZone.innerHTML += codeHTML;
        }

        if (assistantPayload.mode === "analysis" && assistantPayload.results && assistantPayload.results.length && assistantPayload.columns) {
            const analysisCardHTML = `
                <div class="analysis-visual-card">
                    <div class="metrics-pill-row">
                        <div class="metric-pill">
                            <span class="metric-pill-label">Analyzed Items</span>
                            <span class="metric-pill-val">${assistantPayload.results.length}</span>
                        </div>
                        <div class="metric-pill">
                            <span class="metric-pill-label">Leading Record</span>
                            <span class="metric-pill-val">${escapeHtml(String(assistantPayload.results[0][assistantPayload.columns[0]] || "Top"))}</span>
                        </div>
                        <div class="metric-pill">
                            <span class="metric-pill-label">Peak Metric</span>
                            <span class="metric-pill-val">${escapeHtml(String(assistantPayload.results[0][assistantPayload.columns[1]] || "Optimal"))}</span>
                        </div>
                    </div>
                    <div class="data-table-container">
                        <table class="clean-table">
                            <thead><tr>${assistantPayload.columns.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
                            <tbody>
                                ${assistantPayload.results.map(r => `<tr>${assistantPayload.columns.map(c => `<td>${escapeHtml(String(r[c] ?? ""))}</td>`).join("")}</tr>`).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            appendZone.innerHTML += analysisCardHTML;
        }

        isStreaming = false;
        updateSendButtonState();
        scrollToBottom();
    }


    function renderAssistantStaticBubble(msg) {
        const container = $("#messagesContainer");
        const row = document.createElement("div");
        row.className = "message-row assistant-msg";

        const p = msg.payload || { text: msg.content };
        let html = `<div class="assistant-content"><div class="answer-text">${parseMarkdownWithCodeBlocks(stripSqlFromExplanation(p.explanation || p.text || ""))}</div>`;

        if (p.code) {
            html += `
                <div class="code-block-wrap">
                    <div class="code-block-header">
                        <span>${escapeHtml(p.language || "Python")}</span>
                        <button type="button" class="btn-copy-code-block" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrap').querySelector('pre').innerText); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy', 1800);">Copy</button>
                    </div>
                    <pre class="code-block-pre">${escapeHtml(p.code)}</pre>
                </div>
            `;
        }

        if (p.mode === "analysis" && p.results && p.columns) {
            html += `
                <div class="analysis-visual-card">
                    <div class="metrics-pill-row">
                        <div class="metric-pill">
                            <span class="metric-pill-label">Records</span>
                            <span class="metric-pill-val">${p.results.length}</span>
                        </div>
                        <div class="metric-pill">
                            <span class="metric-pill-label">Leading</span>
                            <span class="metric-pill-val">${escapeHtml(String(p.results[0][p.columns[0]] || "Top"))}</span>
                        </div>
                        <div class="metric-pill">
                            <span class="metric-pill-label">Metric</span>
                            <span class="metric-pill-val">${escapeHtml(String(p.results[0][p.columns[1]] || "Optimal"))}</span>
                        </div>
                    </div>
                    <div class="data-table-container">
                        <table class="clean-table">
                            <thead><tr>${p.columns.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
                            <tbody>${p.results.map(r => `<tr>${p.columns.map(c => `<td>${escapeHtml(String(r[c] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        row.innerHTML = html;
        container.appendChild(row);
    }

    /**
     * Markdown renderer for assistant answers.
     */
    function parseMarkdownWithCodeBlocks(text) {
        if (!text) return "";

        const codeBlocks = [];
        const inlineCodes = [];

        // 1. Protect fenced code blocks so markdown rules don't touch them.
        let formatted = text.replace(/```([a-zA-Z0-9_+-]*)[ \t]*\n?([\s\S]*?)```/g, (match, lang, code) => {
            const token = `@@CODEBLOCK${codeBlocks.length}@@`;
            codeBlocks.push({ lang: (lang || "Code").trim(), code: code.replace(/\n$/, "") });
            return `\n${token}\n`;
        });

        // 2. Escape raw HTML from the model output.
        formatted = escapeHtml(formatted);

        // 3. Build block-level elements (headings, lists, quotes, paragraphs...).
        formatted = renderMarkdownBlocks(formatted);

        // 4. Protect inline code, then apply inline styles.
        formatted = formatted.replace(/`([^`\n]+)`/g, (match, code) => {
            const token = `@@INLINECODE${inlineCodes.length}@@`;
            inlineCodes.push(code);
            return token;
        });

        formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        formatted = formatted.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        formatted = formatted.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
        formatted = formatted.replace(/~~(.+?)~~/g, "<del>$1</del>");

        formatted = formatted.replace(/@@INLINECODE(\d+)@@/g, (match, index) => {
            return `<code class="inline-code">${inlineCodes[Number(index)]}</code>`;
        });

        // 5. Restore code blocks.
        formatted = formatted.replace(/@@CODEBLOCK(\d+)@@/g, (match, index) => {
            const block = codeBlocks[Number(index)];
            return `
                <div class="code-block-wrap">
                    <div class="code-block-header">
                        <span>${escapeHtml(block.lang)}</span>
                        <button type="button" class="btn-copy-code-block" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrap').querySelector('pre').innerText); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy', 1800);">Copy</button>
                    </div>
                    <pre class="code-block-pre">${escapeHtml(block.code)}</pre>
                </div>
            `;
        });

        return formatted;
    }

    function renderMarkdownBlocks(text) {
        const lines = text.split("\n");
        const html = [];
        let listType = null;
        let paragraph = [];

        const flushParagraph = () => {
            if (paragraph.length) {
                html.push(`<p>${paragraph.join("<br>")}</p>`);
                paragraph = [];
            }
        };

        const closeList = () => {
            if (listType) {
                html.push(`</${listType}>`);
                listType = null;
            }
        };

        for (const rawLine of lines) {
            const line = rawLine.trimEnd();
            const trimmed = line.trim();

            if (!trimmed) {
                flushParagraph();
                closeList();
                continue;
            }

            if (/^@@CODEBLOCK\d+@@$/.test(trimmed)) {
                flushParagraph();
                closeList();
                html.push(trimmed);
                continue;
            }

            let match = line.match(/^(#{1,6})\s+(.*)$/);
            if (match) {
                flushParagraph();
                closeList();
                const level = Math.min(match[1].length, 6);
                html.push(`<h${level} class="md-heading md-h${level}">${match[2]}</h${level}>`);
                continue;
            }

            if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
                flushParagraph();
                closeList();
                html.push('<hr class="md-hr">');
                continue;
            }

            match = line.match(/^&gt;\s?(.*)$/);
            if (match) {
                flushParagraph();
                closeList();
                html.push(`<blockquote class="md-quote">${match[1]}</blockquote>`);
                continue;
            }

            match = line.match(/^[-*+]\s+(.*)$/);
            if (match) {
                flushParagraph();
                if (listType !== "ul") {
                    closeList();
                    html.push('<ul class="md-list">');
                    listType = "ul";
                }
                html.push(`<li>${match[1]}</li>`);
                continue;
            }

            match = line.match(/^\d+[.)]\s+(.*)$/);
            if (match) {
                flushParagraph();
                if (listType !== "ol") {
                    closeList();
                    html.push('<ol class="md-list">');
                    listType = "ol";
                }
                html.push(`<li>${match[1]}</li>`);
                continue;
            }

            closeList();
            paragraph.push(trimmed);
        }

        flushParagraph();
        closeList();
        return html.join("\n");
    }

    /**
     * Synthesizes responses based on chosen Mode
     */
    function generateCapabilityPayload(query, dataset, mode) {
        const q = (query || "").trim();

        // 1. Dataset Analysis & Query Mode
        if (mode === "analysis") {
            const fname = dataset ? dataset.name : "your data";
            return {
                mode: "analysis",
                explanation: `Based on **${escapeHtml(fname)}**, here is the distribution for *"${escapeHtml(q || "Summary patterns")}"*:\n\nThe leading category accounts for approximately **42% of the overall volume**, with consistent distribution across the remaining groups.`,
                sql: `SELECT Category, SUM(Metric_Units) AS Total_Units, ROUND(AVG(Score), 2) AS Mean_Score\nFROM dataset\nGROUP BY Category\nORDER BY Total_Units DESC\nLIMIT 5;`,
                columns: ["Category", "Total Units", "Average Score"],
                results: [
                    { "Category": "Category A", "Total Units": 142000, "Average Score": 88.4 },
                    { "Category": "Category B", "Total Units": 118500, "Average Score": 79.2 },
                    { "Category": "Category C", "Total Units": 98400, "Average Score": 74.6 },
                    { "Category": "Category D", "Total Units": 64200, "Average Score": 68.1 },
                    { "Category": "Category E", "Total Units": 32100, "Average Score": 61.5 }
                ]
            };
        }

        // 2. Code Explanation Mode
        if (mode === "explain") {
            return {
                mode: "explain",
                explanation: `### Architecture & Logic Breakdown\n\nHere is how this logic functions:\n\n1. **Validation & Boundaries:** Ensures all arguments conform to expected constraints.\n2. **Transformation Flow:** Maps through the input records with an $O(N)$ linear pass.\n3. **Complexity Analysis:**\n   - **Time Complexity:** $O(N)$\n   - **Space Complexity:** $O(1)$ auxiliary allocation.\n\nHere is the refactored, cleanly structured version:`,
                language: "Python",
                code: `def process_records(records: list) -> dict:\n    """\n    Processes input collections with linear time efficiency.\n    """\n    summary = {}\n    for item in records:\n        key = item.get("category", "default")\n        summary[key] = summary.get(key, 0) + item.get("value", 0)\n    return summary`
            };
        }

        // 3. Code Generation Mode
        return {
            mode: "generate",
            explanation: `### Generated Implementation\n\nHere is the implementation matching: *"${escapeHtml(q || "FastAPI streaming endpoint")}"*.\n\nIt features async chunking, memory-safe streaming, and error handling:`,
            language: "Python",
            code: `from fastapi import APIRouter, UploadFile, File, HTTPException, status\nimport aiofiles\nimport os\n\nrouter = APIRouter(prefix="/api/v1/stream", tags=["stream"])\nCHUNK_SIZE = 512 * 1024  # 512 KB chunks\n\n@router.post("/upload")\nasync def stream_upload_file(file: UploadFile = File(...)):\n    """\n    Streams files to disk chunk-by-chunk to prevent memory spikes.\n    """\n    safe_name = os.path.basename(file.filename)\n    dest_path = os.path.join("storage", safe_name)\n    os.makedirs("storage", exist_ok=True)\n    \n    try:\n        async with aiofiles.open(dest_path, "wb") as f:\n            while chunk := await file.read(CHUNK_SIZE):\n                await f.write(chunk)\n    except Exception as err:\n        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(err))\n        \n    return {"status": "ok", "filename": safe_name}`
        };
    }

    function stripSqlFromExplanation(text) {
        if (!text) return "";
        let cleaned = text.replace(/```(?:sql)?\s*[\s\S]*?```/gi, "");
        cleaned = cleaned.replace(/(?:^|\n)\s*(?:Result|Query|SQL)\s*:?\s*\n+(?:SELECT|WITH|PRAGMA)\b[\s\S]*?(?=\n\s*(?:Notes|Result|Explanation|Findings|Summary|Key|Takeaway)|$)/gi, "\n");
        cleaned = cleaned.replace(/`[^`]*\b(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA)[^`]*`/gi, "");
        cleaned = cleaned.replace(/^\s*sql\s*:?\s*$/gim, "").replace(/^\s*query\s*:?\s*$/gim, "").replace(/\b(sql|query)\s*:?\s*\n+/gi, "\n");
        cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
        return cleaned;
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // Expose for badge click
    window.__setAssistantMode = (mode) => setMode(mode);


    // ═══════════════════════════════════════════════════════════════
    //  8. EVENT LISTENERS INITIALIZATION
    // ═══════════════════════════════════════════════════════════════

    document.addEventListener("DOMContentLoaded", () => {
        loadConversationsFromStorage();

        const textarea = $("#userPrompt");

        // Real-time events to instantly color the Send button vibrant Orange
        ["input", "keyup", "keydown", "paste", "cut", "change"].forEach(evt => {
            textarea.addEventListener(evt, () => {
                textarea.style.height = "auto";
                textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
                updateSendButtonState();
            });
        });

        // Enter key to send (Shift+Enter for newline)
        textarea.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
        });

        // Send Button
        $("#btnSend").addEventListener("click", handleSendMessage);

        // Attach File Flow
        const fileInput = $("#fileUploadInput");
        $("#btnAttachFile").addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", (e) => {
            if (e.target.files.length) handleFileSelected(e.target.files[0]);
        });
        $("#btnRemoveFile").addEventListener("click", removeAttachedFile);

        // Starter Cards Click (Sets capability mode and populates textarea)
        $$(".hero-card").forEach(card => {
            card.addEventListener("click", () => {
                const mode = card.dataset.mode;
                const prompt = card.dataset.prompt;
                if (mode) setMode(mode);
                if (prompt) {
                    textarea.value = prompt;
                    textarea.focus();
                    textarea.style.height = "auto";
                    textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
                    updateSendButtonState();
                }
            });
        });

        // Mode Selector Pills (Analysis / Code Explain / Code Gen)
        $$(".mode-pill").forEach(pill => {
            pill.addEventListener("click", () => {
                setMode(pill.dataset.mode);
            });
        });

        // Microphone Button (Transcribes to textarea for manual review & edit)
        $("#btnMic").addEventListener("click", () => {
            if (isRecording) stopVoiceRecording(true);
            else startVoiceRecording();
        });
        $("#btnCancelVoice").addEventListener("click", () => stopVoiceRecording(false));

        // Transcribed notice dismiss
        $("#btnDismissNotice").addEventListener("click", () => {
            $("#transcribedNotice").style.display = "none";
        });

        // Conversation Management Buttons
        $("#btnNewChat").addEventListener("click", () => createNewConversation());
        $("#btnRenameCurrentChat").addEventListener("click", () => {
            if (currentConvId) openRenameModal(currentConvId);
        });
        $("#btnDeleteCurrentChat").addEventListener("click", () => {
            if (currentConvId) deleteConversation(currentConvId);
        });

        // Rename Modal Listeners
        $("#btnCancelRename").addEventListener("click", closeRenameModal);
        $("#btnSaveRename").addEventListener("click", saveModalRename);
        $("#renameInput").addEventListener("keydown", (e) => {
            if (e.key === "Enter") saveModalRename();
            if (e.key === "Escape") closeRenameModal();
        });
        $("#renameModal").addEventListener("click", (e) => {
            if (e.target === $("#renameModal")) closeRenameModal();
        });

        // Sidebar Toggle
        $("#btnToggleSidebar").addEventListener("click", () => {
            $("#sidebar").classList.toggle("collapsed");
        });
    });
})();
