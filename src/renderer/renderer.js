const cloudStage = document.querySelector('#cloud-stage');
const frontCloud = document.querySelector('#front-cloud');
const backCloud = document.querySelector('#back-cloud');
const gridStage = document.querySelector('#grid-stage');
const viewToggle = document.querySelector('#view-toggle');
const usagePodium = document.querySelector('#usage-podium');
const quotaRows = document.querySelector('#quota-rows');
const agentCount = document.querySelector('#agent-count');
const resetCount = document.querySelector('#reset-count');
const planLabel = document.querySelector('#plan-label');
const dreamSparkleOne = document.querySelector('.dream-sparkle--one');
const dreamSparkleTwo = document.querySelector('.dream-sparkle--two');

const PAGE_SIZE = 3;
const ROTATE_MS = 6_500;
const state = {
  overview: null,
  page: 0,
  voiceEnabled: localStorage.getItem('pet-companion-audio') !== 'off',
  lastTaskKey: '',
  viewMode: 'cloud',
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
    return '--';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  }
  return String(value);
}

function chunk(tasks) {
  const pages = [];
  for (let index = 0; index < tasks.length; index += PAGE_SIZE) {
    pages.push(tasks.slice(index, index + PAGE_SIZE));
  }
  return pages.length ? pages : [[]];
}

function cloudMarkup(tasks, page, total) {
  if (!tasks.length) {
    return '<p class="empty-cloud">No recent Codex workspaces found.</p>';
  }

  const rows = tasks.map((task) => {
    const context = task.context.percent === null ? 'Waiting' : `${task.context.percent}%`;
    const contextClass = task.context.percent === null ? 'repo-context--unknown' : '';
    const repo = task.workspace || task.title;
    return `
      <article class="repo-row">
        <span class="repo-name" title="${escapeHtml(repo)}">${escapeHtml(repo)}</span>
        <span class="repo-context ${contextClass}">${context}</span>
        <span class="repo-task" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
        <div class="repo-meta">
          <strong>${task.status === 'working' ? 'Working' : 'Idle'}</strong>
          <span>${formatTokens(task.context.used)} / ${formatTokens(task.context.window)}</span>
          <span>In ${formatTokens(task.tokens.input)} Out ${formatTokens(task.tokens.output)}</span>
        </div>
      </article>
    `;
  }).join('');

  return `
    <div class="cloud-eyebrow"><span>THOUGHTS</span><span>${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} / ${total}</span></div>
    <div class="repo-list">${rows}</div>
  `;
}

function gridMarkup(tasks) {
  if (!tasks.length) {
    return '<p class="empty-cloud">No recent Codex workspaces found.</p>';
  }

  const rows = tasks.map((task) => {
    const context = task.context.percent === null ? 'Waiting' : `${task.context.percent}%`;
    const contextClass = task.context.percent === null ? 'repo-context--unknown' : '';
    const repo = task.workspace || task.title;
    return `
      <article class="repo-row">
        <span class="repo-name" title="${escapeHtml(repo)}">${escapeHtml(repo)}</span>
        <span class="repo-context ${contextClass}">${context}</span>
        <span class="repo-task" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
        <div class="repo-meta">
          <strong>${task.status === 'working' ? 'Working' : 'Idle'}</strong>
          <span>${formatTokens(task.context.used)} / ${formatTokens(task.context.window)}</span>
          <span>In ${formatTokens(task.tokens.input)} Out ${formatTokens(task.tokens.output)}</span>
        </div>
      </article>
    `;
  }).join('');

  return `
    <div class="cloud-eyebrow" style="margin-bottom:16px;"><span>ALL WORKSPACES</span><span>${tasks.length} total</span></div>
    <div class="repo-list">${rows}</div>
  `;
}

