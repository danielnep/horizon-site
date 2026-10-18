export const TOOLS = Object.freeze([
  { id: 'planilhas', icon: 'table', name: 'Alimentação automática de planilhas', short: 'Planilhas', description: 'Registre uma vez. Sua planilha é atualizada automaticamente.', benefit: 'Menos digitação, menos retrabalho.', tags: ['registros','dados','planilha','automação'], category: 'registros' },
  { id: 'servicos', icon: 'briefcase', name: 'Acompanhamento de serviços', short: 'Serviços', description: 'Veja o que foi solicitado, iniciado, concluído ou está pendente.', benefit: 'Cada serviço no seu devido lugar.', tags: ['operação','serviços','prazos'], category: 'operacao' },
  { id: 'checklists', icon: 'checklist', name: 'Inspeções e checklists', short: 'Checklists', description: 'Conferências pelo celular, com registros e histórico.', benefit: 'Conferir e comprovar, no mesmo lugar.', tags: ['inspeções','checklist','conferência'], category: 'operacao' },
  { id: 'agendamentos', icon: 'calendar', name: 'Agendamentos e retornos', short: 'Agendamentos', description: 'Organize atendimentos, responsáveis e prazos.', benefit: 'Nenhum retorno fica para trás.', tags: ['agenda','atendimentos','retorno','prazos'], category: 'operacao' },
  { id: 'etapas', icon: 'workflow', name: 'Controle de etapas e aprovações', short: 'Etapas e aprovações', description: 'Acompanhe da solicitação até a conclusão.', benefit: 'Saiba o próximo passo e quem resolve.', tags: ['processos','etapas','aprovação'], category: 'operacao' },
  { id: 'ocorrencias', icon: 'flag', name: 'Ocorrências e solicitações', short: 'Ocorrências', description: 'Registre problemas e acompanhe a resolução.', benefit: 'Problema registrado. Responsável definido.', tags: ['problemas','ocorrência','solicitação'], category: 'operacao' },
  { id: 'indicadores', icon: 'chart', name: 'Indicadores e relatórios', short: 'Indicadores', description: 'Transforme suas atividades em informações para decidir.', benefit: 'Sua operação vista por inteiro.', tags: ['relatórios','indicadores','resultados'], category: 'resultados' },
  { id: 'comprovantes', icon: 'receipt', name: 'Comprovantes e registros de execução', short: 'Comprovantes', description: 'Reúna confirmações, fotos e histórico de serviços.', benefit: 'O que foi feito, com tudo registrado.', tags: ['comprovação','foto','execução','registros'], category: 'registros' }
]);
export const TOOL_IDS = TOOLS.map(tool => tool.id);
export const FLOW_ORDER = ['ocorrencias','agendamentos','etapas','checklists','servicos','comprovantes','planilhas','indicadores'];
export const TOOL_BY_ID = Object.fromEntries(TOOLS.map(tool => [tool.id, tool]));
const paths = {
  table: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 10h18M9 4v16M15 10v10"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a24 24 0 0 0 18 0M10 12v3h4v-3"/>',
  checklist: '<rect x="5" y="4" width="15" height="17" rx="3"/><path d="M9 3h7v3H9zM8 11l1 1 2-2M14 11h3M8 16l1 1 2-2M14 16h3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 17h2"/>',
  workflow: '<rect x="3" y="3" width="7" height="6" rx="2"/><rect x="14" y="15" width="7" height="6" rx="2"/><path d="M7 9v7a2 2 0 0 0 2 2h5M10 6h6a2 2 0 0 1 2 2v7"/>',
  flag: '<path d="M5 21V4m0 0c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  chart: '<path d="M4 3v17h17M8 16v-4M13 16V8M18 16V5"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h3"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v11h14V9M10 20v-7h4v7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-3M9 14l6 3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 3h4l1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  spark: '<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z"/>',
  link: '<path d="m10 8 3-3a5 5 0 0 1 7 7l-3 3M14 16l-3 3a5 5 0 0 1-7-7l3-3M8 16l8-8"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1 8M3 4v6h6"/>',
  photo: '<rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="8" cy="10" r="2"/><path d="m3 17 5-3 4 3 5-6 4 6"/>',
  message: '<path d="M21 12a9 9 0 0 1-13 8l-5 1 1-5a9 9 0 1 1 17-4Z"/><path d="M8 8c1 4 3 6 7 7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18"/>'
};
export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}
