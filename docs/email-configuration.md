# Email oficial da Condomia

Remetente e resposta: **Condomia <geral.condomia@gmail.com>**.

## Edge Function de avisos

`email-dispatch` usa o segredo `GMAIL_APP_PASSWORD` exclusivamente no servidor, SMTP Gmail com TLS na porta 465 e Nodemailer 10.0.11. A função exige `x-cron-secret`, validado contra a configuração privada `email_dispatch_config`; não aceita destinatários nem conteúdo fornecidos pelo cliente. Nunca guardar a palavra-passe no código.

O cron `condomia-email-dispatch` processa a fila a cada dois minutos, até cinco avisos por chamada, com um limite conservador de 400 mensagens reclamadas nas últimas 24 horas. Os destinatários vêm dos utilizadores associados às notificações; o acesso é verificado novamente antes do envio. Cada email tem um único destinatário.

Inclui novos avisos de licenças, ocorrências aprovadas, manutenção e serviços já gerados pela aplicação; acrescenta avisos aos moradores para assembleias agendadas, votações publicadas e avisos publicados imediatamente, bem como o resultado da validação do próprio comprovativo. Não importa avisos antigos nem envia palavras-passe.

A fila `notification_emails` regista `pending`, `sending`, `retry`, `sent`, `skipped` ou `review`. `sent` significa aceite pelo servidor SMTP, não confirmação de leitura nem garantia de chegada à caixa de entrada. Falhas seguras de conexão têm tentativas limitadas. Envios com resultado incerto ficam em `review` para evitar repetição automática. A configuração e fila têm RLS e estão inacessíveis a clientes; apenas service_role e tarefas internas as utilizam.

Para pausar: `update public.email_dispatch_config set enabled=false where id=1;` (operação administrativa no servidor).

Os modos autenticados `verify` (apenas autenticação SMTP) e `test` (email fixo para a própria conta oficial) permitem verificar a ligação sem indicar destinatários externos. A autenticação e a aceitação SMTP do teste foram verificadas em 27/09/2026.

Teste transacional: `supabase/tests/email-delivery.sql`.

## Emails de autenticação: configuração separada

A Edge Function não substitui o SMTP de Supabase Auth. Confirmação de conta, convite de autenticação e recuperação de palavra-passe exigem Custom SMTP em Authentication → Email → SMTP Settings:

| Campo | Valor |
| --- | --- |
| Sender email / Username | geral.condomia@gmail.com |
| Sender name | Condomia |
| Host | smtp.gmail.com |
| Port | 465 |
| Password | Palavra-passe de aplicação, colocada diretamente no dashboard |

https://supabase.com/dashboard/project/pvfrlirjdauncoudkomu/auth/smtp

A criação direta de utilizadores continua sem enviar palavras-passe por email.

## Layout comum

`supabase/functions/email-dispatch/layout.js` centraliza o HTML, alternativa de texto e logótipo PNG incorporado por CID. O PNG em `logo.js` é renderizado do logótipo oficial `assets/icons/cf-icon.svg`. Todos os avisos e o teste usam esta função. Cabeçalho azul-marinho com marca e slogan, mensagem, botão e contacto oficial no rodapé. Os campos variáveis são escapados como texto. Os emails de Auth permanecem por configurar separadamente.
