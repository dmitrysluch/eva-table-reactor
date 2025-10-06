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
    await downloadCsv(response.tableName, response.csv)
    setStatus('Export finished.');
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

function downloadCsv(tableName, csv) {
    console.log('Download initiated', { tableName: tableName });
    const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
    const filename = `${tableName || 'table'}-${timestamp}.csv`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      browserApi.downloads.download({ url, filename }, () => {
        URL.revokeObjectURL(url);
        if (browserApi.notifications) {
            browserApi.notifications.create({
              type: 'basic',
              iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAPCAYAAADJViUEAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAKZJREFUeNpi/P//PwMlgImBQjDwZ2Bg+M/AwPCfgRFBxMAEI5gGiF7g4GAJEM0H4jLg3E8QHYh4D4g2E8QbYh4P8AZj1gYkApGoG4D4jLg/EcQfYgYF4B4nIgxF8j0MWYDEQJxF8nsT0A8jkYH4HxAdTHEDsT0D8nFgfgfED1McQOxPQPyKQMDIYw1iArElgPgeEmYg2E8QHYg6AsT2AzEqg/ExKDvD8T8QUXgk0EoGgFgQwAAAwBcvxjzoWJt6gAAAABJRU5ErkJggg==',
              title: 'Eva Table Reactor',
              message: `Export for ${table.name} completed (${dates.length} date${dates.length === 1 ? '' : 's'}).`,
            });
          }
        resolve();
      });
    });
  }
