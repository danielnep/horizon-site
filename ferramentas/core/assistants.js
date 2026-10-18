import { TOOL_BY_ID } from './tools.js';

const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const groups = [
  {keys:['estoque','material','produto','compra'],tools:['planilhas','checklists','indicadores'],text:'Registre as movimentações, confira os materiais e acompanhe os resultados.'},
  {keys:['agenda','retorno','visita','cliente','ligacao'],tools:['agendamentos','servicos','indicadores'],text:'Organize as visitas, acompanhe cada atendimento e veja os resultados.'},
  {keys:['servico','prazo','etapa','equipe','obra','manutencao'],tools:['servicos','etapas','comprovantes'],text:'Acompanhe os serviços por etapa e guarde a confirmação da execução.'},
  {keys:['problema','ocorrencia','falha','inspecao','vistoria'],tools:['ocorrencias','checklists','comprovantes'],text:'Registre as ocorrências, confira a execução e reúna os comprovantes.'},
  {keys:['documento','nota','pedido','planilha','digitar'],tools:['planilhas','etapas'],text:'Organize as informações em um registro e acompanhe sua aprovação.'}
];

// Simuladores locais com regras: apresentam cenários, sem fingir uma IA conectada.
export function suggestTools(text) {
  const value = normalize(text);
  const matches = groups.filter(group=>group.keys.some(key=>value.includes(key)));
  return {
    tools:[...new Set(matches.flatMap(group=>group.tools))],
    text:matches.length?matches.map(group=>group.text).join(' '):'Conte uma tarefa concreta da sua rotina para ver uma sugestão neste exemplo.'
  };
}

export function readDocument(text) {
  const capture = expression => (String(text).match(expression)||[])[1]?.trim()||'';
  return {
    company:capture(/(?:empresa|fornecedor|cliente)\s*[:=-]\s*([^\n;]+)/i),
    title:capture(/(?:material|produto|item|registro)\s*[:=-]\s*([^\n;]+)/i),
    quantity:capture(/(?:quantidade|qtd\.?)\s*[:=-]\s*(\d+)/i),
    owner:capture(/(?:responsavel|responsável)\s*[:=-]\s*([^\n;]+)/i)
  };
}

export function answerMessage(text) {
  const value = normalize(text);
  if (/preco|valor|orcamento|custa/.test(value)) return 'Podemos preparar um orçamento para sua necessidade. Informe o serviço, a empresa e o prazo desejado para o responsável avaliar.';
  if (/agend|visita|retorno|horario/.test(value)) return 'Vamos organizar a visita. Informe a unidade, a data desejada e o responsável pelo atendimento. O pedido poderá seguir para a agenda.';
  if (/falha|problema|atraso|cancel/.test(value)) return 'Informe o que aconteceu, em qual unidade e quem pode acompanhar o caso. A ocorrência poderá ser registrada e encaminhada.';
  if (!value.trim()) return 'Digite uma mensagem para experimentar o atendimento.';
  return 'Recebemos sua solicitação. Descreva o serviço e a unidade para que o responsável possa dar continuidade ao atendimento.';
}

export const toolNames = ids => ids.map(id=>TOOL_BY_ID[id]?.name).filter(Boolean);
