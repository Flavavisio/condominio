# Condomia

Plataforma SaaS para empresas gestoras de condomínios.

## Modelo

**Super Admin → Empresa Gestora → Condomínios → Frações / Condóminos**

A **empresa gestora** é o cliente pagante da plataforma e pode gerir vários condomínios com branding próprio.

## Stack

- HTML5
- CSS3
- JavaScript ES Modules
- Supabase Auth
- Supabase PostgreSQL
- Row Level Security (RLS)
- GitHub Actions para validação de sintaxe

## Supabase

Project ref: `pvfrlirjdauncoudkomu`

Região: `eu-west-1`

O frontend utiliza apenas a **publishable key**. Nunca deve ser colocada uma `service_role` ou secret key no browser.

## Estrutura multi-tenant

### Base

- `profiles`
- `companies`
- `company_members`
- `condominiums`
- `fractions`
- `condominium_members`
- `issues`

### Operação já migrada

- `notices`
- `notice_reads`
- `documents`
- `suppliers`
- `equipment`
- `maintenance`
- `obligations`
- `obligation_checklist_items`
- `obligation_inspections`

Todas as tabelas expostas têm RLS ativo e políticas por utilizador, empresa e condomínio.

## Frontend atual

O `main` já trabalha diretamente com Supabase e inclui:

- Login
- Criar conta
- Conta sem acesso / a aguardar ativação
- Dashboard
- Empresas gestoras
- Condomínios
- Workspace por condomínio
- Frações
- Ocorrências
- Avisos
- Fornecedores
- Equipamentos
- Manutenção
- Obrigações
- Vista transversal de ocorrências
- Vista transversal de obrigações
- Área simplificada de condómino

## Segurança

- RLS ativo nas tabelas expostas
- autorização separada por empresa e condomínio
- utilizadores não podem promover-se a `is_super_admin`
- gestores só podem visualizar perfis dos utilizadores que gerem
- write operations são validadas pelo PostgreSQL/RLS, não apenas pela interface
- Supabase Security Advisor sem alertas na última validação

## Primeiro acesso / Super Admin

1. Abrir a aplicação e escolher **Criar conta**.
2. Criar a conta com email e palavra-passe.
3. A conta ficará em **A aguardar ativação** até lhe ser atribuído um papel.
4. O `is_super_admin` deve ser atribuído no backend, nunca pelo frontend.

## Ainda por migrar da v11

- Espaços e reservas
- Assembleias
- Votações e sondagens
- Quotas e pagamentos
- Encomendas / portaria
- Mensagens e pedidos privados
- Notificações
- Visitantes e QR temporário
- Chaves / comandos / cartões
- Contactos de emergência
- Livro Digital / plantas e pontos
- Storage de logótipos, fotografias e documentos

## Validação

O repositório inclui:

```bash
npm run check
```

que valida a sintaxe dos módulos JavaScript. Existe também um workflow GitHub Actions em `.github/workflows/validate.yml`.

## Desenvolvimento local

Servir o repositório por HTTP, por exemplo:

```bash
python -m http.server 8080
```

Depois abrir:

```text
http://localhost:8080
```

Não abrir diretamente como `file://`, porque a aplicação usa ES Modules.


## Assembleias e votações

- A administração e os gestores com acesso ao condomínio podem criar assembleias, publicar a ordem de trabalhos e guardar a ata.
- Rascunhos ficam reservados à gestão. As assembleias agendadas aparecem no dashboard, na agenda e na área do condómino.
- As votações têm início e fim, associação opcional a uma assembleia e as opções A favor, Contra e Abstenção.
- Proprietários e representantes ativos podem votar uma vez por fração. O servidor regista a identidade e a permilagem; os votos não podem ser alterados.
- A gestão pode acompanhar os resultados. Os condóminos consultam os totais após o encerramento.
- O acesso à equipa e à criação de gestores/funcionários está no menu lateral do administrador da empresa.

