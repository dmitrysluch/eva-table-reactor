const browserApi = window.browser ?? window.chrome;

const state = {
  tables: [],
  selectedTableId: null,
  currentSelection: null,
  highlightedStored: new Set(),
  currentHighlightedCell: null,
  overlay: null,
};

function cssEscape(identifier) {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(identifier);
  }
  return identifier.replace(/([\0-\x1F\x7F-\x9F!"#$%&'()*+,./:;<=>?@\[\]`{|}~])/g, '\\$1');
}

function buildSelector(element, stopAt) {
  if (!element || element === stopAt) {
    return '';
  }
  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }
  const segments = [];
  let current = element;
  while (current && current !== stopAt && current.nodeType === Node.ELEMENT_NODE) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      segment = `#${cssEscape(current.id)}`;
      segments.unshift(segment);
      break;
    }
    const siblingIndex = (() => {
      let index = 1;
      let sibling = current;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === current.tagName) {
          index += 1;
        }
      }
      return index;
    })();
    segment += `:nth-of-type(${siblingIndex})`;
    segments.unshift(segment);
    current = current.parentElement;
  }
  return segments.join(' > ');
}

function uniqueSelector(element) {
  if (!element) {
    return '';
  }
  const root = document.body;
  const selector = buildSelector(element, root);
  if (selector) {
    return selector;
  }
  return element.tagName.toLowerCase();
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    browserApi.runtime.sendMessage(payload, (response) => {
      resolve(response || {});
    });
  });
}

function clearStoredHighlights() {
  for (const selector of state.highlightedStored) {
    const element = document.querySelector(selector);
    if (element) {
      element.classList.remove('eva-table-reactor-stored');
      element.removeAttribute('data-eva-table-reactor-column');
      element.removeAttribute('title');
      const tooltip = element.querySelector('.eva-table-reactor-tooltip');
      if (tooltip) {
        tooltip.remove();
      }
    }
  }
  state.highlightedStored.clear();
}

function ensureCellTooltip(element, text) {
  if (!element) {
    return;
  }
  let tooltip = element.querySelector('.eva-table-reactor-tooltip');
  if (!text) {
    if (tooltip) {
      tooltip.remove();
    }
    return;
  }
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'eva-table-reactor-tooltip';
    element.appendChild(tooltip);
  }
  tooltip.textContent = text;
}

function highlightStoredColumns() {
  clearStoredHighlights();
  state.tables.forEach((table) => {
    table.columns.forEach((column) => {
      if (!column.sampleCellSelector) {
        return;
      }
      const element = document.querySelector(column.sampleCellSelector);
      if (element) {
        element.classList.add('eva-table-reactor-stored');
        if (column.name) {
          element.setAttribute('data-eva-table-reactor-column', column.name);
          element.setAttribute('title', column.name);
          ensureCellTooltip(element, column.name);
        } else {
          element.removeAttribute('data-eva-table-reactor-column');
          element.removeAttribute('title');
          ensureCellTooltip(element, '');
        }
        state.highlightedStored.add(column.sampleCellSelector);
      }
    });
  });
}

function highlightSelectedCell(element) {
  if (state.currentHighlightedCell && state.currentHighlightedCell !== element) {
    state.currentHighlightedCell.classList.remove('eva-table-reactor-selected');
  }
  state.currentHighlightedCell = element || null;
  if (state.currentHighlightedCell) {
    state.currentHighlightedCell.classList.add('eva-table-reactor-selected');
  }
}

function getSelectedTable() {
  if (!state.selectedTableId) {
    return null;
  }
  return state.tables.find((table) => table.id === state.selectedTableId) || null;
}

function ensureOverlay() {
  if (state.overlay) {
    return state.overlay;
  }
  const overlay = document.createElement('div');
  overlay.className = 'table-reactor-overlay';
  overlay.innerHTML = `
    <header>
      <span>Eva Table Reactor</span>
      <button type="button" class="toggle-visibility" title="Hide">×</button>
    </header>
    <div class="overlay-body">
      <div class="field-row">
        <label style="flex:1">
          <span>Output table</span>
          <select class="table-select"></select>
        </label>
        <button type="button" class="secondary create-table">New</button>
      </div>
      <div class="info-block instructions">Hold <kbd>Alt</kbd> and click a table cell to capture it.</div>
      <div class="info-block selection-preview">
        <div><strong>Cell value:</strong> <span class="cell-value">None</span></div>
        <div><strong>Column index:</strong> <span class="cell-index">-</span></div>
        <div><strong>Table selector:</strong> <code class="table-selector">n/a</code></div>
        <div><strong>Cell selector:</strong> <code class="cell-selector">n/a</code></div>
        <div><strong>Source URL:</strong> <span class="cell-url">n/a</span></div>
      </div>
      <label>
        <span>Column name</span>
        <input type="text" class="column-name" placeholder="e.g. Close price" />
      </label>
      <div class="field-row">
        <button type="button" class="primary save-column" disabled>Save column</button>
        <span class="status-message"></span>
      </div>
      <div>
        <strong>Columns</strong>
        <ul class="column-list"></ul>
      </div>
    </div>
  `;
  overlay.querySelector('.toggle-visibility').addEventListener('click', () => {
    hideOverlay();
  });
  overlay.addEventListener('mouseenter', () => {
    overlay.dataset.mouseInside = 'true';
  });
  overlay.addEventListener('mouseleave', () => {
    overlay.dataset.mouseInside = 'false';
  });
  overlay.dataset.mouseInside = 'false';
  document.body.appendChild(overlay);
  state.overlay = overlay;
  return overlay;
}

