# Ponte WhatsApp → CRM Orium

Conecta o WhatsApp da loja (pelo QR code, como o WhatsApp Web) ao CRM do Admin.
Conexão **não oficial** (Baileys): o número pode ser bloqueado pelo WhatsApp se
houver envio em massa. O CRM só envia mensagens uma a uma, por clique.

## Rodar

```bash
cd bridge
npm install
cp .env.example .env   # preencha os três valores
npm start
```

O QR aparece em **Admin → Clientes → Conversas**. Escaneie em
WhatsApp → Aparelhos conectados → Conectar aparelho. A sessão fica em `auth/`
(nunca vai para o git). Para desconectar, remova o aparelho no celular.

## Token

`BRIDGE_TOKEN` é conferido pelo banco (hash sha256 em `wa_bridge_state.token_hash`).
Para trocar: gere um texto aleatório de 64 caracteres, grave o hash com
`update wa_bridge_state set token_hash = encode(digest('<token>','sha256'),'hex')`
e coloque o token no `.env`.

## Servidor 24h (Oracle Cloud Always Free, Ubuntu)

```bash
sudo apt-get update && sudo apt-get install -y nodejs npm git
git clone <repo> && cd orium-app/bridge && npm install
# copie .env e (opcional) a pasta auth/ do computador atual
sudo tee /etc/systemd/system/orium-wa.service >/dev/null <<'EOF'
[Unit]
Description=Ponte WhatsApp Orium
After=network-online.target
[Service]
WorkingDirectory=/home/ubuntu/orium-app/bridge
ExecStart=/usr/bin/node index.mjs
Restart=always
RestartSec=5
User=ubuntu
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now orium-wa
```
