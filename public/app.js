const state = {
  tabs: [],
  activeTabId: null,
  editingDoc: null,
};

let pendingRequests = 0;
function showLoading() {
  pendingRequests += 1;
  document.getElementById('loading-bar').hidden = false;
}
function hideLoading() {
  pendingRequests = Math.max(0, pendingRequests - 1);
  if (pendingRequests === 0) document.getElementById('loading-bar').hidden = true;
}

const api = {
  async get(path) {
    showLoading();
    try {
      const res = await fetch(path);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
      return body;
    } finally {
      hideLoading();
    }
  },
  async send(method, path, payload) {
    showLoading();
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
      return body;
    } finally {
      hideLoading();
    }
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

async function loadConnections() {
  try {
    const { connections } = await api.get('/api/connections');
    const tree = document.getElementById('connection-tree');
    tree.innerHTML = '';
    connections.forEach((conn) => tree.appendChild(buildConnectionNode(conn)));
    hideBanner();
  } catch (err) {
    showBanner(`Não foi possível carregar as conexões: ${err.message}`);
  }
}

function buildConnectionNode(conn) {
  const li = document.createElement('li');
  li.className = 'tree-node';
  li.dataset.connId = conn.id;

  const row = document.createElement('div');
  row.className = 'tree-row';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'expand-btn';
  expandBtn.textContent = '▸';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tree-label';
  nameSpan.textContent = conn.name;

  const editBtn = document.createElement('button');
  editBtn.className = 'expand-btn';
  editBtn.textContent = '✎';
  editBtn.title = 'Editar conexão';
  editBtn.addEventListener('click', (e) => { e.stopPropagation(); openConnectionModal(conn); });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'expand-btn';
  deleteBtn.textContent = '×';
  deleteBtn.title = 'Excluir conexão';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Excluir a conexão "${conn.name}"?`)) return;
    try {
      await api.send('DELETE', `/api/connections/${conn.id}`);
      state.tabs = state.tabs.filter((t) => t.connId !== conn.id);
      renderTabBar();
      renderActiveTab();
      loadConnections();
    } catch (err) {
      showBanner(`Erro ao excluir conexão: ${err.message}`);
    }
  });

  const addCollBtn = document.createElement('button');
  addCollBtn.className = 'expand-btn';
  addCollBtn.textContent = '+';
  addCollBtn.title = 'Nova coleção';

  row.appendChild(expandBtn);
  row.appendChild(nameSpan);
  row.appendChild(addCollBtn);
  row.appendChild(editBtn);
  row.appendChild(deleteBtn);
  li.appendChild(row);

  const childList = document.createElement('ul');
  childList.className = 'tree-children';
  childList.hidden = true;
  li.appendChild(childList);

  let loaded = false;

  function renderCollectionLi(name) {
    const collLi = document.createElement('li');
    collLi.className = 'tree-node';
    collLi.dataset.connId = conn.id;
    collLi.dataset.path = name;
    const collRow = document.createElement('div');
    collRow.className = 'tree-row';
    const collLabel = document.createElement('span');
    collLabel.className = 'tree-label';
    collLabel.textContent = name;
    collLabel.addEventListener('click', () => openTab(conn.id, name));
    collRow.appendChild(collLabel);
    collLi.appendChild(collRow);
    return collLi;
  }

  async function loadCollections() {
    const { collections } = await api.get(`/api/connections/${conn.id}/collections`);
    childList.innerHTML = '';
    collections.forEach((name) => childList.appendChild(renderCollectionLi(name)));
    loaded = true;
  }

  const toggle = async () => {
    if (!loaded) {
      try {
        await loadCollections();
      } catch (err) {
        showBanner(`Erro ao carregar coleções de ${conn.name}: ${err.message}`);
        return;
      }
    }
    childList.hidden = !childList.hidden;
    expandBtn.textContent = childList.hidden ? '▸' : '▾';
  };
  expandBtn.addEventListener('click', toggle);
  nameSpan.addEventListener('click', toggle);

  addCollBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCreateCollectionModal(conn.id, async () => {
      await loadCollections();
      childList.hidden = false;
      expandBtn.textContent = '▾';
    });
  });

  return li;
}

let createCollectionConnId = null;
let createCollectionOnSuccess = null;

function openCreateCollectionModal(connId, onSuccess) {
  createCollectionConnId = connId;
  createCollectionOnSuccess = onSuccess;
  document.getElementById('new-collection-name').value = '';
  document.getElementById('new-collection-doc-id').value = '';
  document.getElementById('create-collection-error').hidden = true;
  document.getElementById('create-collection-modal').hidden = false;
  document.getElementById('new-collection-name').focus();
}

function closeCreateCollectionModal() {
  document.getElementById('create-collection-modal').hidden = true;
}

async function submitCreateCollection() {
  const name = document.getElementById('new-collection-name').value.trim();
  const docId = document.getElementById('new-collection-doc-id').value.trim();
  const errEl = document.getElementById('create-collection-error');
  if (!name) {
    errEl.textContent = 'Informe o nome da coleção.';
    errEl.hidden = false;
    return;
  }
  if (name.includes('/')) {
    errEl.textContent = 'Nome de coleção não pode conter "/".';
    errEl.hidden = false;
    return;
  }
  try {
    await api.send('POST', `/api/connections/${createCollectionConnId}/document/${encodeURIComponentPath(name)}`, {
      id: docId || undefined,
      data: {},
    });
    closeCreateCollectionModal();
    if (createCollectionOnSuccess) await createCollectionOnSuccess();
  } catch (err) {
    errEl.textContent = `Erro ao criar coleção: ${err.message}`;
    errEl.hidden = false;
  }
}

const MONGO_NUMBER_KEYS = ['$numberLong', '$numberInt', '$numberDouble', '$numberDecimal'];

function convertMongoTypes(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(convertMongoTypes);
  const keys = Object.keys(value);
  if (keys.length === 1) {
    const [key] = keys;
    if (key === '$oid') return value.$oid;
    if (MONGO_NUMBER_KEYS.includes(key)) return Number(value[key]);
    if (key === '$date') {
      const raw = value.$date;
      const millis = raw && typeof raw === 'object' ? Number(raw.$numberLong ?? raw.$numberInt) : raw;
      return { __type: 'timestamp', value: new Date(millis).toISOString() };
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = convertMongoTypes(v);
  return out;
}

function isMongoImportMode() {
  return document.getElementById('import-json-mongo').checked;
}

function parseImportJson(text, mongoMode) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON inválido.');
  }
  if (mongoMode) parsed = convertMongoTypes(parsed);
  const docs = [];
  if (Array.isArray(parsed)) {
    parsed.forEach((item) => {
      if (!item || typeof item !== 'object') throw new Error('Cada item do array deve ser um objeto.');
      const { id, ...data } = item;
      docs.push({ id: id || undefined, data });
    });
  } else if (parsed && typeof parsed === 'object') {
    Object.entries(parsed).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') throw new Error(`Valor de "${key}" deve ser um objeto.`);
      const { id, ...data } = value;
      docs.push({ id: id || key, data });
    });
  } else {
    throw new Error('JSON deve ser um array ou um objeto.');
  }
  if (docs.length === 0) throw new Error('Nenhum documento encontrado no JSON.');
  return docs;
}

let importJsonConnId = null;
let importJsonPath = null;

function openImportJsonModal(connId, path) {
  importJsonConnId = connId;
  importJsonPath = path;
  document.getElementById('import-json-text').value = '';
  document.getElementById('import-json-file').value = '';
  document.getElementById('import-json-mongo').checked = false;
  document.getElementById('import-json-error').hidden = true;
  document.getElementById('import-json-columns').hidden = true;
  document.getElementById('import-json-columns-list').innerHTML = '';
  document.getElementById('import-json-modal').hidden = false;
  document.getElementById('import-json-text').focus();
}

function closeImportJsonModal() {
  document.getElementById('import-json-modal').hidden = true;
}

function previewImportColumns(text) {
  const columnsWrap = document.getElementById('import-json-columns');
  const listEl = document.getElementById('import-json-columns-list');
  listEl.innerHTML = '';
  let documents;
  try {
    documents = parseImportJson(text, isMongoImportMode());
  } catch {
    columnsWrap.hidden = true;
    return;
  }
  const fields = [...new Set(documents.flatMap((doc) => Object.keys(doc.data)))].sort();
  if (fields.length === 0) {
    columnsWrap.hidden = true;
    return;
  }
  fields.forEach((field) => {
    const label = document.createElement('label');
    label.className = 'import-column-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = field;
    checkbox.checked = true;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${field}`));
    listEl.appendChild(label);
  });
  columnsWrap.hidden = false;
}

function loadImportJsonFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('import-json-text').value = reader.result;
    document.getElementById('import-json-error').hidden = true;
    previewImportColumns(reader.result);
  };
  reader.readAsText(file);
}

async function submitImportJson() {
  const text = document.getElementById('import-json-text').value.trim();
  const errEl = document.getElementById('import-json-error');
  errEl.hidden = true;
  if (!text) {
    errEl.textContent = 'Cole o JSON a importar ou selecione um arquivo.';
    errEl.hidden = false;
    return;
  }
  let documents;
  try {
    documents = parseImportJson(text, isMongoImportMode());
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
    return;
  }
  const columnsWrap = document.getElementById('import-json-columns');
  if (!columnsWrap.hidden) {
    const selected = [...document.querySelectorAll('#import-json-columns-list input:checked')].map((cb) => cb.value);
    if (selected.length === 0) {
      errEl.textContent = 'Selecione ao menos um campo para importar.';
      errEl.hidden = false;
      return;
    }
    documents = documents.map((doc) => ({
      id: doc.id,
      data: Object.fromEntries(Object.entries(doc.data).filter(([key]) => selected.includes(key))),
    }));
  }
  try {
    const { imported, errors } = await api.send('POST', `/api/connections/${importJsonConnId}/import/${encodeURIComponentPath(importJsonPath)}`, { documents });
    closeImportJsonModal();
    await refreshTab(importJsonConnId, importJsonPath);
    showBanner(errors && errors.length
      ? `Importados ${imported} documento(s). ${errors.length} erro(s): ${errors[0]}`
      : `Importados ${imported} documento(s).`);
  } catch (err) {
    errEl.textContent = `Erro ao importar: ${err.message}`;
    errEl.hidden = false;
  }
}

