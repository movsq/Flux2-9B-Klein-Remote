<script>
  import { generateCode, listCodes, deleteCode } from '../lib/api.js';

  let { token, onClose } = $props();

  let codes = $state([]);
  let loading = $state(true);
  let generating = $state(false);
  let error = $state('');
  let copyFeedback = $state(null); // code id that was just copied

  // Config for new code
  let usesRemaining = $state(1);
  let expiresInHours = $state('');
  let codeType = $state('registration');

  // Load codes on mount
  $effect(() => {
    loadCodes();
  });

  async function loadCodes() {
    loading = true;
    try {
      codes = await listCodes(token);
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function handleGenerate() {
    generating = true;
    error = '';
    try {
      const expiry = expiresInHours ? parseInt(expiresInHours, 10) : null;
      await generateCode(token, {
        type: codeType,
        usesRemaining: usesRemaining || null,
        expiresInHours: expiry,
      });
      await loadCodes();
    } catch (err) {
      error = err.message;
    } finally {
      generating = false;
    }
  }

  async function handleDelete(id) {
    try {
      await deleteCode(token, id);
      codes = codes.filter(c => c.id !== id);
    } catch (err) {
      error = err.message;
    }
  }

  async function handleCopy(code, id) {
    await navigator.clipboard.writeText(code);
    copyFeedback = id;
    setTimeout(() => { if (copyFeedback === id) copyFeedback = null; }, 1500);
  }

  function formatExpiry(expiresAt) {
    if (!expiresAt) return 'Never';
    const d = new Date(expiresAt);
    if (Date.now() > expiresAt) return 'Expired';
    const hours = Math.round((expiresAt - Date.now()) / 3600_000);
    if (hours < 1) return '<1h left';
    if (hours < 24) return `${hours}h left`;
    return `${Math.round(hours / 24)}d left`;
  }

  function isExpired(code) {
    return code.expiresAt && Date.now() > code.expiresAt;
  }

  function isDepleted(code) {
    return code.usesRemaining !== null && code.usesRemaining <= 0;
  }

  // Click-outside action
  function clickOutside(node, callback) {
    const handle = (e) => { if (!node.contains(e.target)) callback(); };
    document.addEventListener('pointerdown', handle, true);
    return { destroy() { document.removeEventListener('pointerdown', handle, true); } };
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<div
  class="admin-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Admin Panel"
  tabindex="-1"
  onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
>
  <div class="admin-panel" use:clickOutside={onClose}>
    <div class="admin-handle"></div>
    <div class="admin-header">
      <span class="admin-title">INVITE CODES</span>
      <button class="admin-close" type="button" onclick={onClose} aria-label="Close">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>

    <div class="admin-body">
      <!-- Generate section -->
      <div class="gen-section">
        <span class="section-label">GENERATE NEW CODE</span>
        <div class="gen-row">
          <div class="gen-field">
            <label class="field-label" for="admin-uses">USES</label>
            <input id="admin-uses" type="number" min="1" step="1" bind:value={usesRemaining} placeholder="∞" />
          </div>
          <div class="gen-field">
            <label class="field-label" for="admin-expiry">EXPIRES (HOURS)</label>
            <input id="admin-expiry" type="number" min="1" step="1" bind:value={expiresInHours} placeholder="Never" />
          </div>
        </div>
        <button class="btn-gen" disabled={generating} onclick={handleGenerate}>
          {generating ? 'GENERATING…' : 'GENERATE CODE'}
        </button>
      </div>

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <!-- Code list -->
      <div class="code-list">
        {#if loading}
          <p class="empty">Loading…</p>
        {:else if codes.length === 0}
          <p class="empty">No codes generated yet.</p>
        {:else}
          {#each codes as code (code.id)}
            <div class="code-item" class:code-inactive={isExpired(code) || isDepleted(code)}>
              <div class="code-main">
                <span class="code-value">{code.code}</span>
                <div class="code-meta">
                  <span>{code.usesRemaining !== null ? `${code.usesRemaining} uses` : '∞ uses'}</span>
                  <span class="separator">·</span>
                  <span>{formatExpiry(code.expiresAt)}</span>
                </div>
              </div>
              <div class="code-actions">
                <button class="btn-icon" onclick={() => handleCopy(code.code, code.id)} aria-label="Copy code">
                  {#if copyFeedback === code.id}
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7.5l2.5 2.5L11 4" stroke="#7b9cbf" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  {:else}
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5" stroke="currentColor" stroke-width="1.2"/></svg>
                  {/if}
                </button>
                <button class="btn-icon btn-delete" onclick={() => handleDelete(code.id)} aria-label="Revoke code">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .admin-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    animation: admin-backdrop-in 0.22s ease both;
  }

  @keyframes admin-backdrop-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .admin-panel {
    width: 100%;
    max-width: 440px;
    background: rgba(14, 14, 18, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1.25rem 1.25rem 0 0;
    padding: 0 1.75rem 1.75rem;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    display: flex;
    flex-direction: column;
    gap: 0;
    max-height: 85dvh;
    overflow: hidden;
    animation: admin-sheet-up 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes admin-sheet-up {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }

  @media (min-width: 600px) {
    .admin-backdrop { align-items: center; }
    .admin-panel {
      border-radius: 1.25rem;
      max-height: 80vh;
      animation: admin-panel-in 0.24s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    @keyframes admin-panel-in {
      from { transform: scale(0.96) translateY(-6px); opacity: 0; }
      to   { transform: scale(1)    translateY(0);    opacity: 1; }
    }
  }

  .admin-handle {
    width: 2.5rem;
    height: 3px;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.12);
    align-self: center;
    margin: 1rem 0 0.75rem;
    flex-shrink: 0;
  }

  @media (min-width: 600px) {
    .admin-handle { display: none; }
  }

  .admin-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 0;
    flex-shrink: 0;
  }

  @media (min-width: 600px) {
    .admin-header { padding-top: 1.5rem; }
  }

  .admin-title {
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.22em;
    color: #7b9cbf;
  }

  .admin-close {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.05);
    color: #a4afbb;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.12s ease, filter 0.12s ease, background 0.2s, color 0.2s;
    flex-shrink: 0;
  }
  .admin-close:hover { background: rgba(255, 255, 255, 0.1); color: #e4e4e7; }
  .admin-close:active { transform: scale(0.88); filter: brightness(0.85); }

  .admin-body {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
  }
  .admin-body::-webkit-scrollbar { width: 4px; }
  .admin-body::-webkit-scrollbar-track { background: transparent; }
  .admin-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

  .gen-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section-label {
    font-family: 'DM Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.2em;
    color: #6c7585;
  }

  .gen-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  .gen-field {
    display: flex;
    flex-direction: column;
  }

  .field-label {
    display: block;
    font-family: 'DM Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.18em;
    color: #8b96a6;
    margin-bottom: 0.35rem;
  }

  input[type='number'] {
    padding: 0.65rem 0.875rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.75rem;
    background: rgba(255, 255, 255, 0.05);
    color: #e4e4e7;
    font-family: 'DM Mono', monospace;
    font-size: 0.85rem;
    outline: none;
    width: 100%;
    transition: border-color 0.2s;
    -moz-appearance: textfield;
    -webkit-appearance: textfield;
    appearance: textfield;
  }

  input[type='number']::-webkit-inner-spin-button,
  input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  input[type='number']::placeholder { color: #6c7585; }
  input[type='number']:focus { border-color: rgba(123, 156, 191, 0.4); }

  .btn-gen {
    padding: 0.8rem;
    border: none;
    border-radius: 3rem;
    background: #7b9cbf;
    color: #09090b;
    font-family: 'DM Mono', monospace;
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    cursor: pointer;
    transition: transform 0.12s ease, filter 0.12s ease, background 0.2s;
  }
  .btn-gen:hover:not(:disabled) { background: #a3bdd4; }
  .btn-gen:active:not(:disabled) { transform: scale(0.96); filter: brightness(0.85); }
  .btn-gen:disabled { opacity: 0.5; cursor: not-allowed; }

  .error {
    font-family: 'DM Mono', monospace;
    color: #c47070;
    font-size: 0.75rem;
    margin: 0;
  }

  .code-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .empty {
    font-family: 'DM Mono', monospace;
    font-size: 0.75rem;
    color: #6c7585;
    margin: 0;
    text-align: center;
    padding: 1rem 0;
  }

  .code-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.65rem 0.875rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.75rem;
    transition: opacity 0.2s;
  }

  .code-inactive {
    opacity: 0.4;
  }

  .code-main {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .code-value {
    font-family: 'DM Mono', monospace;
    font-size: 0.8rem;
    color: #e4e4e7;
    letter-spacing: 0.08em;
  }

  .code-meta {
    font-family: 'DM Mono', monospace;
    font-size: 0.62rem;
    color: #6c7585;
    letter-spacing: 0.04em;
    display: flex;
    gap: 0.3rem;
  }

  .separator {
    color: #525a66;
  }

  .code-actions {
    display: flex;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .btn-icon {
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: transparent;
    color: #8b96a6;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.12s ease, background 0.2s, color 0.2s;
  }
  .btn-icon:hover { background: rgba(255, 255, 255, 0.08); color: #e4e4e7; }
  .btn-icon:active { transform: scale(0.88); }

  .btn-delete:hover { color: #c47070; }

  @media (hover: none) and (pointer: coarse) {
    input[type='number'] { font-size: 16px !important; }
  }
</style>
