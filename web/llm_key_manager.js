import { app } from "/scripts/app.js";

const API_BASE = "";
const ENDPOINT_LIST = "/xiser/keys";
const ENDPOINT_SAVE = "/xiser/keys";
const ENDPOINT_DELETE = profile => `/xiser/keys/${encodeURIComponent(profile)}`;

function createElement(tag, className, props = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    Object.assign(el, props);
    return el;
}

function showToast(msg, isError = false) {
    const div = createElement("div", `xiser-toast ${isError ? "error" : ""}`, { innerText: msg });
    document.body.appendChild(div);
    setTimeout(() => div.classList.add("show"), 10);
    setTimeout(() => {
        div.classList.remove("show");
        setTimeout(() => div.remove(), 300);
    }, 2200);
}

async function apiFetch(url, options = {}) {
    const res = await fetch(API_BASE + url, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
    }
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch (err) {
        return {};
    }
}

class KeyManager {
    constructor() {
        this.modal = null;
        this.profileSelect = null;
        this.state = { profiles: [] };
        this.storageKey = "xiser.llm.profileMap"; // nodeId -> profile
    }

    async init() {
        this.injectStyles();
        this.createModal();
        await this.refresh();
    }

    injectStyles() {
        const style = document.createElement("style");
        style.textContent = `
        .xiser-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; z-index: 3000; }
        .xiser-modal { width: 520px; max-height: 80vh; background: #1e1e24; color: #f5f5f5; border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,0.35); display: flex; flex-direction: column; overflow: hidden; }
        .xiser-modal header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #2a2a30; border-bottom: 1px solid #333; }
        .xiser-modal header h3 { margin: 0; font-size: 15px; }
        .xiser-close { cursor: pointer; font-weight: bold; padding: 4px 8px; }
        .xiser-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
        .xiser-row { display: flex; gap: 8px; align-items: center; }
        .xiser-row label { min-width: 90px; font-size: 13px; color: #ccc; }
        .xiser-input, .xiser-select { flex: 1; padding: 8px; border-radius: 6px; border: 1px solid #444; background: #141419; color: #fff; }
        .xiser-btn { padding: 8px 12px; border-radius: 6px; border: none; background: #3a6ff7; color: #fff; cursor: pointer; }
        .xiser-btn.secondary { background: #3a3a40; color: #ddd; }
        .xiser-btn.danger { background: #c0392b; }
        .xiser-badge { background: #3a6ff7; color: #fff; padding: 2px 8px; border-radius: 999px; font-size: 12px; margin-left: 8px; }
        .xiser-instructions { max-height: 160px; overflow: auto; padding: 10px; border: 1px solid #333; border-radius: 8px; background: #111; line-height: 1.45; font-size: 13px; }
        .xiser-toast { position: fixed; bottom: -40px; left: 50%; transform: translateX(-50%); background: #2c2c2c; color: #fff; padding: 10px 16px; border-radius: 8px; opacity: 0; transition: all 0.3s; z-index: 4000; }
        .xiser-toast.error { background: #c0392b; }
        .xiser-toast.show { bottom: 24px; opacity: 1; }
        `;
        document.head.appendChild(style);
    }

    createModal() {
        const overlay = createElement("div", "xiser-modal-overlay");
        const modal = createElement("div", "xiser-modal");
        const header = createElement("header");
        header.appendChild(createElement("h3", "", { innerText: "XISER LLM Keys" }));
        const closeBtn = createElement("span", "xiser-close", { innerText: "✕" });
        closeBtn.onclick = () => this.toggleModal(false);
        header.appendChild(closeBtn);
        modal.appendChild(header);

        const body = createElement("div", "xiser-body");

        const rowProfile = createElement("div", "xiser-row");
        rowProfile.appendChild(createElement("label", "", { innerText: "Profile name" }));
        this.inputProfile = createElement("input", "xiser-input", { placeholder: "profile name" });
        rowProfile.appendChild(this.inputProfile);
        body.appendChild(rowProfile);

        const rowKey = createElement("div", "xiser-row");
        rowKey.appendChild(createElement("label", "", { innerText: "API Key" }));
        this.inputKey = createElement("input", "xiser-input", { placeholder: "sk-...", type: "password" });
        rowKey.appendChild(this.inputKey);
        body.appendChild(rowKey);

        const rowSave = createElement("div", "xiser-row");
        const saveBtn = createElement("button", "xiser-btn", { innerText: "Save" });
        saveBtn.onclick = () => this.saveKey();
        rowSave.appendChild(saveBtn);
        const overwriteInfo = createElement("small", "", { innerText: "Stored encrypted in ComfyUI/user/xiser_keys/" });
        rowSave.appendChild(overwriteInfo);
        body.appendChild(rowSave);

        const rowSelect = createElement("div", "xiser-row");
        rowSelect.appendChild(createElement("label", "", { innerText: "Select API key" }));
        this.profileSelect = createElement("select", "xiser-select");
        rowSelect.appendChild(this.profileSelect);
        body.appendChild(rowSelect);

        const rowDelete = createElement("div", "xiser-row");
        const delBtn = createElement("button", "xiser-btn danger", { innerText: "Delete profile" });
        delBtn.onclick = () => this.deleteSelected();
        rowDelete.appendChild(delBtn);
        body.appendChild(rowDelete);

        const instr = createElement("div", "xiser-instructions");
        instr.innerHTML = `
        <strong>Usage</strong><br>
        - Keys are stored encrypted in <code>ComfyUI/user/xiser_keys/</code> (never saved into workflows/projects).<br>
        - Open this panel from a node, pick an API key (Select API key); it applies only to that node (profile name is saved, key is not embedded).<br>
        - Text/vision: providers like <code>deepseek</code> / <code>qwen_vl</code> / <code>moonshot_vision</code> require a non-empty instruction; images must pair with text.<br>
        - Image generation: <code>qwen-image-edit-plus</code> uses reference image(s); size is optional (leave blank for auto). <code>qwen_image_plus</code> sizes allowed 1664*928, 1472*1140, 1328*1328, 1140*1472, 928*1664 (UI enforces).<br>
        - Seed: widget value is the actual seed; &ge;0 fixed, &lt;0 uses model default random.<br>
        `;
        body.appendChild(instr);

        modal.appendChild(body);
        overlay.appendChild(modal);
        overlay.onclick = e => { if (e.target === overlay) this.toggleModal(false); };
        this.modal = overlay;
        document.body.appendChild(overlay);
    }

