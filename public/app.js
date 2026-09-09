const state = {
  tabs: [],
  activeTabId: null,
  editingDoc: null,
};

const api = {
  async get(path) {
    const res = await fetch(path);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
    return body;
  },
  async send(method, path, payload) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
    return body;
  },
};

function encodeURIComponentPath(pathStr) {
  return pathStr.split('/').map(encodeURIComponent).join('/');
}

function showBanner(message) {
  const banner = document.getElementById('banner');
  banner.textContent = message;
  banner.hidden = false;
}

function hideBanner() {
  document.getElementById('banner').hidden = true;
}

async function loadRootCollections() {
  try {
    const { collections } = await api.get('/api/collections');
    const tree = document.getElementById('collection-tree');
    tree.innerHTML = '';
    collections.forEach((name) => tree.appendChild(buildCollectionNode(name, name)));
    hideBanner();
  } catch (err) {
    showBanner(`Não foi possível conectar ao emulador: ${err.message}`);
  }
}

function buildCollectionNode(path, label) {
  const li = document.createElement('li');
  li.className = 'tree-node';
  li.dataset.path = path;

  const row = document.createElement('div');
  row.className = 'tree-row';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'expand-btn';
  expandBtn.textContent = '▸';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tree-label';
  nameSpan.textContent = label;
  nameSpan.addEventListener('click', () => openTab(path));

  row.appendChild(expandBtn);
  row.appendChild(nameSpan);
  li.appendChild(row);

  const childList = document.createElement('ul');
  childList.className = 'tree-children';
  childList.hidden = true;
  li.appendChild(childList);

  let loaded = false;
  expandBtn.addEventListener('click', async () => {
    if (!loaded) {
      try {
        const { documents } = await api.get(`/api/documents/${encodeURIComponentPath(path)}?pageSize=200`);
        childList.innerHTML = '';
        documents.forEach((doc) => {
          childList.appendChild(buildDocumentNode(`${path}/${doc.id}`, doc.id));
        });
        loaded = true;
      } catch (err) {
        showBanner(`Erro ao expandir ${path}: ${err.message}`);
        return;
      }
    }
    childList.hidden = !childList.hidden;
    expandBtn.textContent = childList.hidden ? '▸' : '▾';
  });

  return li;
}

function buildDocumentNode(docPath, label) {
  const li = document.createElement('li');
  li.className = 'tree-node doc-node';

  const row = document.createElement('div');
  row.className = 'tree-row';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'expand-btn';
  expandBtn.textContent = '▸';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tree-label doc-label';
  nameSpan.textContent = label;

  row.appendChild(expandBtn);
  row.appendChild(nameSpan);
  li.appendChild(row);

  const childList = document.createElement('ul');
  childList.className = 'tree-children';
  childList.hidden = true;
  li.appendChild(childList);

  let loaded = false;
  expandBtn.addEventListener('click', async () => {
    if (!loaded) {
      try {
        const { subcollections } = await api.get(`/api/document/${encodeURIComponentPath(docPath)}`);
        childList.innerHTML = '';
        subcollections.forEach((name) => {
          childList.appendChild(buildCollectionNode(`${docPath}/${name}`, name));
        });
        loaded = true;
      } catch (err) {
        showBanner(`Erro ao expandir ${docPath}: ${err.message}`);
        return;
      }
    }
    childList.hidden = !childList.hidden;
    expandBtn.textContent = childList.hidden ? '▸' : '▾';
  });

  return li;
}

function showModalError(message) {
  const el = document.getElementById('create-collection-error');
  el.textContent = message;
  el.hidden = false;
}

function hideModalError() {
  document.getElementById('create-collection-error').hidden = true;
}

function openCreateCollectionModal() {
  document.getElementById('new-collection-name').value = '';
  document.getElementById('new-collection-doc-id').value = '';
  hideModalError();
  document.getElementById('create-collection-modal').hidden = false;
  document.getElementById('new-collection-name').focus();
}

function closeCreateCollectionModal() {
  document.getElementById('create-collection-modal').hidden = true;
}

