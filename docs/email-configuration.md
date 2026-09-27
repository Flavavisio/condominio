# Email oficial da Condomia

Remetente e resposta: **Condomia <geral.condomia@gmail.com>**.

## Estado

O endereço está definido como contacto público. O envio pelo Gmail ainda depende da autenticação SMTP no servidor. Não guardar a palavra-passe no repositório, no JavaScript público ou em conversas.

## Autenticação Supabase

Configurar Custom SMTP em Authentication → Email → SMTP Settings:

| Campo | Valor |
| --- | --- |
| Sender email | geral.condomia@gmail.com |
| Sender name | Condomia |
| Host | smtp.gmail.com |
| Port | 465 (TLS) |
| Username | geral.condomia@gmail.com |
| Password | Palavra-passe de aplicação criada na conta Google |

A conta Google precisa de verificação em dois passos para criar uma palavra-passe de aplicação. Se a opção não estiver disponível, resolver as restrições da conta ou usar uma integração OAuth; não usar a palavra-passe normal da conta.

Configuração do projeto: https://supabase.com/dashboard/project/pvfrlirjdauncoudkomu/auth/smtp
Palavras-passe de aplicação: https://myaccount.google.com/apppasswords

## Limites do que esta configuração ativa

O SMTP do Supabase Auth serve os emails de autenticação, como confirmação, convite por email e recuperação de acesso. O fluxo atual de criação direta de utilizadores não envia email nem palavras-passe.

Os avisos operacionais (licenças, ocorrências, assembleias e pagamentos) ainda não têm transporte por email. Atualmente usam as notificações da aplicação e o serviço de push existente. Necessitam de um serviço de envio no servidor com controlo de destinatários, deduplicação e registo de falhas; configurar o SMTP de Auth não ativa esses avisos.

Após configurar a credencial, validar o remetente, a resposta e os links com um envio de teste autorizado antes de ativar emails automáticos.
