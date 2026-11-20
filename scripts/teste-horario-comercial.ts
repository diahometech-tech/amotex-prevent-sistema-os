// Confere a regra de horário comercial (src/lib/horario-comercial.ts).
// Rodar: npx tsx scripts/teste-horario-comercial.ts
import { periodoAtendimento } from '../src/lib/horario-comercial';

// Horários em Brasília (UTC-3, sem horário de verão desde 2019).
const casos: [string, string, 'comercial' | 'plantao'][] = [
  ['seg 07:59', '2026-11-16T10:59:00Z', 'plantao'],
  ['seg 08:00', '2026-11-16T11:00:00Z', 'comercial'],
  ['sex 17:59', '2026-11-20T20:59:00Z', 'comercial'],
  ['sex 18:00', '2026-11-20T21:00:00Z', 'plantao'],
  ['sáb 08:00', '2026-11-21T11:00:00Z', 'comercial'],
  ['sáb 15:59', '2026-11-21T18:59:00Z', 'comercial'],
  ['sáb 16:00', '2026-11-21T19:00:00Z', 'plantao'],
  ['dom 12:00', '2026-11-22T15:00:00Z', 'plantao'],
  ['seg 01:00 (UTC ainda é domingo)', '2026-11-16T04:00:00Z', 'plantao'],
];
let falhas = 0;
for (const [nome, iso, esperado] of casos) {
  const obtido = periodoAtendimento(new Date(iso));
  if (obtido !== esperado) {
    falhas++;
    console.error(`FALHOU ${nome}: esperado ${esperado}, veio ${obtido}`);
  }
}
if (falhas) process.exit(1);
console.log(`ok — ${casos.length} casos`);