let indexesConnId = null;
let indexesPath = null;

function addIndexFieldRow() {
  const row = document.createElement('div');
  row.className = 'index-field-row';
  row.innerHTML = `
    <input type="text" class="index-field-path" placeholder="campo (ex: status)" />
    <select class="index-field-mode">
      <option value="asc">Crescente</option>
      <option value="desc">Decrescente</option>
      <option value="array">Array contém</option>
    </select>
    <button type="button" class="remove-field-btn">×</button>
  `;
  row.querySelector('.remove-field-btn').addEventListener('click', () => row.remove());
  document.getElementById('indexes-fields').appendChild(row);
}

function openIndexesModal(connId, path) {
  indexesConnId = connId;
  indexesPath = path;
  document.getElementById('indexes-error').hidden = true;
  document.getElementById('indexes-fields').innerHTML = '';
  addIndexFieldRow();
  addIndexFieldRow();
  document.getElementById('indexes-modal').hidden = false;
  loadIndexesList();
}

function closeIndexesModal() {
  document.getElementById('indexes-modal').hidden = true;
}

async function loadIndexesList() {
  const listEl = document.getElementById('indexes-list');
  const errEl = document.getElementById('indexes-error');
  errEl.hidden = true;
  listEl.textContent = 'Carregando...';
  try {
    const { indexes } = await api.get(`/api/connections/${indexesConnId}/indexes/${encodeURIComponentPath(indexesPath)}`);
    listEl.innerHTML = '';
    if (indexes.length === 0) {
      listEl.textContent = 'Nenhum índice composto criado ainda.';
      return;
    }
    indexes.forEach((idx) => {
      const row = document.createElement('div');
      row.className = 'index-row';
      const summary = document.createElement('span');
      summary.className = 'index-fields-summary';
      summary.textContent = idx.fields
        .map((f) => `${f.fieldPath} ${f.arrayConfig ? '(array)' : f.order === 'DESCENDING' ? '↓' : '↑'}`)
        .join(', ');
      const stateSpan = document.createElement('span');
      stateSpan.className = 'index-state';
      stateSpan.textContent = idx.state || '';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'remove-field-btn';
      delBtn.textContent = '×';
      delBtn.title = 'Excluir índice';
      delBtn.addEventListener('click', async () => {
        if (!confirm('Excluir este índice?')) return;
        try {
          await api.send('DELETE', `/api/connections/${indexesConnId}/indexes/${encodeURIComponentPath(indexesPath)}?id=${encodeURIComponent(idx.id)}`);
          loadIndexesList();
        } catch (err) {
          showBanner(`Erro ao excluir índice: ${err.message}`);
        }
      });
      row.appendChild(summary);
      row.appendChild(stateSpan);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });
  } catch (err) {
    listEl.textContent = '';
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
}

async function submitCreateIndex() {
  const errEl = document.getElementById('indexes-error');
  errEl.hidden = true;
  const fields = [...document.querySelectorAll('#indexes-fields .index-field-row')]
    .map((row) => {
      const fieldPath = row.querySelector('.index-field-path').value.trim();
      if (!fieldPath) return null;
      const mode = row.querySelector('.index-field-mode').value;
      return { fieldPath, ...(mode === 'array' ? { arrayConfig: 'CONTAINS' } : { order: mode === 'desc' ? 'DESCENDING' : 'ASCENDING' }) };
    })
    .filter(Boolean);
  if (fields.length === 0) {
    errEl.textContent = 'Informe ao menos um campo.';
    errEl.hidden = false;
    return;
  }
  try {
    await api.send('POST', `/api/connections/${indexesConnId}/indexes/${encodeURIComponentPath(indexesPath)}`, { fields });
    document.getElementById('indexes-fields').innerHTML = '';
    addIndexFieldRow();
    addIndexFieldRow();
    loadIndexesList();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
}

let editingConnectionId = null;

function updateConnectionModalFields() {
  const isProd = document.getElementById('conn-type').value === 'production';
  document.getElementById('conn-emulator-field').hidden = isProd;
  document.getElementById('conn-production-field').hidden = !isProd;
}

function openConnectionModal(conn) {
  editingConnectionId = conn ? conn.id : null;
  document.getElementById('connection-modal-title').textContent = conn ? 'Editar conexão' : 'Nova conexão';
  document.getElementById('conn-name').value = conn ? conn.name : '';
  document.getElementById('conn-type').value = conn ? conn.type : 'emulator';
  document.getElementById('conn-project-id').value = conn ? conn.projectId : '';
  document.getElementById('conn-database-id').value = conn ? conn.databaseId || '' : '';
  document.getElementById('conn-emulator-host').value = conn ? conn.emulatorHost || '' : '';
  document.getElementById('conn-credential').value = '';
  updateConnectionModalFields();
  document.getElementById('connection-error').hidden = true;
  document.getElementById('connection-modal').hidden = false;
}

function closeConnectionModal() {
  document.getElementById('connection-modal').hidden = true;
}

async function submitConnection() {
  const name = document.getElementById('conn-name').value.trim();
  const type = document.getElementById('conn-type').value;
  const projectId = document.getElementById('conn-project-id').value.trim();
  const databaseId = document.getElementById('conn-database-id').value.trim();
  const emulatorHost = document.getElementById('conn-emulator-host').value.trim();
  const credentialJson = document.getElementById('conn-credential').value.trim();

  const errEl = document.getElementById('connection-error');
  if (!name || !projectId) {
    errEl.textContent = 'Nome e Project ID são obrigatórios.';
    errEl.hidden = false;
    return;
  }

  const payload = { name, type, projectId, emulatorHost: emulatorHost || undefined, credentialJson: credentialJson || undefined, databaseId: databaseId || undefined };
  try {
    if (editingConnectionId) {
      await api.send('PUT', `/api/connections/${editingConnectionId}`, payload);
    } else {
      await api.send('POST', '/api/connections', payload);
    }
    closeConnectionModal();
    loadConnections();
  } catch (err) {
    errEl.textContent = `Erro ao salvar conexão: ${err.message}`;
    errEl.hidden = false;
  }
}

// ---- Tabs ----

function getActiveTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || null;
}

function getTabByPath(connId, path) {
  return state.tabs.find((t) => t.connId === connId && t.path === path) || null;
}

function openTab(connId, path) {
  let tab = getTabByPath(connId, path);
  if (!tab) {
    tab = {
      id: `${connId}::${path}::${Date.now()}`,
      connId,
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
  document.getElementById('import-json-btn').disabled = !tab;
  document.getElementById('indexes-btn').disabled = !tab;
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
      ({ documents } = await api.send('POST', `/api/connections/${tab.connId}/query/${encodeURIComponentPath(tab.path)}`, body));
    } else {
      const query = cursorDocId
        ? `?pageSize=${tab.limit}&cursor=${encodeURIComponent(cursorDocId)}`
        : `?pageSize=${tab.limit}`;
      ({ documents } = await api.get(`/api/connections/${tab.connId}/documents/${encodeURIComponentPath(tab.path)}${query}`));
    }
    tab.documents = documents;
    hideBanner();
  } catch (err) {
    showBanner(`Erro ao carregar ${tab.path}: ${err.message}`);
  }
  if (tab.id === state.activeTabId) renderActiveTab();
}

async function refreshTab(connId, path) {
  const tab = getTabByPath(connId, path);
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
    row.addEventListener('click', () => openEditorForExisting(tab.connId, tab.path, doc.id));
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
    root.appendChild(buildTreeNode(doc.id, doc.data, () => openEditorForExisting(tab.connId, tab.path, doc.id)));
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
  loadConnections();

  document.getElementById('add-connection-btn').addEventListener('click', () => openConnectionModal(null));
  document.getElementById('connection-close-btn').addEventListener('click', closeConnectionModal);
  document.getElementById('connection-cancel-btn').addEventListener('click', closeConnectionModal);
  document.getElementById('connection-confirm-btn').addEventListener('click', submitConnection);
  document.getElementById('conn-type').addEventListener('change', updateConnectionModalFields);
  document.getElementById('connection-modal').addEventListener('click', (event) => {
    if (event.target.id === 'connection-modal') closeConnectionModal();
  });

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

  document.getElementById('import-json-close-btn').addEventListener('click', closeImportJsonModal);
  document.getElementById('import-json-cancel-btn').addEventListener('click', closeImportJsonModal);
  document.getElementById('import-json-confirm-btn').addEventListener('click', submitImportJson);
  document.getElementById('import-json-modal').addEventListener('click', (event) => {
    if (event.target.id === 'import-json-modal') closeImportJsonModal();
  });
  document.getElementById('import-json-text').addEventListener('input', (event) => {
    previewImportColumns(event.target.value);
  });
  document.getElementById('import-json-file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) loadImportJsonFile(file);
  });
  document.getElementById('import-json-mongo').addEventListener('change', () => {
    previewImportColumns(document.getElementById('import-json-text').value);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('connection-modal').hidden) {
      closeConnectionModal();
    }
    if (event.key === 'Escape' && !document.getElementById('create-collection-modal').hidden) {
      closeCreateCollectionModal();
    }
    if (event.key === 'Escape' && !document.getElementById('import-json-modal').hidden) {
      closeImportJsonModal();
    }
    if (event.key === 'Escape' && !document.getElementById('indexes-modal').hidden) {
      closeIndexesModal();
    }
  });
});

