export const TEST_USERS = [
  { role: 'user', initials: 'AT', name: 'Ana Torres', email: 'ana@visum.com', pass: 'demo1234' },
  { role: 'admin', initials: 'CR', name: 'Carlos Ruiz', email: 'carlos@visum.com', pass: 'demo1234' },
  { role: 'master', initials: 'MV', name: 'Marta Vidal', email: 'marta@voxready.io', pass: 'demo1234' }
];

export const CHARTDATA = [
  [55, 60, 64, 67, 70],
  [62, 68, 73, 78, 81],
  [60, 66, 70, 75, 79],
  [40, 46, 50, 54, 58]
];

// Colores de series definidos como variables CSS (se adaptan al modo oscuro)
export const CHARTCOLORS = ['rgb(var(--c1))', 'rgb(var(--c2))', 'rgb(var(--c3))', 'rgb(var(--c4))'];

export const roleIndex = (role) => (role === 'user' ? 0 : role === 'admin' ? 1 : 2);

export const homeFor = (role) => (role === 'user' ? '/vocero' : role === 'admin' ? '/admin' : '/maestro');