    toggleModal(show) {
        this.modal.style.display = show ? "flex" : "none";
    }

    async refresh() {
        try {
            const data = await apiFetch(ENDPOINT_LIST);
            this.state.profiles = data.profiles || [];
            this.renderProfiles();
        } catch (err) {
            showToast(`Load keys failed: ${err.message}`, true);
        }
    }

    renderProfiles() {
        this.profileSelect.innerHTML = "";
        const empty = createElement("option", "", { value: "", innerText: "-- select --" });
        this.profileSelect.appendChild(empty);
        this.state.profiles.forEach(p => {
            const opt = createElement("option", "", { value: p, innerText: p });
            this.profileSelect.appendChild(opt);
        });
        this.restoreSelectionForActiveNode();
    }

    async saveKey() {
        const profile = this.inputProfile.value.trim();
        const key = this.inputKey.value.trim();
        if (!profile || !key) {
            showToast("Profile and key required", true);
            return;
        }
        try {
            await apiFetch(ENDPOINT_SAVE, {
                method: "POST",
                body: JSON.stringify({ profile, api_key: key, overwrite: true }),
            });
            this.inputProfile.value = "";
            this.inputKey.value = "";
            showToast("Saved");
            await this.refresh();
        } catch (err) {
            showToast(err.message || "Save failed", true);
        }
    }

    setActiveProfile(profile) {
        const activeNodeId = window.__XISER_ACTIVE_NODE_ID;
        if (!activeNodeId) {
            const event = new CustomEvent("xiser-llm-profile-changed", { detail: { profile } });
            window.dispatchEvent(event);
            return;
        }
        const raw = localStorage.getItem(this.storageKey);
        const map = raw ? JSON.parse(raw) : {};
        map[activeNodeId] = profile || "";
        localStorage.setItem(this.storageKey, JSON.stringify(map));
        const event = new CustomEvent("xiser-llm-profile-changed", { detail: { profile, nodeId: activeNodeId } });
        window.dispatchEvent(event);
    }

    handleSelectChange() {
        const profile = this.profileSelect.value;
        this.setActiveProfile(profile);
        if (profile) {
            showToast(`已切换为 ${profile} API key`);
        }
    }

    restoreSelectionForActiveNode() {
        const activeNodeId = window.__XISER_ACTIVE_NODE_ID;
        const raw = localStorage.getItem(this.storageKey);
        const map = raw ? JSON.parse(raw) : {};
        const profile = activeNodeId ? map[activeNodeId] : "";
        if (profile && this.state.profiles.includes(profile)) {
            this.profileSelect.value = profile;
        } else {
            this.profileSelect.value = "";
        }
    }

    async deleteSelected() {
        const profile = this.profileSelect.value;
        if (!profile) {
            showToast("Select a profile", true);
            return;
        }
        if (!confirm(`Delete profile '${profile}'?`)) return;
        try {
            await apiFetch(ENDPOINT_DELETE(profile), { method: "DELETE" });
            showToast("Deleted");
            await this.refresh();
        } catch (err) {
            showToast(err.message || "Delete failed", true);
        }
    }
}

app.registerExtension({
    name: "xiser.llm.keymanager",
    async setup() {
        const mgr = new KeyManager();
        await mgr.init();
        window.__XISER_KEY_MGR = mgr;

        // initialize selection change listener
        if (mgr.profileSelect) {
            mgr.profileSelect.onchange = () => mgr.handleSelectChange();
        }
    },
});