const TYPE_OPTIONS = ['string', 'number', 'boolean', 'null', 'timestamp', 'geopoint', 'reference', 'bytes', 'map', 'array'];

function updateDocIdHint() {
  const isNew = state.editingDoc && state.editingDoc.isNew;
  const input = document.getElementById('field-doc-id');
  document.getElementById('doc-id-hint').hidden = !(isNew && !input.value.trim());
}

function openEditor(docId, connId, collectionPath, data) {
  state.editingDoc = { connId, collectionPath, id: docId, isNew: docId === null };
  const isNew = state.editingDoc.isNew;
  document.getElementById('editor-title').textContent = isNew ? 'Adicionar um documento' : 'Editar documento';
  document.getElementById('editor-parent-path').textContent = `/${collectionPath}`;
  document.getElementById('editor-panel').hidden = false;

  const idInput = document.getElementById('field-doc-id');
  idInput.value = isNew ? '' : docId;
  idInput.disabled = !isNew;
  document.getElementById('auto-id-btn').hidden = !isNew;
  updateDocIdHint();

  renderEditorFields(data || {});
  document.getElementById('delete-doc-btn').hidden = isNew;
  document.getElementById('save-add-another-btn').hidden = !isNew;
}

async function openEditorForExisting(connId, collectionPath, docId) {
  try {
    const doc = await api.get(`/api/connections/${connId}/document/${encodeURIComponentPath(`${collectionPath}/${docId}`)}`);
    openEditor(docId, connId, collectionPath, doc.data);
  } catch (err) {
    showBanner(`Erro ao abrir documento: ${err.message}`);
  }
}

