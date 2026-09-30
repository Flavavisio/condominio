# FSM — Equipas e serviços

Módulo opcional por empresa. O Super Admin define o preço mensal no catálogo; anual = 12 meses, IVA incluído. A ativação não efetua cobrança bancária.

## Equipa e equipas internas

Equipa permite editar nome/função e retirar gestores/funcionários da empresa. O nome é próprio da empresa; a identidade Auth e acessos a outras empresas/frações ficam preservados. Não se pode retirar um chefe com ordens pendentes. Administradores não podem ser removidos por este fluxo.

Equipas internas permite criar, editar e apagar equipas. Cada equipa tem um chefe com conta e elementos identificados por nome, sem necessidade de conta. Associações antigas a membros com conta mantêm-se até serem retiradas. Apagar arquiva a equipa e conserva o histórico; exige concluir ou cancelar ordens pendentes. Mudar o chefe atualiza as ordens agendadas; durante uma execução essa mudança é bloqueada. Equipas antigas sem chefe não recebem novas ordens.

## Condomínio → Serviços

Existe um único cartão por serviço periódico, com Editar, Histórico, Pausar/Reativar e Ordem de serviço. Os blocos separados de ordens e de modelos gerais de checklist foram removidos. As equipas usam o mesmo estilo de cartões, com Editar, Pausar/Reativar e Apagar.

Na ficha do serviço definem-se frequência, próxima data/hora, vários dias da semana para frequências semanal/quinzenal, prestador interno/externo, afazeres próprios e ativação das ordens. Valores continuam associados ao Financeiro. As configurações operacionais ficam numa tabela privada, separada dos dados públicos do serviço.

Guardar cria a primeira ordem e reutiliza a que ainda estiver aberta, sem duplicar. Editar atualiza a ordem agendada; uma execução já iniciada/concluída preserva a sua checklist e equipa. Ao fechar a execução, o servidor calcula a próxima data e cria uma ordem com a configuração atual. Frequências mensais/anuais usam meses de calendário; Pontual não cria outra ordem. A próxima data baseia-se no maior entre a data agendada e o dia atual de Lisboa, evitando gerar retroativamente todas as visitas em atraso.

Pausar cancela ordens ainda agendadas; uma execução em curso pode ser terminada, sem gerar outra enquanto o serviço estiver pausado. Reativar prepara a próxima ordem. Ordens antigas autónomas foram associadas a cartões pontuais para preservar o acesso ao histórico.

## Execução e visibilidade

O chefe que não é administrador tem apenas Serviços no menu. Recebe as ordens atribuídas e a lista atualiza de 30 em 30 segundos enquanto está aberta, sem interromper formulários. Só o chefe atribuído pode iniciar, guardar progresso e terminar uma ordem interna; a gestão regista execuções externas.

O visto «Serviço efetuado» regista o resultado global. Nos afazeres, visto = feito; sem visto = não feito. O progresso é guardado durante o serviço. Ao finalizar, o servidor calcula os minutos entre início e término, ignorando valores de horas enviados pelo cliente. Não há assiduidade, GPS ou horas editáveis. Observações são opcionais. O relatório inclui início/fim, duração, equipa, elementos e afazeres feitos/não feitos; pode ser impresso em PDF.

Manutenções com todos os afazeres feitos são concluídas. Com tarefas não feitas voltam a agendadas. Uma ordem de serviço periódico concluída cria uma visita genérica e atualiza a última execução; a próxima execução segue a configuração guardada no serviço.

Condóminos consultam apenas descrição, data e estado em Serviços. O RPC devolve uma projeção explícita, sem equipa, chefe, elementos, checklist ou relatório interno. As tabelas FSM não permitem acesso direto aos clientes.

## Validação

`supabase/tests/fsm.sql` e `supabase/tests/periodic-workflow.sql` cria dados temporários e faz rollback: isolamento entre empresas, privacidade de condóminos, elementos sem conta, edição/remoção de funcionário, preservação do histórico, fornecedor externo, checklist, cálculo de duração e transições. O fluxo visual é validado com a demonstração local em computador e telemóvel, sem contas ou emails reais.
