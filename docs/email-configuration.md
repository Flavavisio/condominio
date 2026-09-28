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

## Emails de autenticação: hook ativo e recuperação confirmada

A Edge Function `auth-email` está publicada. Usa o mesmo Gmail e layout, verifica assinaturas Standard Webhooks e suporta confirmação, recuperação, convite, acesso por link, alteração de email (incluindo confirmação dupla) e código de reautenticação. Nunca envia palavras-passe. O endpoint recusa pedidos sem assinatura válida.

Ativar em https://supabase.com/dashboard/project/pvfrlirjdauncoudkomu/auth/hooks :

1. Criar hook **Send Email**, tipo HTTPS.
2. URL: `https://pvfrlirjdauncoudkomu.supabase.co/functions/v1/auth-email`.
3. Gerar o segredo de assinatura e copiá-lo integralmente para o Secret `SEND_EMAIL_HOOK_SECRET` em Edge Functions → Secrets. Não partilhar no chat nem no repositório.
4. Guardar/ativar o hook. O fornecedor Email deve estar ativo; ativar Confirm Email caso se pretenda confirmação no registo.

O hook substitui o SMTP de Auth; não é necessário duplicar a palavra-passe Gmail nas definições SMTP. O SMTP alternativo permanece válido se o hook não for usado.

A página `auth.html` permite pedir recuperação e confirmar links apenas após clicar, para evitar consumo automático por scanners. Links de recuperação/convite permitem definir uma palavra-passe; a aplicação tem o link “Esqueci-me da palavra-passe”. A função invite-member envia um convite Auth para todas as novas contas, mesmo que um cliente antigo envie uma palavra-passe. Nunca cria contas novas já confirmadas. Contas existentes conservam identidade e palavra-passe.

Adicionar `https://flavavisio.github.io/condominio/auth.html*` aos Redirect URLs e usar `https://flavavisio.github.io/condominio/app.html` como Site URL. Os links do hook apontam diretamente para a página de confirmação do projeto.

Validação local concluída para confirmação e recuperação com Auth simulado. Após a correção do segredo do hook em 28/09/2026, o pedido real de recuperação devolveu HTTP 200 e o proprietário confirmou a receção do email. A ativação de uma nova conta ainda não teve confirmação de receção num teste integral.

## Layout comum

`supabase/functions/email-dispatch/layout.js` centraliza o HTML, alternativa de texto e logótipo PNG incorporado por CID. O PNG em `logo.js` é renderizado do logótipo oficial `assets/icons/cf-icon.svg`. Todos os avisos e o teste usam esta função. Cabeçalho azul-marinho com marca e slogan, mensagem, botão e contacto oficial no rodapé. Os campos variáveis são escapados como texto. O layout também é usado pelo hook de Auth preparado.


## SMTP por empresa (28/09/2026)

O administrador abre **Configurações → Email da empresa**, indica servidor público, porta 465/TLS ou 587/2525/STARTTLS, utilizador, palavra-passe de aplicação, remetente e endereço de resposta. Guarda e testa. O teste envia apenas para o email da própria conta autenticada; exige um intervalo de um minuto. Uma alteração invalida a validação anterior; palavra-passe vazia preserva a existente. A interface nunca recebe o segredo guardado.

- Condomia/Gmail: destinatário Super Admin ou administrador da empresa; ativação/recuperação dos administradores.
- SMTP da gestora: funcionários e condóminos, incluindo convites e recuperação. Marca e contactos da empresa no layout comum; logótipo HTTPS da empresa quando configurado.
- Sem SMTP validado: novos convites da empresa são recusados antes de criar contas; notificações ficam pendentes sem consumir tentativas. Não há fallback para Gmail Condomia.
- Em erros de entrega, a configuração mostra o estado e os totais pendentes/em revisão. A fila retoma os pendentes automaticamente; entregas incertas não são repetidas. A revisão de entrega incerta é administrativa no servidor.
- Identidade em várias empresas, sem perfil de administrador: recuperação recusa encaminhamento ambíguo. Não escolhe silenciosamente outra empresa.
- Convites e recuperação são pedidos de Auth síncronos, não a fila de notificações. Em falha, o utilizador deve repetir o pedido; não são anunciados como enviados.

`company-email` valida a sessão e a associação ativa como administrador da empresa. `company_smtp` e `auth_email_routes` não têm privilégios de cliente; as credenciais JSON ficam cifradas no Vault. As funções privadas de acesso ao Vault só podem ser executadas pela service_role, com validação explícita desse papel. A remoção da configuração elimina o segredo cifrado. O transporte exige TLS, resolve um IPv4 público e fixa esse endereço para evitar acesso a redes internas e troca de DNS.

A rota de Auth vem de associações na base de dados ou da intenção de convite gravada pelo servidor, nunca de user_metadata. Registos públicos sem associações destinam-se a candidatos a administrador da plataforma. Contas sem associações não recebem recuperação pelo remetente da plataforma.

Verificação: `tests/company-email.test.mjs`, `tests/invite-member.test.mjs`, `supabase/tests/company-smtp.sql`, `supabase/tests/email-delivery.sql`; formulário validado em 390px e 1280px. O envio real por um SMTP de empresa requer que o administrador configure e teste as suas credenciais.

## Quotas automáticas e centro de emails

Em Financeiro, o gestor pode ativar uma regra mensal por condomínio, com valor fixo por fração ou total distribuído por permilagem. A tarefa diária das 08:10 UTC emite as quotas; valores já emitidos não mudam ao editar a regra. Os lembretes opcionais começam sete dias após o vencimento, no máximo um por semana e destinatário, e são suspensos com comprovativo pendente. Reativar uma regra recupera meses em falta desde o início configurado, até 24 meses.

Configurações → Centro de emails mostra os avisos operacionais da própria empresa, estado SMTP, tentativas e falhas. Apenas pendentes e tentativas seguras podem regressar à fila. Convites e recuperação continuam síncronos, fora deste histórico.
