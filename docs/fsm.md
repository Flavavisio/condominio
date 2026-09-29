# FSM — Equipas e serviços

Módulo opcional por empresa. O Super Admin define o preço mensal no catálogo; anual = 12 meses, IVA incluído. A ativação não efetua cobrança bancária.

## Equipa e equipas internas

Equipa permite editar nome/função e retirar gestores/funcionários da empresa. O nome é próprio da empresa; a identidade Auth e acessos a outras empresas/frações ficam preservados. Não se pode retirar um chefe com ordens pendentes. Administradores não podem ser removidos por este fluxo.

Equipas internas permite criar, editar e apagar equipas. Cada equipa tem um chefe com conta e elementos identificados por nome, sem necessidade de conta. Associações antigas a membros com conta mantêm-se até serem retiradas. Apagar arquiva a equipa e conserva o histórico; exige concluir ou cancelar ordens pendentes. Mudar o chefe atualiza as ordens agendadas; durante uma execução essa mudança é bloqueada. Equipas antigas sem chefe não recebem novas ordens.

## Condomínio → Serviços

Aqui criam-se as ordens, com descrição pública, data, equipa interna ou fornecedor externo. A escolha de equipa mostra automaticamente chefe e elementos. Podem combinar-se modelos gerais de checklist e afazeres próprios da ordem. Modelos antigos específicos de um condomínio continuam disponíveis nesse condomínio. Cada ordem guarda cópia dos afazeres, chefe e elementos; o histórico concluído não muda ao editar equipas/modelos.

Serviços periódicos mantêm os valores associados ao Financeiro. Ao criar um serviço periódico com FSM ativo, a opção de criar a ordem para a próxima execução está selecionada. Na edição é opcional. Não se geram automaticamente ordens para todas as recorrências futuras. A ordem também pode referenciar uma manutenção existente. O registo periódico manual de execução não aparece quando já existe uma ordem associada.

## Execução e visibilidade

O chefe que não é administrador tem apenas Serviços no menu. Recebe as ordens atribuídas e a lista atualiza de 30 em 30 segundos enquanto está aberta, sem interromper formulários. Só o chefe atribuído pode iniciar, guardar progresso e terminar uma ordem interna; a gestão regista execuções externas.

Visto = feito; sem visto = não feito. O progresso é guardado durante o serviço. Ao finalizar, o servidor calcula os minutos entre início e término, ignorando valores de horas enviados pelo cliente. Não há assiduidade, GPS ou horas editáveis. Observações são opcionais. O relatório inclui início/fim, duração, equipa, elementos e afazeres feitos/não feitos; pode ser impresso em PDF.

Manutenções com todos os afazeres feitos são concluídas. Com tarefas não feitas voltam a agendadas. Uma ordem de serviço periódico concluída cria uma visita genérica e atualiza a última execução; a próxima data é gerida na ficha do serviço.

Condóminos consultam apenas descrição, data e estado em Serviços. O RPC devolve uma projeção explícita, sem equipa, chefe, elementos, checklist ou relatório interno. As tabelas FSM não permitem acesso direto aos clientes.

## Validação

`supabase/tests/fsm.sql` cria dados temporários e faz rollback: isolamento entre empresas, privacidade de condóminos, elementos sem conta, edição/remoção de funcionário, preservação do histórico, fornecedor externo, checklist, cálculo de duração e transições. O fluxo visual é validado com a demonstração local em computador e telemóvel, sem contas ou emails reais.
