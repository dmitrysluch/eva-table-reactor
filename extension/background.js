const browserApi = typeof browser !== 'undefined' ? browser : chrome;

async function getState() {
  const data = await browserApi.storage.local.get({ tables: [] });
  return data;
}

async function setState(state) {
  await browserApi.storage.local.set(state);
}

function normalizeUrlInfo(urlString) {
  try {
    const url = new URL(urlString);
    return {
      origin: url.origin,
      pathname: url.pathname,
    };
  } catch (error) {
    return null;
  }
}

function ensureTableDefaults(table, sourceUrl) {
  const normalized = normalizeUrlInfo(sourceUrl || table.urlTemplate || table.page?.origin + table.page?.pathname || '');
  return {
    id: table.id,
    name: table.name,
    urlTemplate: table.urlTemplate || sourceUrl || '',
    page: table.page || normalized || { origin: '', pathname: '' },
    tableSelector: table.tableSelector || '',
    dataSection: table.dataSection || 'tbody',
    columns: table.columns || [],
  };
}

async function getTables() {
  const { tables } = await getState();
  return tables.map((table) => ensureTableDefaults(table));
}

async function saveTables(tables) {
  await setState({ tables });
}

function findTableIndex(tables, tableId) {
  return tables.findIndex((table) => table.id === tableId);
}

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function handleGetTablesForUrl(message) {
  const tables = await getTables();
  const { origin, pathname } = normalizeUrlInfo(message.url) || {};
  return tables.filter((table) => {
    if (!origin || !pathname) {
      return false;
    }
    if (!table.page) {
      return false;
    }
    return table.page.origin === origin && table.page.pathname === pathname;
  });
}

async function handleCreateTable(message) {
  const tables = await getTables();
  const id = createId('table');
  const normalized = normalizeUrlInfo(message.sourceUrl);
  const table = ensureTableDefaults(
    {
      id,
      name: message.name || `Table ${tables.length + 1}`,
      urlTemplate: message.sourceUrl || '',
      page: normalized || { origin: '', pathname: '' },
      tableSelector: message.tableSelector || '',
      dataSection: message.dataSection || 'tbody',
      columns: [],
    },
    message.sourceUrl,
  );
  tables.push(table);
  await saveTables(tables);
  return table;
}

async function handleSaveColumn(message) {
  const tables = await getTables();
  const index = findTableIndex(tables, message.tableId);
  if (index === -1) {
    throw new Error('Table not found');
  }
  const table = tables[index];
  const column = {
    id: message.column.id || createId('col'),
    name: message.column.name,
    columnIndex: message.column.columnIndex,
    sampleCellSelector: message.column.sampleCellSelector,
    sampleRowIndex: message.column.sampleRowIndex,
    section: message.column.section || 'tbody',
  };
  table.tableSelector = message.tableSelector || table.tableSelector;
  table.dataSection = message.dataSection || table.dataSection || 'tbody';

  const existingIndex = table.columns.findIndex((col) => col.id === column.id || col.name === column.name);
  if (existingIndex !== -1) {
    table.columns[existingIndex] = { ...table.columns[existingIndex], ...column };
  } else {
    table.columns.push(column);
  }
  tables[index] = table;
  await saveTables(tables);
  return table;
}

async function handleRemoveColumn(message) {
  const tables = await getTables();
  const index = findTableIndex(tables, message.tableId);
  if (index === -1) {
    throw new Error('Table not found');
  }
  const table = tables[index];
  table.columns = table.columns.filter((col) => col.id !== message.columnId);
  tables[index] = table;
  await saveTables(tables);
  return table;
}

async function handleUpdateTable(message) {
  const tables = await getTables();
  const index = findTableIndex(tables, message.table.id);
  if (index === -1) {
    throw new Error('Table not found');
  }
  const table = tables[index];
  tables[index] = ensureTableDefaults({
    ...table,
    ...message.table,
    page: normalizeUrlInfo(message.table.urlTemplate || table.urlTemplate) || table.page,
  });
  await saveTables(tables);
  return tables[index];
}

async function handleDeleteTable(message) {
  const tables = await getTables();
  const filtered = tables.filter((table) => table.id !== message.tableId);
  await saveTables(filtered);
  return { tableId: message.tableId };
}

function csvEscape(value) {
  if (value == null) {
    return '';
  }
  const needsQuotes = /[",\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function buildCsv(columns, rows) {
  const header = ['Date', ...columns.map((col) => col.name)];
  const lines = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    const line = [row.__date || '', ...columns.map((col) => row[col.name] ?? '')];
    lines.push(line.map((value) => csvEscape(String(value))).join(','));
  }
  return lines.join('\n');
}

async function waitForTabComplete(tabId) {
  const tab = await browserApi.tabs.get(tabId);
  if (tab.status === 'complete') {
    return;
  }
  return new Promise((resolve) => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        browserApi.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    browserApi.tabs.onUpdated.addListener(listener);
  });
}

async function createTab(url) {
  return new Promise((resolve) => {
    browserApi.tabs.create({ url, active: false }, (tab) => resolve(tab));
  });
}

async function closeTab(tabId) {
  return new Promise((resolve) => {
    browserApi.tabs.remove(tabId, () => resolve());
  });
}