function openEditorForNew(connId, collectionPath) {
  openEditor(null, connId, collectionPath, {});
}

function detectType(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object' && value.__type) return value.__type;
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'map';
  return typeof value;
}

function renumberLevel(level, prefix) {
  let i = 0;
  Array.from(level.children).forEach((row) => {
    if (!row.classList.contains('field-row')) return;
    i += 1;
    const num = prefix ? `${prefix}.${i}` : `${i}`;
    row.querySelector(':scope > .field-num').textContent = num;
    const children = row.querySelector(':scope > .field-children');
    if (children) renumberLevel(children, num);
  });
}

function renumberEditor() {
  renumberLevel(document.getElementById('editor-fields'), '');
}

function buildFieldsLevel(dataObj) {
  const level = document.createElement('div');
  level.className = 'field-children';
  Object.entries(dataObj).forEach(([k, v]) => level.appendChild(buildFieldRow(k, v)));
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'add-field-btn';
  addBtn.textContent = '+ Adicionar campo';
  addBtn.addEventListener('click', () => {
    level.insertBefore(buildFieldRow('', ''), addBtn);
    renumberEditor();
  });
  level.appendChild(addBtn);
  return level;
}

function renderEditorFields(data) {
  const container = document.getElementById('editor-fields');
  container.innerHTML = '';
  Object.entries(data).forEach(([key, value]) => container.appendChild(buildFieldRow(key, value)));

  const addFieldBtn = document.createElement('button');
  addFieldBtn.type = 'button';
  addFieldBtn.id = 'add-field-btn';
  addFieldBtn.className = 'add-field-btn';
  addFieldBtn.textContent = '+ Adicionar campo';
  addFieldBtn.addEventListener('click', () => {
    container.insertBefore(buildFieldRow('', ''), addFieldBtn);
    renumberEditor();
  });
  container.appendChild(addFieldBtn);
  renumberEditor();
}