async function submitCreateCollection() {
  const name = document.getElementById('new-collection-name').value.trim();
  const docId = document.getElementById('new-collection-doc-id').value.trim();

  if (!name) {
    showModalError('Informe o nome da coleção.');
    return;
  }
  if (name.includes('/')) {
    showModalError('Nome de coleção não pode conter "/".');
    return;
  }

  try {
    await api.send('POST', `/api/document/${encodeURIComponentPath(name)}`, {
      id: docId || undefined,
      data: {},
    });
    const tree = document.getElementById('collection-tree');
    const existing = tree.querySelector(`:scope > li[data-path="${CSS.escape(name)}"]`);
    if (!existing) {
      tree.appendChild(buildCollectionNode(name, name));
    }
    hideBanner();
    closeCreateCollectionModal();
  } catch (err) {
    showModalError(`Erro ao criar coleção: ${err.message}`);
  }
}

// ---- Tabs ----

function getActiveTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || null;
}

function getTabByPath(path) {
  return state.tabs.find((t) => t.path === path) || null;
}

function openTab(path) {
  let tab = getTabByPath(path);
  if (!tab) {
    tab = {
      id: `${path}::${Date.now()}`,
      path,
      wheres: [],
      orderByField: '',
      orderByDir: 'asc',
      limit: 50,
      queryApplied: false,
      viewMode: 'table',
      documents: [],
      cursorStack: [],
    };
    state.tabs.push(tab);
  }
  setActiveTab(tab.id);
  fetchTabDocuments(tab);
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  state.tabs.splice(idx, 1);
  if (state.activeTabId === id) {
    const next = state.tabs[idx] || state.tabs[idx - 1];
    state.activeTabId = next ? next.id : null;
  }
  renderTabBar();
  renderActiveTab();
}

function setActiveTab(id) {
  state.activeTabId = id;
  renderTabBar();
  renderActiveTab();

  const previouslySelected = document.querySelector('#collection-tree .tree-row.selected');
  if (previouslySelected) previouslySelected.classList.remove('selected');
  const tab = getActiveTab();
  if (tab) {
    const selectedRow = document.querySelector(
      `#collection-tree li[data-path="${CSS.escape(tab.path)}"] > .tree-row`
    );
    if (selectedRow) selectedRow.classList.add('selected');
  }
}

function renderTabBar() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = '';
  state.tabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === state.activeTabId ? ' active' : '');
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = tab.path;
    label.title = tab.path;
    label.addEventListener('click', () => setActiveTab(tab.id));
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    el.appendChild(label);
    el.appendChild(closeBtn);
    bar.appendChild(el);
  });
}

function renderActiveTab() {
  const tab = getActiveTab();
  document.getElementById('empty-state').hidden = !!tab;
  document.getElementById('table-panel').hidden = !tab;
  document.getElementById('add-doc-btn').disabled = !tab;
  if (!tab) return;

  renderQueryPanel(tab);
  renderViewModeBar(tab);
  renderActiveView(tab);
  document.getElementById('prev-page-btn').disabled = tab.queryApplied || tab.cursorStack.length === 0;
  document.getElementById('next-page-btn').disabled = tab.queryApplied || tab.documents.length < tab.limit;
}

async function fetchTabDocuments(tab, cursorDocId) {
  try {
    let documents;
    if (tab.queryApplied) {
      const body = {
        wheres: tab.wheres,
        limit: tab.limit,
        orderBy: tab.orderByField ? { field: tab.orderByField, dir: tab.orderByDir } : undefined,
      };
      ({ documents } = await api.send('POST', `/api/query/${encodeURIComponentPath(tab.path)}`, body));
    } else {
      const query = cursorDocId
        ? `?pageSize=${tab.limit}&cursor=${encodeURIComponent(cursorDocId)}`
        : `?pageSize=${tab.limit}`;
      ({ documents } = await api.get(`/api/documents/${encodeURIComponentPath(tab.path)}${query}`));
    }
    tab.documents = documents;
    hideBanner();
  } catch (err) {
    showBanner(`Erro ao carregar ${tab.path}: ${err.message}`);
  }
  if (tab.id === state.activeTabId) renderActiveTab();
}

