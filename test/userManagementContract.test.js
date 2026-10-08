const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');

const modelPath = require.resolve('../models/userModel');
const controllerPath = require.resolve('../controllers/userController');
const filterModelPath = require.resolve('../models/filterModel');
const filterControllerPath = require.resolve('../controllers/filterController');

function loadController(userModel) {
  const oldModel = require.cache[modelPath];
  const oldController = require.cache[controllerPath];
  require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: userModel,
  };
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  if (oldModel) require.cache[modelPath] = oldModel;
  else delete require.cache[modelPath];
  if (oldController) require.cache[controllerPath] = oldController;
  else delete require.cache[controllerPath];
  return controller;
}

function loadFilterController(filterModel) {
  const oldModel = require.cache[filterModelPath];
  const oldController = require.cache[filterControllerPath];
  require.cache[filterModelPath] = {
    id: filterModelPath,
    filename: filterModelPath,
    loaded: true,
    exports: filterModel,
  };
  delete require.cache[filterControllerPath];
  try {
    return require(filterControllerPath);
  } finally {
    if (oldModel) require.cache[filterModelPath] = oldModel;
    else delete require.cache[filterModelPath];
    if (oldController) require.cache[filterControllerPath] = oldController;
    else delete require.cache[filterControllerPath];
  }
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('GET users maps SQL field names to the Admin DTO and omits password hashes', async () => {
  const controller = loadController({
    getAllUsers: async () => [{
      id: 7,
      full_name: 'Ayu',
      email: 'ayu@example.test',
      role: 'Klien',
      partner_name: 'Partner A',
      assigned_kiosks: '["K-01"]',
      service_mode: 'Self-managed',
      status: 'Active',
      updated_at: '2026-10-01T00:00:00.000Z',
      notes: 'verified',
      password_hash: 'must-not-leak',
    }],
  });
  const res = response();
  await controller.getAllUsers({}, res, assert.fail);

  assert.deepEqual(res.body.data[0], {
    id: '7',
    name: 'Ayu',
    email: 'ayu@example.test',
    role: 'Klien',
    partner: 'Partner A',
    assignedKiosks: ['K-01'],
    serviceMode: 'Self-managed',
    status: 'Active',
    lastActive: '2026-10-01T00:00:00.000Z',
    notes: 'verified',
  });
});

test('PUT status-only update persists without requiring name, email, or role', async () => {
  const existing = {
    id: 8,
    full_name: 'Bima',
    email: 'bima@example.test',
    role: 'Admin Mitra',
    partner_name: 'Partner B',
    assigned_kiosks: '[]',
    service_mode: 'Self-managed',
    status: 'Active',
    notes: '',
  };
  let saved;
  const controller = loadController({
    getUserById: async () => ({ ...existing, ...saved }),
    getAllUsers: async () => [existing],
    updateUser: async (_id, data) => { saved = data; },
  });
  const res = response();
  let error;
  await controller.updateUser({ params: { id: '8' }, body: { status: 'Inactive' } }, res, e => { error = e; });

  assert.equal(error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(saved.status, 'Inactive');
});

test('PUT rejects clearing the partner for a non-Super Admin account', async () => {
  const existing = {
    id: 8,
    full_name: 'Bima',
    email: 'bima@example.test',
    role: 'Admin Mitra',
    partner_name: 'Partner B',
    assigned_kiosks: '[]',
    service_mode: 'Self-managed',
    status: 'Active',
    notes: '',
  };
  let saved;
  const controller = loadController({
    getUserById: async () => ({ ...existing, ...saved }),
    updateUser: async (_id, data) => { saved = data; },
  });
  const res = response();
  let error;
  await controller.updateUser({ params: { id: '8' }, body: { partner: '  ' } }, res, e => { error = e; });

  assert.equal(res.statusCode, 400);
  assert.match(error.message, /Partner name is required/i);
  assert.equal(saved, undefined);
});

test('PUT rejects object-valued partner fields', async () => {
  let saved;
  const controller = loadController({
    getUserById: async () => ({ id: 8, full_name: 'Bima', email: 'bima@example.test', role: 'Admin Mitra', partner_name: 'Partner B', status: 'Active' }),
    updateUser: async (_id, data) => { saved = data; },
  });
  const res = response();
  let error;
  await controller.updateUser({ params: { id: '8' }, body: { partner: { name: 'Injected' } } }, res, e => { error = e; });

  assert.equal(res.statusCode, 400);
  assert.match(error.message, /Partner name/i);
  assert.equal(saved, undefined);
});

test('deleting the last active Super Admin is rejected by the backend', async () => {
  let deleted = false;
  const controller = loadController({
    getUserById: async () => ({ id: 1, role: 'Super Admin', status: 'Active' }),
    getAllUsers: async () => [{ id: 1, role: 'Super Admin', status: 'Active' }],
    deleteUser: async () => { deleted = true; },
  });
  const res = response();
  let error;
  await controller.deleteUser({ params: { id: '1' } }, res, e => { error = e; });

  assert.equal(deleted, false);
  assert.equal(res.statusCode, 409);
  assert.match(error.message, /Super Admin/i);
});

test('private user and filter routes reject requests without an authentication token', async t => {
  const adminRoutes = require('../routes/v1/adminRoutes');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin', adminRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/api/v1/admin`;

  for (const [method, pathname, body] of [
    ['GET', '/users'],
    ['POST', '/users', '{}'],
    ['PUT', '/users/1', '{}'],
    ['DELETE', '/users/1'],
    ['GET', '/filters'],
    ['POST', '/filters', '{}'],
  ]) {
    const result = await fetch(`${base}${pathname}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body,
    });
    assert.equal(result.status, 401, `${method} ${pathname} must require a session`);
  }
});

test('role middleware rejects authenticated users outside the allowlist', () => {
  const { requireRole } = require('../middlewares/authMiddleware');
  const res = response();
  let called = false;
  requireRole(['Super Admin'])({ user: { role: 'Klien' } }, res, () => { called = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(called, false);
});


test('filter creation persists the complete PhotoFilters payload', async () => {
  let filter;
  const controller = loadFilterController({
    createFilter: async data => { filter = { id: 41, ...data }; return { insertId: 41 }; },
    getFilterById: async () => filter || null,
  });
  const res = response();
  await controller.createFilter({ body: {
    name: 'Warm Studio',
    description: 'Warm color grading',
    type: 'color',
    preview_url: '/uploads/warm.png',
    css_filter: 'sepia(25%)',
    is_active: 1,
  } }, res, assert.fail);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body.data, {
    id: 41,
    name: 'Warm Studio',
    description: 'Warm color grading',
    type: 'color',
    preview_url: '/uploads/warm.png',
    css_filter: 'sepia(25%)',
    is_active: 1,
  });
});

test('filter status update preserves the CSS filter and applies the requested active state', async () => {
  let filter = {
    id: 41,
    name: 'Warm Studio',
    description: 'Warm color grading',
    type: 'color',
    preview_url: '/uploads/warm.png',
    css_filter: 'sepia(25%)',
    is_active: 1,
  };
  let saved;
  const controller = loadFilterController({
    getFilterById: async () => filter,
    updateFilter: async (_id, data) => { saved = data; filter = { ...filter, ...data }; },
  });
  const res = response();
  await controller.updateFilter({ params: { id: '41' }, body: { ...filter, is_active: 0 } }, res, assert.fail);

  assert.equal(res.statusCode, 200);
  assert.equal(saved.is_active, 0);
  assert.equal(saved.css_filter, 'sepia(25%)');
  assert.equal(res.body.data.is_active, 0);
});

test('POST rejects non-string identity fields instead of coercing objects into user data', async () => {
  let created = false;
  const controller = loadController({
    findUserByEmail: async () => null,
    create: async () => { created = true; return { insertId: 10 }; },
  });
  const res = response();
  let error;
  await controller.createUser({ body: {
    name: { display: 'Not a string' },
    email: 'person@example.test',
    password: 'Sufficient-Long1',
    role: 'Klien',
    partner: { name: 'Partner' },
    serviceMode: 'View Only',
    assignedKiosks: [],
    status: 'Active',
    notes: '',
  } }, res, e => { error = e; });

  assert.equal(res.statusCode, 400);
  assert.match(error.message, /Name, valid email/i);
  assert.equal(created, false);
});

test('POST user hashes the initial password and returns no credential material', async () => {
  const bcrypt = require('bcrypt');
  let saved;
  const controller = loadController({
    findUserByEmail: async () => null,
    create: async data => { saved = data; return { insertId: 9 }; },
    getUserById: async id => ({
      id,
      full_name: 'Cici',
      email: 'cici@example.test',
      role: 'Klien',
      partner_name: 'Client',
      assigned_kiosks: '["K-01"]',
      service_mode: 'View Only',
      status: 'Active',
      notes: '',
    }),
  });
  assert.equal(typeof controller.createUser, 'function', 'POST user creation is missing');
  if (typeof controller.createUser !== 'function') return;

  const res = response();
  await controller.createUser({ body: {
    name: 'Cici',
    email: ' CICI@example.test ',
    password: 'Sufficient-Long1',
    role: 'Klien',
    partner: 'Client',
    serviceMode: 'View Only',
    assignedKiosks: ['K-01'],
    status: 'Active',
    notes: '',
  } }, res, assert.fail);

  assert.equal(res.statusCode, 201);
  assert.equal(saved.email, 'cici@example.test');
  assert.notEqual(saved.password_hash, 'Sufficient-Long1');
  assert.equal(await bcrypt.compare('Sufficient-Long1', saved.password_hash), true);
  assert.equal(Object.hasOwn(res.body.data, 'password_hash'), false);
});
