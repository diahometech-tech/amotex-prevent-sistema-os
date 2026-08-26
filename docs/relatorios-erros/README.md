# Relatórios de revisão diária de erros

Gerados pela skill `nexusflow-error-review` (`.claude/skills/nexusflow-error-review/SKILL.md`),
cruzando logs de execução (PM2, VPS) com a trilha de auditoria (`activity_logs`/`session_logs`,
Postgres) das últimas 24h.

- `INDICE.md` — uma linha por dia; dias sem ocorrência nova não geram arquivo próprio.
- `YYYY-MM-DD.md` — relatório detalhado, só nos dias com achado novo.