async function refreshTab(path) {
  const tab = getTabByPath(path);
  if (tab) await fetchTabDocuments(tab);
}

document.getElementById('next-page-btn').addEventListener('click', () => {
  const tab = getActiveTab();
  if (!tab) return;
  const lastDoc = tab.documents[tab.documents.length - 1];
  if (!lastDoc) return;
  tab.cursorStack.push(lastDoc.id);
  fetchTabDocuments(tab, lastDoc.id);
});

document.getElementById('prev-page-btn').addEventListener('click', () => {
  const tab = getActiveTab();
  if (!tab) return;
  tab.cursorStack.pop();
  const prevCursor = tab.cursorStack[tab.cursorStack.length - 1];
  fetchTabDocuments(tab, prevCursor);
});

// ---- Query builder (Simple mode) ----

const WHERE_OPS = ['==', '!=', '<', '<=', '>', '>=', 'array-contains', 'array-contains-any', 'in', 'not-in'];

function parseWhereValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function renderQueryPanel(tab) {
  const wheresEl = document.getElementById('query-wheres');
  wheresEl.innerHTML = '';
  tab.wheres.forEach((w, i) => wheresEl.appendChild(buildWhereRow(tab, w, i)));
  document.getElementById('query-orderby-field').value = tab.orderByField;
  document.getElementById('query-orderby-dir').value = tab.orderByDir;
  document.getElementById('query-limit').value = tab.limit;
}

function buildWhereRow(tab, where, index) {
  const row = document.createElement('div');
  row.className = 'where-row';

  const fieldInput = document.createElement('input');
  fieldInput.placeholder = 'campo';
  fieldInput.value = where.field;
  fieldInput.addEventListener('input', () => { where.field = fieldInput.value; });

  const opSelect = document.createElement('select');
  WHERE_OPS.forEach((op) => {
    const opt = document.createElement('option');
    opt.value = op;
    opt.textContent = op;
    if (op === where.op) opt.selected = true;
    opSelect.appendChild(opt);
  });
  opSelect.addEventListener('change', () => { where.op = opSelect.value; });

  const valueInput = document.createElement('input');
  valueInput.placeholder = 'valor';
  valueInput.value = where.rawValue;
  valueInput.addEventListener('input', () => { where.rawValue = valueInput.value; });

  const removeBtn = document.createElement('button');
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => {
    tab.wheres.splice(index, 1);
    renderQueryPanel(tab);
  });

  row.appendChild(fieldInput);
  row.appendChild(opSelect);
  row.appendChild(valueInput);
  row.appendChild(removeBtn);
  return row;
}

document.getElementById('query-toggle-btn').addEventListener('click', () => {
  const panel = document.getElementById('query-panel');
  panel.hidden = !panel.hidden;
  document.getElementById('query-toggle-btn').textContent = (panel.hidden ? '▸' : '▾') + ' Query';
});

document.getElementById('add-where-btn').addEventListener('click', () => {
  const tab = getActiveTab();
  if (!tab) return;
  tab.wheres.push({ field: '', op: '==', rawValue: '' });
  renderQueryPanel(tab);
});

document.getElementById('run-query-btn').addEventListener('click', () => {
  const tab = getActiveTab();
  if (!tab) return;
  tab.wheres = tab.wheres
    .filter((w) => w.field.trim())
    .map((w) => ({ field: w.field.trim(), op: w.op, value: parseWhereValue(w.rawValue), rawValue: w.rawValue }));
  tab.orderByField = document.getElementById('query-orderby-field').value.trim();
  tab.orderByDir = document.getElementById('query-orderby-dir').value;
  tab.limit = parseInt(document.getElementById('query-limit').value, 10) || 50;
  tab.queryApplied = tab.wheres.length > 0 || !!tab.orderByField;
  tab.cursorStack = [];
  fetchTabDocuments(tab);
});

// ---- View modes ----

function renderViewModeBar(tab) {
  document.querySelectorAll('.view-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === tab.viewMode);
  });
}

document.querySelectorAll('.view-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;
    tab.viewMode = btn.dataset.mode;
    renderActiveTab();
  });
});

