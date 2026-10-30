// Catálogo de escenarios generales en INGLÉS (los administra el equipo de VoxReady).
//
// Es un catálogo INDEPENDIENTE: estos escenarios se escribieron en inglés y NO son la traducción
// automática del catálogo español. Cada uno tiene su propio título, contexto, mensajes clave,
// líneas rojas y configuración de entrevista.
// Se registran como escenarios generales con `language = 'en'`.
const LIBRARY_SCENARIOS_EN = [
  {
    title: 'Prolonged outage of an essential service',
    category: 'CRISIS',
    optic: 'Empathetic',
    context:
      'A technical failure left thousands of customers without service for more than 12 hours. The organization was slow to inform and criticism is growing on social media. You face a live interview.',
    keyMessages: [
      'We are sorry for the impact this interruption had on the people and families affected.',
      'The service is restored and we have identified the cause of the failure.',
      'We will compensate the affected customers automatically.',
      'We will improve our notification times so we inform much earlier.',
    ],
    redLines: ['Blaming customers, the weather or third parties without evidence.', 'Playing down the impact by saying it "was not that serious".', 'Promising timelines or amounts that are not confirmed.'],
  },
  {
    title: 'Customer data breach',
    category: 'CRISIS',
    optic: 'Formal',
    context:
      'Unauthorized access was detected to a database with customer names, emails and phone numbers. The scope is still under investigation. A technology journalist interviews you.',
    keyMessages: [
      'We detected the access, contained it and reported it to the relevant authority.',
      'No passwords or banking data were exposed according to the current investigation.',
      'We will contact every affected person with concrete recommendations.',
    ],
    redLines: ['Promising that "it will never happen again".', 'Blaming customers for using weak passwords.', 'Giving figures of affected people that are not yet confirmed.'],
  },
  {
    title: 'Preventive product recall',
    category: 'CRISIS',
    optic: 'Empathetic',
    context:
      'A defect was detected in a batch of products that could cause injuries. The organization announced a preventive recall and consumers are worried about what they already bought.',
    keyMessages: [
      "People's safety is our priority: that is why we are recalling the batch preventively.",
      'Anyone who has the product can return it and receive a full refund.',
      'We are investigating the origin of the defect together with the health authority.',
    ],
    redLines: ['Playing down the risk to consumers.', 'Blaming the supplier before the investigation is finished.'],
  },
  {
    title: 'Serious workplace accident',
    category: 'CRISIS',
    optic: 'Empathetic',
    context:
      'A worker was seriously injured at the organization facilities. The family and the union are demanding answers and the press is at the entrance.',
    keyMessages: [
      'Our priority is the worker and their family, whom we are supporting.',
      'We are fully cooperating with the authority investigation.',
      'We will review all our safety protocols.',
    ],
    redLines: ['Speculating about the causes or blaming the worker.', 'Disclosing personal or medical information about the affected person.'],
  },
  {
    title: 'Viral complaint on social media',
    category: 'CRISIS',
    optic: 'Empathetic',
    context:
      'A video of a customer reporting mistreatment by organization staff went viral. Thousands of comments are asking for an answer and a digital outlet contacts you.',
    keyMessages: [
      'We are sorry for what the person experienced and we have already contacted them directly.',
      'We are reviewing what happened with all the available evidence.',
      'That treatment does not represent our values and we will take action if warranted.',
    ],
    redLines: ['Discrediting the person who complained.', 'Announcing sanctions before the review is finished.'],
  },
  {
    title: 'Environmental impact on the community',
    category: 'CRISIS',
    optic: 'Technical',
    context:
      'Neighbours report odours and possible contamination of a stream near one of the organization plants. The environmental authority has started an inspection.',
    keyMessages: [
      'We take the neighbours concern seriously and we are on site.',
      'We will provide the authority with all the information and monitoring available.',
      'If an impact is confirmed, we will take responsibility for repairing it.',
    ],
    redLines: ['Denying the problem before having results.', 'Blaming other companies in the area without evidence.'],
  },
  {
    title: 'Announcing a price increase',
    category: 'MEDIOS',
    optic: 'Technical',
    context:
      'The organization announced a price increase starting next month, amid criticism from consumer associations. A radio programme invites you to explain it.',
    keyMessages: [
      'The increase responds to higher costs, not to larger profits.',
      'There will be benefits for the most vulnerable customers.',
      'We will keep looking for efficiencies to moderate future adjustments.',
    ],
    redLines: ['Blaming the authority or third parties without evidence.', 'Playing down the impact on household budgets.'],
  },
  {
    title: 'Presenting annual results',
    category: 'MEDIOS',
    optic: 'Technical',
    context:
      'A business outlet interviews you after the annual results were published: profits went up, but some branches were also closed.',
    keyMessages: [
      'The results reflect a year of greater operational efficiency.',
      'The people from the closed branches were relocated.',
      'We will keep investing in improving customer service.',
    ],
    redLines: ['Promising investments or figures that are not approved.'],
  },
  {
    title: 'Launching a new project',
    category: 'MEDIOS',
    optic: 'Formal',
    context:
      'The organization announces a new project that will create jobs in the area, but a group of neighbours is worried about its impact. You hold a press conference.',
    keyMessages: [
      'The project will create local jobs and will prioritize people from the district.',
      'We will comply with every required assessment and permit.',
      'We will open spaces for dialogue with the community.',
    ],
    redLines: ['Promising opening dates that are not confirmed.', 'Dismissing the neighbours concerns.'],
  },
  {
    title: 'Interview about an industry controversy',
    category: 'MEDIOS',
    optic: 'Formal',
    context:
      'Another company in the sector is caught up in a scandal and the journalist wants to know whether your organization has similar practices.',
    keyMessages: [
      'Our organization complies with the regulations and is audited periodically.',
      'We respect the investigations currently under way.',
    ],
    redLines: ['Commenting or speculating about another company case.', 'Claiming that "it could never happen in our company".'],
  },
  {
    title: 'Communicating an internal restructure',
    category: 'INSTITUCIONAL',
    optic: 'Empathetic',
    context:
      'The organization will reorganize entire areas and some people will change roles. There is internal unease and rumours of layoffs.',
    keyMessages: [
      'The goal of the restructure is to strengthen the organization in the long term.',
      'We will support every person through the transition.',
      'We will report each stage directly and promptly.',
    ],
    redLines: ['Playing down the employees concerns.', 'Denying changes that are in fact planned.'],
  },
  {
    title: 'Leadership change in the organization',
    category: 'INSTITUCIONAL',
    optic: 'Formal',
    context:
      'The organization top authority leaves the role unexpectedly. Shareholders, employees and the press are asking what will happen to the strategy.',
    keyMessages: [
      'The organization has a succession plan and operations continue as normal.',
      'The strategy and our commitments to customers remain unchanged.',
    ],
    redLines: ['Speculating about the personal reasons for the departure.', 'Announcing replacement names that are not confirmed.'],
  },
];

module.exports = { LIBRARY_SCENARIOS_EN };
