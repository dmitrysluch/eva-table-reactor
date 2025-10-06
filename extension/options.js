const browserApi = window.browser ?? window.chrome;

function sendMessage(payload) {
  return new Promise((resolve) => {
    browserApi.runtime.sendMessage(payload, (response) => {
      resolve(response || {});
    });
  });
}

function formatPageUrl(table) {
  if (!table?.page) {
    return '—';
  }
  return `${table.page.origin}${table.page.pathname}`;
}

function renderColumns(list, table) {
  list.innerHTML = '';
  if (!table.columns || !table.columns.length) {
    const item = document.createElement('li');
    item.textContent = 'No columns mapped yet.';
    list.appendChild(item);
    return;
  }
  table.columns.forEach((column) => {
    const item = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'column-info';

    const title = document.createElement('span');
    title.className = 'column-title';
    title.textContent = `${column.name} (index ${column.columnIndex})`;

    const source = document.createElement('span');
    source.className = 'column-source';
    source.textContent = column.sourceUrl || '—';

    const selector = document.createElement('code');
    selector.textContent = column.sampleCellSelector || '';

    info.appendChild(title);
    info.appendChild(source);

    item.appendChild(info);
    item.appendChild(selector);
    list.appendChild(item);
  });
}

function createTableCard(table) {
  const template = document.getElementById('tableTemplate');
  const node = template.content.firstElementChild.cloneNode(true);
  const nameInput = node.querySelector('.table-name');
  const urlInput = node.querySelector('.url-template');
  const sectionSelect = node.querySelector('.data-section');
  const meta = node.querySelector('.page-url');
  const columnsList = node.querySelector('.column-list');
  const saveButton = node.querySelector('.save');
  const deleteButton = node.querySelector('.delete');

  nameInput.value = table.name || '';
  urlInput.value = table.urlTemplate || '';
  sectionSelect.value = table.dataSection || 'tbody';
  meta.textContent = formatPageUrl(table);
  renderColumns(columnsList, table);

  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    const initialText = saveButton.textContent;
    saveButton.textContent = 'Saving…';
    const updated = {
      ...table,
      name: nameInput.value.trim() || table.name,
      urlTemplate: urlInput.value.trim(),
      dataSection: sectionSelect.value,
    };
    const response = await sendMessage({ type: 'UPDATE_TABLE', table: updated });
    if (response.error) {
      saveButton.textContent = 'Failed';
    } else {
      saveButton.textContent = 'Saved';
      Object.assign(table, response.table || updated);
      renderColumns(columnsList, table);
      meta.textContent = formatPageUrl(table);
    }
    setTimeout(() => {
      saveButton.disabled = false;
      saveButton.textContent = initialText;
    }, 1000);
  });

  deleteButton.addEventListener('click', async () => {
    if (!window.confirm(`Delete table “${table.name}”? This cannot be undone.`)) {
      return;
    }
    deleteButton.disabled = true;
    deleteButton.textContent = 'Deleting…';
    await sendMessage({ type: 'DELETE_TABLE', tableId: table.id });
    await loadTables();
  });

  return node;
}

async function loadTables() {
  const container = document.getElementById('tables');
  const empty = document.getElementById('emptyState');
  container.innerHTML = '';
  const response = await sendMessage({ type: 'GET_ALL_TABLES' });
  const tables = response.tables || [];
  if (!tables.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  tables.forEach((table) => {
    container.appendChild(createTableCard(table));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadTables();
});