function renderActiveView(tab) {
  document.getElementById('view-table').hidden = tab.viewMode !== 'table';
  document.getElementById('view-json').hidden = tab.viewMode !== 'json';
  document.getElementById('view-tree').hidden = tab.viewMode !== 'tree';
  if (tab.viewMode === 'table') renderTable(tab);
  else if (tab.viewMode === 'json') renderJson(tab);
  else renderTree(tab);
}

function renderTable(tab) {
  const documents = tab.documents;
  const thead = document.querySelector('#doc-table thead');
  const tbody = document.querySelector('#doc-table tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const fieldNames = new Set();
  documents.forEach((doc) => Object.keys(doc.data || {}).forEach((key) => fieldNames.add(key)));
  const columns = ['id', ...fieldNames];

  const headRow = document.createElement('tr');
  columns.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  documents.forEach((doc) => {
    const row = document.createElement('tr');
    row.addEventListener('click', () => openEditorForExisting(tab.path, doc.id));
    columns.forEach((col) => {
      const td = document.createElement('td');
      td.textContent = col === 'id' ? doc.id : previewValue(doc.data[col]);
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
}

function renderJson(tab) {
  document.getElementById('view-json').textContent = JSON.stringify(tab.documents, null, 2);
}

function renderTree(tab) {
  const root = document.getElementById('view-tree');
  root.innerHTML = '';
  tab.documents.forEach((doc) => {
    root.appendChild(buildTreeNode(doc.id, doc.data, () => openEditorForExisting(tab.path, doc.id)));
  });
}

function buildTreeNode(label, value, onLabelClick) {
  const li = document.createElement('li');
  li.className = 'tree-node';

  const children = valueChildren(value);
  const row = document.createElement('div');
  row.className = 'tree-row';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'expand-btn';
  expandBtn.textContent = children ? '▸' : ' ';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'tree-label';
  labelSpan.textContent = children ? label : `${label}: ${previewValue(value)}`;
  if (onLabelClick) labelSpan.addEventListener('click', onLabelClick);

  row.appendChild(expandBtn);
  row.appendChild(labelSpan);
  li.appendChild(row);

  if (children) {
    const childList = document.createElement('ul');
    childList.className = 'tree-children';
    childList.hidden = true;
    Object.entries(children).forEach(([key, val]) => childList.appendChild(buildTreeNode(key, val)));
    li.appendChild(childList);
    expandBtn.addEventListener('click', () => {
      childList.hidden = !childList.hidden;
      expandBtn.textContent = childList.hidden ? '▸' : '▾';
    });
  }

  return li;
}

function valueChildren(value) {
  if (value && typeof value === 'object' && !value.__type) return value;
  return null;
}

function previewValue(value) {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'object' && value.__type) {
    if (value.__type === 'timestamp') return value.value;
    if (value.__type === 'geopoint') return `(${value.lat}, ${value.lng})`;
    if (value.__type === 'reference') return value.path;
    if (value.__type === 'bytes') return '<bytes>';
  }
  if (Array.isArray(value)) return `[${value.length} itens]`;
  if (typeof value === 'object') return '{...}';
  return String(value);
}

document.addEventListener('DOMContentLoaded', () => {
  loadRootCollections();

  document.getElementById('add-collection-btn').addEventListener('click', openCreateCollectionModal);
  document.getElementById('create-collection-close-btn').addEventListener('click', closeCreateCollectionModal);
  document.getElementById('create-collection-cancel-btn').addEventListener('click', closeCreateCollectionModal);
  document.getElementById('create-collection-confirm-btn').addEventListener('click', submitCreateCollection);

  document.getElementById('create-collection-modal').addEventListener('click', (event) => {
    if (event.target.id === 'create-collection-modal') closeCreateCollectionModal();
  });

  ['new-collection-name', 'new-collection-doc-id'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitCreateCollection();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('create-collection-modal').hidden) {
      closeCreateCollectionModal();
    }
  });
});

const TYPE_OPTIONS = ['string', 'number', 'boolean', 'null', 'timestamp', 'geopoint', 'reference', 'bytes', 'map/array'];

function openEditor(title, docId, collectionPath, data) {
  state.editingDoc = { collectionPath, id: docId, isNew: docId === null };
  document.getElementById('editor-title').textContent = title;
  document.getElementById('editor-panel').hidden = false;
  renderEditorFields(data || {});
  document.getElementById('delete-doc-btn').hidden = state.editingDoc.isNew;
}

async function openEditorForExisting(collectionPath, docId) {
  try {
    const doc = await api.get(`/api/document/${encodeURIComponentPath(`${collectionPath}/${docId}`)}`);
    openEditor(`${collectionPath}/${docId}`, docId, collectionPath, doc.data);
  } catch (err) {
    showBanner(`Erro ao abrir documento: ${err.message}`);
  }
}

function openEditorForNew(collectionPath) {
  openEditor(`Novo documento em ${collectionPath}`, null, collectionPath, {});
}

function detectType(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object' && value.__type) return value.__type;
  if (Array.isArray(value)) return 'map/array';
  if (typeof value === 'object') return 'map/array';
  return typeof value;
}

function renderEditorFields(data) {
  const container = document.getElementById('editor-fields');
  container.innerHTML = '';

  const idRow = document.createElement('div');
  idRow.className = 'field-row';
  const idLabel = document.createElement('label');
  idLabel.textContent = 'ID do documento';
  const idInput = document.createElement('input');
  idInput.id = 'field-doc-id';
  idInput.value = state.editingDoc.id || '';
  idInput.disabled = !state.editingDoc.isNew;
  idInput.placeholder = state.editingDoc.isNew ? '(auto-gerado se vazio)' : '';
  idRow.appendChild(idLabel);
  idRow.appendChild(idInput);
  container.appendChild(idRow);

  Object.entries(data).forEach(([key, value]) => container.appendChild(buildFieldRow(key, value)));

  const addFieldBtn = document.createElement('button');
  addFieldBtn.textContent = '+ Adicionar campo';
  addFieldBtn.id = 'add-field-btn';
  addFieldBtn.addEventListener('click', () => container.insertBefore(buildFieldRow('', ''), addFieldBtn));
  container.appendChild(addFieldBtn);
}

function buildFieldRow(key, value) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.dataset.type = detectType(value);

  const keyInput = document.createElement('input');
  keyInput.className = 'field-key';
  keyInput.value = key;
  keyInput.placeholder = 'nome do campo';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'field-type';
  TYPE_OPTIONS.forEach((type) => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type;
    if (type === row.dataset.type) opt.selected = true;
    typeSelect.appendChild(opt);
  });

  const valueContainer = document.createElement('div');
  valueContainer.className = 'field-value';
  renderValueInput(valueContainer, row.dataset.type, value);

  typeSelect.addEventListener('change', () => {
    row.dataset.type = typeSelect.value;
    renderValueInput(valueContainer, typeSelect.value, defaultValueForType(typeSelect.value));
  });

  const removeBtn = document.createElement('button');
  removeBtn.textContent = '×';
  removeBtn.className = 'remove-field-btn';
  removeBtn.addEventListener('click', () => row.remove());

  row.appendChild(keyInput);
  row.appendChild(typeSelect);
  row.appendChild(valueContainer);
  row.appendChild(removeBtn);
  return row;
}

