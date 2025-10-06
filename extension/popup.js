const browserApi = window.browser ?? window.chrome;

function sendMessage(payload) {
  return new Promise((resolve) => {
    browserApi.runtime.sendMessage(payload, (response) => {
      resolve(response || {});
    });
  });
}

function setStatus(message) {
  const status = document.getElementById('status');
  if (status) {
    status.textContent = message || '';
  }
}

function parseDates(value) {
  return value
    .split(/\r?\n|,/) // split on newline or comma
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadTables() {
  const select = document.getElementById('tableSelect');
  select.innerHTML = '';
  const response = await sendMessage({ type: 'GET_ALL_TABLES' });
  const tables = response.tables || [];
  tables.forEach((table) => {
    const option = document.createElement('option');
    option.value = table.id;
    option.textContent = table.name;
    select.appendChild(option);
  });
  const exportButton = document.getElementById('exportButton');
  const dates = parseDates(document.getElementById('dateInput').value);
  exportButton.disabled = tables.length === 0 || !select.value || !dates.length;
  if (!tables.length) {
    setStatus('Create a table from a page before exporting.');
  } else {
    setStatus('');
  }
}

async function handleExport() {
  const select = document.getElementById('tableSelect');
  const tableId = select.value;
  const dates = parseDates(document.getElementById('dateInput').value);
  if (!tableId) {
    setStatus('Choose an output table first.');
    return;
  }
  if (!dates.length) {
    setStatus('Provide at least one date.');
    return;
  }
  setStatus('Starting export in background…');
  const response = await sendMessage({
    type: 'EXPORT_TABLE',
    tableId,
    dates,
  });
  if (response.error) {
    setStatus(`Export failed: ${response.error}`);
  } else {
    setStatus('Export started. You will receive a download when finished.');
  }
}

function initialize() {
  loadTables();
  document.getElementById('dateInput').addEventListener('input', () => {
    const dates = parseDates(document.getElementById('dateInput').value);
    const exportButton = document.getElementById('exportButton');
    exportButton.disabled = !document.getElementById('tableSelect').value || !dates.length;
  });
  document.getElementById('tableSelect').addEventListener('change', () => {
    const dates = parseDates(document.getElementById('dateInput').value);
    const exportButton = document.getElementById('exportButton');
    exportButton.disabled = !document.getElementById('tableSelect').value || !dates.length;
  });
  document.getElementById('exportButton').addEventListener('click', handleExport);
  document.getElementById('manageLink').addEventListener('click', (event) => {
    event.preventDefault();
    if (browserApi.runtime.openOptionsPage) {
      browserApi.runtime.openOptionsPage();
    } else {
      window.open(browserApi.runtime.getURL('options.html'));
    }
  });
}

document.addEventListener('DOMContentLoaded', initialize);
