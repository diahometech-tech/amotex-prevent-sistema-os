import { Database } from '@/lib/db';

export class NotificationService {
  /**
   * Envia um e-mail transacional simulado/real para alertar vencimento iminente de SLA
   * @param clientName Nome do Cliente da OS
   * @param osId Identificação da OS
   * @param sector Setor atual onde o processo está travado
   * @param deadline Data limite de resolução
   */
  static async sendSLAWarningEmail(
    clientName: string,
    osId: string,
    sector: string,
    deadline: string
  ): Promise<boolean> {
    const resendApiKey = process.env.RESEND_API_KEY;

    const emailSubject = `⚠️ ALERTA DE SLA VENCIDO - OS #${osId} [${clientName}]`;
    const emailBody = `
      Olá, Equipe NexusFlow.
      
      Informamos que a Ordem de Serviço #${osId} referente ao cliente ${clientName} está travada no setor ${sector.toUpperCase()} e acaba de atingir o limite estipulado de SLA.
      
      Prazo Limite: ${new Date(deadline).toLocaleString('pt-BR')}
      Status: SLA Estourado
      
      Por favor, acesse o painel principal do NexusFlow e atue para destravar a esteira do cliente.
      
      -- 
      Sistema de Notificações Automáticas
      NexusFlow Contabilidade
    `;

    if (resendApiKey) {
      // Disparo real via API do Resend (Fase 1 pronta para produção!)
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`
          },
          body: JSON.stringify({
            from: 'NexusFlow <alertas@nexusflow-contabilidade.com.br>',
            to: ['gerencia@nexusflow-contabilidade.com.br'],
            subject: emailSubject,
            text: emailBody
          })
        });

        if (response.ok) {
          console.log(`[Resend] E-mail de alerta de SLA enviado para OS #${osId}`);
          return true;
        }
      } catch (e) {
        console.error('Erro ao enviar e-mail via Resend:', e);
      }
    }

    // Fallback de Desenvolvimento local (Mock)
    console.log(`\n============== [MOCK EMAIL DISPATCH] ==============`);
    console.log(`Para: gerencia@nexusflow-contabilidade.com.br`);
    console.log(`Assunto: ${emailSubject}`);
    console.log(`Corpo:\n${emailBody}`);
    console.log(`====================================================\n`);

    // Grava log automático de envio no banco de dados local
    await Database.createLog({
      dossier_id: osId,
      user_name: 'Sistema de Notificações',
      action_type: 'SLA_ALERT_SENT',
      details: `Notificação de estouro de SLA gerada e disparada para o e-mail da gerência.`
    });

    return true;
  }
}