function defaultValueForType(type) {
  switch (type) {
    case 'string': return '';
    case 'number': return 0;
    case 'boolean': return false;
    case 'null': return null;
    case 'timestamp': return { __type: 'timestamp', value: new Date().toISOString() };
    case 'geopoint': return { __type: 'geopoint', lat: 0, lng: 0 };
    case 'reference': return { __type: 'reference', path: '' };
    case 'bytes': return { __type: 'bytes', base64: '' };
    case 'map/array': return {};
    default: return '';
  }
}

function renderValueInput(container, type, value) {
  container.innerHTML = '';
  if (type === 'string') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'value-input';
    input.value = value ?? '';
    container.appendChild(input);
  } else if (type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'value-input';
    input.value = value ?? 0;
    container.appendChild(input);
  } else if (type === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'value-input';
    input.checked = Boolean(value);
    container.appendChild(input);
  } else if (type === 'null') {
    const span = document.createElement('span');
    span.textContent = 'null';
    container.appendChild(span);
  } else if (type === 'timestamp') {
    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'value-input';
    const date = value && value.value ? new Date(value.value) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    input.value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    container.appendChild(input);
  } else if (type === 'geopoint') {
    const lat = document.createElement('input');
    lat.type = 'number';
    lat.step = 'any';
    lat.className = 'value-input geo-lat';
    lat.value = value && typeof value.lat === 'number' ? value.lat : 0;
    const lng = document.createElement('input');
    lng.type = 'number';
    lng.step = 'any';
    lng.className = 'value-input geo-lng';
    lng.value = value && typeof value.lng === 'number' ? value.lng : 0;
    container.appendChild(lat);
    container.appendChild(lng);
  } else if (type === 'reference') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'value-input';
    input.placeholder = 'ex: users/abc123';
    input.value = value && value.path ? value.path : '';
    container.appendChild(input);
  } else if (type === 'bytes') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'value-input';
    input.placeholder = 'base64';
    input.value = value && value.base64 ? value.base64 : '';
    container.appendChild(input);
  } else {
    const textarea = document.createElement('textarea');
    textarea.className = 'value-input json-input';
    textarea.value = JSON.stringify(value ?? {}, null, 2);
    container.appendChild(textarea);
  }
}

