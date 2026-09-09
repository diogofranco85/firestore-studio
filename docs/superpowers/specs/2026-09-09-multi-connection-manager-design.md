# Gerenciador de conexões (multi-Firestore, estilo DBeaver)

## Objetivo

Hoje o app conecta em um único Firestore fixo pelo `.env` (`FIRESTORE_PROJECT_ID`,
`FIRESTORE_EMULATOR_HOST`). O usuário quer poder cadastrar várias conexões
(emulador ou produção), salvas em um banco SQL local, e navegar entre elas
pela barra lateral — conexão no topo, coleções dentro de cada uma, como no
DBeaver.

## Armazenamento

`node:sqlite` (nativo do Node 24, sem dependência nova). Arquivo
`.data/connections.db` (adicionado ao `.gitignore`).

```sql
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('emulator', 'production')),
  project_id TEXT NOT NULL,
  emulator_host TEXT,      -- obrigatório quando type = 'emulator'
  credential_json TEXT,    -- obrigatório quando type = 'production'
  created_at TEXT NOT NULL
);
```

Na primeira execução, se a tabela estiver vazia, semeia uma conexão
"Emulador padrão" a partir do `.env` atual (mesmo comportamento de hoje),
para não quebrar o fluxo existente.

## Cliente Firestore por conexão

`server/firestoreClient.js` deixa de exportar um `db` singleton. Passa a
exportar `getClient(connectionId)`, que:

1. Consulta o cache em memória (`Map<connectionId, Firestore>`); se existir, retorna.
2. Caso contrário, lê a conexão no SQLite e cria um Firebase app nomeado
   (`admin.initializeApp(options, connectionId)`):
   - `emulator`: `admin.initializeApp({ projectId }, connectionId)` seguido de
     `firestore.settings({ host: emulatorHost, ssl: false })` — evita usar a
     env var global `FIRESTORE_EMULATOR_HOST`, que não suporta hosts
     diferentes por conexão.
   - `production`: `admin.initializeApp({ credential: admin.credential.cert(JSON.parse(credentialJson)) }, connectionId)`.
3. Guarda no cache e retorna.

Erros de credencial inválida ou host inalcançável propagam para a rota, que
já trata erros de conexão (`handleError`) e devolve mensagem amigável.

## API

CRUD de conexões:
- `GET /api/connections` → lista sem `credential_json`.
- `POST /api/connections` → cria.
- `PUT /api/connections/:id` → edita.
- `DELETE /api/connections/:id` → remove (e derruba o client do cache, se existir).

Dados (rotas atuais, agora aninhadas sob a conexão):
- `GET /api/connections/:connId/collections[/*]`
- `GET /api/connections/:connId/documents/*`
- `GET/POST/PUT/DELETE /api/connections/:connId/document/*`
- `POST /api/connections/:connId/query/*`

`firestoreService.js` passa a receber `db` (o client Firestore) como primeiro
parâmetro de cada função, em vez de importar um singleton do módulo.

## Frontend

Sidebar em duas camadas:
- Topo: lista de conexões, cada uma com nome + botão de expandir; menu de
  contexto (editar/excluir) e botão "+ Nova conexão".
- Dentro de cada conexão expandida: lista plana de coleções (reaproveita a
  UI simplificada atual), cada uma abrindo aba como hoje.

Modal "Nova/editar conexão": nome, tipo (emulador/produção), project ID, e
campo condicional — host do emulador, ou textarea para colar o JSON da
credencial (produção).

Cada aba passa a guardar `connectionId` além de `path`, usado para montar as
URLs das chamadas.

## Testes

Ajusta `test/firestoreService.test.js` para criar uma conexão via
`server/connectionsStore.js` diretamente (sem precisar de emulador de
produção) e obter o client via `getClient` antes de rodar os testes
existentes de CRUD/query. Adiciona um teste simples do
`connectionsStore` (criar, listar, excluir).

## Fora de escopo

- Sem criptografia do `credential_json` no SQLite — é um banco local de uso
  pessoal, mesma confiança do `.env` atual.
- Sem botão "testar conexão" separado — o próprio ato de expandir a conexão
  (listar coleções) já valida e mostra erro inline se falhar.
