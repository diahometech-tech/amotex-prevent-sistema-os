#!/usr/bin/env bash
# Tira uma "foto" diária de contadores de campos essenciais do dossiê
# (Postgres de produção) e compara com o snapshot anterior — usado pela
# skill nexusflow-error-review pra detectar PERDA DE DADO real (arquivo
# anexado ou campo preenchido que sumiu), diferente de um bug de exibição
# (onde o dado continua no banco, só não aparece na tela).
#
# Nenhum destes campos deveria diminuir nunca — nada no fluxo do NexusFlow
# limpa um campo já preenchido (migrações do Postgres só fazem ADD COLUMN/
# UPDATE em campo vazio, nunca DROP/sobrescrita — ver db-postgres.ts) — uma
# queda aqui é sinal de dado perdido de verdade, não de fluxo normal.
#
# Uso: scripts/nexusflow-integrity-snapshot.sh [arquivo-historico]
#   arquivo-historico   CSV com o histórico de snapshots (default:
#                        docs/integridade-dados/historico.csv). Fica
#                        versionado no repo de propósito — é o que permite
#                        comparar com "ontem" de qualquer máquina.
#
# Variável de ambiente:
#   DATABASE_URL   mesma variável de produção (Postgres) — pegue do .env da
#                  VPS ou da memória do usuário, nunca commite.
#
# Sai com código 2 se QUALQUER contador caiu em relação ao snapshot
# anterior — a skill trata isso como achado CRÍTICO, não como um erro
# comum da revisão diária.

set -euo pipefail

HIST="${1:-docs/integridade-dados/historico.csv}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Erro: defina DATABASE_URL (mesma variável de produção). Veja suas notas de referência da VPS." >&2
  exit 1
fi

mkdir -p "$(dirname "$HIST")"

HEADER="data,total_os,certificado_a1,cartao_cnpj,certidao,cert_email,cert_aparelho,vinculo_email,vinculo_phone"

# Campos escolhidos a partir do relato real que motivou este script: A1
# anexado, cartão CNPJ e dados de vínculo do terceiro "sumindo". total_os
# entra como checagem de sanidade geral (exclui soft-delete via
# deleted_at) — não deveria cair nunca, só crescer ou ficar igual.
QUERY="SELECT COUNT(*) AS total_os,
  COUNT(*) FILTER (WHERE certificado_a1_url <> '') AS certificado_a1,
  COUNT(*) FILTER (WHERE cnpj_comprovante_url <> '') AS cartao_cnpj,
  COUNT(*) FILTER (WHERE certidao_inteiro_teor_url <> '') AS certidao,
  COUNT(*) FILTER (WHERE cert_email <> '') AS cert_email,
  COUNT(*) FILTER (WHERE cert_aparelho <> '') AS cert_aparelho,
  COUNT(*) FILTER (WHERE t2_new_email <> '') AS vinculo_email,
  COUNT(*) FILTER (WHERE t2_new_phone <> '') AS vinculo_phone
FROM dossiers WHERE deleted_at IS NULL;"

ROW=$(psql "$DATABASE_URL" -t -A -F',' -c "$QUERY")
TODAY=$(date -u +%F)
NEW_LINE="${TODAY},${ROW}"

if [ ! -f "$HIST" ]; then
  echo "$HEADER" > "$HIST"
fi

# Compara com a última linha JÁ EXISTENTE antes de gravar a nova.
LAST_LINE=$(tail -n 1 "$HIST" 2>/dev/null || true)
ALERTAS=""
if [ -n "$LAST_LINE" ] && [ "$LAST_LINE" != "$HEADER" ]; then
  IFS=',' read -r _ last_total last_a1 last_cnpj last_certidao last_cemail last_caparelho last_vemail last_vphone <<< "$LAST_LINE"
  IFS=',' read -r new_total new_a1 new_cnpj new_certidao new_cemail new_caparelho new_vemail new_vphone <<< "$ROW"

  check() {
    local nome="$1" antigo="$2" novo="$3"
    if [ "$novo" -lt "$antigo" ]; then
      ALERTAS="${ALERTAS}⚠️  ${nome}: caiu de ${antigo} para ${novo} (diferença: $((antigo - novo)))\n"
    fi
  }
  check "total_os"       "$last_total"     "$new_total"
  check "certificado_a1" "$last_a1"        "$new_a1"
  check "cartao_cnpj"    "$last_cnpj"      "$new_cnpj"
  check "certidao"       "$last_certidao"  "$new_certidao"
  check "cert_email"     "$last_cemail"    "$new_cemail"
  check "cert_aparelho"  "$last_caparelho" "$new_caparelho"
  check "vinculo_email"  "$last_vemail"    "$new_vemail"
  check "vinculo_phone"  "$last_vphone"    "$new_vphone"
fi

echo "$NEW_LINE" >> "$HIST"

if [ -n "$ALERTAS" ]; then
  echo "🚨 POSSÍVEL PERDA DE DADO — contador(es) essencial(is) caiu(caíram) desde o último snapshot:" >&2
  echo -e "$ALERTAS" >&2
  exit 2
fi

echo "Snapshot de integridade OK — nenhum contador caiu. Registrado em: $HIST" >&2