function showOverlay() {
  const overlay = ensureOverlay();
  overlay.classList.remove('hidden');
  if (state.currentSelection?.sampleCellSelector) {
    const element = document.querySelector(state.currentSelection.sampleCellSelector);
    if (element) {
      highlightSelectedCell(element);
    }
  }
}

function hideOverlay() {
  if (!state.overlay) {
    return;
  }
  state.overlay.classList.add('hidden');
  highlightSelectedCell(null);
}

function setStatus(message) {
  const overlay = ensureOverlay();
  const status = overlay.querySelector('.status-message');
  if (status) {
    status.textContent = message || '';
  }
}

function renderTables() {
  const overlay = ensureOverlay();
  const select = overlay.querySelector('.table-select');
  select.innerHTML = '';
  state.tables.forEach((table) => {
    const option = document.createElement('option');
    option.value = table.id;
    option.textContent = table.name;
    select.appendChild(option);
  });
  if (!state.selectedTableId && state.tables.length) {
    state.selectedTableId = state.tables[0].id;
  }
  if (state.selectedTableId) {
    select.value = state.selectedTableId;
  }
  select.onchange = () => {
    state.selectedTableId = select.value;
    updateColumnsList();
    highlightStoredColumns();
  };
}

function updateSelectionPreview(selection) {
  const overlay = ensureOverlay();
  overlay.querySelector('.cell-value').textContent = selection ? selection.value : 'None';
  overlay.querySelector('.cell-index').textContent = selection ? `${selection.columnIndex}` : '-';
  overlay.querySelector('.table-selector').textContent = selection ? selection.tableSelector : 'n/a';
  overlay.querySelector('.cell-selector').textContent = selection ? selection.sampleCellSelector : 'n/a';
  overlay.querySelector('.cell-url').textContent = selection ? selection.sourceUrl : 'n/a';
  const saveButton = overlay.querySelector('.save-column');
  saveButton.disabled = !selection || !overlay.querySelector('.column-name').value.trim() || !state.selectedTableId;
}

