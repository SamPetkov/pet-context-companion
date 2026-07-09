const speechText = document.querySelector('#speech-text');
const contextValue = document.querySelector('#context-value');
const contextMeter = document.querySelector('#context-meter');
const contextDetail = document.querySelector('#context-detail');
const taskState = document.querySelector('#task-state');
const inputTokens = document.querySelector('#input-tokens');
const outputTokens = document.querySelector('#output-tokens');
const audioToggle = document.querySelector('#audio-toggle');
const refreshButton = document.querySelector('#refresh');
const dismissButton = document.querySelector('#dismiss');

const state = {
  audioEnabled: localStorage.getItem('pet-companion-audio') === 'on',
  spokenKey: null,
};

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

function formatTokens(value) {
  if (!Number.isFinite(value)) {
    return 'not available';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  }
  return String(value);
}

function getSpeech(task) {
  if (!task) {
    return 'Waiting for a Codex task.';
  }
  if (task.context.percent === null) {
    return task.title;
  }
  return task.title;
}

function speak(task, key) {
  if (!state.audioEnabled || state.spokenKey === key || !('speechSynthesis' in window)) {
    return;
  }
  state.spokenKey = key;
  window.speechSynthesis.cancel();
  const sentence = task?.context.percent === null
    ? `${task.title} is ${task.status}. Context count is waiting.`
    : `${task.title} is ${task.status}. Context is ${task.context.percent} percent full.`;
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(sentence));
}

function redrawIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
  }
}

function updateAudioButton() {
  const iconName = state.audioEnabled ? 'volume-2' : 'volume-x';
  const label = state.audioEnabled ? 'Disable spoken updates' : 'Enable spoken updates';
  audioToggle.title = label;
  audioToggle.setAttribute('aria-label', label);
  audioToggle.innerHTML = `<i data-lucide="${iconName}"></i>`;
  redrawIcons();
}

function render(overview) {
  const tasks = overview.tasks || [];
  const activeTask = tasks.find((task) => task.status === 'working') || tasks[0];
  const speech = getSpeech(activeTask);
  speechText.textContent = speech;
  taskState.textContent = activeTask ? (activeTask.status === 'working' ? 'Working' : 'Idle') : 'Waiting';
  inputTokens.textContent = `Input ${formatTokens(activeTask?.tokens.input)}`;
  outputTokens.textContent = `Output ${formatTokens(activeTask?.tokens.output)}`;

  if (activeTask?.context.percent !== null && activeTask?.context.percent !== undefined) {
    const percent = activeTask.context.percent;
    contextValue.textContent = `${percent}% full`;
    contextDetail.textContent = `${formatTokens(activeTask.context.used)} / ${formatTokens(activeTask.context.window)} tokens`;
    contextMeter.style.width = `${percent}%`;
    contextMeter.style.background = percent >= 80 ? '#d96f5f' : percent >= 55 ? '#e5a447' : '#53a985';
  } else {
    contextValue.textContent = 'Waiting';
    contextDetail.textContent = 'Waiting for a token-count event';
    contextMeter.style.width = '0%';
    contextMeter.style.background = '#53a985';
  }

  const speechKey = activeTask ? `${activeTask.id}:${activeTask.status}:${activeTask.context.percent}` : 'empty';
  speak(activeTask, speechKey);
  redrawIcons();
}

async function refresh() {
  refreshButton.disabled = true;
  try {
    render(await window.petCompanion.getOverview());
  } finally {
    refreshButton.disabled = false;
  }
}

audioToggle.addEventListener('click', () => {
  state.audioEnabled = !state.audioEnabled;
  localStorage.setItem('pet-companion-audio', state.audioEnabled ? 'on' : 'off');
  if (state.audioEnabled) {
    state.spokenKey = null;
    window.petCompanion.getOverview().then(render);
  } else if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  updateAudioButton();
});
refreshButton.addEventListener('click', refresh);
dismissButton.addEventListener('click', () => window.petCompanion.hide());

window.petCompanion.onOverview(render);
updateAudioButton();
refresh();
