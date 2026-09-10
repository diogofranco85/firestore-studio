# Firestore Studio

Interface web local para navegar, consultar e editar dados do Firestore — tanto do emulador quanto de projetos de produção — sem depender do Console do Firebase.

## Funcionalidades

- Gerenciar várias conexões (emulador e produção) e alternar entre elas.
- Navegar coleções e subcoleções em uma árvore lateral.
- Visualizar documentos em tabela, árvore ou JSON.
- Consultas com filtros `where`, `orderBy` e `limit`.
- Criar, editar e apagar documentos com campos tipados (string, número, booleano, mapa, array, timestamp, geopoint, referência, bytes).
- Importar documentos em lote via JSON (colado ou arquivo), com opção de converter Extended JSON exportado do MongoDB (`$oid`, `$date`, `$numberDecimal` etc.) para os tipos equivalentes do Firestore.
- Criar, listar e excluir índices compostos (apenas conexões de produção — o emulador não exige índices).

## Requisitos

- Node.js 22+ (usa o módulo nativo `node:sqlite`).
- Para conexões de produção: uma credencial de service account com permissão no projeto do Firestore.

## Instalação

### Uso local no repositório

```bash
npm install
npm start        # produção
npm run dev       # com reinício automático (nodemon)
```

O servidor sobe em `http://localhost:4001` (configurável, veja abaixo).

### Instalação global (comando `firestore-studio`)

```bash
npm install -g .
# ou, para manter sincronizado com o repositório via symlink:
npm link
```

Depois disso, rode de qualquer diretório:

```bash
firestore-studio
```

Para desinstalar: `npm uninstall -g firestore-studio`.

## Configuração

Variáveis de ambiente (podem ser definidas no ambiente ou em um arquivo `.env` no diretório onde o comando é executado — veja `.env.example`):

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `4001` | Porta do servidor web. |
| `FIRESTORE_PROJECT_ID` | `floci-gcp` | Project ID padrão usado ao criar a conexão inicial do emulador. |
| `FIRESTORE_EMULATOR_HOST` | `localhost:4588` | Host:porta do emulador usado pela conexão inicial. |
| `CONNECTIONS_DB_PATH` | `~/.firestore-studio/connections.db` | Caminho do banco SQLite onde as conexões cadastradas ficam salvas. |

Na primeira execução, uma conexão "Emulador padrão" é criada automaticamente usando `FIRESTORE_PROJECT_ID`/`FIRESTORE_EMULATOR_HOST`. Outras conexões (emulador ou produção) são adicionadas pela própria interface, em "+ Nova Conexão" — para produção, cole o JSON da credencial do service account.

## API

Todas as rotas ficam sob `/api`:

- `GET /connections` / `POST /connections` / `PUT /connections/:id` / `DELETE /connections/:id`
- `GET /connections/:connId/collections`
- `GET /connections/:connId/collections/*` (subcoleções de um documento)
- `GET /connections/:connId/documents/*`
- `POST /connections/:connId/query/*`
- `GET /connections/:connId/document/*` / `POST` / `PUT` / `DELETE`
- `POST /connections/:connId/import/*` (importação em lote)
- `GET /connections/:connId/indexes/*` / `POST` / `DELETE` (índices compostos, apenas conexões de produção)

## Testes

```bash
npm test
```

Roda a suíte com `node --test` (sem framework externo).

## Estrutura do projeto

```
server/     API Express, acesso ao Firestore e ao banco de conexões
public/     frontend estático (HTML/CSS/JS puro, sem build step)
bin/        entry point do comando global `firestore-studio`
test/       testes (node --test)
```
