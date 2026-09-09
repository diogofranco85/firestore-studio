const state = {
  currentPath: null,
  documents: [],
  pageSize: 50,
  cursorStack: [],
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
  nameSpan.addEventListener('click', () => selectCollection(path));

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