function buildFieldRow(key, value) {
  const type = detectType(value);
  const row = document.createElement('div');
  row.className = 'field-row';
  row.dataset.type = type;

  const num = document.createElement('div');
  num.className = 'field-num';

  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.className = 'expand-toggle';
  expandBtn.textContent = '▾';

  const main = document.createElement('div');
  main.className = 'field-main';

  const keyCol = document.createElement('div');
  keyCol.className = 'field-col';
  keyCol.innerHTML = '<label>Nome do campo *</label>';
  const keyInput = document.createElement('input');
  keyInput.className = 'field-key';
  keyInput.value = key;
  keyInput.placeholder = 'nome do campo';
  keyCol.appendChild(keyInput);

  const typeCol = document.createElement('div');
  typeCol.className = 'field-col';
  typeCol.innerHTML = '<label>Tipo de campo</label>';
  const typeSelect = document.createElement('select');
  typeSelect.className = 'field-type';
  TYPE_OPTIONS.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (t === type) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeCol.appendChild(typeSelect);

  const valueCol = document.createElement('div');
  valueCol.className = 'field-col field-value-col';
  valueCol.innerHTML = '<label>Valor do campo</label>';
  const valueContainer = document.createElement('div');
  valueContainer.className = 'field-value';
  valueCol.appendChild(valueContainer);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-field-btn';
  removeBtn.textContent = '🗑';
  removeBtn.title = 'Remover campo';
  removeBtn.addEventListener('click', () => {
    row.remove();
    renumberEditor();
  });

  main.appendChild(keyCol);
  main.appendChild(typeCol);
  main.appendChild(valueCol);
  main.appendChild(removeBtn);

  row.appendChild(num);
  row.appendChild(expandBtn);
  row.appendChild(main);

  let childrenLevel = null;
  function applyType(newType, newValue) {
    row.dataset.type = newType;
    expandBtn.hidden = newType !== 'map';
    if (childrenLevel) {
      childrenLevel.remove();
      childrenLevel = null;
    }
    if (newType === 'map') {
      valueCol.hidden = true;
      childrenLevel = buildFieldsLevel(newValue && typeof newValue === 'object' && !Array.isArray(newValue) ? newValue : {});
      row.appendChild(childrenLevel);
    } else {
      valueCol.hidden = false;
      renderValueInput(valueContainer, newType, newValue);
    }
    renumberEditor();
  }

  typeSelect.addEventListener('change', () => applyType(typeSelect.value, defaultValueForType(typeSelect.value)));
  expandBtn.addEventListener('click', () => {
    if (!childrenLevel) return;
    const collapsed = childrenLevel.hidden;
    childrenLevel.hidden = !collapsed;
    expandBtn.textContent = collapsed ? '▾' : '▸';
  });

  applyType(type, value);
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
    case 'map': return {};
    case 'array': return [];
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
  } else if (type === 'array') {
    const textarea = document.createElement('textarea');
    textarea.className = 'value-input json-input';
    textarea.value = JSON.stringify(value ?? [], null, 2);
    container.appendChild(textarea);
  }
}

