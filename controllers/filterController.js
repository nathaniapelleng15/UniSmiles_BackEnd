const filterModel = require('../models/filterModel');

const FILTER_TYPES = new Set(['color', 'overlay', 'sticker']);

function sendError(res, next, statusCode, message) {
  res.status(statusCode);
  const error = new Error(message);
  error.statusCode = statusCode;
  return next(error);
}

function normalizeActive(value) {
  if (value === undefined) return 1;
  if (![true, false, 0, 1, '0', '1'].includes(value)) return null;
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function validateFilter(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const css_filter = typeof body.css_filter === 'string' ? body.css_filter.trim() : '';
  const description = body.description ?? '';
  const type = body.type ?? 'color';
  const preview_url = body.preview_url ?? '';
  const is_active = normalizeActive(body.is_active);
  if (!name || name.length > 100 || !css_filter || css_filter.length > 255) return { error: 'Name and CSS filter are required and must fit the database limits.' };
  if (!FILTER_TYPES.has(type)) return { error: 'Filter type must be color, overlay, or sticker.' };
  if (typeof description !== 'string' || description.length > 4000) return { error: 'Description must be a string of at most 4000 characters.' };
  if (typeof preview_url !== 'string' || preview_url.length > 500) return { error: 'Preview URL must be a string of at most 500 characters.' };
  if (is_active === null) return { error: 'is_active must be a boolean or 0/1.' };
  return { name, description, type, preview_url, css_filter, is_active };
}

const filterController = {
  getAllFilters: async (req, res, next) => {
    try {
      const filters = await filterModel.getAllFilters();
      return res.status(200).json({ success: true, count: filters.length, data: filters });
    } catch (error) {
      return next(error);
    }
  },

  getAllActiveFilters: async (req, res, next) => {
    try {
      const filters = await filterModel.getAllActiveFilters();
      return res.status(200).json({ success: true, count: filters.length, data: filters });
    } catch (error) {
      return next(error);
    }
  },

  createFilter: async (req, res, next) => {
    try {
      const data = validateFilter(req.body || {});
      if (data.error) return sendError(res, next, 400, data.error);
      const result = await filterModel.createFilter(data);
      const created = await filterModel.getFilterById(result.insertId);
      return res.status(201).json({ success: true, message: 'Filter created successfully.', data: created });
    } catch (error) {
      return next(error);
    }
  },

  updateFilter: async (req, res, next) => {
    try {
      if (!/^\d+$/.test(String(req.params.id ?? '')) || Number(req.params.id) < 1) {
        return sendError(res, next, 400, 'A valid filter ID is required.');
      }
      const existing = await filterModel.getFilterById(req.params.id);
      if (!existing) return sendError(res, next, 404, 'Filter not found.');
      const data = validateFilter(req.body || {});
      if (data.error) return sendError(res, next, 400, data.error);
      await filterModel.updateFilter(req.params.id, data);
      const updated = await filterModel.getFilterById(req.params.id);
      return res.status(200).json({ success: true, message: 'Filter updated successfully.', data: updated });
    } catch (error) {
      return next(error);
    }
  },

  deleteFilter: async (req, res, next) => {
    try {
      if (!/^\d+$/.test(String(req.params.id ?? '')) || Number(req.params.id) < 1) {
        return sendError(res, next, 400, 'A valid filter ID is required.');
      }
      const existing = await filterModel.getFilterById(req.params.id);
      if (!existing) return sendError(res, next, 404, 'Filter not found.');
      await filterModel.deleteFilter(req.params.id);
      return res.status(200).json({ success: true, message: `Filter with ID ${req.params.id} deleted successfully.` });
    } catch (error) {
      return next(error);
    }
  },
};

module.exports = filterController;