function humanReset(seconds) {
  if (!Number.isFinite(seconds)) {
    return 'Reset time unavailable';
  }
  const milliseconds = (seconds * 1000) - Date.now();
  if (milliseconds <= 0) {
    return 'Resetting now';
  }
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) {
    return `Resets in ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 48) {
    return `Resets in ${hours}h ${remainder}m`;
  }
  return `Resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function quotaLabel(window, fallback) {
  if (window?.windowDurationMins === 300) {
    return '5 HOUR';
  }
  if (window?.windowDurationMins === 10_080) {
    return 'WEEK';
  }
  return fallback;
}

function quotaFillClass(percent) {
  if (percent >= 80) {
    return 'quota-fill--high';
  }
  if (percent >= 55) {
    return 'quota-fill--watch';
  }
  return '';
}

function quotaMarkup(window, fallback) {
  const percent = Number.isFinite(window?.usedPercent) ? window.usedPercent : null;
  const label = quotaLabel(window, fallback);
  return `
    <div class="quota-row">
      <span class="quota-label">${label}</span>
      <span class="quota-track"><span class="quota-fill ${percent === null ? '' : quotaFillClass(percent)}" style="width: ${percent ?? 0}%"></span></span>
      <span class="quota-percent">${percent === null ? '--' : `${percent}%`}</span>
      <span class="quota-reset">${humanReset(window?.resetsAt)}</span>
    </div>
  `;
}

function positionClouds(layout) {
  const pet = layout?.pet || { x: 670, y: 300 };
  const side = layout?.cloudSide || 'left';
  const stageX = side === 'left'
    ? Math.max(12, pet.x - 660)
    : Math.min(window.innerWidth - 410, pet.x + 42);
  const stageY = Math.max(12, Math.min(window.innerHeight - 345, pet.y - 238));
  const podiumX = Math.max(12, Math.min(window.innerWidth - 332, pet.x - 160));
  const gridX = side === 'left'
    ? Math.max(12, Math.min(window.innerWidth - 572, pet.x - 650))
    : Math.max(12, Math.min(window.innerWidth - 572, pet.x + 54));
  const gridY = Math.max(12, Math.min(window.innerHeight - 420, pet.y - 236));
  const podiumY = state.viewMode === 'grid'
    ? Math.max(gridY + 380, Math.min(window.innerHeight - 170, pet.y + 74))
    : Math.max(360, Math.min(window.innerHeight - 170, pet.y + 74));

  cloudStage.style.left = `${Math.round(stageX)}px`;
  cloudStage.style.top = `${Math.round(stageY)}px`;
  cloudStage.dataset.side = side;
  usagePodium.style.left = `${Math.round(podiumX)}px`;
  usagePodium.style.top = `${Math.round(podiumY)}px`;
  gridStage.style.left = `${Math.round(gridX)}px`;
  gridStage.style.top = `${Math.round(gridY)}px`;

  viewToggle.style.left = `${Math.round(pet.x + 38)}px`;
  viewToggle.style.top = `${Math.round(pet.y - 48)}px`;
  dreamSparkleOne.style.left = `${Math.round(pet.x + 70)}px`;
  dreamSparkleOne.style.top = `${Math.round(pet.y - 58)}px`;
  dreamSparkleTwo.style.left = `${Math.round(pet.x + 16)}px`;
  dreamSparkleTwo.style.top = `${Math.round(pet.y - 70)}px`;
}

function renderPodium(overview) {
  const quotas = overview.quotas || {};
  quotaRows.innerHTML = `${quotaMarkup(quotas.primary, '5 HOUR')}${quotaMarkup(quotas.secondary, 'WEEK')}`;
  agentCount.textContent = overview.agents?.active ?? 0;
  resetCount.textContent = quotas.resetCredits ?? 'N/A';
  planLabel.textContent = quotas.plan ? quotas.plan.toUpperCase() : 'ACCOUNT';
}

function redrawIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
  }
}

function voiceBriefing() {
  if (!state.voiceEnabled || !state.overview || !('speechSynthesis' in window)) {
    return;
  }
  const pages = chunk(state.overview.tasks || []);
  const visible = pages[state.page] || [];
  const agents = state.overview.agents?.active ?? 0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(
    `Showing ${visible.length} workspaces. ${agents} ${agents === 1 ? 'agent' : 'agents'} active.`,
  ));
}

function render(cycling = false) {
  if (!state.overview) {
    return;
  }

  const tasks = state.overview.tasks || [];

  if (state.viewMode === 'grid') {
    cloudStage.hidden = true;
    gridStage.hidden = false;
    gridStage.innerHTML = gridMarkup(tasks);
  } else {
    cloudStage.hidden = false;
    gridStage.hidden = true;

    const pages = chunk(tasks);
    state.page %= pages.length;
    frontCloud.innerHTML = cloudMarkup(pages[state.page], state.page, tasks.length);
    backCloud.innerHTML = pages.length > 1
      ? cloudMarkup(pages[(state.page + 1) % pages.length], (state.page + 1) % pages.length, tasks.length)
      : '';
    backCloud.hidden = pages.length < 2;
    cloudStage.classList.toggle('is-cycling', cycling);
    if (cycling) {
      setTimeout(() => cloudStage.classList.remove('is-cycling'), 560);
    }
  }

  positionClouds(state.overview.layout);
  renderPodium(state.overview);
  redrawIcons();
}

function updateOverview(overview) {
  const nextKey = (overview.tasks || []).map((task) => task.id).join('|');
  if (nextKey !== state.lastTaskKey) {
    state.page = 0;
    state.lastTaskKey = nextKey;
  }
  state.overview = overview;
  render();
}

setInterval(() => {
  if (state.viewMode === 'grid') return; // Pause carousel in grid view
  const pages = chunk(state.overview?.tasks || []);
  if (pages.length > 1) {
    state.page = (state.page + 1) % pages.length;
    render(true);
    voiceBriefing();
  }
}, ROTATE_MS);

viewToggle.addEventListener('click', () => {
  state.viewMode = state.viewMode === 'cloud' ? 'grid' : 'cloud';
  const expanded = state.viewMode === 'grid';
  viewToggle.setAttribute('aria-pressed', String(expanded));
  viewToggle.setAttribute('aria-label', expanded ? 'Show cycling workspaces' : 'Show all workspaces');
  viewToggle.title = expanded ? 'Show cycling workspaces' : 'Show all workspaces';
  render();
});

viewToggle.addEventListener('mouseenter', () => {
  if (window.petCompanion.setIgnoreMouseEvents) {
    window.petCompanion.setIgnoreMouseEvents(false);
  }
});
viewToggle.addEventListener('mouseleave', () => {
  if (window.petCompanion.setIgnoreMouseEvents) {
    window.petCompanion.setIgnoreMouseEvents(true);
  }
});

window.petCompanion.onOverview(updateOverview);
window.petCompanion.onVoiceToggle(() => {
  state.voiceEnabled = !state.voiceEnabled;
  localStorage.setItem('pet-companion-audio', state.voiceEnabled ? 'on' : 'off');
  if (state.voiceEnabled) {
    voiceBriefing();
  } else if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
});
window.petCompanion.getOverview().then(updateOverview);
