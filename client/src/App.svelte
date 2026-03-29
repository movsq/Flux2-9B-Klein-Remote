<script>
  import Login from './components/Login.svelte';
  import Submit from './components/Submit.svelte';
  import Result from './components/Result.svelte';
  import { createPhoneWS } from './lib/ws.js';
  import { onDestroy } from 'svelte';

  function randomSeed() {
    return Math.floor(Math.random() * 2 ** 32);
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let token = $state(null);
  let ws = $state(null);
  let view = $state('login');        // 'login' | 'submit'
  let currentAesKey = $state(null);
  let currentResult = $state(null);
  let wsError = $state('');
  let showModal = $state(false);

  // Seed + mode are owned here so they survive cycles
  let seed = $state(randomSeed());
  let seedMode = $state('randomize');

  // ── Login ──────────────────────────────────────────────────────────────────
  function handleLogin(newToken) {
    token = newToken;
    view = 'submit';

    ws = createPhoneWS(token);

    ws.on('queued', ({ jobId }) => {
      console.log(`[app] Job queued: ${jobId}`);
    });

    ws.on('result', (msg) => {
      currentResult = msg;
      showModal = true;
    });

    ws.on('error', ({ message }) => {
      wsError = message ?? 'Unknown error';
    });

    ws.on('no_pc', () => {
      wsError = 'PC is not connected to the relay.';
    });

    ws.on('close', () => {
      wsError = 'Connection lost — reconnecting…';
    });

    ws.on('open', () => {
      wsError = '';
    });
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  function handleJobSubmitted({ aesKey }) {
    currentAesKey = aesKey;
  }

  // ── Modal close (keeps result for Preview button) ──────────────────────────
  function handleClose() {
    showModal = false;
  }

  // ── New Job (clears result entirely) ──────────────────────────────────────
  function handleDone() {
    if (seedMode === 'randomize') seed = randomSeed();
    else if (seedMode === 'increment') seed = seed + 1;
    else if (seedMode === 'decrement') seed = seed - 1;

    currentResult = null;
    currentAesKey = null;
    wsError = '';
    showModal = false;
  }

  onDestroy(() => ws?.close());
</script>

<div class="app">
  {#if wsError && view !== 'login'}
    <div class="ws-banner">{wsError}</div>
  {/if}

  {#if view === 'login'}
    <Login onLogin={handleLogin} />
  {:else if view === 'submit'}
    <Submit
      {token} {ws}
      onJobSubmitted={handleJobSubmitted}
      bind:seed bind:seedMode
      previewResult={currentResult}
      onPreview={() => showModal = true}
      onNewJob={handleDone}
    />
  {/if}

  {#if showModal && currentResult}
    <Result result={currentResult} aesKey={currentAesKey} onDone={handleDone} onClose={handleClose} />
  {/if}
</div>

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  :global(html, body) {
    overflow-x: hidden;
    overscroll-behavior-x: none;
  }

  :global(body) {
    margin: 0;
    font-family: 'Syne', system-ui, sans-serif;
    background: #09090b;
    background-image:
      linear-gradient(rgba(123, 156, 191, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(123, 156, 191, 0.03) 1px, transparent 1px);
    background-size: 48px 48px;
    color: #e4e4e7;
    -webkit-font-smoothing: antialiased;
  }

  .app {
    min-height: 100dvh;
    touch-action: pan-y;
  }

  .ws-banner {
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    color: #c4996a;
    font-family: 'DM Mono', monospace;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    padding: 0.5rem 1rem;
    text-align: center;
  }
</style>
