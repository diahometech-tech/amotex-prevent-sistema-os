#!/usr/bin/env bash
# Busca logs de erro/execução da VPS (PM2) das últimas N horas, para a revisão
# diária de erros (skill nexusflow-error-review). Roda a partir da máquina
# local que já tem acesso SSH configurado à VPS da Contex.
#
# Uso: scripts/nexusflow-fetch-logs.sh [horas] [destino]
#   horas    janela de tempo a considerar (default: 24)
#   destino  arquivo de saída (default: stdout)
#
# Variáveis de ambiente (configure no seu shell/perfil local, não neste repo):
#   NEXUSFLOW_VPS_HOST   host/alias SSH da VPS (ex.: "contex-vps" do seu ~/.ssh/config,
#                        ou "user@ip"). Sem default — obrigatório.
#   NEXUSFLOW_PM2_APP    nome do app no PM2 (default: "nexusflow")
#
# Aceita tanto ~/.pm2/logs/<app>-error.log quanto o layout com índice de
# instância (<app>-error-0.log, o que o PM2 usa por padrão em várias versões)
# e que ecosystem.config.js já tem `log_date_format` definido (senão as linhas
# não têm timestamp e o filtro de janela de tempo não funciona).

set -euo pipefail

HOURS="${1:-24}"
DEST="${2:-/dev/stdout}"
APP="${NEXUSFLOW_PM2_APP:-nexusflow}"

if [ -z "${NEXUSFLOW_VPS_HOST:-}" ]; then
  echo "Erro: defina NEXUSFLOW_VPS_HOST (host/alias SSH da VPS). Veja suas notas de referência da VPS." >&2
  exit 1
fi

SINCE_EPOCH=$(date -u -d "-${HOURS} hours" +%s 2>/dev/null || date -u -v-"${HOURS}"H +%s)

REMOTE_CMD=$(cat <<'REMOTE'
shopt -s nullglob
for f in "$HOME"/.pm2/logs/APP_NAME-error*.log "$HOME"/.pm2/logs/APP_NAME-out*.log; do
  cat "$f"
done
true
REMOTE
)
REMOTE_CMD="${REMOTE_CMD//APP_NAME/$APP}"

ssh "$NEXUSFLOW_VPS_HOST" "$REMOTE_CMD" | awk -v since="$SINCE_EPOCH" '
{
  # Espera linhas no formato "YYYY-MM-DD HH:mm:ss Z00: mensagem..." (log_date_format do PM2)
  if (match($0, /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/)) {
    ts = substr($0, RSTART, 19)
    cmd = "date -u -d \"" ts "\" +%s 2>/dev/null || date -u -j -f \"%Y-%m-%d %H:%M:%S\" \"" ts "\" +%s 2>/dev/null"
    cmd | getline epoch
    close(cmd)
    if (epoch != "" && epoch+0 >= since+0) print
  } else {
    # Linha sem timestamp reconhecível (stack trace multi-linha) — inclui,
    # pertence ao bloco anterior.
    print
  }
}' > "$DEST"

echo "Logs de '$APP' (últimas ${HOURS}h) salvos em: $DEST" >&2