function updateColumnsList() {
  const overlay = ensureOverlay();
  const list = overlay.querySelector('.column-list');
  list.innerHTML = '';
  const table = getSelectedTable();
  if (!table) {
    const empty = document.createElement('li');
    empty.textContent = 'No table selected.';
    list.appendChild(empty);
    return;
  }
  if (!table.columns.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No columns yet. Click a cell to start mapping.';
    list.appendChild(empty);
    return;
  }
  table.columns.forEach((column) => {
    const item = document.createElement('li');
    const label = document.createElement('div');
    label.className = 'column-label';
    label.textContent = column.name;
    const meta = document.createElement('div');
    meta.className = 'column-meta';
    meta.textContent = column.sourceUrl || '—';
    const actions = document.createElement('button');
    actions.className = 'secondary';
    actions.textContent = 'Remove';
    actions.addEventListener('click', async () => {
      await sendMessage({
        type: 'REMOVE_COLUMN',
        tableId: table.id,
        columnId: column.id,
      });
      await loadTables();
      setStatus(`Column “${column.name}” removed.`);
    });
    item.appendChild(label);
    const info = document.createElement('div');
    info.className = 'column-info';
    info.appendChild(label);
    info.appendChild(meta);
    item.appendChild(info);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

async function loadTables() {
  const response = await sendMessage({
    type: 'GET_TABLES_FOR_URL',
    url: window.location.href,
  });
  state.tables = response.tables || [];
  if (!state.selectedTableId || !state.tables.some((table) => table.id === state.selectedTableId)) {
    state.selectedTableId = state.tables[0]?.id || null;
  }
  renderTables();
  updateColumnsList();
  highlightStoredColumns();
}

async function handleCreateTable() {
  const name = window.prompt('Name for the new output table:');
  if (!name) {
    return;
  }
  const response = await sendMessage({
    type: 'CREATE_TABLE',
    name,
    sourceUrl: window.location.href,
  });
  if (response?.table) {
    state.selectedTableId = response.table.id;
    await loadTables();
    setStatus(`Created table “${response.table.name}”.`);
  }
}

async function saveCurrentSelection() {
  const table = getSelectedTable();
  const overlay = ensureOverlay();
  if (!table) {
    setStatus('Select or create an output table first.');
    return;
  }
  const nameInput = overlay.querySelector('.column-name');
  const columnName = nameInput.value.trim();
  if (!columnName) {
    setStatus('Provide a column name before saving.');
    return;
  }
  const selection = state.currentSelection;
  if (!selection) {
    setStatus('Click a table cell to capture it.');
    return;
  }
  const response = await sendMessage({
    type: 'SAVE_COLUMN',
    tableId: table.id,
    tableSelector: selection.tableSelector,
    dataSection: selection.section,
    column: {
      name: columnName,
      columnIndex: selection.columnIndex,
      sampleCellSelector: selection.sampleCellSelector,
      sampleRowIndex: selection.sampleRowIndex,
      section: selection.section,
      sourceUrl: selection.sourceUrl,
    },
  });
  if (response?.table) {
    nameInput.value = '';
    state.currentSelection = null;
    highlightSelectedCell(null);
    updateSelectionPreview(null);
    await loadTables();
    setStatus(`Column “${columnName}” saved.`);
  }
}

function captureCell(event) {
  const overlay = ensureOverlay();
  if (overlay.dataset.mouseInside === 'true') {
    return;
  }
  if (!event.altKey) {
    return;
  }
  const cell = event.target.closest('td,th');
  if (!cell || cell.closest('.table-reactor-overlay')) {
    return;
  }
  const tableElement = cell.closest('table');
  if (!tableElement) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  showOverlay();
  const row = cell.closest('tr');
  const sectionElement = cell.closest('tbody, thead, tfoot');
  const section = sectionElement ? sectionElement.tagName.toLowerCase() : 'tbody';
  const sectionRows = sectionElement
    ? Array.from(sectionElement.querySelectorAll('tr'))
    : Array.from(tableElement.querySelectorAll('tr'));
  const sampleRowIndex = sectionRows.indexOf(row);
  const columnIndex = (() => {
    const cells = Array.from(row.querySelectorAll('th,td'));
    return cells.indexOf(cell);
  })();
  const selection = {
    value: cell.innerText.trim(),
    columnIndex,
    tableSelector: uniqueSelector(tableElement),
    sampleCellSelector: uniqueSelector(cell),
    sampleRowIndex: sampleRowIndex >= 0 ? sampleRowIndex : 0,
    section,
    sourceUrl: window.location.href,
  };
  state.currentSelection = selection;
  highlightSelectedCell(cell);
  updateSelectionPreview(selection);
  setStatus(section === 'thead' ? 'Warning: header rows are ignored during export.' : 'Cell captured. Provide a column name and save.');
  const saveButton = overlay.querySelector('.save-column');
  saveButton.disabled = !overlay.querySelector('.column-name').value.trim();
}

function attachOverlayHandlers() {
  const overlay = ensureOverlay();
  overlay.querySelector('.create-table').addEventListener('click', handleCreateTable);
  overlay.querySelector('.save-column').addEventListener('click', saveCurrentSelection);
  overlay.querySelector('.column-name').addEventListener('input', (event) => {
    const hasValue = event.target.value.trim().length > 0;
    const overlayElement = ensureOverlay();
    overlayElement.querySelector('.save-column').disabled = !hasValue || !state.currentSelection;
  });
}

function initializeOverlay() {
  ensureOverlay();
  attachOverlayHandlers();
  loadTables();
  setStatus('Hold Alt and click a cell to capture it.');
}

function scrapeTable(tableConfig) {
  if (!tableConfig?.tableSelector) {
    return { error: 'Table selector missing in configuration.' };
  }
  const tableElement = document.querySelector(tableConfig.tableSelector);
  if (!tableElement) {
    return { error: `Table not found for selector ${tableConfig.tableSelector}` };
  }
  const section = tableConfig.dataSection || 'tbody';
  let rows = [];
  if (section !== 'table') {
    const containers = tableElement.querySelectorAll(section);
    containers.forEach((container) => {
      if (container.matches('tbody, thead, tfoot')) {
        rows = rows.concat(Array.from(container.querySelectorAll('tr')));
      }
    });
  }
  if (!rows.length) {
    rows = Array.from(tableElement.querySelectorAll('tr'));
  }
  rows = rows.filter((row) => {
    if (!row.closest('table') || row.closest('table') !== tableElement) {
      return false;
    }
    if (row.closest('thead')) {
      return false;
    }
    const cells = row.querySelectorAll('td,th');
    return cells.length > 0;
  });
  const minSampleIndex = Math.min(
    ...tableConfig.columns.map((column) => (typeof column.sampleRowIndex === 'number' ? column.sampleRowIndex : 0)),
  );
  const bodyRows = rows.slice(minSampleIndex >= 0 ? minSampleIndex : 0);
  const records = bodyRows.map((row) => {
    const cells = Array.from(row.querySelectorAll('td,th'));
    const record = {};
    tableConfig.columns.forEach((column) => {
      const cell = cells[column.columnIndex];
      record[column.name] = cell ? cell.innerText.trim() : '';
    });
    return record;
  });
  return { rows: records };
}

function initialize() {
  initializeOverlay();
  document.addEventListener(
    'click',
    (event) => {
      captureCell(event);
    },
    true,
  );
  browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'PERFORM_SCRAPE') {
      const result = scrapeTable(message.table);
      sendResponse(result);
      return true;
    }
    return undefined;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.overlay && !state.overlay.classList.contains('hidden')) {
    hideOverlay();
  }
});