A migração `supabase/migrations/20260925075423_assemblies_and_votes.sql` cria as tabelas, permissões e funções. O teste `supabase/tests/governance.sql` verifica os acessos e a integridade dos votos numa transação revertida no final; executar com o proprietário da base de dados.

A navegação principal mantém Equipa, Condomínios, Avisos e Fornecedores. As assembleias e votações estão nos separadores do condomínio, imediatamente após Financeiro. O Super Admin tem um dashboard de quantidades exatas por empresa gestora e acesso direto a Licenças no menu lateral.

### Acessos dos condóminos e aprovação de ocorrências

Na ficha do condomínio, em Frações, a gestora pode criar uma conta com email e palavra-passe inicial por fração. Um email já registado mantém a palavra-passe existente e recebe a associação à fração; não é criado como funcionário da gestora. Os gestores só podem criar acessos nos condomínios que lhes estão atribuídos. A criação é processada pela Edge Function `invite-member`.

A gestora pode nomear até dois administradores do condomínio entre os utilizadores com frações ativas. O limite e as permissões são validados na base de dados. As ocorrências de condóminos comuns ficam pendentes até um administrador aprovar ou rejeitar (com motivo). Só as aprovadas chegam à gestora e às suas notificações. O administrador vê a fila de aprovação no seu painel. A gestora trata o estado e o fornecedor após aprovação. As ocorrências existentes permanecem aprovadas. As votações mantêm um voto por fração, sem voto adicional por ser administrador.

Migração: `20260925095349_resident_accounts_and_issue_approval.sql`. O teste SQL `supabase/tests/resident-approval.sql` usa dados temporários e termina com rollback.

### Relatórios por condomínio

Em Relatórios é obrigatório selecionar um condomínio e gerar o relatório. São consultados os registos atuais, com paginação, respeitando as permissões do utilizador: financeiro por fração, cobranças, recebimentos, acessos, ocorrências, assembleias e atas, resultados agregados de votações, manutenções, equipamentos, obrigações, verificações, inspeções, serviços e visitas, fornecedores, documentos e avisos. O botão Imprimir / Guardar PDF abre uma versão para impressão.

O resumo financeiro calcula valores em cêntimos a partir das cobranças e alocações dos pagamentos; exclui cobranças anuladas dos totais de dívida. Não representa despesas ou saldo bancário. O relatório indica a data de geração e abrange todo o histórico acessível, sem misturar condomínios.

Verificações locais: `npm run check`, `node tests/invite-member.test.mjs` e `node tests/reports.test.mjs`.

### Portal do condómino e comprovativos

O condómino tem apenas Resumo, Ocorrências, Avisos, Assembleias, Votações e Financeiro. O botão Pagamento do condomínio abre as quotas por mês, valores em dívida e pagamentos das suas frações. Mesmo um administrador residente só consulta o financeiro das suas próprias frações; a validação financeira pertence à gestora (administrador ou gestor atribuído).

O envio de comprovativos aceita PDF, JPG, PNG e WEBP até 10 MB num bucket privado. Cada comprovativo indica uma quota, data e valor (total ou parcial). Permanece pendente sem liquidar a dívida. A gestora recebe uma notificação e, no Financeiro do condomínio, abre o ficheiro e valida ou rejeita com motivo. A validação regista o pagamento e a alocação na mesma transação; uma quota totalmente liquidada fica paga. Rejeições permitem novo envio. Os ficheiros submetidos não podem ser substituídos pelo condómino e só são abertos através de ligações temporárias autorizadas. Não existe cobrança online: o pagamento é realizado pelos meios indicados pela gestora.

A migração `20260925110943_resident_payment_proofs.sql` restringe as permissões financeiras, cria o armazenamento e a validação, e protege todas as alocações contra valores superiores à dívida/pagamento e cruzamento de frações. `supabase/tests/payment-proofs.sql` verifica o fluxo com dados temporários e rollback. O relatório completo inclui o estado dos comprovativos.