function readFieldRow(row) {
  const type = row.dataset.type;
  const container = row.querySelector('.field-value');
  if (type === 'string') return container.querySelector('input').value;
  if (type === 'number') return Number(container.querySelector('input').value);
  if (type === 'boolean') return container.querySelector('input').checked;
  if (type === 'null') return null;
  if (type === 'timestamp') {
    const raw = container.querySelector('input').value;
    return { __type: 'timestamp', value: new Date(raw).toISOString() };
  }
  if (type === 'geopoint') {
    const lat = Number(container.querySelector('.geo-lat').value);
    const lng = Number(container.querySelector('.geo-lng').value);
    return { __type: 'geopoint', lat, lng };
  }
  if (type === 'reference') {
    return { __type: 'reference', path: container.querySelector('input').value };
  }
  if (type === 'bytes') {
    return { __type: 'bytes', base64: container.querySelector('input').value };
  }
  return JSON.parse(container.querySelector('textarea').value);
}

function collectEditorData() {
  const data = {};
  document.querySelectorAll('#editor-fields .field-row').forEach((row) => {
    const keyInput = row.querySelector('.field-key');
    if (!keyInput) return;
    const key = keyInput.value.trim();
    if (!key) return;
    data[key] = readFieldRow(row);
  });
  return data;
}

document.getElementById('editor-close-btn').addEventListener('click', () => {
  document.getElementById('editor-panel').hidden = true;
  state.editingDoc = null;
});

document.getElementById('save-doc-btn').addEventListener('click', async () => {
  try {
    const data = collectEditorData();
    const { isNew, collectionPath, id } = state.editingDoc;
    if (isNew) {
      const idInput = document.getElementById('field-doc-id').value.trim();
      await api.send('POST', `/api/document/${encodeURIComponentPath(collectionPath)}`, {
        id: idInput || undefined,
        data,
      });
    } else {
      await api.send('PUT', `/api/document/${encodeURIComponentPath(`${collectionPath}/${id}`)}`, { data });
    }
    document.getElementById('editor-panel').hidden = true;
    state.editingDoc = null;
    await refreshTab(collectionPath);
  } catch (err) {
    showBanner(`Erro ao salvar: ${err.message}`);
  }
});

document.getElementById('delete-doc-btn').addEventListener('click', async () => {
  if (!confirm('Apagar este documento?')) return;
  try {
    const { collectionPath, id } = state.editingDoc;
    await api.send('DELETE', `/api/document/${encodeURIComponentPath(`${collectionPath}/${id}`)}`);
    document.getElementById('editor-panel').hidden = true;
    state.editingDoc = null;
    await refreshTab(collectionPath);
  } catch (err) {
    showBanner(`Erro ao apagar: ${err.message}`);
  }
});

document.getElementById('add-doc-btn').addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab) openEditorForNew(tab.path);
});
