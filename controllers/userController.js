const bcrypt = require('bcrypt');
const userModel = require('../models/userModel');

const ROLES = new Set(['Super Admin', 'Admin Mitra', 'Klien']);
const SERVICE_MODES = new Set([
  'Self-managed', 'Managed by Uni Inside', 'View Only', 'Platform Owner', 'Managed Support',
]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sendError(res, next, statusCode, message) {
  res.status(statusCode);
  const error = new Error(message);
  error.statusCode = statusCode;
  return next(error);
}

function parseAssignedKiosks(value) {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string');
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function toUserDto(user) {
  return {
    id: String(user.id),
    name: String(user.full_name ?? user.name ?? ''),
    email: String(user.email ?? ''),
    role: String(user.role ?? ''),
    partner: String(user.partner_name ?? (user.role === 'Super Admin' ? 'All Partners' : '')),
    assignedKiosks: parseAssignedKiosks(user.assigned_kiosks),
    serviceMode: String(user.service_mode ?? 'Self-managed'),
    status: String(user.status).toLowerCase() === 'inactive' ? 'Inactive' : 'Active',
    lastActive: user.updated_at ? String(user.updated_at) : (user.created_at ? String(user.created_at) : ''),
    notes: String(user.notes ?? ''),
  };
}

function validKiosks(value) {
  return Array.isArray(value)
    && value.length <= 100
    && value.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 100);
}

async function isLastActiveSuperAdmin(user) {
  if (user.role !== 'Super Admin' || String(user.status).toLowerCase() !== 'active') return false;
  const activeAdmins = (await userModel.getAllUsers()).filter(row =>
    row.role === 'Super Admin' && String(row.status).toLowerCase() === 'active'
  );
  return activeAdmins.length <= 1;
}

const userController = {
  getAllUsers: async (req, res, next) => {
    try {
      const users = await userModel.getAllUsers();
      return res.status(200).json({ success: true, count: users.length, data: users.map(toUserDto) });
    } catch (error) {
      return next(error);
    }
  },

  getUserById: async (req, res, next) => {
    try {
      const user = await userModel.getUserById(req.params.id);
      if (!user) return sendError(res, next, 404, 'User not found.');
      return res.status(200).json({ success: true, data: toUserDto(user) });
    } catch (error) {
      return next(error);
    }
  },

  createUser: async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const nameInput = body.name ?? body.full_name;
      const emailInput = body.email;
      const partnerInput = body.partner ?? body.partner_name;
      const name = typeof nameInput === 'string' ? nameInput.trim() : '';
      const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const role = body.role;
      const partner = typeof partnerInput === 'string' ? partnerInput.trim() : '';
      const serviceMode = body.serviceMode ?? body.service_mode ?? 'Self-managed';
      const status = body.status ?? 'Active';
      const assignedKiosks = body.assignedKiosks ?? body.assigned_kiosks ?? [];
      const notes = body.notes ?? '';

      if (!name || name.length > 100 || !email || email.length > 150 || !EMAIL_PATTERN.test(email) || !ROLES.has(role)) {
        return sendError(res, next, 400, 'Name, valid email, and supported role are required.');
      }
      if (partnerInput !== undefined && partnerInput !== null && typeof partnerInput !== 'string') {
        return sendError(res, next, 400, 'Partner name must be a string.');
      }
      if (password.length < 10 || password.length > 128) {
        return sendError(res, next, 400, 'Password must contain 10 to 128 characters.');
      }
      if (partner.length > 100) return sendError(res, next, 400, 'Partner name must be at most 100 characters.');
      if (role !== 'Super Admin' && !partner) {
        return sendError(res, next, 400, 'Partner name is required for this role.');
      }
      if (!SERVICE_MODES.has(serviceMode) || !['Active', 'Inactive'].includes(status) || !validKiosks(assignedKiosks)) {
        return sendError(res, next, 400, 'Invalid service mode, status, or assigned kiosks.');
      }
      if (typeof notes !== 'string' || notes.length > 4000) {
        return sendError(res, next, 400, 'Notes must be a string of at most 4000 characters.');
      }
      if (await userModel.findUserByEmail(email)) {
        return sendError(res, next, 409, 'Email is already registered.');
      }

      const password_hash = await bcrypt.hash(password, 10);
      const result = await userModel.create({
        full_name: name,
        email,
        password_hash,
        role,
        partner_name: role === 'Super Admin' ? null : partner,
        assigned_kiosks: assignedKiosks,
        service_mode: serviceMode,
        status,
        notes,
      });
      const created = await userModel.getUserById(result.insertId);
      return res.status(201).json({
        success: true,
        message: 'User created successfully.',
        data: toUserDto(created || {
          id: result.insertId, full_name: name, email, role,
          partner_name: role === 'Super Admin' ? null : partner,
          assigned_kiosks: assignedKiosks, service_mode: serviceMode, status, notes,
        }),
      });
    } catch (error) {
      return next(error);
    }
  },

  updateUser: async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!/^\d+$/.test(String(id ?? '')) || Number(id) < 1) {
        return sendError(res, next, 400, 'A valid user ID is required.');
      }
      const existing = await userModel.getUserById(id);
      if (!existing) return sendError(res, next, 404, 'User not found.');

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const fields = {};
      const has = key => Object.prototype.hasOwnProperty.call(body, key);
      if (has('name') || has('full_name')) {
        const nameInput = body.name ?? body.full_name;
        const name = typeof nameInput === 'string' ? nameInput.trim() : '';
        if (!name || name.length > 100) return sendError(res, next, 400, 'Name is required and must be at most 100 characters.');
        fields.full_name = name;
      }
      if (has('email')) {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (!email || email.length > 150 || !EMAIL_PATTERN.test(email)) return sendError(res, next, 400, 'A valid email of at most 150 characters is required.');
        if (email !== String(existing.email).toLowerCase()) {
          const duplicate = await userModel.findUserByEmail(email);
          if (duplicate && String(duplicate.id) !== String(id)) return sendError(res, next, 409, 'Email is already in use.');
        }
        fields.email = email;
      }
      if (has('role')) {
        if (!ROLES.has(body.role)) return sendError(res, next, 400, 'Unsupported role.');
        fields.role = body.role;
      }
      if (has('partner') || has('partner_name')) {
        const partnerInput = body.partner ?? body.partner_name;
        if (partnerInput !== undefined && partnerInput !== null && typeof partnerInput !== 'string') {
          return sendError(res, next, 400, 'Partner name must be a string of at most 100 characters.');
        }
        const partner = typeof partnerInput === 'string' ? partnerInput.trim() : '';
        if (partner.length > 100) return sendError(res, next, 400, 'Partner name must be at most 100 characters.');
        fields.partner_name = partner || null;
      }
      if (has('serviceMode') || has('service_mode')) {
        const serviceMode = body.serviceMode ?? body.service_mode;
        if (!SERVICE_MODES.has(serviceMode)) return sendError(res, next, 400, 'Unsupported service mode.');
        fields.service_mode = serviceMode;
      }
      if (has('assignedKiosks') || has('assigned_kiosks')) {
        const kiosks = body.assignedKiosks ?? body.assigned_kiosks;
        if (!validKiosks(kiosks)) return sendError(res, next, 400, 'Assigned kiosks must be an array of up to 100 names.');
        fields.assigned_kiosks = kiosks;
      }
      if (has('status')) {
        if (!['Active', 'Inactive'].includes(body.status)) return sendError(res, next, 400, 'Status must be Active or Inactive.');
        fields.status = body.status;
      }
      if (has('notes')) {
        if (typeof body.notes !== 'string' || body.notes.length > 4000) return sendError(res, next, 400, 'Notes must be a string of at most 4000 characters.');
        fields.notes = body.notes;
      }
      if (Object.keys(fields).length === 0) return sendError(res, next, 400, 'No supported fields were provided.');

      const nextRole = fields.role ?? existing.role;
      const nextPartner = Object.prototype.hasOwnProperty.call(fields, 'partner_name')
        ? fields.partner_name
        : existing.partner_name;
      if (nextRole !== 'Super Admin' && !nextPartner) return sendError(res, next, 400, 'Partner name is required for this role.');
      if (nextRole === 'Super Admin' && !has('partner') && !has('partner_name')) fields.partner_name = null;

      const losingSuperAdmin = existing.role === 'Super Admin'
        && String(existing.status).toLowerCase() === 'active'
        && (nextRole !== 'Super Admin' || fields.status === 'Inactive');
      if (losingSuperAdmin && await isLastActiveSuperAdmin(existing)) {
        return sendError(res, next, 409, 'Cannot disable or change the last active Super Admin.');
      }

      await userModel.updateUser(id, fields);
      const updated = await userModel.getUserById(id);
      return res.status(200).json({ success: true, message: 'User updated successfully.', data: toUserDto(updated) });
    } catch (error) {
      return next(error);
    }
  },

  deleteUser: async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!/^\d+$/.test(String(id ?? '')) || Number(id) < 1) {
        return sendError(res, next, 400, 'A valid user ID is required.');
      }
      const user = await userModel.getUserById(id);
      if (!user) return sendError(res, next, 404, 'User not found.');
      if (await isLastActiveSuperAdmin(user)) {
        return sendError(res, next, 409, 'Cannot delete the last active Super Admin.');
      }
      await userModel.deleteUser(id);
      return res.status(200).json({ success: true, message: `User with ID ${id} deleted successfully.` });
    } catch (error) {
      return next(error);
    }
  },
};

module.exports = userController;
