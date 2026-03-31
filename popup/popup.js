const els = {
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  exportBtn: document.getElementById("exportBtn"),
  healthBtn: document.getElementById("healthBtn"),
  stage: document.getElementById("stage"),
  running: document.getElementById("running"),
  discovered: document.getElementById("discovered"),
  processed: document.getElementById("processed"),
  failed: document.getElementById("failed"),
  error: document.getElementById("error"),
  logBox: document.getElementById("logBox")
};

function log(message, asJson = false) {
  const line = `[${new Date().toLocaleTimeString()}] ${asJson ? JSON.stringify(message, null, 2) : message}`;
  els.logBox.textContent = `${line}\n${els.logBox.textContent}`.slice(0, 3000);
}

async function getActiveInstagramTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url?.includes("instagram.com")) {
    throw new Error("Открой Instagram tab");
  }
  return tab;
}

async function sendToContent(type, payload) {
  const tab = await getActiveInstagramTab();
  return chrome.tabs.sendMessage(tab.id, { type, payload });
}

function renderState(state) {
  const safe = state || {};
  els.stage.textContent = safe.stage || "idle";
  els.running.textContent = String(Boolean(safe.running));
  els.discovered.textContent = String(safe.discovered || 0);
  els.processed.textContent = String(safe.processed || 0);
  els.failed.textContent = String(safe.failed || 0);
  els.error.textContent = safe.lastError || "-";
}

async function refreshStatus() {
  try {
    const resp = await sendToContent("parser:getStatus");
    if (resp?.ok) renderState(resp.state);
  } catch (error) {
    log(error.message || "status error");
  }
}

els.startBtn.addEventListener("click", async () => {
  try {
    const resp = await sendToContent("parser:start", {});
    log(resp?.ok ? "Парсинг стартовал" : `Не стартовал: ${resp?.reason || "unknown"}`);
    await refreshStatus();
  } catch (error) {
    log(error.message || "start error");
  }
});

els.pauseBtn.addEventListener("click", async () => {
  try {
    await sendToContent("parser:pause");
    log("Пауза");
    await refreshStatus();
  } catch (error) {
    log(error.message || "pause error");
  }
});

els.resumeBtn.addEventListener("click", async () => {
  try {
    await sendToContent("parser:resume");
    log("Resume");
    await refreshStatus();
  } catch (error) {
    log(error.message || "resume error");
  }
});

els.healthBtn.addEventListener("click", async () => {
  try {
    const resp = await sendToContent("parser:healthCheck");
    log(resp?.health || { error: "no health data" }, true);
  } catch (error) {
    log(error.message || "health error");
  }
});

els.exportBtn.addEventListener("click", async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: "export:csv" });
    log(result?.ok ? `Экспортировано: ${result.count}, errors: ${result.failures}` : `Export fail: ${result?.reason || "unknown"}`);
  } catch (error) {
    log(error.message || "export error");
  }
});

refreshStatus();
setInterval(refreshStatus, 1200);
