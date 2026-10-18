import { TOOL_IDS } from './tools.js';
import { localDay, toolStats } from './store.js';

// Cada passo altera os mesmos dados que os formulários e botões do aplicativo.
// Uma demonstração só apresenta ferramentas que o visitante escolheu.
export class Demonstration {
  constructor(tools) {
    this.tools = TOOL_IDS.filter(id => tools.includes(id));
    this.steps = [];
    this.index = 0;
    this.ids = {};
    this.lastResult = '';
    this.title = 'Conferência da Unidade Norte';
    const add = (tool, action, label, detail) => {
      if (this.tools.includes(tool)) this.steps.push({tool, action, label, detail});
    };
    add('ocorrencias', 'incident', 'Registrar uma ocorrência', 'O problema entra na lista com prioridade e responsável.');
    add('ocorrencias', 'resolve', 'Encaminhar e resolver', 'A ocorrência muda de situação e mantém seu histórico.');
    add('agendamentos', 'appointment', 'Agendar a visita', 'A visita aparece na agenda com data, horário e responsável.');
    add('agendamentos', 'appointmentDone', 'Concluir o compromisso', 'O atendimento passa a constar como concluído.');
    add('etapas', 'approval', 'Criar uma solicitação', 'O processo entra na primeira etapa do quadro.');
    add('etapas', 'approve', 'Encaminhar e aprovar', 'A solicitação percorre as etapas até a aprovação.');
    add('servicos', 'service', 'Solicitar e iniciar o serviço', 'O serviço fica em andamento e recebe um responsável.');
    add('checklists', 'inspection', 'Conferir o checklist', 'Os itens são preenchidos no checklist da demonstração.');
    add('checklists', 'inspectionDone', 'Concluir a conferência', 'A conferência ganha histórico e atualiza as ferramentas conectadas.');
    add('servicos', 'serviceDone', 'Consultar o serviço concluído', 'A situação e o histórico mostram a execução concluída.');
    add('comprovantes', 'proof', 'Registrar um comprovante', 'A execução recebe um registro que pode ser aberto e baixado.');
    add('planilhas', 'sheet', 'Ver a planilha atualizar', 'O registro aparece na tabela e pode ser baixado.');
    add('indicadores', 'report', 'Consultar os resultados', 'Os indicadores são calculados a partir dos registros da demonstração.');
  }

  get current() { return this.steps[this.index]; }
  get finished() { return this.index >= this.steps.length; }

  run(store) {
    const step = this.current;
    if (!step) return null;
    const base = { title:this.title, owner:'Lucas', client:'Unidade Norte', company:'Unidade Norte' };
    let result = '';
    switch (step.action) {
      case 'incident': {
        const record = store.addIncident({...base, place:'Unidade Norte', priority:'normal'});
        this.ids.incident = record.id;
        result = 'Ocorrência registrada. Lucas é o responsável.';
        break;
      }
      case 'resolve':
        store.incidentAction(this.ids.incident);
        store.incidentAction(this.ids.incident);
        result = 'A ocorrência agora está resolvida.';
        break;
      case 'appointment': {
        const record = store.addAppointment({...base, date:localDay(store.now()), time:'10:00', kind:'Visita'});
        this.ids.appointment = record.id;
        result = 'Visita agendada para hoje, às 10:00.';
        break;
      }
      case 'appointmentDone':
        store.appointmentAction(this.ids.appointment, 'concluir');
        result = 'Visita concluída na agenda.';
        break;
      case 'approval':
        this.ids.approval = store.addApproval(base).id;
        result = 'Solicitação adicionada ao quadro de etapas.';
        break;
      case 'approve':
        store.approvalAction(this.ids.approval, 'avancar');
        store.approvalAction(this.ids.approval, 'avancar');
        result = 'O processo foi aprovado e está concluído.';
        break;
      case 'service': {
        const service = store.addService({...base, due:localDay(store.now())});
        this.ids.service = service.id;
        store.setServiceStatus(service.id, 'andamento');
        result = 'Serviço iniciado na Unidade Norte.';
        break;
      }
      case 'inspection': {
        if (store.state.inspection.status === 'concluido') store.newInspection();
        const inspection = store.state.inspection;
        inspection.title = this.title;
        inspection.owner = base.owner;
        if (this.ids.service) inspection.serviceId = this.ids.service;
        inspection.items.filter(item=>!item.done).forEach(item=>store.toggleInspectionItem(item.id));
        store.updateInspectionNotes('Materiais, área e equipamentos conferidos.');
        result = 'Os quatro itens foram conferidos. O checklist já pode ser concluído.';
        break;
      }
      case 'inspectionDone':
        store.completeInspection();
        result = 'Conferência concluída e registrada no histórico.';
        break;
      case 'serviceDone':
        store.setServiceStatus(this.ids.service, 'concluido');
        result = 'O serviço está concluído. Abra o histórico para ver as mudanças.';
        break;
      case 'proof': {
        const serviceId = this.ids.service || store.state.services.find(item=>item.status==='concluido')?.id;
        this.ids.proof = store.addProof({...base, serviceId, notes:'Conferência realizada, execução verificada e registrada.'}).id;
        result = 'Comprovante criado. Você pode abrir e baixar o registro abaixo.';
        break;
      }
      case 'sheet':
        // Uma ação conectada já produziu o registro. Uma planilha isolada recebe um registro manual.
        if (!store.state.rows.some(row=>row.title===this.title)) store.addRecord({...base, quantity:3});
        result = `A planilha tem ${store.state.rows.length} registros, incluindo a conferência demonstrada.`;
        break;
      case 'report': {
        const stats = toolStats(store.state);
        const has=id=>store.tools.length===1||store.enabled(id);
        const counts=[
          ['servicos',`${stats.completed} serviços concluídos`],
          ['checklists',`${stats.inspections} inspeções registradas`],
          ['ocorrencias',`${stats.openIncidents} ocorrências abertas`],
          ['agendamentos',`${stats.appointments} compromissos agendados`],
          ['etapas',`${store.state.approvals.filter(item=>item.stage==='concluido').length} processos aprovados`],
          ['comprovantes',`${stats.proofs} comprovantes`],
          ['planilhas',`${stats.rows} registros em planilha`]
        ].filter(([id])=>has(id)).map(([,text])=>text);
        result = 'Resultado da demonstração: '+counts.join('; ')+'.';
        break;
      }
    }
    this.lastResult = result;
    this.index++;
    return {tool:step.tool, result};
  }
}