async function sendMessageToTab(tabId, payload) {
  return new Promise((resolve, reject) => {
    try {
      browserApi.tabs.sendMessage(tabId, payload, (response) => {
        const error = browserApi.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function buildUrlFromTemplate(template, dateValue, table) {
  if (!template) {
    return '';
  }
  if (template.includes('{{date}}')) {
    const dateToken = encodeURIComponent(dateValue);
    return template.replace(/\{\{date\}\}/g, dateToken);
  }
  let base = template;
  if (!/^https?:/i.test(template)) {
    const origin = table?.page?.origin || '';
    if (!origin) {
      return '';
    }
    base = `${origin.replace(/\/$/, '')}/${template.replace(/^\//, '')}`;
  }
  try {
    const url = new URL(base);
    url.searchParams.set('date', dateValue);
    return url.toString();
  } catch (error) {
    return '';
  }
}

async function downloadCsv(tableName, csv) {
  const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
  const filename = `${tableName || 'table'}-${timestamp}.csv`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    browserApi.downloads.download({ url, filename }, () => {
      URL.revokeObjectURL(url);
      resolve();
    });
  });
}

async function exportTable(message) {
  const tables = await getTables();
  const table = tables.find((item) => item.id === message.tableId);
  if (!table) {
    throw new Error('Table not found');
  }
  if (!table.columns || table.columns.length === 0) {
    throw new Error('Table has no columns defined');
  }
  const dates = (message.dates || []).filter(Boolean);
  if (!dates.length) {
    throw new Error('No dates provided');
  }
  const aggregated = [];
  for (const date of dates) {
    const url = buildUrlFromTemplate(table.urlTemplate, date, table);
    if (!url) {
      throw new Error('Table URL template is invalid');
    }
    const tab = await createTab(url);
    await waitForTabComplete(tab.id);
    let response;
    try {
      response = await sendMessageToTab(tab.id, {
        type: 'PERFORM_SCRAPE',
        table,
        date,
      });
    } finally {
      await closeTab(tab.id);
    }
    if (!response || response.error) {
      throw new Error(response?.error || 'Unable to scrape table');
    }
    for (const row of response.rows) {
      aggregated.push({ ...row, __date: date });
    }
  }
  const csv = buildCsv(table.columns, aggregated);
  await downloadCsv(table.name, csv);
  if (browserApi.notifications) {
    browserApi.notifications.create({
      type: 'basic',
      iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAPCAYAAADJViUEAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAKZJREFUeNpi/P//PwMlgImBQjDwZ2Bg+M/AwPCfgRFBxMAEI5gGiF7g4GAJEM0H4jLg3E8QHYh4D4g2E8QbYh4P8AZj1gYkApGoG4D4jLg/EcQfYgYF4B4nIgxF8j0MWYDEQJxF8nsT0A8jkYH4HxAdTHEDsT0D8nFgfgfED1McQOxPQPyKQMDIYw1iArElgPgeEmYg2E8QHYg6AsT2AzEqg/ExKDvD8T8QUXgk0EoGgFgQwAAAwBcvxjzoWJt6gAAAABJRU5ErkJggg==',
      title: 'Eva Table Reactor',
      message: `Export for ${table.name} completed (${dates.length} date${dates.length === 1 ? '' : 's'}).`,
    });
  }
  return { status: 'completed' };
}

browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'GET_TABLES_FOR_URL':
          sendResponse({ tables: await handleGetTablesForUrl(message) });
          break;
        case 'CREATE_TABLE':
          sendResponse({ table: await handleCreateTable(message) });
          break;
        case 'SAVE_COLUMN':
          sendResponse({ table: await handleSaveColumn(message) });
          break;
        case 'REMOVE_COLUMN':
          sendResponse({ table: await handleRemoveColumn(message) });
          break;
        case 'UPDATE_TABLE':
          sendResponse({ table: await handleUpdateTable(message) });
          break;
        case 'DELETE_TABLE':
          await handleDeleteTable(message);
          sendResponse({ success: true });
          break;
        case 'GET_ALL_TABLES':
          sendResponse({ tables: await getTables() });
          break;
        case 'EXPORT_TABLE':
          exportTable(message)
            .then(() => {
              // no-op; result handled via notification
            })
            .catch((error) => {
              if (browserApi.notifications) {
                browserApi.notifications.create({
                  type: 'basic',
                  iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAPCAYAAADJViUEAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAItJREFUeNpi/P//PwMlgImBQjDwZ2Bg+M/AwPCfgRFBxMAEI5gGiF7g4GAJEM0H4jLg3E8QHYh4D4g2E8QbYh4P8AZj1gYkApGoG4D4jLg/EcQfYgYF4B4nIgxF8j0MWYDEQJxF8nsT0A8jkYH4HxAdTHEDsT0D8nFgfgfED1McQOxPQPyKQMDIYw1iArElgPgeEmYg2E8QHYg6AsT2AzEqg/ExKDvD8T8QUXgk0EoGgFgQwAAAMB5yx8v5pWFBwAAAABJRU5ErkJggg==',
                  title: 'Eva Table Reactor',
                  message: error.message || 'Export failed.',
                });
              }
            });
          sendResponse({ status: 'started' });
          break;
        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      sendResponse({ error: error.message || String(error) });
    }
  })();
  return true;
});

browserApi.runtime.onInstalled.addListener(async () => {
  const tables = await getTables();
  if (!tables.length) {
    await saveTables([]);
  }
});
