// Autenticación sin dependencias externas (módulo crypto de Node):
// - Contraseñas cifradas con scrypt + salt.
// - Token firmado con HMAC-SHA256 (formato similar a un JWT), válido 7 días.
const crypto = require('crypto');

const SECRET = process.env.AUTH_SECRET || 'voxready-dev-secret-cambiar-en-produccion';
const TOKEN_DAYS = 7;

// Roles en la base de datos ↔ roles usados por el frontend
const ROLE_TO_API = { VOCERO: 'user', ADMIN: 'admin', MASTER: 'master', SYSTEM: 'system' };
const ROLE_FROM_API = { user: 'VOCERO', admin: 'ADMIN', master: 'MASTER', system: 'SYSTEM' };

// ------------------------------------------------------------- Contraseñas

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

// ------------------------------------------------------------------ Token

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function createToken(user) {
  const payload = { sub: user.id, role: user.role, exp: Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000 };
  const body = b64(payload);
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = sign(body);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  return payload.exp > Date.now() ? payload : null;
}

// ------------------------------------------------------------- Formato

const initialsOf = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

// Usuario tal como lo ve el frontend (nunca incluye el hash de la contraseña)
function toApiUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    initials: initialsOf(user.name),
    role: ROLE_TO_API[user.role] || 'user',
    status: user.status,
    area: user.area,
    tenantId: user.tenantId,
    tenantName: user.tenant?.name || null,
    // Colores de la organización (configuración "Estilo"); null = colores de VoxReady
    palette:
      user.tenant?.brandColor && user.tenant?.accentColor
        ? { brand: user.tenant.brandColor, accent: user.tenant.accentColor }
        : null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

// ------------------------------------------------------------ Middleware

// Exige sesión iniciada y, opcionalmente, uno de los roles indicados (en formato API).
function requireAuth(prisma, roles = []) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      // El token también puede venir en la URL (?token=) para <video> y descargas
      const payload = readToken(header.replace(/^Bearer\s+/i, '') || req.query?.token);
      if (!payload) {
        return res.status(401).json({ status: 'error', mensaje: 'Sesión no válida o expirada. Inicia sesión nuevamente.' });
      }

      const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { tenant: true } });
      if (!user || user.status !== 'ACTIVE' || user.tenant?.status === 'SUSPENDED' || user.tenant?.status === 'DELETING') {
        return res.status(401).json({ status: 'error', mensaje: 'Tu cuenta o tu organización no está activa.' });
      }

      const apiRole = ROLE_TO_API[user.role];
      if (roles.length && !roles.includes(apiRole)) {
        return res.status(403).json({ status: 'error', mensaje: 'No tienes permiso para esta acción.' });
      }

      req.user = user;
      req.apiRole = apiRole;
      next();
    } catch (error) {
      console.error('Error de autenticación:', error);
      res.status(500).json({ status: 'error', mensaje: 'Error verificando la sesión.' });
    }
  };
}

module.exports = {
  ROLE_TO_API,
  ROLE_FROM_API,
  hashPassword,
  verifyPassword,
  createToken,
  toApiUser,
  initialsOf,
  requireAuth,
};
