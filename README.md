# supabase-to-sheets

Sincronização em tempo real entre o Supabase e o Google Sheets.  
Toda vez que um processo é **criado ou editado** na tabela `processes`, o webhook atualiza automaticamente a planilha **GEINFRA (Obras)**.

---

## Arquitetura

```
Seu site
   │  cria/edita processo
   ▼
Supabase (tabela: processes)
   │  dispara Database Webhook
   ▼
Este servidor Express (POST /webhook/process)
   │  busca dados completos com joins
   ▼
Google Sheets (aba: GEINFRA (Obras))
```

---

## Colunas sincronizadas

| Coluna Supabase           | Cabeçalho na Planilha |
|---------------------------|-----------------------|
| `process_number`          | SGPE (link clicável)  |
| `regional_nucleus_id`     | NÚCLEO ORIGEM         |
| `municipality_id`         | MUNICÍPIO             |
| `object`                  | OBJETO                |
| `total_concedent_value`   | VALOR CONCEDENTE      |
| `total_proponente_value`  | CONTRAPARTIDA         |
| `licitado_value`          | VALOR LICITADO        |
| `vigencia_date`           | VIGÊNCIA PT           |
| `portaria_number`         | PORTARIA              |

> O número do processo (SGPE) é exibido como link clicável usando o campo `link_plataforma_governo` do banco.

---

## Configuração

### 1. Clonar o repositório

```bash
git clone https://github.com/seu-usuario/supabase-to-sheets.git
cd supabase-to-sheets
npm install
```

### 2. Configurar variáveis de ambiente

Copie o arquivo de exemplo e preencha:

```bash
cp .env.example .env
```

| Variável                     | Descrição                                              |
|------------------------------|--------------------------------------------------------|
| `SUPABASE_URL`               | URL do seu projeto Supabase                            |
| `SUPABASE_SERVICE_ROLE_KEY`  | Chave service role (Settings → API)                    |
| `GOOGLE_SPREADSHEET_ID`      | ID da planilha no Google Sheets                        |
| `GOOGLE_SHEET_NAME`          | Nome da aba (padrão: `GEINFRA (Obras)`)                |
| `GOOGLE_SERVICE_ACCOUNT_JSON`| JSON da conta de serviço Google (em uma linha)         |
| `WEBHOOK_SECRET`             | Secret para validar chamadas do Supabase               |
| `PORT`                       | Porta do servidor (padrão: `3000`)                     |

---

### 3. Configurar Google Sheets API

1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. Crie um projeto (ou use um existente)
3. Ative a **Google Sheets API**
4. Vá em **IAM & Admin → Service Accounts** → crie uma conta de serviço
5. Gere uma chave JSON (Actions → Manage keys → Add key → JSON)
6. Copie o conteúdo do JSON **em uma única linha** e cole em `GOOGLE_SERVICE_ACCOUNT_JSON`
7. **Compartilhe a planilha** com o e-mail da conta de serviço (ex: `nome@projeto.iam.gserviceaccount.com`) com permissão de **Editor**

---

### 4. Configurar o Webhook no Supabase

1. No painel Supabase: **Database → Webhooks → Create a new hook**
2. Configure:
   - **Name:** `sync-to-sheets`
   - **Table:** `processes`
   - **Events:** ✅ Insert  ✅ Update
   - **Type:** HTTP Request
   - **URL:** `https://SEU-SERVIDOR/webhook/process`
   - **HTTP Headers:**
     ```
     x-webhook-secret: seu_secret_aqui
     Content-Type: application/json
     ```

---

### 5. Rodar localmente (para testes)

```bash
npm run dev
```

Para expor o servidor local ao Supabase durante testes, use o [ngrok](https://ngrok.com):

```bash
npx ngrok http 3000
# Copie a URL gerada (ex: https://abc123.ngrok.io) e use no webhook do Supabase
```

---

### 6. Configurar GitHub Actions (deploy automático)

Adicione os seguintes **secrets** no repositório (Settings → Secrets → Actions):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `WEBHOOK_SECRET`

O workflow em `.github/workflows/deploy.yml` valida os secrets a cada push na branch `main`.  
Para deploy automático, descomente o bloco do serviço de sua escolha (Railway, Render, Fly.io).

---

## Deploy em produção

Recomendamos o uso do **Railway** ou **Render** (ambos têm plano gratuito):

### Railway
1. Acesse [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Selecione este repositório
3. Adicione as variáveis de ambiente no painel do Railway
4. O servidor ficará disponível em uma URL pública

### Render
1. Acesse [render.com](https://render.com) → New → Web Service
2. Conecte ao repositório
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Adicione as variáveis de ambiente

---

## Estrutura do projeto

```
supabase-to-sheets/
├── .github/
│   └── workflows/
│       └── deploy.yml       # CI/CD GitHub Actions
├── src/
│   ├── server.js            # Servidor Express + endpoint webhook
│   ├── supabase.js          # Busca de processos com joins
│   └── sheets.js            # Upsert no Google Sheets
├── .env.example
├── .gitignore
├── package.json
└── README.md
```
