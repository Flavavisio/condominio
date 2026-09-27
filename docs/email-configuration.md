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

## Emails de autenticação: hook preparado, ativação no dashboard pendente

A Edge Function `auth-email` está publicada. Usa o mesmo Gmail e layout, verifica assinaturas Standard Webhooks e suporta confirmação, recuperação, convite, acesso por link, alteração de email (incluindo confirmação dupla) e código de reautenticação. Nunca envia palavras-passe. O endpoint recusa pedidos sem assinatura válida.

Ativar em https://supabase.com/dashboard/project/pvfrlirjdauncoudkomu/auth/hooks :

1. Criar hook **Send Email**, tipo HTTPS.
2. URL: `https://pvfrlirjdauncoudkomu.supabase.co/functions/v1/auth-email`.
3. Gerar o segredo de assinatura e copiá-lo integralmente para o Secret `SEND_EMAIL_HOOK_SECRET` em Edge Functions → Secrets. Não partilhar no chat nem no repositório.
4. Guardar/ativar o hook. O fornecedor Email deve estar ativo; ativar Confirm Email caso se pretenda confirmação no registo.

O hook substitui o SMTP de Auth; não é necessário duplicar a palavra-passe Gmail nas definições SMTP. O SMTP alternativo permanece válido se o hook não for usado.

A página `auth.html` permite pedir recuperação e confirmar links apenas após clicar, para evitar consumo automático por scanners. Links de recuperação/convite permitem definir uma palavra-passe; a aplicação tem o link “Esqueci-me da palavra-passe”. A função invite-member usa convite Auth quando não é fornecida uma palavra-passe; a criação direta com palavra-passe continua a manter o comportamento existente.

Adicionar `https://flavavisio.github.io/condominio/auth.html*` aos Redirect URLs e usar `https://flavavisio.github.io/condominio/app.html` como Site URL. Os links do hook apontam diretamente para a página de confirmação do projeto.

Validação local concluída para o fluxo de confirmação e recuperação com Auth simulado. O teste integrado de envio Auth depende da ativação do hook e do segredo de assinatura no dashboard.

## Layout comum

`supabase/functions/email-dispatch/layout.js` centraliza o HTML, alternativa de texto e logótipo PNG incorporado por CID. O PNG em `logo.js` é renderizado do logótipo oficial `assets/icons/cf-icon.svg`. Todos os avisos e o teste usam esta função. Cabeçalho azul-marinho com marca e slogan, mensagem, botão e contacto oficial no rodapé. Os campos variáveis são escapados como texto. O layout também é usado pelo hook de Auth preparado.
