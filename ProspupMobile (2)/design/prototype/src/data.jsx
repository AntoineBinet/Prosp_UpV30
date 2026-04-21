// ─────────────────────────────────────────────────────────────
// Mock data — cohérent avec le schéma ProspUp réel
// ─────────────────────────────────────────────────────────────

const PROSPECTS = [
  { id: 1, first: 'Camille', last: 'Moreau', company: 'Dassault Systèmes', role: 'Responsable R&D Robotique', status: 'rdv', pertinence: 5, phone: '06 12 34 56 78', email: 'c.moreau@dassault.fr', linkedin: true, followupDue: false, rdv: 'Jeudi 14h', lastContact: 'il y a 2j', tags: ['ROS2', 'Embedded', 'C++'], notes: 'Projet cobots chaîne de montage — recrute 3 ingé.' },
  { id: 2, first: 'Thomas', last: 'Leroy', company: 'Thales Alenia Space', role: 'Technical Lead Embarqué', status: 'appele', pertinence: 4, phone: '07 88 22 11 03', email: 't.leroy@thalesgroup.com', linkedin: true, followupDue: true, rdv: null, lastContact: 'il y a 5j', tags: ['RTOS', 'Spatial'], notes: 'Relance prévue mardi — attend retour DG.' },
  { id: 3, first: 'Sophie', last: 'Chen', company: 'Airbus Defence', role: 'Head of Systems Engineering', status: 'prospecte', pertinence: 5, phone: '06 45 78 91 22', email: 's.chen@airbus.com', linkedin: true, followupDue: false, rdv: null, lastContact: '—', tags: ['Systems', 'MBSE', 'Leadership'], notes: 'Contact chaleureux, à relancer sous 2 semaines.' },
  { id: 4, first: 'Nicolas', last: 'Dupont', company: 'Safran Electronics', role: 'Firmware Engineer Sr.', status: 'messagerie', pertinence: 3, phone: '06 99 00 11 22', email: 'n.dupont@safran.fr', linkedin: false, followupDue: true, rdv: null, lastContact: 'il y a 10j', tags: ['Firmware', 'ARM'], notes: 'Messagerie pleine — essayer LinkedIn.' },
  { id: 5, first: 'Léa', last: 'Bernard', company: 'Schneider Electric', role: 'Embedded SW Manager', status: 'rappeler', pertinence: 4, phone: '07 11 22 33 44', email: 'l.bernard@se.com', linkedin: true, followupDue: true, rdv: null, lastContact: 'il y a 3j', tags: ['IoT', 'Management', 'Yocto'], notes: 'A demandé rappel à 17h aujourd\'hui.' },
  { id: 6, first: 'Antoine', last: 'Roux', company: 'Renault Group', role: 'ADAS Software Lead', status: 'rdv', pertinence: 5, phone: '06 55 44 33 22', email: 'a.roux@renault.com', linkedin: true, followupDue: false, rdv: 'Lundi 10h', lastContact: 'il y a 1j', tags: ['AUTOSAR', 'ADAS'], notes: 'Préparer fiche pré-RDV avec IA.' },
  { id: 7, first: 'Maxime', last: 'Petit', company: 'STMicroelectronics', role: 'Principal Engineer', status: 'prospecte', pertinence: 4, phone: '07 12 45 78 99', email: 'm.petit@st.com', linkedin: true, followupDue: false, rdv: null, lastContact: '—', tags: ['SoC', 'Hardware'], notes: '' },
  { id: 8, first: 'Clara', last: 'Martin', company: 'Naval Group', role: 'CTO Systèmes Navals', status: 'pasInteresse', pertinence: 2, phone: '06 00 00 00 00', email: 'c.martin@naval-group.com', linkedin: false, followupDue: false, rdv: null, lastContact: 'il y a 30j', tags: ['Leadership'], notes: 'Pas de besoin sur 2026.' },
];

const STATUS_META = {
  appele:       { label: 'Appelé',         color: 'appele' },
  rdv:          { label: 'RDV',            color: 'rdv' },
  prospecte:    { label: 'Prospecté',      color: 'prospecte' },
  messagerie:   { label: 'Messagerie',     color: 'messagerie' },
  rappeler:     { label: 'À rappeler',     color: 'rappeler' },
  pasInteresse: { label: 'Pas intéressé',  color: 'pasInteresse' },
  neutre:       { label: '—',              color: 'neutre' },
};

