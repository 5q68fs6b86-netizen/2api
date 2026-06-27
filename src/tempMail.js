'use strict';

const { request } = require('./httpClient');

const DEFAULT_TEMP_MAIL_API = process.env.TEMP_MAIL_API || 'https://e.114514heihei.eu.org';
const DEFAULT_TEMP_MAIL_ADMIN_AUTH = process.env.TEMP_MAIL_ADMIN_AUTH || 'mapiwbh@pass';
const DEFAULT_TEMP_MAIL_DOMAIN = process.env.TEMP_MAIL_DOMAIN || '114514heihei.eu.org';

async function createTempEmail(name, options = {}) {
  const apiBase = options.apiBase || DEFAULT_TEMP_MAIL_API;
  const adminAuth = options.adminAuth || DEFAULT_TEMP_MAIL_ADMIN_AUTH;
  const domain = options.domain || DEFAULT_TEMP_MAIL_DOMAIN;
  const resp = await request(`${apiBase}/admin/new_address`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-auth': adminAuth,
    },
    body: { name, domain },
  });

  if (resp.status === 200 && resp.data && resp.data.jwt) {
    return resp.data;
  }

  throw new Error(`创建邮箱失败: ${JSON.stringify(resp.data)}`);
}

async function getMails(address, options = {}) {
  const apiBase = options.apiBase || DEFAULT_TEMP_MAIL_API;
  const adminAuth = options.adminAuth || DEFAULT_TEMP_MAIL_ADMIN_AUTH;
  const resp = await request(`${apiBase}/admin/mails?limit=20&offset=0&address=${encodeURIComponent(address)}`, {
    headers: { 'x-admin-auth': adminAuth },
  });

  return resp.status === 200 && resp.data ? (resp.data.results || []) : [];
}

async function getMailDetail(mailId, jwt, options = {}) {
  const apiBase = options.apiBase || DEFAULT_TEMP_MAIL_API;
  const resp = await request(`${apiBase}/api/mail/${mailId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  return resp.data;
}

function extractVerificationLink(html = '') {
  const normalized = normalizeEmailContent(html);
  const patterns = [
    /href="(https?:\/\/[^"]*confirm_email[^"]*)"/i,
    /href="(https?:\/\/[^"]*verify[^"]*)"/i,
    /href="(https?:\/\/[^"]*confirm[^"]*)"/i,
    /href="(https?:\/\/[^"]*activate[^"]*)"/i,
    /\b(https?:\/\/\S*confirm_email\S*)/i,
    /\b(https?:\/\/\S*verify\S*)/i,
    /\b(https?:\/\/\S*confirm\S*)/i,
    /\b(https?:\/\/\S*activate\S*)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return cleanVerificationLink(match[1]);
  }

  return null;
}

function normalizeEmailContent(content = '') {
  return String(content)
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function cleanVerificationLink(link) {
  return String(link)
    .replace(/&amp;/g, '&')
    .replace(/[)"'<>\]]+$/g, '');
}

async function waitForVerificationEmail(address, jwt, options = {}) {
  const timeoutMs = options.timeoutMs || 90000;
  const intervalMs = options.intervalMs || 3000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const mails = await getMails(address, options);
    for (const mail of mails) {
      const detail = await getMailDetail(mail.id, jwt, options).catch(() => ({}));
      const link = extractVerificationLink(
        detail.html || detail.text || detail.raw || mail.html || mail.text || mail.raw || '',
      );
      if (link) return { mail, detail, link };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}

module.exports = {
  DEFAULT_TEMP_MAIL_DOMAIN,
  createTempEmail,
  getMailDetail,
  getMails,
  extractVerificationLink,
  waitForVerificationEmail,
};