function readFieldRow(row) {
  const type = row.dataset.type;
  const container = row.querySelector(':scope > .field-main .field-value');
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

function collectLevel(level) {
  const data = {};
  Array.from(level.children).forEach((row) => {
    if (!row.classList.contains('field-row')) return;
    const keyInput = row.querySelector(':scope > .field-main .field-key');
    const key = keyInput.value.trim();
    if (!key) return;
    if (row.dataset.type === 'map') {
      const children = row.querySelector(':scope > .field-children');
      data[key] = children ? collectLevel(children) : {};
    } else {
      data[key] = readFieldRow(row);
    }
  });
  return data;
}

function collectEditorData() {
  return collectLevel(document.getElementById('editor-fields'));
}

document.getElementById('editor-close-btn').addEventListener('click', () => {
  document.getElementById('editor-panel').hidden = true;
  state.editingDoc = null;
});

document.getElementById('cancel-doc-btn').addEventListener('click', () => {
  document.getElementById('editor-panel').hidden = true;
  state.editingDoc = null;
});

document.getElementById('auto-id-btn').addEventListener('click', () => {
  const input = document.getElementById('field-doc-id');
  input.value = '';
  input.focus();
  updateDocIdHint();
});

document.getElementById('field-doc-id').addEventListener('input', updateDocIdHint);

async function saveActiveDocument() {
  const data = collectEditorData();
  const { isNew, connId, collectionPath, id } = state.editingDoc;
  if (isNew) {
    const idInput = document.getElementById('field-doc-id').value.trim();
    await api.send('POST', `/api/connections/${connId}/document/${encodeURIComponentPath(collectionPath)}`, {
      id: idInput || undefined,
      data,
    });
  } else {
    await api.send('PUT', `/api/connections/${connId}/document/${encodeURIComponentPath(`${collectionPath}/${id}`)}`, { data });
  }
  return { connId, collectionPath };
}

document.getElementById('save-doc-btn').addEventListener('click', async () => {
  try {
    const { connId, collectionPath } = await saveActiveDocument();
    document.getElementById('editor-panel').hidden = true;
    state.editingDoc = null;
    await refreshTab(connId, collectionPath);
  } catch (err) {
    showBanner(`Erro ao salvar: ${err.message}`);
  }
});

document.getElementById('save-add-another-btn').addEventListener('click', async () => {
  try {
    const { connId, collectionPath } = await saveActiveDocument();
    await refreshTab(connId, collectionPath);
    openEditorForNew(connId, collectionPath);
  } catch (err) {
    showBanner(`Erro ao salvar: ${err.message}`);
  }
});

document.getElementById('delete-doc-btn').addEventListener('click', async () => {
  if (!confirm('Apagar este documento?')) return;
  try {
    const { connId, collectionPath, id } = state.editingDoc;
    await api.send('DELETE', `/api/connections/${connId}/document/${encodeURIComponentPath(`${collectionPath}/${id}`)}`);
    document.getElementById('editor-panel').hidden = true;
    state.editingDoc = null;
    await refreshTab(connId, collectionPath);
  } catch (err) {
    showBanner(`Erro ao apagar: ${err.message}`);
  }
});

document.getElementById('add-doc-btn').addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab) openEditorForNew(tab.connId, tab.path);
});

document.getElementById('import-json-btn').addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab) openImportJsonModal(tab.connId, tab.path);
});

document.getElementById('indexes-btn').addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab) openIndexesModal(tab.connId, tab.path);
});

document.getElementById('indexes-close-btn').addEventListener('click', closeIndexesModal);
document.getElementById('indexes-cancel-btn').addEventListener('click', closeIndexesModal);
document.getElementById('indexes-confirm-btn').addEventListener('click', submitCreateIndex);
document.getElementById('indexes-add-field-btn').addEventListener('click', addIndexFieldRow);
document.getElementById('indexes-modal').addEventListener('click', (event) => {
  if (event.target.id === 'indexes-modal') closeIndexesModal();
});