const COMPANIES = [
  { id: 1, name: 'Dassault Systèmes', logo: 'DS', sector: 'Industrial Software',  city: 'Vélizy',  prospects: 12, activeDeals: 3,  lastTouch: 'il y a 2j', accent: '#005386' },
  { id: 2, name: 'Thales Alenia Space', logo: 'TA', sector: 'Aerospace & Defence', city: 'Cannes',  prospects: 8,  activeDeals: 1,  lastTouch: 'il y a 5j', accent: '#004B87' },
  { id: 3, name: 'Airbus Defence',     logo: 'AD', sector: 'Aerospace',            city: 'Toulouse',prospects: 15, activeDeals: 4,  lastTouch: 'il y a 1j', accent: '#00205B' },
  { id: 4, name: 'Safran Electronics', logo: 'SE', sector: 'Aerospace',            city: 'Massy',   prospects: 6,  activeDeals: 0,  lastTouch: 'il y a 10j', accent: '#CE0E2D' },
  { id: 5, name: 'Schneider Electric', logo: 'SC', sector: 'Energy',              city: 'Rueil',    prospects: 9,  activeDeals: 2,  lastTouch: 'il y a 3j', accent: '#3DCD58' },
  { id: 6, name: 'Renault Group',      logo: 'RG', sector: 'Automotive',          city: 'Boulogne', prospects: 11, activeDeals: 2,  lastTouch: 'il y a 1j', accent: '#FFC300' },
  { id: 7, name: 'STMicroelectronics', logo: 'ST', sector: 'Semiconductors',      city: 'Crolles',  prospects: 7,  activeDeals: 1,  lastTouch: 'il y a 7j', accent: '#03234B' },
];

const CANDIDATES = [
  { id: 1, name: 'Arthur Delattre',  role: 'Ingénieur Embarqué Senior', skills: ['C++', 'ROS2', 'Linux', 'Yocto'], tjm: 650, exp: 8, match: 94, city: 'Paris',     avail: 'Immédiate' },
  { id: 2, name: 'Inès Bouaziz',     role: 'Firmware Engineer',          skills: ['STM32', 'RTOS', 'ARM', 'C'], tjm: 580, exp: 5, match: 88, city: 'Lyon',      avail: '2 sem.' },
  { id: 3, name: 'Victor Fontaine',  role: 'Tech Lead Robotique',        skills: ['ROS2', 'Python', 'SLAM', 'Gazebo'], tjm: 720, exp: 11, match: 86, city: 'Toulouse', avail: '1 mois' },
  { id: 4, name: 'Julie Lopez',      role: 'DevOps Embarqué',            skills: ['Yocto', 'CI/CD', 'Buildroot', 'Linux'], tjm: 620, exp: 7, match: 82, city: 'Nantes',   avail: '3 sem.' },
  { id: 5, name: 'Karim Benali',     role: 'Software Architect',         skills: ['C++20', 'AUTOSAR', 'SysML'], tjm: 780, exp: 13, match: 79, city: 'Boulogne', avail: 'Immédiate' },
];

const OBJECTIVES = [
  { id: 'calls', label: 'Appels',        done: 18, target: 25, color: '#60A5FA' },
  { id: 'mails', label: 'Emails',        done: 32, target: 40, color: '#FBBF24' },
  { id: 'rdv',   label: 'RDV pris',      done: 4,  target: 5,  color: '#4ADE80' },
  { id: 'news',  label: 'Nouveaux',      done: 7,  target: 10, color: '#C084FC' },
];

const XP = { level: 14, current: 2340, next: 3000, streak: 7, todayXp: 180 };

const ACTIVITY = [
  { when: '09:24', icon: '📞', text: 'Appel — Camille Moreau', sub: 'Dassault Systèmes · 12 min', kind: 'call' },
  { when: '10:12', icon: '✉️', text: 'Email envoyé — Thomas Leroy', sub: 'Template : Prise de contact ESN', kind: 'mail' },
  { when: '11:03', icon: '📅', text: 'RDV confirmé — Antoine Roux', sub: 'Lundi 10h · visio', kind: 'rdv' },
  { when: '13:45', icon: '🔁', text: 'Relance — Léa Bernard', sub: 'Rappel programmé à 17h', kind: 'follow' },
  { when: '14:22', icon: '⭐', text: 'Pertinence ↑ — Sophie Chen', sub: '4★ → 5★', kind: 'edit' },
];

Object.assign(window, { PROSPECTS, STATUS_META, COMPANIES, CANDIDATES, OBJECTIVES, XP, ACTIVITY });
