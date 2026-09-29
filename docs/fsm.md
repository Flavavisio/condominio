# FSM — Equipas e serviços

Módulo opcional por empresa, desligado por defeito. Preço inicial 0,00 EUR/mês, IVA incluído; anual = 12 meses. O Super Admin configura o catálogo em Módulos · FSM. O index consulta esse catálogo, sem um preço alternativo fixo. Os resumos das licenças apresentam o custo FSM e o total adicional quando ativo. Não existe cobrança bancária automática nesta funcionalidade. Alterar o catálogo altera o preço apresentado às empresas ativas.

O administrador ativa/desativa o módulo, cria várias equipas e escolhe colaboradores já existentes na empresa. Especialidades livres, com sugestões Limpeza, Eletricidade, Construção e Manutenção. O menu Equipas internas fica abaixo de Fornecedores. Os fornecedores já dispõem de email na ficha.

Cada condomínio pode ter várias checklists. Ao atribuir uma ordem, selecionam-se condomínio, equipa, data, novo serviço ou serviço periódico/manutenção existente e uma ou várias checklists. Os afazeres são copiados para a ordem e não mudam com futuras edições dos modelos.

Apenas o responsável ativo de cada equipa inicia e fecha os serviços. O chefe de equipa que não seja administrador tem apenas Serviços no menu; o administrador mantém os menus de gestão. As ordens exigem uma equipa previamente criada, ativa e com responsável ativo na empresa.

Durante o serviço, cada visto é guardado: marcado significa feito e desmarcado significa não feito. As horas trabalhadas no serviço da equipa podem ser ajustadas, com valor inicial baseado no tempo decorrido. São guardadas em minutos, separadas dos horários automáticos de início e término; não se multiplicam pelo número de membros. Observações são opcionais. Fechar serviço guarda o estado concluído, os vistos, as horas e um relatório automático quando não há observações. Serviços concluídos não aceitam alterações de progresso. O relatório pode ser impresso/guardado em PDF. Não existe picagem de assiduidade ou GPS.

O administrador escolhe o responsável ao editar a equipa; equipas antigas sem responsável não podem receber novas ordens.

Manutenções totalmente realizadas ficam concluídas. Havendo afazeres não realizados, voltam a agendadas para nova intervenção. Serviços periódicos geram uma visita de execução e atualizam a última data; a próxima data continua a ser gerida no serviço periódico.

RLS impede acesso direto às tabelas operacionais. Uma função privada autorizada por sessão, empresa ativa, licença, papel e equipa executa as operações através de wrapper público invoker. Super Admin configura preços e acesso; administrador gere equipas/modelos/ordens; funcionário vê os serviços das suas equipas; só o responsável pode iniciar e terminar. Condóminos não têm acesso. Dados e checklists não são apagados ao desativar o módulo. Resultados e transições são validados no servidor, com bloqueio da ordem nas transições e índice único para impedir duas ordens abertas para a mesma manutenção.

Validação: `supabase/tests/fsm.sql` usa dados temporários com rollback. Demonstração local permite experimentar todo o fluxo sem escrever em produção.
